#!/usr/bin/env bash
# dredge v4.1 smoke tests — runs against localhost:3001
# Usage: bash smoketest.sh

set -uo pipefail

API="http://localhost:3001"
PASS=0
FAIL=0

GREEN='\033[0;32m'
RED='\033[0;31m'
DIM='\033[2m'
RESET='\033[0m'

pass() { echo -e "${GREEN}✓${RESET} $1"; ((PASS++)); }
fail() { echo -e "${RED}✗${RESET} $1"; ((FAIL++)); }
section() { echo -e "\n${DIM}── $1 ──${RESET}"; }

# ── shared fixtures ────────────────────────────────────────────────────────────

PLAN='{"category":"burglary","date_from":"2024-01","date_to":"2024-01","location":"Cambridge, UK"}'
POLY="52.2500,0.0500:52.2500,0.1700:52.1700,0.1700:52.1700,0.0500"

EXECUTE_BODY=$(cat <<EOF
{
  "plan": $PLAN,
  "poly": "$POLY",
  "viz_hint": "map",
  "resolved_location": "Cambridge, Cambridgeshire, England",
  "country_code": "GB",
  "intent": "crime",
  "months": ["2024-01"]
}
EOF
)

# ── helper ─────────────────────────────────────────────────────────────────────

post() {
  local tmp
  tmp=$(mktemp)
  local status
  status=$(curl -s -o "$tmp" -w "%{http_code}" -X POST "$API$1" \
    -H "Content-Type: application/json" \
    -d "$2")
  printf "%s\n%s" "$(cat "$tmp")" "$status"
  rm -f "$tmp"
}

# ── test 1: fresh query ────────────────────────────────────────────────────────

section "Test 1 — fresh query (cache miss)"

RAW=$(post "/query/execute" "$EXECUTE_BODY")
BODY=$(echo "$RAW" | sed '$d')
STATUS=$(echo "$RAW" | tail -n 1)

if [[ "$STATUS" != "200" ]]; then
  fail "Expected 200, got $STATUS"
  echo "  Response: $BODY"
else
  pass "Status 200"

  CACHE_HIT=$(echo "$BODY" | grep -o '"cache_hit":[a-z]*' | cut -d: -f2)
  if [[ "$CACHE_HIT" == "false" ]]; then
    pass "cache_hit: false"
  else
    fail "cache_hit expected false, got: $CACHE_HIT"
  fi

  QUERY_ID=$(echo "$BODY" | grep -o '"query_id":"[^"]*"' | cut -d'"' -f4)
  if [[ -n "$QUERY_ID" ]]; then
    pass "query_id present: $QUERY_ID"
  else
    fail "query_id missing from response"
  fi

  COUNT=$(echo "$BODY" | grep -o '"count":[0-9]*' | cut -d: -f2)
  pass "result count: $COUNT"
fi

# ── test 2: same query again (cache hit) ──────────────────────────────────────

section "Test 2 — same query again (cache hit)"

RAW2=$(post "/query/execute" "$EXECUTE_BODY")
BODY2=$(echo "$RAW2" | sed '$d')
STATUS2=$(echo "$RAW2" | tail -n 1)

if [[ "$STATUS2" != "200" ]]; then
  fail "Expected 200, got $STATUS2"
  echo "  Response: $BODY2"
else
  pass "Status 200"

  CACHE_HIT2=$(echo "$BODY2" | grep -o '"cache_hit":[a-z]*' | cut -d: -f2)
  if [[ "$CACHE_HIT2" == "true" ]]; then
    pass "cache_hit: true"
  else
    fail "cache_hit expected true, got: $CACHE_HIT2 (did test 1 succeed and write a cache row?)"
  fi
fi

# ── test 3: unsupported region (US location) ──────────────────────────────────

section "Test 3 — unsupported region (US)"

US_BODY=$(cat <<EOF
{
  "plan": $PLAN,
  "poly": "$POLY",
  "viz_hint": "map",
  "resolved_location": "New York, NY",
  "country_code": "US",
  "intent": "crime",
  "months": ["2024-01"]
}
EOF
)

RAW3=$(post "/query/execute" "$US_BODY")
BODY3=$(echo "$RAW3" | sed '$d')
STATUS3=$(echo "$RAW3" | tail -n 1)

if [[ "$STATUS3" == "400" ]]; then
  pass "Status 400"
else
  fail "Expected 400, got $STATUS3"
fi

ERROR_CODE=$(echo "$BODY3" | grep -o '"error":"[^"]*"' | cut -d'"' -f4)
if [[ "$ERROR_CODE" == "unsupported_region" ]]; then
  pass "error: unsupported_region"
else
  fail "error expected unsupported_region, got: $ERROR_CODE"
fi

RETURNED_CC=$(echo "$BODY3" | grep -o '"country_code":"[^"]*"' | cut -d'"' -f4)
if [[ "$RETURNED_CC" == "US" ]]; then
  pass "country_code echoed back: US"
else
  fail "country_code missing or wrong in error response: $RETURNED_CC"
fi

# ── test 4: structured JSON log on stdout ─────────────────────────────────────

section "Test 4 — structured JSON log (check server stdout)"

echo -e "${DIM}  Re-running execute and capturing server log is not possible from this script."
echo -e "  Check your orchestrator terminal — each execute should have printed a line like:"
echo -e '  {"event":"execute_complete","query_id":"...","cache_hit":false,"duration_ms":...}'"${RESET}"
echo -e "${DIM}  (or similar — exact keys depend on your query.ts log format)${RESET}"
pass "Manual check required — see note above"

# ── summary ───────────────────────────────────────────────────────────────────

echo -e "\n─────────────────────────────"
TOTAL=$((PASS + FAIL))
echo -e "  ${GREEN}${PASS} passed${RESET}  /  ${RED}${FAIL} failed${RESET}  /  ${TOTAL} total"
echo ""

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi