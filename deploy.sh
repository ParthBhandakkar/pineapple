#!/usr/bin/env bash
# Same flow as deploy.ps1 — use this on macOS/Linux. Requires: tar, scp, ssh.
set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-root@187.127.154.116}"
REMOTE_PATH="${REMOTE_PATH:-/opt/agentsim}"
ARCHIVE_NAME="${ARCHIVE_NAME:-agentsim-deploy-current.tgz}"
REMOTE_ARCHIVE="${REMOTE_ARCHIVE:-/tmp/agentsim-deploy-current.tgz}"
SKIP_HEALTH_CHECK=0
NO_CLEANUP=0
SYNC_DOTENV=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-health-check) SKIP_HEALTH_CHECK=1 ;;
    --no-cleanup) NO_CLEANUP=1 ;;
    --sync-dotenv) SYNC_DOTENV=1 ;;
    -h | --help)
      echo "Usage: $0 [--skip-health-check] [--no-cleanup] [--sync-dotenv]"
      echo "Env: REMOTE_HOST REMOTE_PATH ARCHIVE_NAME REMOTE_ARCHIVE"
      echo "     DEPLOY_SYNC_DOTENV=1   — same as --sync-dotenv (ships .env.production to the VM)"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
  shift
done

for cmd in tar scp ssh; do
  command -v "$cmd" >/dev/null || {
    echo "Required command not found in PATH: $cmd" >&2
    exit 1
  }
done

if [[ -n "${DEPLOY_SSH_PASSWORD:-}" ]]; then
  command -v expect >/dev/null || {
    echo "DEPLOY_SSH_PASSWORD is set but 'expect' was not found (needed for non-interactive SSH)." >&2
    exit 1
  }
fi

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_ROOT"

if [[ "${DEPLOY_SYNC_DOTENV:-}" =~ ^(1|true|yes)$ ]]; then
  SYNC_DOTENV=1
fi

[[ -f docker-compose.yml ]] || {
  echo "docker-compose.yml not found in project root: $REPO_ROOT" >&2
  exit 1
}

if [[ "$SYNC_DOTENV" -eq 1 ]]; then
  [[ -f .env.production ]] || {
    echo ".env.production not found in $REPO_ROOT — nothing to sync." >&2
    exit 1
  }
  echo ">>> Including .env.production (will overwrite the copy under ${REMOTE_PATH} on the server)."
fi

ARCHIVE_PATH="$REPO_ROOT/$ARCHIVE_NAME"
cleanup() {
  if [[ "$NO_CLEANUP" -eq 0 && -f "$ARCHIVE_PATH" ]]; then
    rm -f "$ARCHIVE_PATH"
  fi
}
trap cleanup EXIT

echo "Creating archive: $ARCHIVE_PATH"
# Avoid macOS tar polluting the archive with LIBARCHIVE.xattr metadata (harmless but noisy on Linux extract).
export COPYFILE_DISABLE=1
tar_excludes=(
  --exclude=".git"
  --exclude="node_modules"
  --exclude=".next"
  --exclude=".venv"
)
[[ "$SYNC_DOTENV" -eq 0 ]] && tar_excludes+=(--exclude=".env.production")
tar_excludes+=(
  --exclude=".env"
  --exclude="agentsim-deploy*.tgz"
)
tar -czf "$ARCHIVE_PATH" "${tar_excludes[@]}" .

echo "Uploading archive to VM: ${REMOTE_HOST}:${REMOTE_ARCHIVE}"
if [[ -n "${DEPLOY_SSH_PASSWORD:-}" ]]; then
  expect "$REPO_ROOT/deploy/pw-scp.expect" "$ARCHIVE_PATH" "${REMOTE_HOST}:${REMOTE_ARCHIVE}"
else
  scp -o StrictHostKeyChecking=no "$ARCHIVE_PATH" "${REMOTE_HOST}:${REMOTE_ARCHIVE}"
fi

TMP_LOCAL="$(mktemp)"
REMOTE_SCRIPT_PATH="/tmp/agentsim-deploy-remote.sh"
{
  cat <<'EOS_HEAD'
set -euo pipefail
REMOTE_DIR=$1
UPLOAD=$2
EXTRACT_DIR=/tmp/agentsim-deploy-current

rm -rf "$EXTRACT_DIR"
mkdir -p "$EXTRACT_DIR"
tar -xzf "$UPLOAD" -C "$EXTRACT_DIR"

rsync -a --delete \
EOS_HEAD
  if [[ "$SYNC_DOTENV" -eq 0 ]]; then
    printf '%s\n' '  --exclude ".env.production" \'
  fi
  cat <<'EOS_TAIL'
  --exclude ".env" \
  --exclude ".env.local" \
  --exclude ".next" \
  --exclude ".venv" \
  --exclude "node_modules" \
  "$EXTRACT_DIR/" "$REMOTE_DIR/"

cd "$REMOTE_DIR"
docker compose up -d --build --remove-orphans

rm -f "$UPLOAD"
rm -rf "$EXTRACT_DIR"
rm -f /tmp/agentsim-deploy-remote.sh
EOS_TAIL
} >"$TMP_LOCAL"

echo "Uploading and running deploy commands on VM"
if [[ -n "${DEPLOY_SSH_PASSWORD:-}" ]]; then
  expect "$REPO_ROOT/deploy/pw-scp.expect" "$TMP_LOCAL" "${REMOTE_HOST}:${REMOTE_SCRIPT_PATH}"
else
  scp -o StrictHostKeyChecking=no "$TMP_LOCAL" "${REMOTE_HOST}:${REMOTE_SCRIPT_PATH}"
fi
rm -f "$TMP_LOCAL"

if [[ -n "${DEPLOY_SSH_PASSWORD:-}" ]]; then
  expect "$REPO_ROOT/deploy/pw-ssh.expect" "$REMOTE_HOST" "bash $REMOTE_SCRIPT_PATH $REMOTE_PATH $REMOTE_ARCHIVE"
else
  ssh -o StrictHostKeyChecking=no "$REMOTE_HOST" "bash $REMOTE_SCRIPT_PATH $REMOTE_PATH $REMOTE_ARCHIVE"
fi

echo "Deployment command completed. Checking service status..."
if [[ -n "${DEPLOY_SSH_PASSWORD:-}" ]]; then
  expect "$REPO_ROOT/deploy/pw-ssh.expect" "$REMOTE_HOST" "cd $REMOTE_PATH && docker compose ps"
else
  ssh -o StrictHostKeyChecking=no "$REMOTE_HOST" "cd $REMOTE_PATH && docker compose ps"
fi

if [[ "$SKIP_HEALTH_CHECK" -eq 0 ]]; then
  echo "Waiting for /api/health..."
  HEALTH_REMOTE='for _ in $(seq 1 30); do curl -sf http://127.0.0.1:3000/api/health >/dev/null && exit 0; sleep 3; done; exit 1'
  if [[ -n "${DEPLOY_SSH_PASSWORD:-}" ]]; then
    expect "$REPO_ROOT/deploy/pw-ssh.expect" "$REMOTE_HOST" "$HEALTH_REMOTE"
  else
    ssh -o StrictHostKeyChecking=no "$REMOTE_HOST" 'bash -lc "for _ in $(seq 1 30); do curl -sf http://127.0.0.1:3000/api/health >/dev/null && exit 0; sleep 3; done; exit 1"'
  fi
  echo "Health check passed."
fi
