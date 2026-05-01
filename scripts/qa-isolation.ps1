param(
  [string]$Base = "https://pineapplee.com",
  [Parameter(Mandatory = $true)] [string]$EmailA,
  [Parameter(Mandatory = $true)] [string]$EmailB,
  [string]$Password = "TestPass123!"
)

$ErrorActionPreference = "Stop"

function New-Session([string]$email) {
  $loginBody = @{ email = $email; password = $Password } | ConvertTo-Json
  $session = $null
  $null = Invoke-WebRequest -Uri "$Base/api/auth/login" -Method Post -ContentType 'application/json' -Body $loginBody -UseBasicParsing -SessionVariable session
  return $session
}

function Try-Post([string]$path, $payload, $session) {
  $body = $payload | ConvertTo-Json -Depth 6
  try {
    $r = Invoke-WebRequest -Uri "$Base$path" -Method Post -ContentType 'application/json' -Body $body -UseBasicParsing -WebSession $session -TimeoutSec 30
    return @{ status = [int]$r.StatusCode; body = $r.Content }
  } catch {
    $st = if ($_.Exception.Response) { $_.Exception.Response.StatusCode.value__ } else { -1 }
    $bd = ''
    if ($_.Exception.Response) { try { $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream()); $bd = $reader.ReadToEnd() } catch {} }
    return @{ status = $st; body = $bd }
  }
}

Write-Host ""
Write-Host "==== Login as A ($EmailA) ====" -ForegroundColor Cyan
$sessA = New-Session $EmailA
$bootA = (Invoke-WebRequest -Uri "$Base/api/bootstrap" -Method Get -UseBasicParsing -WebSession $sessA).Content | ConvertFrom-Json
"  user.id     : $($bootA.user.id)"
"  conversations: $($bootA.conversations.Count)"
$convA = $bootA.conversations | Select-Object -First 1
"  pickedConvA : $($convA.id)"
$agentA = ($bootA.userAgents | Where-Object { $_.status -eq 'DEPLOYED' } | Select-Object -First 1).agentId
"  agentA      : $agentA"

Write-Host ""
Write-Host "==== Login as B ($EmailB) ====" -ForegroundColor Cyan
$sessB = New-Session $EmailB
$bootB = (Invoke-WebRequest -Uri "$Base/api/bootstrap" -Method Get -UseBasicParsing -WebSession $sessB).Content | ConvertFrom-Json
"  user.id     : $($bootB.user.id)"
"  conversations: $($bootB.conversations.Count)"
$bIds = $bootB.conversations | ForEach-Object { $_.id }
"  B can see A's conv? : $($bIds -contains $convA.id)"

Write-Host ""
Write-Host "==== B tries to chat INTO A's conversation ====" -ForegroundColor Cyan
$res = Try-Post "/api/chat" @{ prompt = "leak attempt"; conversationId = $convA.id; modelCode = "deepseek-v3-2" } $sessB
"  status: $($res.status)"
"  body  : $($res.body)"

Write-Host ""
Write-Host "==== B tries to create a conversation pinned to A's agent (still owned by B) ====" -ForegroundColor Cyan
$res2 = Try-Post "/api/conversations" @{ title = "B injection"; agentId = $agentA } $sessB
"  status: $($res2.status)"
"  body  : $($res2.body)"

Write-Host ""
Write-Host "==== B tries to fetch A's conversations via bootstrap (should only see own) ====" -ForegroundColor Cyan
$bootB2 = (Invoke-WebRequest -Uri "$Base/api/bootstrap" -Method Get -UseBasicParsing -WebSession $sessB).Content | ConvertFrom-Json
$bIds2 = $bootB2.conversations | ForEach-Object { $_.id }
"  bootstrap conversations for B: $($bIds2 -join ', ')"
"  B can see A's conv? : $($bIds2 -contains $convA.id)"
