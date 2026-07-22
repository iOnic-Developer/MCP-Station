#!/usr/bin/env bash
# OAuth 2.1 + MCP conformance and abuse suite.
#
# Written after a bug where /token demanded redirect_uri (optional per RFC 6749 §4.1.3) and so
# rejected EVERY real claude.ai connector — while the old tests, which always sent it, stayed green.
# The rule here: test what real clients and attackers actually send, never what we assume they send.
#
#   bash scripts/smoke-oauth.sh
set -u
PORT=8791
B="http://127.0.0.1:$PORT"
J="$(mktemp)"; DATA="$(mktemp -d)"; LOG="$(mktemp)"; MCPS="$(mktemp -d)"
cp -r mcps/. "$MCPS"/
pass=0; fail=0
ok()  { echo "  ✅ $1"; pass=$((pass+1)); }
bad() { echo "  ❌ $1 — got: ${2:-}"; fail=$((fail+1)); }
has() { echo "$1" | grep -q "$2"; }
jq1() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.stdout.write(String(JSON.parse(d)$1??''))}catch{process.stdout.write('')}})"; }
api() { curl -s -b "$J" -H 'x-station-csrf: 1' -H 'content-type: application/json' "$@"; }
RU="https://claude.ai/api/mcp/auth_callback"

APP_PASSWORD=test1234 MCP_TOKEN=station-master PUBLIC_URL="$B" DATA_DIR="$DATA" MCPS_DIR="$MCPS" PORT=$PORT \
  node server/index.js > "$LOG" 2>&1 &
SRV=$!
trap 'kill -9 $SRV 2>/dev/null; rm -rf "$DATA" "$MCPS"' EXIT
for i in $(seq 20); do curl -s "$B/healthz" > /dev/null && break; sleep 0.4; done
curl -s -c "$J" -X POST "$B/api/login" -H 'content-type: application/json' -H 'x-station-csrf: 1' -d '{"password":"test1234"}' > /dev/null

CID=$(curl -s -X POST "$B/register" -H 'content-type: application/json' \
  -d "{\"client_name\":\"Claude\",\"redirect_uris\":[\"$RU\"],\"token_endpoint_auth_method\":\"none\",\"grant_types\":[\"authorization_code\",\"refresh_token\"],\"response_types\":[\"code\"]}" | jq1 .client_id)
CID2=$(curl -s -X POST "$B/register" -H 'content-type: application/json' \
  -d "{\"client_name\":\"Other client\",\"redirect_uris\":[\"$RU\"],\"token_endpoint_auth_method\":\"none\",\"grant_types\":[\"authorization_code\",\"refresh_token\"],\"response_types\":[\"code\"]}" | jq1 .client_id)
VER="verifier-0123456789abcdefghijklmnopqrstuvwxyz"
CHAL=$(node -e "process.stdout.write(require('crypto').createHash('sha256').update('$VER').digest('base64url'))")

# The real consent flow: GET /authorize creates a server-side pending login and embeds a login_id
# in the HTML; POST that login_id + password to /oauth/approve. authz_loginid <cid> prints the id.
authz_loginid() { # <client_id>
  curl -s "$B/authorize?client_id=$1&redirect_uri=$RU&response_type=code&code_challenge=$CHAL&code_challenge_method=S256&state=st8&scope=mcp" \
    | sed -n 's/.*name="login_id" value="\([^"]*\)".*/\1/p'
}
# approve_loc <client_id> [extra form args…] → prints the Location header from /oauth/approve
approve_loc() {
  local cid="$1"; shift
  local lid; lid=$(authz_loginid "$cid")
  curl -s -o /dev/null -D - -X POST "$B/oauth/approve" -d "login_id=$lid" -d "password=test1234" "$@" \
    | tr -d '\r' | grep -i '^location:'
}
# mint <client_id> [extra form args…] → prints the authorization code
mint() {
  approve_loc "$@" | sed -n 's/.*code=\([^&]*\).*/\1/p'
}
mcp() { # mcp <slug> <token> [method]
  curl -s -o /dev/null -w '%{http_code}' -X "${3:-POST}" "$B/$1" -H "Authorization: Bearer $2" \
    -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
    -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
}

