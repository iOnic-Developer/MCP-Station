#!/usr/bin/env bash
# MCP Station smoke test — boots the server on :8797 with throwaway state and
# exercises every surface: auth, admin API, OAuth PKCE round-trip, MCP
# handshake (static bearer + OAuth token), module lifecycle, export/backup.
# Usage: bash scripts/smoke.sh   (from the repo root, after npm install)
set -u
PORT=8797
B="http://127.0.0.1:$PORT"
J="$(mktemp)"; DATA="$(mktemp -d)"; LOG="$(mktemp)"; MCPS="$(mktemp -d)"
cp -r mcps/. "$MCPS"/   # throwaway copy so created modules don't pollute the repo
PASS=0; FAIL=0

say()  { printf '%s\n' "$*"; }
ok()   { PASS=$((PASS+1)); say "  ✅ $1"; }
bad()  { FAIL=$((FAIL+1)); say "  ❌ $1 — got: ${2:-}"; }
has()  { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }

APP_PASSWORD=test1234 PUBLIC_URL="$B" MCP_TOKEN=sekret-token \
DATA_DIR="$DATA" MCPS_DIR="$MCPS" PORT=$PORT node server/index.js >"$LOG" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null; rm -rf "$J" "$DATA" "$LOG" "$MCPS"' EXIT

for i in $(seq 1 40); do curl -sf "$B/healthz" >/dev/null 2>&1 && break; sleep 0.25; done

say "── health / auth ──"
R=$(curl -s "$B/healthz")
has "$R" '"ok":true' && ok "healthz" || bad "healthz" "$R"

R=$(curl -s -X POST "$B/api/login" -H 'content-type: application/json' -H 'x-station-csrf: 1' -d '{"password":"wrong"}')
has "$R" 'Wrong password' && ok "login rejects bad password" || bad "login rejects bad password" "$R"

R=$(curl -s -c "$J" -X POST "$B/api/login" -H 'content-type: application/json' -H 'x-station-csrf: 1' -d '{"password":"test1234"}')
has "$R" '"ok":true' && ok "login" || bad "login" "$R"

R=$(curl -s "$B/api/mcps")
has "$R" 'Not signed in' && ok "api blocks anonymous" || bad "api blocks anonymous" "$R"

R=$(curl -s -b "$J" -X PATCH "$B/api/mcps/gemini" -H 'content-type: application/json' -d '{"enabled":true}')
has "$R" 'CSRF' && ok "csrf header enforced" || bad "csrf header enforced" "$R"

say "── admin api ──"
R=$(curl -s -b "$J" "$B/api/mcps")
has "$R" 'gemini_mcp' && has "$R" 'telegram_mcp' && ok "mcps listed" || bad "mcps listed" "$R"

R=$(curl -s -b "$J" -H 'x-station-csrf: 1' -X POST "$B/api/mcps" -H 'content-type: application/json' -d '{"name":"Smoke","slug":"smoke_mcp","icon":"🧪","description":"smoke test module"}')
has "$R" '"ok":true' && ok "create module from template" || bad "create module from template" "$R"

R=$(curl -s -b "$J" "$B/api/mcps/smoke_mcp/file?path=index.js")
has "$R" 'smoke_mcp_echo' && ok "template placeholders filled" || bad "template placeholders filled" "$(echo "$R" | head -c 200)"

R=$(curl -s -b "$J" -H 'x-station-csrf: 1' -X PATCH "$B/api/mcps/gemini" -H 'content-type: application/json' -d '{"settings":{"api_key":"fake-key-123","default_model":"gemini-2.5-flash"}}')
has "$R" '"ok":true' && ok "save settings (secret encrypted)" || bad "save settings" "$R"

if grep -q 'fake-key-123' "$DATA/station.json"; then bad "secret encrypted at rest" "plaintext found in station.json"; else ok "secret encrypted at rest"; fi

R=$(curl -s -b "$J" "$B/api/mcps")
has "$R" '"api_key":"••••••"' && ok "secret masked in api" || bad "secret masked in api" "$R"

say "── mcp endpoints (static bearer) ──"
ACC='accept: application/json, text/event-stream'
INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0"}}}'

R=$(curl -s -X POST "$B/gemini_mcp" -H 'content-type: application/json' -H "$ACC" -d "$INIT")
has "$R" 'Unauthorized' && ok "mcp rejects no token" || bad "mcp rejects no token" "$R"

H=$(curl -s -o /dev/null -D - -X POST "$B/gemini_mcp" -H 'content-type: application/json' -H "$ACC" -d "$INIT")
has "$H" 'resource_metadata=' && ok "401 advertises resource metadata" || bad "401 advertises resource metadata" "$H"

