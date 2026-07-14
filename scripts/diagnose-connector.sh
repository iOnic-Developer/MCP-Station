#!/usr/bin/env bash
# Walks claude.ai's ENTIRE connector flow against a LIVE station, through your reverse proxy,
# and says exactly which step fails. Run it from any machine that can reach the public URL.
#
#   APP_PASSWORD='your-station-password' bash scripts/diagnose-connector.sh https://dbzocchi.app gemini_mcp
#
# It registers a throwaway OAuth client and mints one token, exactly as claude.ai would.
set -u
BASE="${1:-}"; SLUG="${2:-}"
PW="${APP_PASSWORD:-}"
[ -z "$BASE" ] || [ -z "$SLUG" ] && { echo "usage: APP_PASSWORD=… bash $0 <https://host> <slug>"; exit 2; }
BASE="${BASE%/}"
RED=''; ok() { echo "  ✅ $1"; }; bad() { echo "  ❌ $1"; RED=1; }
J() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.stdout.write(String(JSON.parse(d)$1??''))}catch{process.stdout.write('')}})"; }

echo "── 1. is the station reachable, and WHICH VERSION is actually running? ──"
H=$(curl -s -m 10 "$BASE/healthz")
V=$(echo "$H" | J ".version")
if [ -n "$V" ]; then ok "healthz → version $V   (fixes for connectors landed in 1.3.3 — if this is lower, the container was not rebuilt)"
else bad "no /healthz — wrong URL, or the proxy isn't reaching the station. Got: $(echo "$H" | head -c 120)"; fi
echo "$H" | grep -q '"oauth":true' && ok "OAuth is ON (PUBLIC_URL is set)" || bad "OAuth is OFF — PUBLIC_URL is not set on the container. claude.ai cannot connect without it."

echo "── 2. the MCP endpoint must 401 (not 404) and say where to authenticate ──"
D=$(curl -s -m 10 -D - -o /dev/null -X POST "$BASE/$SLUG" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' -d '{}' | tr -d '\r')
echo "$D" | head -1 | grep -q '401' && ok "401 (endpoint exists and is guarded)" || bad "expected 401, got: $(echo "$D" | head -1)  → 404 means the slug is wrong; 200 means it is UNPROTECTED"
echo "$D" | grep -qi '^www-authenticate:' && ok "WWW-Authenticate header present" || bad "no WWW-Authenticate header — the client cannot discover the auth server"

echo "── 3. discovery, cross-origin, exactly as claude.ai's browser does it ──"
for U in "/.well-known/oauth-protected-resource/$SLUG" "/.well-known/oauth-authorization-server"; do
  R=$(curl -s -m 10 -D - -H 'Origin: https://claude.ai' "$BASE$U" | tr -d '\r')
  echo "$R" | head -1 | grep -q '200' && ok "$U → 200" || bad "$U → $(echo "$R" | head -1)  (proxy blocking /.well-known?)"
  echo "$R" | grep -qi 'access-control-allow-origin' && ok "  CORS header present" || bad "  NO CORS header — the browser will block this (pre-1.3.3, or the proxy strips it)"
done
ISS=$(curl -s -m 10 "$BASE/.well-known/oauth-authorization-server" | J ".issuer")
[ "$ISS" = "$BASE" ] && ok "issuer matches your public URL ($ISS)" || bad "issuer is '$ISS' but you asked for '$BASE' — PUBLIC_URL is wrong on the container"

echo "── 4. preflight (a preflight carries no Authorization header — it must not 401) ──"
C=$(curl -s -m 10 -o /dev/null -w '%{http_code}' -X OPTIONS -H 'Origin: https://claude.ai' -H 'Access-Control-Request-Method: POST' "$BASE/register")
[ "$C" = 204 ] || [ "$C" = 200 ] && ok "OPTIONS /register → $C" || bad "OPTIONS /register → $C (proxy is eating preflights)"

echo "── 5. dynamic client registration ──"
CID=$(curl -s -m 10 -X POST "$BASE/register" -H 'content-type: application/json' \
  -d '{"client_name":"connector diagnosis","redirect_uris":["https://claude.ai/api/mcp/auth_callback"]}' | J ".client_id")
[ -n "$CID" ] && ok "registered client $CID" || { bad "registration failed — cannot continue"; exit 1; }

if [ -z "$PW" ]; then echo; echo "Set APP_PASSWORD=… to also test approval + token exchange + a real tool call."; exit ${RED:+1}; fi

echo "── 6. approve → code → token (the step claude.ai reports as 'Authorization failed') ──"
VER="diagnose-verifier-0123456789abcdefghijklmnop"
CHAL=$(node -e "process.stdout.write(require('crypto').createHash('sha256').update('$VER').digest('base64url'))")
LOC=$(curl -s -m 10 -o /dev/null -D - -X POST "$BASE/oauth/approve" \
  -d "client_id=$CID" -d "redirect_uri=https://claude.ai/api/mcp/auth_callback" -d "response_type=code" \
  -d "code_challenge=$CHAL" -d "code_challenge_method=S256" -d "state=diag" -d "scope=mcp" \
  -d "resource=$BASE/$SLUG" -d "password=$PW" | tr -d '\r' | grep -i '^location:')
echo "$LOC" | grep -q 'error=access_denied' && bad "APPROVAL WAS DENIED — pre-1.3.2 bug: Deny was the form's default submit button"
CODE=$(echo "$LOC" | sed -n 's/.*code=\([^&]*\).*/\1/p')
[ -n "$CODE" ] && ok "approval issued a code" || bad "no code — wrong password, or approval rejected. Location: ${LOC:-<none>}"
[ -n "$CODE" ] || exit 1
TOK=$(curl -s -m 10 -X POST "$BASE/token" -d "grant_type=authorization_code" -d "code=$CODE" \
  -d "client_id=$CID" -d "redirect_uri=https://claude.ai/api/mcp/auth_callback" -d "code_verifier=$VER")
AT=$(echo "$TOK" | J ".access_token")
[ -n "$AT" ] && ok "token exchange succeeded" || bad "token exchange failed: $(echo "$TOK" | head -c 200)"
[ -n "$AT" ] || exit 1

echo "── 7. the token actually opens the MCP ──"
C=$(curl -s -m 15 -o /dev/null -w '%{http_code}' -X POST "$BASE/$SLUG" -H "Authorization: Bearer $AT" \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
[ "$C" = 200 ] && ok "tools/list → 200 — the full claude.ai flow WORKS against this deployment" \
  || bad "tools/list → $C (403 = token scoped to a different MCP; 401 = proxy is stripping the Authorization header)"

echo
[ -z "$RED" ] && echo "== everything claude.ai needs is working. ==" || echo "== see the ❌ lines above. =="
[ -z "$RED" ]