echo "── /authorize: errors must never become an open redirector ──"
R=$(curl -s -o /dev/null -w '%{http_code}' "$B/authorize?client_id=NOPE&redirect_uri=https://evil.example/cb&response_type=code&code_challenge=$CHAL&code_challenge_method=S256")
[ "$R" = 400 ] && ok "unknown client_id → 400, no redirect" || bad "unknown client must not redirect" "$R"
R=$(curl -s -o /dev/null -D - "$B/authorize?client_id=$CID&redirect_uri=https%3A%2F%2Fevil.example%2Fcb&response_type=code&code_challenge=$CHAL&code_challenge_method=S256" | tr -d '\r')
has "$R" '^HTTP/1.1 400' && ! has "$R" 'evil.example' && ok "unregistered redirect_uri → 400, never bounces to it" || bad "OPEN REDIRECT RISK" "$(echo "$R" | head -1)"

echo "── /authorize: recoverable errors MUST bounce back to the client (§4.1.2.1) ──"
L=$(curl -s -o /dev/null -D - "$B/authorize?client_id=$CID&redirect_uri=$RU&response_type=token&code_challenge=$CHAL&code_challenge_method=S256&state=st8" | tr -d '\r' | grep -i '^location:')
# The point is that a bad response_type BOUNCES BACK to the client (a Location redirect) instead of
# a 400 page that hangs the connector popup. The SDK reports the rejected enum as invalid_request;
# because response_type is the very field that selects the response mode, it can't echo state on
# this one — so we assert the redirect + error, not state (state IS preserved for other recoverable
# errors, checked below).
{ has "$L" 'error=unsupported_response_type' || has "$L" 'error=invalid_request'; } && ok "response_type=token → redirect with error (no hung 400 page)" || bad "must redirect with error (a 400 page hangs the client popup)" "$L"
L=$(curl -s -o /dev/null -D - "$B/authorize?client_id=$CID&redirect_uri=$RU&response_type=code&state=st8" | tr -d '\r' | grep -i '^location:')
has "$L" 'error=invalid_request' && ok "missing PKCE → redirect with error" || bad "missing PKCE must redirect with error" "$L"
L=$(curl -s -o /dev/null -D - "$B/authorize?client_id=$CID&redirect_uri=$RU&response_type=code&code_challenge=$CHAL&code_challenge_method=plain&state=st8" | tr -d '\r' | grep -i '^location:')
has "$L" 'error=invalid_request' && ok "PKCE 'plain' refused (S256 only)" || bad "plain PKCE must be refused" "$L"

echo "── approval gate ──"
LID=$(authz_loginid "$CID")
R=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$B/oauth/approve" -d "login_id=$LID" -d "password=WRONG")
[ "$R" = 401 ] && ok "wrong password → 401, no code" || bad "wrong password must not issue a code" "$R"
L=$(approve_loc "$CID" -d "deny=1")
has "$L" 'error=access_denied' && has "$L" 'state=st8' && ok "Deny → access_denied + state preserved" || bad "deny path" "$L"
C=$(mint "$CID"); [ -n "$C" ] && ok "Approve → code" || bad "approve issued no code" ""

