param(
    [string]$RemoteHost = "root@187.127.154.116",
    [string]$RemotePath = "/opt/agentsim",
    [string]$ArchiveName = "agentsim-deploy-current.tgz",
    [string]$RemoteArchive = "/tmp/agentsim-deploy-current.tgz",
    [switch]$SkipHealthCheck,
    [switch]$NoCleanup
)

$ErrorActionPreference = "Stop"

function Require-Cmd {
    param([string]$CommandName)

    if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
        throw "Required command not found in PATH: $CommandName"
    }
}

Require-Cmd "tar"
Require-Cmd "scp"
Require-Cmd "ssh"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not (Test-Path (Join-Path $repoRoot "docker-compose.yml"))) {
    throw "docker-compose.yml not found in project root: $repoRoot"
}

Set-Location $repoRoot
$archivePath = Join-Path $repoRoot $ArchiveName
$tmpRemoteScript = $null

Write-Host "Creating archive: $archivePath"
& tar -czf $archivePath --exclude=".git" --exclude="node_modules" --exclude=".next" --exclude=".venv" --exclude=".env.production" --exclude=".env" --exclude="agentsim-deploy*.tgz" .

try {
    Write-Host "Uploading archive to VM: ${RemoteHost}:$RemoteArchive"
    & scp -o StrictHostKeyChecking=no $archivePath "${RemoteHost}:$RemoteArchive"

    $remoteScript = @"
set -euo pipefail

REMOTE_DIR=`$1
UPLOAD=`$2
EXTRACT_DIR=/tmp/agentsim-deploy-current

rm -rf "`$EXTRACT_DIR"
mkdir -p "`$EXTRACT_DIR"
tar -xzf "`$UPLOAD" -C "`$EXTRACT_DIR"

rsync -a --delete \
  --exclude ".env.production" \
  --exclude ".env" \
  --exclude ".env.local" \
  --exclude ".next" \
  --exclude ".venv" \
  --exclude "node_modules" \
  "`$EXTRACT_DIR/" "`$REMOTE_DIR/"

cd "`$REMOTE_DIR"
docker compose up -d --build --remove-orphans

rm -f "`$UPLOAD"
rm -rf "`$EXTRACT_DIR"
rm -f /tmp/agentsim-deploy-remote.sh
"@

    $remoteScriptPath = "/tmp/agentsim-deploy-remote.sh"
    $tmpRemoteScript = Join-Path $env:TEMP "agentsim-deploy-remote-$(Get-Random).sh"
    Set-Content -Path $tmpRemoteScript -Value $remoteScript -NoNewline -Encoding UTF8

    Write-Host "Uploading and running deploy commands on VM"
    & scp -o StrictHostKeyChecking=no $tmpRemoteScript "${RemoteHost}:$remoteScriptPath"
    & ssh -o StrictHostKeyChecking=no $RemoteHost "bash $remoteScriptPath $RemotePath $RemoteArchive"

    Write-Host "Deployment command completed. Checking service status..."
    & ssh -o StrictHostKeyChecking=no $RemoteHost "cd $RemotePath && docker compose ps"

    if (-not $SkipHealthCheck.IsPresent) {
        Write-Host "Waiting for /api/health..."
        $healthCheck = @'
for _ in $(seq 1 30); do
  if curl -sf http://127.0.0.1:3000/api/health >/dev/null; then
    exit 0
  fi
  sleep 3
done
exit 1
'@

        & ssh -o StrictHostKeyChecking=no $RemoteHost $healthCheck
        Write-Host "Health check passed."
    }
}
finally {
    if (-not $NoCleanup.IsPresent -and (Test-Path $archivePath)) {
        Remove-Item $archivePath -Force
    }

    if ($null -ne $tmpRemoteScript -and (Test-Path $tmpRemoteScript)) {
        Remove-Item $tmpRemoteScript -Force
    }
}

