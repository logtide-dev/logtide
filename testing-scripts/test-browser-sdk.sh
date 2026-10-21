#!/bin/bash
#
# Test script for Browser SDK features (Issue #156)
#
# Sends realistic browser-origin logs with:
#   - session_id fields (Phase 1)
#   - Core Web Vitals entries (Phase 2)
#   - Breadcrumbs attached to error logs
#   - Mixed sessions across services
#
# Usage:
#   ./test-browser-sdk.sh <API_KEY>
#
# Example:
#   ./test-browser-sdk.sh lp_abc123def456
#

set -euo pipefail

API_KEY="${1:-}"
BASE_URL="${2:-http://localhost:8080}"

if [ -z "$API_KEY" ]; then
  echo "Usage: $0 <API_KEY> [BASE_URL]"
  echo "Example: $0 lp_abc123def456 http://localhost:8080"
  exit 1
fi

echo "=== Browser SDK Test Data Generator ==="
echo "Base URL: $BASE_URL"
echo "API Key: ${API_KEY:0:10}..."
echo ""

# Helper: generate a UUID v4
gen_uuid() {
  printf '%08x-%04x-4%03x-%04x-%012x' \
    $RANDOM$RANDOM \
    $RANDOM \
    $((RANDOM % 4096)) \
    $((32768 + RANDOM % 16384)) \
    $RANDOM$RANDOM$RANDOM
}

gen_trace_id() {
  printf '%08x%08x%08x%08x' $RANDOM $RANDOM $RANDOM $RANDOM
}

# Fixed session IDs (so we can search for them)
SESSION_1=$(gen_uuid)
SESSION_2=$(gen_uuid)
SESSION_3=$(gen_uuid)
SESSION_4=$(gen_uuid)

echo "Generated test sessions:"
echo "  Session 1 (user-A checkout): $SESSION_1"
echo "  Session 2 (user-B browse):   $SESSION_2"
echo "  Session 3 (user-C errors):   $SESSION_3"
echo "  Session 4 (user-D mixed):    $SESSION_4"
echo ""

NOW_S=$(date +%s)

send_logs() {
  local body=$1
  local desc=$2

  local response
  response=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/v1/ingest" \
    -H "Content-Type: application/json" \
    -H "X-API-Key: $API_KEY" \
    -d "$body" 2>&1) || true

  local http_code
  http_code=$(echo "$response" | tail -1)
  local resp_body
  resp_body=$(echo "$response" | sed '$d')

  if [ "$http_code" = "200" ]; then
    echo "  [OK] $desc ($http_code)"
  else
    echo "  [FAIL] $desc - HTTP $http_code: $resp_body"
  fi
}

# ============================================================================
# Phase 1: Session-correlated logs (user journeys with session_id)
# ============================================================================
echo "--- Phase 1: Sending session-correlated logs ---"
echo ""

# Session 1: User-A checkout flow (10 logs over 5 minutes)
echo "Session 1: user-A checkout flow..."
TRACE_1=$(gen_trace_id)
for i in $(seq 1 10); do
  offset_s=$((300 - i * 30))
  ts_s=$((NOW_S - offset_s))
  ts=$(date -u -d @$ts_s +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || date -u -r $ts_s +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null)

  case $i in
    1)  msg="Page loaded: /products"; level="info"; svc="nextjs-frontend" ;;
    2)  msg="User clicked: button#add-to-cart [Add to Cart]"; level="info"; svc="nextjs-frontend" ;;
    3)  msg="API request: GET /api/cart -> 200 (45ms)"; level="info"; svc="nextjs-frontend" ;;
    4)  msg="Page navigation: /checkout"; level="info"; svc="nextjs-frontend" ;;
    5)  msg="User clicked: button#pay-now [Pay Now]"; level="info"; svc="nextjs-frontend" ;;
    6)  msg="API request: POST /api/orders -> 201 (320ms)"; level="info"; svc="nextjs-frontend" ;;
    7)  msg="Order created: order_id=ord-8821"; level="info"; svc="order-service" ;;
    8)  msg="Payment processed: charge_id=ch_93kx amount=49.99"; level="info"; svc="payment-service" ;;
    9)  msg="Page navigation: /order/confirmation"; level="info"; svc="nextjs-frontend" ;;
    10) msg="User clicked: a#continue-shopping [Continue Shopping]"; level="info"; svc="nextjs-frontend" ;;
  esac

  body='{"logs":[{"time":"'"$ts"'","service":"'"$svc"'","level":"'"$level"'","message":"'"$msg"'","session_id":"'"$SESSION_1"'","trace_id":"'"$TRACE_1"'","metadata":{"hostname":"browser","user_agent":"Mozilla/5.0 Chrome/120"}}]}'
  send_logs "$body" "Session-1 log $i"
