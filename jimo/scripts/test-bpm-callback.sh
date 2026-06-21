#!/usr/bin/env bash
# Simulate BPM approval-outcome callbacks against the NestJS webhook endpoint.
# Verifies the full chain: HMAC signature check -> timestamp window -> idempotent
# replay -> DB upsert. No BPM service required.
#
# Prerequisite: NestJS server running with BPM_CALLBACK_SECRET == $SECRET.
#
# Usage:
#   bash scripts/test-bpm-callback.sh
#   BPM_CALLBACK_SECRET=xxx WEBHOOK_URL=http://host:8888/... bash scripts/test-bpm-callback.sh
set -euo pipefail

SECRET="${BPM_CALLBACK_SECRET:-dev-test-secret}"
URL="${WEBHOOK_URL:-http://localhost:8888/api/v1/webhooks/bpm/approval}"
BIZ_ID="${BIZ_ID:-contract-test-001}"
TMP="$(mktemp)"

sign() {
  # hex HMAC-SHA256 over $1, matching NestJS verifyBpmSignature(secret, ts, body)
  printf '%s' "$1" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $NF}'
}

send() {
  # send LABEL BODY [TS_OVERRIDE] [SIG_OVERRIDE]
  local label="$1" body="$2" ts="${3:-$(date +%s%3N)}" sig="${4:-}"
  [ -z "$sig" ] && sig="$(sign "${ts}.${body}")"
  printf '\n=== %s ===\n' "$label"
  local code
  code=$(curl -s -o "$TMP" -w '%{http_code}' -X POST "$URL" \
    -H 'Content-Type: application/json' \
    -H "X-BPM-Timestamp: $ts" \
    -H "X-BPM-Signature: $sig" \
    --data "$body" 2>/dev/null || true)
  printf 'HTTP %s | body: ' "$code"
  cat "$TMP" 2>/dev/null || true
  echo
}

BODY_APPROVE='{"businessType":"contract","businessId":"'"$BIZ_ID"'","processInstanceId":"pi-'"$BIZ_ID"'","status":"APPROVED","initiatorId":"EMP003","approverId":"EMP008","comment":"curl test approve"}'
BODY_REJECT='{"businessType":"contract","businessId":"contract-test-002","processInstanceId":"pi-002","status":"REJECTED","initiatorId":"EMP003","approverId":"EMP009","comment":"curl test reject"}'

echo "Secret: $SECRET"
echo "URL:    $URL"

send "1) valid APPROVE            (expect HTTP 200, replay:false)" "$BODY_APPROVE"
send "2) replay same APPROVE      (expect HTTP 200, replay:true)"  "$BODY_APPROVE"
send "3) tampered signature       (expect HTTP 401)"               "$BODY_APPROVE" "$(date +%s%3N)" "deadbeef"
send "4) stale timestamp (-10min) (expect HTTP 401)"               "$BODY_APPROVE" "$(( $(date +%s%3N) - 600000 ))"
send "5) valid REJECT, 2nd row    (expect HTTP 200, replay:false)" "$BODY_REJECT"

rm -f "$TMP"
echo
echo "Verify in DB:"
echo "  SELECT business_type, business_id, status, approver_id, comment FROM lc_business_approvals ORDER BY created_at DESC LIMIT 5;"