echo "── /token: the shapes real clients actually send ──"
R=$(curl -s -X POST "$B/token" -d "grant_type=authorization_code" -d "code=$(mint "$CID")" -d "client_id=$CID" -d "code_verifier=$VER")
has "$R" 'access_token' && ok "NO redirect_uri (claude.ai's shape) → accepted" || bad "REGRESSION: claude.ai's token call rejected" "$R"
R=$(curl -s -X POST "$B/token" -d "grant_type=authorization_code" -d "code=$(mint "$CID")" -d "client_id=$CID" -d "redirect_uri=$RU" -d "code_verifier=$VER")
has "$R" 'access_token' && ok "WITH redirect_uri (Claude Code's shape) → accepted" || bad "token with redirect_uri" "$R"
R=$(curl -s -X POST "$B/token" -d "grant_type=authorization_code" -d "code=$(mint "$CID")" -d "client_id=$CID" -d "redirect_uri=https://evil.example/cb" -d "code_verifier=$VER")
has "$R" 'invalid_grant' && ok "WRONG redirect_uri → invalid_grant" || bad "wrong redirect_uri must be refused" "$R"

echo "── /token: abuse ──"
C=$(mint "$CID")
curl -s -X POST "$B/token" -d "grant_type=authorization_code" -d "code=$C" -d "client_id=$CID" -d "code_verifier=$VER" > /dev/null
R=$(curl -s -X POST "$B/token" -d "grant_type=authorization_code" -d "code=$C" -d "client_id=$CID" -d "code_verifier=$VER")
has "$R" 'invalid_grant' && ok "code is single-use (replay refused)" || bad "CODE REPLAY ACCEPTED" "$R"
R=$(curl -s -X POST "$B/token" -d "grant_type=authorization_code" -d "code=$(mint "$CID")" -d "client_id=$CID2" -d "code_verifier=$VER")
has "$R" 'invalid_grant' && ok "another client cannot redeem this code" || bad "CROSS-CLIENT CODE REDEMPTION" "$R"
R=$(curl -s -X POST "$B/token" -d "grant_type=authorization_code" -d "code=$(mint "$CID")" -d "client_id=$CID" -d "code_verifier=wrong-verifier")
has "$R" 'invalid_grant' && ok "wrong PKCE verifier refused" || bad "PKCE NOT ENFORCED" "$R"
# Omitting code_verifier must be REFUSED (PKCE not bypassable). The SDK rejects it at schema level
# as invalid_request (code_verifier is a required field) before the challenge compare — invalid_grant
# would come from a *present-but-wrong* verifier. Either way the grant is denied; that's the property.
R=$(curl -s -X POST "$B/token" -d "grant_type=authorization_code" -d "code=$(mint "$CID")" -d "client_id=$CID")
{ has "$R" 'invalid_grant' || has "$R" 'invalid_request'; } && ok "missing code_verifier refused" || bad "PKCE bypassable by omission" "$R"
# client_id is required for the handler to reach the grant_type check (public clients still identify).
R=$(curl -s -X POST "$B/token" -d "grant_type=password" -d "username=x" -d "password=y" -d "client_id=$CID")
has "$R" 'unsupported_grant_type' && ok "legacy grants refused" || bad "unsupported grant" "$R"

echo "── refresh rotation ──"
TOK=$(curl -s -X POST "$B/token" -d "grant_type=authorization_code" -d "code=$(mint "$CID")" -d "client_id=$CID" -d "code_verifier=$VER")
AT=$(echo "$TOK" | jq1 .access_token); RT=$(echo "$TOK" | jq1 .refresh_token)
R=$(curl -s -X POST "$B/token" -d "grant_type=refresh_token" -d "refresh_token=$RT" -d "client_id=$CID2")
has "$R" 'invalid_grant' && ok "another client cannot use this refresh token" || bad "CROSS-CLIENT REFRESH ACCEPTED" "$R"
R=$(curl -s -X POST "$B/token" -d "grant_type=refresh_token" -d "refresh_token=$RT" -d "client_id=$CID")
AT2=$(echo "$R" | jq1 .access_token); RT2=$(echo "$R" | jq1 .refresh_token)
[ -n "$AT2" ] && [ "$RT2" != "$RT" ] && ok "refresh works and rotates the refresh token" || bad "refresh rotation" "$R"
R=$(curl -s -X POST "$B/token" -d "grant_type=refresh_token" -d "refresh_token=$RT" -d "client_id=$CID")
has "$R" 'invalid_grant' && ok "the OLD refresh token is dead (no reuse)" || bad "REFRESH REUSE ACCEPTED" "$R"