done

echo ""

# Session 2: User-B browsing (8 logs, navigation-heavy)
echo "Session 2: user-B browsing session..."
for i in $(seq 1 8); do
  offset_s=$((240 - i * 30))
  ts_s=$((NOW_S - offset_s))
  ts=$(date -u -d @$ts_s +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || date -u -r $ts_s +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null)

  case $i in
    1) msg="Page loaded: /"; level="info" ;;
    2) msg="Page navigation: /products"; level="info" ;;
    3) msg="API request: GET /api/products -> 200 (89ms)"; level="info" ;;
    4) msg="Page navigation: /products/laptop-pro-16"; level="info" ;;
    5) msg="API request: GET /api/products/laptop-pro-16 -> 200 (34ms)"; level="info" ;;
    6) msg="Page navigation: /products/keyboard-mx"; level="info" ;;
    7) msg="API request: GET /api/products/keyboard-mx -> 200 (28ms)"; level="info" ;;
    8) msg="Page navigation: /about"; level="info" ;;
  esac

  body='{"logs":[{"time":"'"$ts"'","service":"sveltekit-app","level":"'"$level"'","message":"'"$msg"'","session_id":"'"$SESSION_2"'","metadata":{"hostname":"browser","user_agent":"Mozilla/5.0 Firefox/121"}}]}'
  send_logs "$body" "Session-2 log $i"
done

echo ""

# Session 3: User-C error session (logs with errors + breadcrumbs)
echo "Session 3: user-C error session..."
TRACE_3=$(gen_trace_id)
for i in $(seq 1 8); do
  offset_s=$((180 - i * 20))
  ts_s=$((NOW_S - offset_s))
  ts=$(date -u -d @$ts_s +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || date -u -r $ts_s +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null)

  case $i in
    1) msg="Page loaded: /dashboard"; level="info"; svc="nuxt-app" ;;
    2) msg="API request: GET /api/stats -> 200 (120ms)"; level="info"; svc="nuxt-app" ;;
    3) msg="User clicked: button#refresh [Refresh Data]"; level="info"; svc="nuxt-app" ;;
    4) msg="API request: GET /api/analytics -> 500 (2340ms)"; level="warn"; svc="nuxt-app" ;;
    5) msg="TypeError: Cannot read properties of undefined (reading 'map')"; level="error"; svc="nuxt-app" ;;
    6) msg="Internal server error on GET /api/analytics"; level="error"; svc="api-gateway" ;;
    7) msg="User clicked: button#retry [Retry]"; level="info"; svc="nuxt-app" ;;
    8) msg="API request: GET /api/analytics -> 200 (95ms)"; level="info"; svc="nuxt-app" ;;
  esac

  body='{"logs":[{"time":"'"$ts"'","service":"'"$svc"'","level":"'"$level"'","message":"'"$msg"'","session_id":"'"$SESSION_3"'","trace_id":"'"$TRACE_3"'","metadata":{"hostname":"browser","user_agent":"Mozilla/5.0 Safari/17"}}]}'
  send_logs "$body" "Session-3 log $i"