R=$(curl -s -X POST "$B/gemini_mcp" -H 'content-type: application/json' -H "$ACC" -H 'authorization: Bearer sekret-token' -d "$INIT")
has "$R" 'gemini-mcp-server' && ok "initialize (MCP_TOKEN)" || bad "initialize (MCP_TOKEN)" "$R"

R=$(curl -s -X POST "$B/gemini_mcp" -H 'content-type: application/json' -H "$ACC" -H 'authorization: Bearer sekret-token' -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}')
has "$R" 'gemini_generate_text' && has "$R" 'gemini_embed_text' && ok "tools/list gemini (4 tools)" || bad "tools/list gemini" "$(echo "$R" | head -c 300)"

R=$(curl -s -X POST "$B/telegram_mcp" -H 'content-type: application/json' -H "$ACC" -H 'authorization: Bearer sekret-token' -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"telegram_send_message","arguments":{"text":"hi"}}}')
has "$R" 'bot_token is not configured' && ok "tool returns actionable config error" || bad "actionable config error" "$(echo "$R" | head -c 300)"

say "── oauth 2.1 round trip ──"
R=$(curl -s "$B/.well-known/oauth-authorization-server")
has "$R" '"registration_endpoint"' && ok "AS metadata" || bad "AS metadata" "$R"
R=$(curl -s "$B/.well-known/oauth-protected-resource/gemini_mcp")
has "$R" "\"resource\":\"$B/gemini_mcp\"" && ok "resource metadata" || bad "resource metadata" "$R"

REG=$(curl -s -X POST "$B/register" -H 'content-type: application/json' -d '{"client_name":"smoke client","redirect_uris":["https://claude.ai/api/mcp/auth_callback"]}')
CID=$(echo "$REG" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(JSON.parse(d).client_id||''))")
[ -n "$CID" ] && ok "dynamic client registration" || bad "dynamic client registration" "$REG"

VER="test-verifier-$(date +%s)-0123456789abcdefghijklmn"
CHAL=$(node -e "process.stdout.write(require('crypto').createHash('sha256').update('$VER').digest('base64url'))")

R=$(curl -s "$B/authorize?client_id=$CID&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&response_type=code&code_challenge=$CHAL&code_challenge_method=S256&state=xyz&scope=mcp")
has "$R" 'smoke client' && ok "authorize page renders client" || bad "authorize page" "$(echo "$R" | head -c 200)"

LOC=$(curl -s -o /dev/null -D - -X POST "$B/oauth/approve" \
  -d "client_id=$CID" -d "redirect_uri=https://claude.ai/api/mcp/auth_callback" -d "response_type=code" \
  -d "code_challenge=$CHAL" -d "code_challenge_method=S256" -d "state=xyz" -d "scope=mcp" -d "password=test1234" \
  | tr -d '\r' | grep -i '^location:' )
CODE=$(echo "$LOC" | sed 's/.*code=\([^&]*\).*/\1/')
has "$LOC" 'state=xyz' && [ -n "$CODE" ] && ok "approval issues code" || bad "approval issues code" "$LOC"

R=$(curl -s -X POST "$B/token" -d "grant_type=authorization_code" -d "code=$CODE" -d "client_id=$CID" -d "redirect_uri=https://claude.ai/api/mcp/auth_callback" -d "code_verifier=WRONG")
has "$R" 'invalid_grant' && ok "token rejects bad PKCE verifier" || bad "token rejects bad verifier" "$R"

LOC2=$(curl -s -o /dev/null -D - -X POST "$B/oauth/approve" \
  -d "client_id=$CID" -d "redirect_uri=https://claude.ai/api/mcp/auth_callback" -d "response_type=code" \
  -d "code_challenge=$CHAL" -d "code_challenge_method=S256" -d "state=abc" -d "scope=mcp" -d "password=test1234" \
  | tr -d '\r' | grep -i '^location:')
CODE2=$(echo "$LOC2" | sed 's/.*code=\([^&]*\).*/\1/')
TOK=$(curl -s -X POST "$B/token" -d "grant_type=authorization_code" -d "code=$CODE2" -d "client_id=$CID" -d "redirect_uri=https://claude.ai/api/mcp/auth_callback" -d "code_verifier=$VER")
AT=$(echo "$TOK" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(JSON.parse(d).access_token||''))")
RT=$(echo "$TOK" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(JSON.parse(d).refresh_token||''))")
[ -n "$AT" ] && [ -n "$RT" ] && ok "token exchange (PKCE ok)" || bad "token exchange" "$TOK"

