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

echo "── OAuth token bound by the client's resource param (RFC 8707) ──"
CID=$(curl -s -X POST "$B/register" -H 'content-type: application/json' -d '{"client_name":"scope test","redirect_uris":["https://claude.ai/api/mcp/auth_callback"],"token_endpoint_auth_method":"none","grant_types":["authorization_code","refresh_token"],"response_types":["code"]}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(JSON.parse(d).client_id))")
VER="verifier-0123456789abcdefghijklmnopqrstuvwxyz"
CHAL=$(node -e "process.stdout.write(require('crypto').createHash('sha256').update('$VER').digest('base64url'))")
# The real consent flow: GET /authorize (with the RFC 8707 resource, which is what binds the
# token's slug), scrape the login_id it embeds, then POST login_id + password to /oauth/approve.
mint() { # $1 = resource URL for /authorize ('' = none → a station-wide token)
  local rq=""; [ -n "$1" ] && rq="&resource=$(node -e "process.stdout.write(encodeURIComponent(process.argv[1]))" "$1")"
  local az lid loc code
  az=$(curl -s "$B/authorize?client_id=$CID&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&response_type=code&code_challenge=$CHAL&code_challenge_method=S256&state=x&scope=mcp$rq")
  lid=$(printf '%s' "$az" | sed -n 's/.*name="login_id" value="\([^"]*\)".*/\1/p')
  loc=$(curl -s -o /dev/null -D - -X POST "$B/oauth/approve" -d "login_id=$lid" -d "password=test1234" | tr -d '\r' | grep -i '^location:')
  code=$(printf '%s' "$loc" | sed 's/.*code=\([^&]*\).*/\1/')
  curl -s -X POST "$B/token" -d "grant_type=authorization_code" -d "code=$code" -d "client_id=$CID" \
    -d "redirect_uri=https://claude.ai/api/mcp/auth_callback" -d "code_verifier=$VER" \
    | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(JSON.parse(d).access_token||''))"
}
AT=$(mint "$B/siyuan/mcp")
[ -n "$AT" ] && ok "minted a token for resource=/siyuan" || bad "mint" ""
[ "$(code siyuan "$AT")" = 200 ] && ok "opens /siyuan" || bad "opens /siyuan" "$(code siyuan "$AT")"
[ "$(code gemini_mcp "$AT")" = 403 ] && ok "403 on /gemini_mcp (scoping bites)" || bad "must 403 cross-MCP" "$(code gemini_mcp "$AT")"

echo "── OAuth token with NO resource is station-wide ──"
AT2=$(mint "")
[ -n "$AT2" ] && ok "minted a token with no resource param" || bad "mint no-resource" ""
[ "$(code gemini_mcp "$AT2")" = 200 ] && ok "opens /gemini_mcp" || bad "no-resource must open any MCP" "$(code gemini_mcp "$AT2")"
[ "$(code siyuan "$AT2")" = 200 ] && ok "opens /siyuan too (station-wide, by design)" || bad "no-resource must open any MCP" "$(code siyuan "$AT2")"

echo "── connections + revoke ──"
CONN=$(api "$B/api/mcps/siyuan/connections")
echo "$CONN" | grep -q 'scope test' && ok "connection listed on its module" || bad "connection not listed" "$CONN"
echo "$CONN" | grep -q '"lastUsedAt":[0-9]' && ok "last-used recorded" || bad "no lastUsedAt" "$CONN"
# Derive the connection handle for $AT directly (sha256b64url of the token, first 12 chars) rather
# than trusting list order — a station-wide token also shows in this list and could sort first.
H=$(node -e "process.stdout.write(require('crypto').createHash('sha256').update(process.argv[1]).digest('base64url').slice(0,12))" "$AT")
api -X DELETE "$B/api/connections/$H" > /dev/null
[ "$(code siyuan "$AT")" = 401 ] && ok "revoked token is dead" || bad "revoke did not kill the token" "$(code siyuan "$AT")"

echo
echo "== RESULT: $pass passed, $fail failed =="
[ "$fail" -eq 0 ]