done

echo ""

# Session 4: User-D mixed session across services
echo "Session 4: user-D mixed session..."
for i in $(seq 1 6); do
  offset_s=$((120 - i * 20))
  ts_s=$((NOW_S - offset_s))
  ts=$(date -u -d @$ts_s +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || date -u -r $ts_s +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null)

  case $i in
    1) msg="Page loaded: /settings"; level="info"; svc="angular-admin" ;;
    2) msg="API request: GET /api/settings -> 200 (67ms)"; level="info"; svc="angular-admin" ;;
    3) msg="User clicked: button#save [Save Changes]"; level="info"; svc="angular-admin" ;;
    4) msg="API request: PUT /api/settings -> 200 (150ms)"; level="info"; svc="angular-admin" ;;
    5) msg="Settings updated successfully"; level="info"; svc="api-gateway" ;;
    6) msg="Page navigation: /settings/security"; level="info"; svc="angular-admin" ;;
  esac

  body='{"logs":[{"time":"'"$ts"'","service":"'"$svc"'","level":"'"$level"'","message":"'"$msg"'","session_id":"'"$SESSION_4"'","metadata":{"hostname":"browser","user_agent":"Mozilla/5.0 Chrome/120"}}]}'
  send_logs "$body" "Session-4 log $i"
done

echo ""

# ============================================================================
# Phase 2: Core Web Vitals logs
# ============================================================================
echo "--- Phase 2: Sending Core Web Vitals logs ---"
echo ""

# Generate Web Vitals for multiple sessions/services over last 2 hours
SERVICES=("nextjs-frontend" "sveltekit-app" "nuxt-app" "angular-admin")
WV_SESSIONS=("$SESSION_1" "$SESSION_2" "$SESSION_3" "$SESSION_4")

for s_idx in $(seq 0 3); do
  svc="${SERVICES[$s_idx]}"
  sid="${WV_SESSIONS[$s_idx]}"

  # Generate 5 sets of Web Vitals per service (simulating 5 page loads over 2 hours)
  for p in $(seq 1 5); do
    offset_s=$((7200 - p * 1400))
    ts_s=$((NOW_S - offset_s))
    ts=$(date -u -d @$ts_s +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || date -u -r $ts_s +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null)

    # LCP: good < 2500ms, needs-improvement 2500-4000, poor > 4000
    case $svc in
      "nextjs-frontend")  lcp=$((800 + RANDOM % 1500)) ;;
      "sveltekit-app")    lcp=$((600 + RANDOM % 1200)) ;;
      "nuxt-app")         lcp=$((1500 + RANDOM % 2500)) ;;
      "angular-admin")    lcp=$((1000 + RANDOM % 2000)) ;;
    esac
    if [ $lcp -lt 2500 ]; then lcp_rating="good";
    elif [ $lcp -lt 4000 ]; then lcp_rating="needs-improvement";
    else lcp_rating="poor"; fi

    # INP: good < 200ms, needs-improvement 200-500, poor > 500
    inp=$((50 + RANDOM % 350))
    if [ $inp -lt 200 ]; then inp_rating="good";
    elif [ $inp -lt 500 ]; then inp_rating="needs-improvement";
    else inp_rating="poor"; fi

    # CLS: good < 0.1, needs-improvement 0.1-0.25, poor > 0.25
    cls_int=$((RANDOM % 30))  # 0-29 -> 0.00-0.29
    cls="0.$(printf '%02d' $cls_int)"
    if [ $cls_int -lt 10 ]; then cls_rating="good";
    elif [ $cls_int -lt 25 ]; then cls_rating="needs-improvement";
    else cls_rating="poor"; fi

    body='{"logs":[
      {"time":"'"$ts"'","service":"'"$svc"'","level":"info","message":"Web Vital: LCP = '"$lcp"'","session_id":"'"$sid"'","metadata":{"performance.metric":"LCP","performance.value":'"$lcp"',"performance.rating":"'"$lcp_rating"'","performance.id":"v4-lcp-'"$p"'","hostname":"browser"}},
      {"time":"'"$ts"'","service":"'"$svc"'","level":"info","message":"Web Vital: INP = '"$inp"'","session_id":"'"$sid"'","metadata":{"performance.metric":"INP","performance.value":'"$inp"',"performance.rating":"'"$inp_rating"'","performance.id":"v4-inp-'"$p"'","hostname":"browser"}},
      {"time":"'"$ts"'","service":"'"$svc"'","level":"info","message":"Web Vital: CLS = '"$cls"'","session_id":"'"$sid"'","metadata":{"performance.metric":"CLS","performance.value":'"$cls"',"performance.rating":"'"$cls_rating"'","performance.id":"v4-cls-'"$p"'","hostname":"browser"}}
    ]}'

    send_logs "$body" "Web Vitals for $svc (page load $p)"
  done
