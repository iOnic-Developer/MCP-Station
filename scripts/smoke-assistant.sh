#!/usr/bin/env bash
# ✦ assistant drill — boots a throwaway station on :8798 against scripts/mock-llm.mjs (:8898),
# which speaks the Anthropic + Gemini STREAMING wire shapes, and checks the whole loop the
# browser sees: text streams as deltas, keep-alive comments flow while the model is slow, the
# file tools edit a module in place and hot-reload it (file_changed / modules_changed events,
# load errors reported), cut-off replies are announced instead of swallowed, output caps are
# looked up and lowered on 400/429, and both providers behave the same.
#   bash scripts/smoke-assistant.sh    (from the repo root, after npm install)
set -u
PORT=8798; MPORT=8898
B="http://127.0.0.1:$PORT"
J="$(mktemp)"; DATA="$(mktemp -d)"; LOG="$(mktemp)"; MLOG="$(mktemp)"; REC="$(mktemp)"; MCPS="$(mktemp -d)"
cp -r mcps/. "$MCPS"/
PASS=0; FAIL=0
say()  { printf '%s\n' "$*"; }
ok()   { PASS=$((PASS+1)); say "  ✅ $1"; }
bad()  { FAIL=$((FAIL+1)); say "  ❌ $1 — got: $(printf '%s' "${2:-}" | head -c 400)"; }
has()  { case "$1" in *"$2"*) return 0;; *) return 1;; esac; }

node scripts/mock-llm.mjs $MPORT "$REC" >"$MLOG" 2>&1 &
MOCK=$!
APP_PASSWORD=test1234 PUBLIC_URL="$B" DATA_DIR="$DATA" MCPS_DIR="$MCPS" PORT=$PORT \
ANTHROPIC_API_KEY=mock-key ANTHROPIC_MODEL=mock-model ANTHROPIC_BASE_URL="http://127.0.0.1:$MPORT" \
GEMINI_API_KEY=mock-key GEMINI_MODEL=mock-gemini GEMINI_BASE_URL="http://127.0.0.1:$MPORT" \
ASSISTANT_HEARTBEAT_MS=300 node server/index.js >"$LOG" 2>&1 &
SRV=$!
trap 'kill $SRV $MOCK 2>/dev/null; rm -rf "$J" "$DATA" "$LOG" "$MLOG" "$REC" "$MCPS"' EXIT
for i in $(seq 1 40); do curl -sf "$B/healthz" >/dev/null 2>&1 && break; sleep 0.25; done

api()  { curl -s -b "$J" -H 'x-station-csrf: 1' -H 'content-type: application/json' "$@"; }
# One assistant turn, scoped to the smoke module; returns the raw SSE body.
chat() { curl -s -N -b "$J" -H 'x-station-csrf: 1' -H 'content-type: application/json' -X POST "$B/api/assistant" \
           -d "{\"messages\":[{\"role\":\"user\",\"content\":\"$1\"}],\"mcpId\":\"${2-smoke_edit}\"}"; }
file() { api "$B/api/mcps/smoke_edit/file?path=$1"; }
marker_index() {   # pristine template index.js + the marker the mock's edit scenario looks for
  api -X PUT "$B/api/mcps/smoke_edit/file" -d "$(node -e '
    const src = require("fs").readFileSync(process.argv[1], "utf8").replace("export function register", "// ORIGINAL_MARKER\nexport function register");
    console.log(JSON.stringify({ path: "index.js", content: src }));' "$DATA/pristine-index.js")" >/dev/null
}

say "── setup ──"
R=$(curl -s -c "$J" -X POST "$B/api/login" -H 'content-type: application/json' -H 'x-station-csrf: 1' -d '{"password":"test1234"}')
has "$R" '"ok":true' && ok "login" || bad "login" "$R"
R=$(api -X POST "$B/api/mcps" -d '{"name":"Smoke edit","slug":"smoke_edit","icon":"🧪","description":"assistant drill"}')
has "$R" '"ok":true' && ok "module smoke_edit created from template" || bad "create module" "$R"
cp "$MCPS/smoke_edit/index.js" "$DATA/pristine-index.js"
marker_index
R=$(file index.js); has "$R" 'ORIGINAL_MARKER' && ok "marker planted in index.js" || bad "marker planted" "$R"

