#!/usr/bin/env bash
# Per-MCP access control: module tokens, slug-scoped OAuth tokens, connections + revoke.
# Boots its own station on :8796 with throwaway state.
#   bash scripts/smoke-scoping.sh
set -u
PORT=8796
B="http://127.0.0.1:$PORT"
J="$(mktemp)"; DATA="$(mktemp -d)"; LOG="$(mktemp)"; MCPS="$(mktemp -d)"
cp -r mcps/. "$MCPS"/
pass=0; fail=0
ok()  { echo "  ✅ $1"; pass=$((pass+1)); }
bad() { echo "  ❌ $1 — got: ${2:-}"; fail=$((fail+1)); }
code() { curl -s -o /dev/null -w '%{http_code}' -X POST "$B/$1" -H "Authorization: Bearer $2" \
         -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
         -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'; }
api() { curl -s -b "$J" -H 'x-station-csrf: 1' -H 'content-type: application/json' "$@"; }

APP_PASSWORD=test1234 MCP_TOKEN=station-master PUBLIC_URL="$B" DATA_DIR="$DATA" MCPS_DIR="$MCPS" PORT=$PORT \
  node server/index.js > "$LOG" 2>&1 &
SRV=$!
trap 'kill -9 $SRV 2>/dev/null; rm -rf "$DATA" "$MCPS"' EXIT
for i in $(seq 20); do curl -s "$B/healthz" > /dev/null && break; sleep 0.4; done
curl -s -c "$J" -X POST "$B/api/login" -H 'content-type: application/json' -H 'x-station-csrf: 1' -d '{"password":"test1234"}' > /dev/null

echo "── station master token (MCP_TOKEN) ──"
[ "$(code siyuan station-master)" = 200 ] && ok "opens /siyuan" || bad "opens /siyuan" "$(code siyuan station-master)"
[ "$(code gemini_mcp station-master)" = 200 ] && ok "opens /gemini_mcp too (master key, by design)" || bad "opens /gemini_mcp" "$(code gemini_mcp station-master)"

echo "── per-module token ──"
MT=$(api -X POST "$B/api/mcps/siyuan/token" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(JSON.parse(d).token||''))")
[ -n "$MT" ] && ok "generated a token for siyuan" || bad "generate token" ""
[ "$(code siyuan "$MT")" = 200 ] && ok "opens its own MCP" || bad "opens its own MCP" "$(code siyuan "$MT")"
[ "$(code gemini_mcp "$MT")" = 401 ] && ok "REFUSED on another MCP" || bad "must be refused elsewhere" "$(code gemini_mcp "$MT")"
api "$B/api/mcps" | grep -q '"tokenSet":true' && ok "listing reports tokenSet" || bad "tokenSet not reported" ""

echo "── OAuth token bound by the client's resource param ──"
CID=$(curl -s -X POST "$B/register" -H 'content-type: application/json' -d '{"client_name":"scope test","redirect_uris":["https://claude.ai/api/mcp/auth_callback"]}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(JSON.parse(d).client_id))")
VER="verifier-0123456789abcdefghijklmnopqrstuvwxyz"
CHAL=$(node -e "process.stdout.write(require('crypto').createHash('sha256').update('$VER').digest('base64url'))")
mint() { # $1 = extra form fields
  LOC=$(curl -s -o /dev/null -D - -X POST "$B/oauth/approve" \
    -d "client_id=$CID" -d "redirect_uri=https://claude.ai/api/mcp/auth_callback" -d "response_type=code" \
    -d "code_challenge=$CHAL" -d "code_challenge_method=S256" -d "state=x" -d "scope=mcp" -d "password=test1234" \
    $1 | tr -d '\r' | grep -i '^location:')
  C=$(echo "$LOC" | sed 's/.*code=\([^&]*\).*/\1/')
  curl -s -X POST "$B/token" -d "grant_type=authorization_code" -d "code=$C" -d "client_id=$CID" \
    -d "redirect_uri=https://claude.ai/api/mcp/auth_callback" -d "code_verifier=$VER" \
    | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(JSON.parse(d).access_token||''))"
}
AT=$(mint "-d resource=$B/siyuan")
[ -n "$AT" ] && ok "minted a token for resource=/siyuan" || bad "mint" ""
[ "$(code siyuan "$AT")" = 200 ] && ok "opens /siyuan" || bad "opens /siyuan" "$(code siyuan "$AT")"
[ "$(code gemini_mcp "$AT")" = 403 ] && ok "403 on /gemini_mcp (scoping bites)" || bad "must 403 cross-MCP" "$(code gemini_mcp "$AT")"

echo "── OAuth token bound by the human on the approval page ──"
PAGE=$(curl -s "$B/authorize?client_id=$CID&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&response_type=code&code_challenge=$CHAL&code_challenge_method=S256&state=x&scope=mcp")
echo "$PAGE" | grep -q 'Which MCP may this client use' && ok "approval page asks which MCP (no resource sent)" || bad "no MCP picker on the page" ""
AT2=$(mint "-d grant_slug=gemini_mcp")
[ "$(code gemini_mcp "$AT2")" = 200 ] && ok "picked MCP opens" || bad "picked MCP" "$(code gemini_mcp "$AT2")"
[ "$(code siyuan "$AT2")" = 403 ] && ok "403 on the one it wasn't granted" || bad "must 403" "$(code siyuan "$AT2")"

echo "── connections + revoke ──"
CONN=$(api "$B/api/mcps/siyuan/connections")
echo "$CONN" | grep -q 'scope test' && ok "connection listed on its module" || bad "connection not listed" "$CONN"
echo "$CONN" | grep -q '"lastUsedAt":[0-9]' && ok "last-used recorded" || bad "no lastUsedAt" "$CONN"
H=$(echo "$CONN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(JSON.parse(d).connections[0].handle))")
api -X DELETE "$B/api/connections/$H" > /dev/null
[ "$(code siyuan "$AT")" = 401 ] && ok "revoked token is dead" || bad "revoke did not kill the token" "$(code siyuan "$AT")"

echo
echo "== RESULT: $pass passed, $fail failed =="
[ "$fail" -eq 0 ]
