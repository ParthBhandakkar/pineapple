#!/usr/bin/env bash
# Smoke checks after deploy. Usage: BASE_URL=https://pineapplee.com ./scripts/dry-test.sh
set -euo pipefail
BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"

echo ">>> GET $BASE_URL/api/health"
code="$(curl -sS -o /tmp/agentsim-health.json -w "%{http_code}" "$BASE_URL/api/health" || true)"
echo "    HTTP $code"
if [[ "$code" != "200" && "$code" != "503" ]]; then
  echo "    Unexpected status"
  cat /tmp/agentsim-health.json 2>/dev/null || true
  exit 1
fi
head -c 400 /tmp/agentsim-health.json | tr -d '\n'
echo ""
echo ">>> OK"