say "── streaming + keep-alive (Anthropic) ──"
R=$(chat "hello")
has "$R" '"text":"Hello "' && has "$R" '"text":"from the mock."' && ok "text arrives as separate deltas" || bad "text deltas" "$R"
has "$R" '"done":true' && ok "stream ends with done" || bad "done event" "$R"
REQ=$(grep '"path":"/v1/messages"' "$REC" | tail -1)
has "$REQ" '"stream":true' && ok "upstream call is streamed" || bad "stream:true" "$REQ"
has "$REQ" '"max_tokens":32000' && ok "max_tokens from the model's own cap (32000 via /v1/models)" || bad "max_tokens cap" "$REQ"
has "$REQ" 'cache_control' && ok "system prompt carries a cache breakpoint" || bad "cache_control" "$REQ"
has "$REQ" '"name":"edit_module_file"' && has "$REQ" '"name":"read_module_file"' && has "$REQ" '"name":"write_module_file"' && ok "file tools offered to the model" || bad "tools offered" "$REQ"
has "$REQ" 'How to change it' && has "$REQ" 'ORIGINAL_MARKER' && ok "module brief + current source in the system prompt" || bad "module brief" "$REQ"
has "$REQ" '(' && has "$REQ" 'lines,' && ok "inlined files are headed with line counts" || bad "line counts" "$REQ"
R=$(chat "slow")
has "$R" ': hb' && has "$R" '"text":"slow reply"' && ok "keep-alive comments flow while the model is slow" || bad "heartbeat" "$R"

say "── file tools ──"
R=$(chat "edit")
has "$R" '"text":"Editing now. "' && ok "text before the tool call streams first" || bad "pre-tool text" "$R"
has "$R" '"tool":{"name":"edit_module_file","status":"running"}' && ok "tool running event" || bad "tool running" "$R"
has "$R" '"name":"edit_module_file","ok":true' && has "$R" 'index.js line' && has "$R" 'module reloaded OK' && ok "edit tool succeeded with a readable detail" || bad "edit detail" "$R"
has "$R" '"file_changed":{"id":"smoke_edit","path":"index.js"}' && ok "file_changed event for the editor" || bad "file_changed" "$R"
has "$R" '"modules_changed":true' && ok "modules_changed event for the cards" || bad "modules_changed" "$R"
has "$R" 'TOOL_RESULT:ok' && ok "second hop sees the tool result and answers" || bad "second hop" "$R"
R=$(file index.js); has "$R" 'REPLACED_MARKER' && ! has "$R" 'ORIGINAL_MARKER' && ok "index.js changed on disk" || bad "file on disk" "$R"
R=$(api "$B/api/mcps"); has "$R" '"smoke_edit"' && ! has "$R" 'smoke_edit","error":"' && ok "module still loads after the edit" || bad "module loads" "$R"
grep -q "Edited smoke_edit/index.js at line" "$LOG" && ok "edit logged with the line number" || bad "edit log" "$(tail -3 "$LOG")"

marker_index
R=$(chat "thinkedit")
has "$R" 'THINKING_ECHOED:yes' && ok "thinking block round-trips into the tool-result hop (signature kept)" || bad "thinking echo" "$R"
R=$(file index.js); has "$R" 'REPLACED_MARKER' && ok "edit applied on the thinking path too" || bad "thinking edit" "$R"

R=$(chat "badtool")
has "$R" '"name":"edit_module_file","ok":false' && has "$R" 'not found in index.js' && ok "missing find text → clear tool error" || bad "badtool" "$R"
has "$R" 'TOOL_RESULT:error:' && ok "error handed back to the model as a tool result" || bad "error tool_result" "$R"
REQ=$(grep '"path":"/v1/messages"' "$REC" | tail -1)
has "$REQ" '"is_error":true' && ok "tool_result flagged is_error" || bad "is_error" "$REQ"

R=$(chat "scope")
has "$R" "scoped to module 'smoke_edit'" && ok "module chat cannot edit another module" || bad "scope guard" "$R"
R=$(chat "dotfile")
has "$R" 'station-managed' && ok "dot-files refused" || bad "dotfile guard" "$R"

R=$(chat "write")
has "$R" '"file_changed":{"id":"smoke_edit","path":"about.md"}' && has "$R" 'about.md created' && ok "write_module_file creates about.md" || bad "write" "$R"
R=$(file about.md); has "$R" 'Written by the mock' && ok "about.md on disk" || bad "about.md" "$R"

R=$(chat "read")
has "$R" 'READ_RESULT:' && has "$R" 'lines 1-2 of' && ok "read_module_file returns a line range" || bad "read" "$R"

R=$(chat "break")
has "$R" 'LOAD ERROR' && has "$R" 'TOOL_RESULT:load_error' && ok "an edit that breaks the module reports the load error" || bad "break" "$R"
R=$(api "$B/api/mcps"); has "$R" 'smoke_edit' && has "$R" '"error":"' && ok "card shows the load error" || bad "card error" "$R"
marker_index; R=$(chat "edit"); has "$R" 'module reloaded OK' && ok "fixing it brings the module back" || bad "recover" "$R"