echo "── MCP endpoint ──"
[ "$(mcp gemini_mcp "$AT2")" = 200 ] && ok "fresh access token opens the MCP" || bad "token should open the MCP" "$(mcp gemini_mcp "$AT2")"
[ "$(mcp gemini_mcp not-a-token)" = 401 ] && ok "garbage bearer → 401" || bad "garbage bearer" "$(mcp gemini_mcp not-a-token)"
D=$(curl -s -D - -o /dev/null -X POST "$B/gemini_mcp" -H 'Content-Type: application/json' -d '{}' | tr -d '\r')
has "$D" '401' && echo "$D" | grep -qi '^www-authenticate:' && ok "no bearer → 401 + WWW-Authenticate (client can discover the AS)" || bad "401 must carry WWW-Authenticate" "$(echo "$D" | head -1)"
[ "$(mcp gemini_mcp "$AT2" GET)" = 405 ] && ok "GET → 405 (stateless: POST only)" || bad "GET should be 405" "$(mcp gemini_mcp "$AT2" GET)"
[ "$(mcp gemini_mcp "$AT2" DELETE)" = 405 ] && ok "DELETE → 405" || bad "DELETE should be 405" "$(mcp gemini_mcp "$AT2" DELETE)"
[ "$(mcp nope-not-here "$AT2")" = 404 ] && ok "unknown slug → 404" || bad "unknown slug" "$(mcp nope-not-here "$AT2")"
api -X PATCH "$B/api/mcps/gemini" -d '{"enabled":false}' > /dev/null
[ "$(mcp gemini_mcp "$AT2")" = 404 ] && ok "disabled module → 404 even with a valid token" || bad "disabled module must not serve" "$(mcp gemini_mcp "$AT2")"
api -X PATCH "$B/api/mcps/gemini" -d '{"enabled":true}' > /dev/null

echo "── revocation ──"
curl -s -X POST "$B/revoke" -d "token=$AT2" -d "client_id=$CID" > /dev/null
[ "$(mcp gemini_mcp "$AT2")" = 401 ] && ok "/revoke kills the access token" || bad "revoked token still works" "$(mcp gemini_mcp "$AT2")"

echo "── browser surface: CORS where it belongs, nowhere else ──"
R=$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS -H 'Origin: https://claude.ai' -H 'Access-Control-Request-Method: POST' "$B/gemini_mcp")
[ "$R" = 204 ] && ok "preflight on the MCP → 204 without auth" || bad "preflight must not 401" "$R"
curl -s -D - -o /dev/null -H 'Origin: https://claude.ai' "$B/.well-known/oauth-authorization-server" | grep -qi 'access-control-allow-origin' && ok "discovery is cross-origin readable" || bad "discovery needs CORS" ""
curl -s -D - -o /dev/null -H 'Origin: https://evil.example' "$B/api/me" | grep -qi 'access-control-allow-origin' && bad "/api IS CORS-ENABLED — CSRF defence broken" "" || ok "/api has NO CORS (stays same-origin, CSRF holds)"

echo "── admin API gate ──"
R=$(curl -s -o /dev/null -w '%{http_code}' "$B/api/mcps")
[ "$R" = 401 ] && ok "no session → 401" || bad "admin API must require a session" "$R"
R=$(curl -s -b "$J" -o /dev/null -w '%{http_code}' -X POST "$B/api/reload")
[ "$R" = 403 ] && ok "session but no CSRF header → 403" || bad "CSRF header must be required on mutations" "$R"

echo
echo "== RESULT: $pass passed, $fail failed =="
[ "$fail" -eq 0 ]