done

echo ""

# ============================================================================
# Phase 3: Additional logs without session_id (contrast for filtering)
# ============================================================================
echo "--- Phase 3: Sending backend-only logs (no session_id, for contrast) ---"
echo ""

for i in $(seq 1 10); do
  offset_s=$((600 - i * 60))
  ts_s=$((NOW_S - offset_s))
  ts=$(date -u -d @$ts_s +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null || date -u -r $ts_s +"%Y-%m-%dT%H:%M:%S.000Z" 2>/dev/null)

  case $((i % 4)) in
    0) svc="api-gateway"; msg="Health check OK latency=2ms"; level="debug" ;;
    1) svc="order-service"; msg="Order batch processed: count=$((RANDOM % 50 + 10))"; level="info" ;;
    2) svc="payment-service"; msg="Stripe webhook received: event=payment_intent.succeeded"; level="info" ;;
    3) svc="auth-service"; msg="Token rotation completed, expired=$((RANDOM % 20)) tokens"; level="info" ;;
  esac

  body='{"logs":[{"time":"'"$ts"'","service":"'"$svc"'","level":"'"$level"'","message":"'"$msg"'","metadata":{"hostname":"srv-prod-1"}}]}'
  send_logs "$body" "Backend log $i (no session)"
done

echo ""
echo "=========================================="
echo " DONE!"
echo "=========================================="
echo ""
echo "Data sent:"
echo "  - 32 session-correlated logs across 4 sessions"
echo "  - 60 Core Web Vitals entries (LCP/INP/CLS x 4 services x 5 page loads)"
echo "  - 10 backend-only logs (no session_id, for contrast)"
echo ""
echo "Test sessions to search for:"
echo "  Session 1 (checkout):  $SESSION_1"
echo "  Session 2 (browsing):  $SESSION_2"
echo "  Session 3 (errors):    $SESSION_3"
echo "  Session 4 (settings):  $SESSION_4"
echo ""
echo "What to verify in the frontend:"
echo ""
echo "  1. DASHBOARD (http://localhost:5173/dashboard)"
echo "     - Core Web Vitals widget should show LCP, INP, CLS with good/needs-work/poor badges"
echo ""
echo "  2. SEARCH PAGE (http://localhost:5173/dashboard/logs)"
echo "     - Session ID filter: paste a session ID above into the 'Session ID' input"
echo "     - All logs for that session should appear"
echo "     - Expand a log -> session_id badge should be visible and clickable"
echo "     - Clicking the session badge auto-filters by that session"
echo "     - Search 'Web Vital:' to see all performance entries"
echo "     - Logs without session_id should NOT show a session badge"
echo ""
echo "  3. VERIFY SESSION FILTER WORKS"
echo "     - Filter by Session ID $SESSION_3"
echo "     - Should see 8 logs including the error ones"
echo "     - Clear the filter -> should see all logs again"
echo ""
