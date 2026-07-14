#!/usr/bin/env bash
# Self-contained module drill: a module folder carries its own config (.config.json), so
# removing it and putting it back — by hand OR via the UI delete + restore-from-trash —
# leaves the station carrying on as if nothing happened.
#
#   BASE=http://localhost:8799 APP_PASSWORD=test bash scripts/smoke-selfcontained.sh
set -u
BASE="${BASE:-http://localhost:8799}"
PW="${APP_PASSWORD:-test}"
JAR=$(mktemp)
ID="${1:-siyuan}"
DIR="mcps/$ID"
pass=0; fail=0
ok()   { echo "  ✓ $1"; pass=$((pass+1)); }
bad()  { echo "  ✗ $1"; fail=$((fail+1)); }
api()  { curl -s -b "$JAR" -H 'x-station-csrf: 1' -H 'content-type: application/json' "$@"; }

curl -s -c "$JAR" -X POST "$BASE/api/login" -H 'content-type: application/json' -H 'x-station-csrf: 1' \
  -d "{\"password\":\"$PW\"}" > /dev/null

echo "1. configure $ID"
api -X PATCH "$BASE/api/mcps/$ID" -d '{"settings":{"siyuan_url":"https://siyuan.example.com","siyuan_token":"secret-token-123"}}' > /dev/null
[ -f "$DIR/.config.json" ] && ok "config mirrored to $DIR/.config.json" || bad "no .config.json written"
grep -q 'enc:v1:' "$DIR/.config.json" && ok "secret is encrypted in the mirror" || bad "secret NOT encrypted in the mirror"
grep -q 'secret-token-123' "$DIR/.config.json" && bad "PLAINTEXT SECRET on disk" || ok "no plaintext secret on disk"

echo "2. remove the folder by hand"
mv "$DIR" "/tmp/$ID-away"
api -X POST "$BASE/api/reload" > /dev/null
api "$BASE/api/mcps" | grep -q "\"id\":\"$ID\"" && bad "module still listed after removal" || ok "module gone while folder is away"
curl -s -o /dev/null -w '%{http_code}' "$BASE/healthz" | grep -q 200 && ok "station still healthy" || bad "station unhealthy"

echo "3. put it back"
mv "/tmp/$ID-away" "$DIR"
api -X POST "$BASE/api/reload" > /dev/null
api "$BASE/api/mcps" | grep -q "\"id\":\"$ID\"" && ok "module detected again" || bad "module not detected"
api "$BASE/api/mcps" | grep -q '"configured":true' && ok "settings survived (configured)" || bad "settings LOST after restore"

echo "4. UI delete, then restore from data/trash"
api -X DELETE "$BASE/api/mcps/$ID" > /dev/null
TRASH=$(ls -d "${DATA_DIR:-/tmp/st3}"/trash/$ID-* 2>/dev/null | tail -1)
[ -n "$TRASH" ] && ok "folder is in trash" || bad "nothing in trash"
cp -r "$TRASH" "$DIR"
api -X POST "$BASE/api/reload" > /dev/null
api "$BASE/api/mcps" | grep -q "\"id\":\"$ID\"" && ok "module adopted after UI delete + restore" || bad "module not adopted"
api "$BASE/api/mcps" | grep -q '"configured":true' && ok "settings adopted from the folder (was lost before)" || bad "settings LOST — adoption failed"

echo
echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