# claude.ai omits redirect_uri on the token call (it is optional — RFC 6749 §4.1.3). Demanding it
# rejected every real connector with invalid_grant, while curl tests that always sent it passed.
LOC3=$(curl -s -o /dev/null -D - -X POST "$B/oauth/approve" \
  -d "client_id=$CID" -d "redirect_uri=https://claude.ai/api/mcp/auth_callback" -d "response_type=code" \
  -d "code_challenge=$CHAL" -d "code_challenge_method=S256" -d "state=noru" -d "scope=mcp" -d "password=test1234" \
  | tr -d '\r' | grep -i '^location:')
CODE3=$(echo "$LOC3" | sed 's/.*code=\([^&]*\).*/\1/')
R=$(curl -s -X POST "$B/token" -d "grant_type=authorization_code" -d "code=$CODE3" -d "client_id=$CID" -d "code_verifier=$VER")
has "$R" 'access_token' && ok "token exchange without redirect_uri (claude.ai's shape)" || bad "token exchange without redirect_uri" "$R"

R=$(curl -s -X POST "$B/token" -d "grant_type=authorization_code" -d "code=$CODE3" -d "client_id=$CID" -d "redirect_uri=https://evil.example/cb" -d "code_verifier=$VER")
has "$R" 'invalid_grant' && ok "token rejects a WRONG redirect_uri" || bad "token rejects wrong redirect_uri" "$R"

R=$(curl -s -X POST "$B/gemini_mcp" -H 'content-type: application/json' -H "$ACC" -H "authorization: Bearer $AT" -d '{"jsonrpc":"2.0","id":4,"method":"tools/list","params":{}}')
has "$R" 'gemini_generate_text' && ok "mcp accepts OAuth token" || bad "mcp accepts OAuth token" "$(echo "$R" | head -c 200)"

R=$(curl -s -X POST "$B/token" -d "grant_type=refresh_token" -d "refresh_token=$RT")
AT2=$(echo "$R" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write(JSON.parse(d).access_token||''))")
[ -n "$AT2" ] && ok "refresh token rotation" || bad "refresh token rotation" "$R"

R=$(curl -s -X POST "$B/token" -d "grant_type=refresh_token" -d "refresh_token=$RT")
has "$R" 'invalid_grant' && ok "old refresh token consumed" || bad "old refresh token consumed" "$R"

say "── module lifecycle / backup ──"
R=$(curl -s -b "$J" -H 'x-station-csrf: 1' -X POST "$B/api/reload")
has "$R" 'smoke_mcp' && ok "reload modules" || bad "reload modules" "$(echo "$R" | head -c 200)"

R=$(curl -s -X POST "$B/smoke_mcp" -H 'content-type: application/json' -H "$ACC" -H 'authorization: Bearer sekret-token' -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"smoke_mcp_echo","arguments":{"text":"round-trip"}}}')
has "$R" 'Echo: round-trip' && ok "created module serves tool calls" || bad "created module tool call" "$(echo "$R" | head -c 300)"

R=$(curl -s -b "$J" "$B/api/export?secrets=1")
has "$R" 'fake-key-123' && ok "export with secrets decrypts" || bad "export with secrets" "$(echo "$R" | head -c 200)"
R=$(curl -s -b "$J" "$B/api/export")
has "$R" '••••••' && ok "export masks secrets by default" || bad "export masks secrets" "$(echo "$R" | head -c 200)"

R=$(curl -s -b "$J" -H 'x-station-csrf: 1' -X POST "$B/api/import" -H 'content-type: application/json' -d '{"kind":"mcp-station-export","version":1,"mcps":[{"id":"telegram","enabled":true,"settings":{"default_chat_id":"12345"}}]}')
has "$R" '"applied":\["telegram"\]' || has "$R" '"applied":["telegram"]' && ok "import applies settings" || bad "import" "$R"

R=$(curl -s -b "$J" -H 'x-station-csrf: 1' -X POST "$B/api/backup")
has "$R" '.tar.gz' && ok "backup created" || bad "backup created" "$R"
R=$(curl -s -b "$J" "$B/api/backups")
has "$R" 'mcp-station-backup-' && ok "backups listed" || bad "backups listed" "$R"

R=$(curl -s "$B/nonexistent_mcp" -X POST -H 'content-type: application/json' -d '{}')
has "$R" 'Nothing here' && ok "404 fallthrough" || bad "404 fallthrough" "$R"

say ""
say "== RESULT: $PASS passed, $FAIL failed =="
grep -Ei 'error|warn' "$LOG" | grep -v 'PUBLIC_URL is not set' | head -5 || true
exit $FAIL