say "── cut-offs and failures ──"
R=$(chat "cutoff")
has "$R" '"text":"cut off"' && has "$R" 'Reply cut off at the model' && ok "max_tokens reply → text kept + notice" || bad "cutoff notice" "$R"
marker_index
R=$(chat "toolcut")
has "$R" 'in the middle of its edit_module_file call' && ok "max_tokens inside a tool call → notice, nothing changed" || bad "toolcut notice" "$R"
R=$(file index.js); has "$R" 'ORIGINAL_MARKER' && ok "file untouched after the cut-off tool call" || bad "toolcut file" "$R"
R=$(chat "fail")
has "$R" '"error":"Anthropic API 500' && has "$R" '"done":true' && ok "upstream 500 → error event, stream still closed cleanly" || bad "upstream error" "$R"

say "── output cap self-heal ──"
api -X PUT "$B/api/global" -d '{"anthropicModel":"mock-small"}' >/dev/null
R=$(chat "toobig")
has "$R" '"text":"small ok"' && ok "400 max_tokens → retried at the allowed cap" || bad "toobig" "$R"
has "$(grep -c '"model":"mock-small"' "$REC")" '2' && has "$(grep '"model":"mock-small"' "$REC" | tail -1)" '"max_tokens":8192' && ok "second attempt asked for 8192" || bad "toobig retry" "$(grep '"model":"mock-small"' "$REC" | tail -1 | head -c 200)"
api -X PUT "$B/api/global" -d '{"anthropicModel":"mock-tier1"}' >/dev/null
R=$(chat "ratelimit")
has "$R" '"text":"small ok"' && ok "429 output-tokens-per-minute → halved until it fits" || bad "ratelimit" "$R"
grep -q "retrying at 8192" "$LOG" && ok "cap lowering logged" || bad "cap log" "$(grep -i retrying "$LOG" | tail -2)"
api -X PUT "$B/api/global" -d '{"anthropicModel":"mock-model"}' >/dev/null

say "── station popup (no module scope) ──"
R=$(chat "hello" "")
has "$R" '"text":"Hello "' && ok "station popup streams too" || bad "popup" "$R"
REQ=$(grep '"path":"/v1/messages"' "$REC" | tail -1 | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>{const b=JSON.parse(s).body;console.log(b.system.map(x=>x.text).join("\n"))})')
has "$REQ" 'Live station context' && has "$REQ" 'read_module_file` shows a file' && ok "live context names the file tools" || bad "live context" "$(printf '%s' "$REQ" | tail -c 300)"

say "── gemini ──"
api -X PUT "$B/api/global" -d '{"provider":"gemini"}' >/dev/null
R=$(chat "hello")
has "$R" '"text":"Hello "' && has "$R" '"text":"from the mock."' && has "$R" '"done":true' && ok "gemini streams text deltas" || bad "gemini text" "$R"
REQ=$(grep 'streamGenerateContent' "$REC" | tail -1)
has "$REQ" '"maxOutputTokens":64000' && ok "gemini output cap looked up (65536 → 64000 ceiling)" || bad "gemini cap" "$REQ"
has "$REQ" 'functionDeclarations' && has "$REQ" 'edit_module_file' && ok "gemini gets the tools as functionDeclarations" || bad "gemini tools" "$REQ"
marker_index
R=$(chat "edit")
has "$R" '"name":"edit_module_file","ok":true' && has "$R" 'TOOL_RESULT:ok' && ok "gemini function call → edit applied → result echoed" || bad "gemini edit" "$R"
REQ=$(grep 'streamGenerateContent' "$REC" | tail -1)
has "$REQ" '"thoughtSignature":"gsig_mock"' && has "$REQ" 'functionResponse' && ok "gemini thoughtSignature round-trips with the functionResponse" || bad "gemini sig" "$REQ"
R=$(file index.js); has "$R" 'REPLACED_MARKER' && ok "gemini edit on disk" || bad "gemini file" "$R"
R=$(chat "cutoff")
has "$R" 'Reply cut off' && ok "gemini MAX_TOKENS → notice" || bad "gemini cutoff" "$R"
R=$(chat "fail")
has "$R" '"error":"Gemini API 503' && ok "gemini upstream error surfaces" || bad "gemini error" "$R"

say "── instructions ──"
R=$(api -X PUT "$B/api/instructions" -d '{"instructions":"custom brief"}'); has "$R" '"ok":true' && ok "instructions saved" || bad "save instr" "$R"
R=$(api -X POST "$B/api/instructions/reset"); has "$R" 'Editing a module that already exists' && ok "reset restores this version's seed" || bad "reset" "$R"

say ""
say "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
