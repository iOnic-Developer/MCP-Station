#!/usr/bin/env bash
set -u
PORT=8799; MPORT=8899
B="http://127.0.0.1:$PORT"
J="$(mktemp)"; DATA="$(mktemp -d)"; LOG="$(mktemp)"; MLOG="$(mktemp)"; REC="$(mktemp)"; MCPS="$(mktemp -d)"
cp -r mcps/. "$MCPS"/
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); printf '  ✅ %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  ❌ %s — %s\n' "$1" "${2:-}"; }
has() { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }

node scripts/mock-openai.mjs $MPORT "$REC" >"$MLOG" 2>&1 & MOCK=$!
APP_PASSWORD=test1234 PUBLIC_URL="$B" DATA_DIR="$DATA" MCPS_DIR="$MCPS" PORT=$PORT \
OPENAI_API_KEY=mock-openai-key OPENAI_MODEL=gpt-6-astra OPENAI_BASE_URL="http://127.0.0.1:$MPORT" \
ASSISTANT_PROVIDER=openai ASSISTANT_HEARTBEAT_MS=300 node server/index.js >"$LOG" 2>&1 & SRV=$!
trap 'kill $SRV $MOCK 2>/dev/null; rm -rf "$J" "$DATA" "$LOG" "$MLOG" "$REC" "$MCPS"' EXIT
for i in $(seq 1 40); do curl -sf "$B/healthz" >/dev/null 2>&1 && break; sleep 0.25; done

api() { curl -s -b "$J" -H 'x-station-csrf: 1' -H 'content-type: application/json' "$@"; }
chat() { curl -s -N -b "$J" -H 'x-station-csrf: 1' -H 'content-type: application/json' -X POST "$B/api/assistant" -d "{\"messages\":[{\"role\":\"user\",\"content\":\"$1\"}],\"mcpId\":\"smoke_openai\"}"; }

R=$(curl -s -c "$J" -X POST "$B/api/login" -H 'content-type: application/json' -H 'x-station-csrf: 1' -d '{"password":"test1234"}')
has "$R" '"ok":true' && ok login || bad login "$R"
R=$(api -X POST "$B/api/mcps" -d '{"name":"Smoke OpenAI","slug":"smoke_openai","icon":"🧪","description":"OpenAI adapter smoke"}')
has "$R" '"ok":true' && ok 'module created' || bad 'module create' "$R"

R=$(api "$B/api/mcps/smoke_openai/file?path=index.js")
SRC=$(printf '%s' "$R" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const j=JSON.parse(s);process.stdout.write(j.content.replace("export function register", "// ORIGINAL_MARKER\nexport function register"));})')
PAYLOAD=$(printf '%s' "$SRC" | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>process.stdout.write(JSON.stringify({path:"index.js",content:s})))')
api -X PUT "$B/api/mcps/smoke_openai/file" -d "$PAYLOAD" >/dev/null

R=$(chat hello)
has "$R" '"text":"Hello "' && has "$R" '"text":"from OpenAI mock."' && has "$R" '"done":true' && ok 'Responses API text streams' || bad 'OpenAI text stream' "$R"
REQ=$(grep '"path":"/v1/responses"' "$REC" | head -1)
has "$REQ" '"model":"gpt-6-astra"' && has "$REQ" '"max_output_tokens":64000' && ok 'Astra model + output cap' || bad 'Astra request' "$REQ"
has "$REQ" '"type":"function"' && has "$REQ" '"name":"edit_module_file"' && ok 'station tools sent as Responses functions' || bad 'OpenAI tools' "$REQ"
has "$REQ" 'How to change it' && has "$REQ" 'ORIGINAL_MARKER' && ok 'module source included in instructions' || bad 'OpenAI instructions' "$REQ"

R=$(chat edit)
has "$R" '"name":"edit_module_file","status":"running"' && has "$R" '"name":"edit_module_file","ok":true' && ok 'function call executes' || bad 'OpenAI function call' "$R"
has "$R" 'TOOL_RESULT:ok' && ok 'tool result continuation returns text' || bad 'OpenAI continuation' "$R"
REQ=$(grep '"previous_response_id"' "$REC" | tail -1)
has "$REQ" '"type":"function_call_output"' && has "$REQ" '"previous_response_id":"resp_' && ok 'previous_response_id + function_call_output round-trip' || bad 'OpenAI tool result wire' "$REQ"
R=$(api "$B/api/mcps/smoke_openai/file?path=index.js")
has "$R" 'OPENAI_MARKER' && ! has "$R" 'ORIGINAL_MARKER' && ok 'OpenAI edit changed file on disk' || bad 'OpenAI edit disk' "$R"

printf '\n%s passed, %s failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
