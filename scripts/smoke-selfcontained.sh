#!/usr/bin/env bash
# Self-contained module drill: a module folder carries its own config (.config.json), so
# removing it and putting it back — by hand OR via the UI delete + restore-from-trash —
# leaves the station carrying on as if nothing happened.
#
# Self-booting: spins up a throwaway station on :8799 against a COPY of mcps/ and a temp
# DATA_DIR, so it never touches your real module folders. Just:
#
#   bash scripts/smoke-selfcontained.sh            # drills the siyuan module
#   bash scripts/smoke-selfcontained.sh gemini_mcp # drill a different module
set -u
PORT=8799
BASE="http://127.0.0.1:$PORT"
PW=test1234
ID="${1:-siyuan}"
JAR=$(mktemp); DATA=$(mktemp -d); LOG=$(mktemp); MCPS=$(mktemp -d)
cp -r mcps/. "$MCPS"/   # throwaway copy — the real mcps/ is never touched
DIR="$MCPS/$ID"
pass=0; fail=0
ok()   { echo "  ✓ $1"; pass=$((pass+1)); }
bad()  { echo "  ✗ $1"; fail=$((fail+1)); }
api()  { curl -s -b "$JAR" -H 'x-station-csrf: 1' -H 'content-type: application/json' "$@"; }

APP_PASSWORD="$PW" PUBLIC_URL="$BASE" DATA_DIR="$DATA" MCPS_DIR="$MCPS" PORT=$PORT \
  node server/index.js >"$LOG" 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null; rm -rf "$JAR" "$DATA" "$LOG" "$MCPS"' EXIT
for i in $(seq 1 40); do curl -sf "$BASE/healthz" >/dev/null 2>&1 && break; sleep 0.25; done

curl -s -c "$JAR" -X POST "$BASE/api/login" -H 'content-type: application/json' -H 'x-station-csrf: 1' \
  -d "{\"password\":\"$PW\"}" > /dev/null

echo "1. configure $ID"
api -X PATCH "$BASE/api/mcps/$ID" -d '{"settings":{"siyuan_url":"https://siyuan.example.com","siyuan_token":"secret-token-123"}}' > /dev/null
[ -f "$DIR/.config.json" ] && ok "config mirrored to <module>/.config.json" || bad "no .config.json written"
grep -q 'enc:v1:' "$DIR/.config.json" && ok "secret is encrypted in the mirror" || bad "secret NOT encrypted in the mirror"
grep -q 'secret-token-123' "$DIR/.config.json" && bad "PLAINTEXT SECRET on disk" || ok "no plaintext secret on disk"

echo "2. remove the folder by hand"
mv "$DIR" "$MCPS/.away-$ID"
api -X POST "$BASE/api/reload" > /dev/null
api "$BASE/api/mcps" | grep -q "\"id\":\"$ID\"" && bad "module still listed after removal" || ok "module gone while folder is away"
curl -s -o /dev/null -w '%{http_code}' "$BASE/healthz" | grep -q 200 && ok "station still healthy" || bad "station unhealthy"

echo "3. put it back"
mv "$MCPS/.away-$ID" "$DIR"
api -X POST "$BASE/api/reload" > /dev/null
api "$BASE/api/mcps" | grep -q "\"id\":\"$ID\"" && ok "module detected again" || bad "module not detected"
api "$BASE/api/mcps" | grep -q '"configured":true' && ok "settings survived (configured)" || bad "settings LOST after restore"

echo "4. UI delete, then restore from data/trash"
api -X DELETE "$BASE/api/mcps/$ID" > /dev/null
TRASH=$(ls -d "$DATA"/trash/$ID-* 2>/dev/null | tail -1)
[ -n "$TRASH" ] && ok "folder is in trash" || bad "nothing in trash"
[ -n "$TRASH" ] && cp -r "$TRASH" "$DIR"
api -X POST "$BASE/api/reload" > /dev/null
api "$BASE/api/mcps" | grep -q "\"id\":\"$ID\"" && ok "module adopted after UI delete + restore" || bad "module not adopted"
api "$BASE/api/mcps" | grep -q '"configured":true' && ok "settings adopted from the folder (was lost before)" || bad "settings LOST — adoption failed"

echo
echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
