#!/usr/bin/env bash
# End-to-end test for the Antigravity CLI adapter hook handler.
#
# Spawns a Memoria HTTP server, drives PreInvocation + Stop with payloads and
# transcript steps shaped like real agy 1.4.4 output, and verifies the round trip.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
# Isolate cross-process hook state so throttle/dedupe/prompt-buffer don't leak across test runs.
export MEMORIA_ADAPTER_STATE_DIR="$TMP_DIR/adapter-state"
PORT=$((20000 + RANDOM % 10000))
SERVER_URL="http://localhost:${PORT}"
SERVER_PID=""

cleanup() { [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$TMP_DIR"; }
trap cleanup EXIT

echo "[antigravity] start server"
MEMORIA_HOME="$TMP_DIR/home" MEMORIA_PORT="$PORT" "$ROOT_DIR/cli" setup --serve --json >"$TMP_DIR/server.log" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 30); do
    if curl -sf "$SERVER_URL/v1/health" >/dev/null 2>&1; then break; fi
    sleep 0.2
done
curl -sf "$SERVER_URL/v1/health" >/dev/null || { echo "[antigravity] server failed to start"; cat "$TMP_DIR/server.log"; exit 1; }

echo "[antigravity] seed memory (so recall has something to return)"
curl -sf -X POST "$SERVER_URL/v1/remember" -H 'Content-Type: application/json' \
    -d '{"timestamp":"2026-05-20T10:00:00Z","project":"antigravity","summary":"用 npm publish 取代 install.sh","events":[{"event_type":"DecisionMade","timestamp":"2026-05-20T10:00:00Z","content":{"decision":"用 npm publish 取代 install.sh"}}]}' \
    >/dev/null

# Fixtures below follow what agy 1.4.4 actually sends. Its payload names no event, so
# the adapter infers one, and the turn text comes from `lastUserInput` plus step-format
# transcript lines.
LOGS="$TMP_DIR/logs"
mkdir -p "$LOGS"
TRANSCRIPT="$LOGS/transcript.jsonl"
cat >"$TRANSCRIPT" <<'EOF'
{"step_index":0,"source":"USER_EXPLICIT","type":"USER_INPUT","status":"DONE","content":"<USER_REQUEST>\nnpm publish 要怎麼設定？\n</USER_REQUEST>"}
{"step_index":1,"source":"MODEL","type":"PLANNER_RESPONSE","status":"DONE","tool_calls":[{"name":"read_file","args":{"AbsolutePath":"/tmp/x"}}]}
{"step_index":2,"source":"MODEL","type":"GENERIC","status":"DONE","content":"工具輸出 NOT-THE-ANSWER"}
{"step_index":3,"source":"MODEL","type":"PLANNER_RESPONSE","status":"DONE","content":"設定 NPM_TOKEN secret 並在 tag push 觸發 release。"}
EOF

payload() { # <extra-json-fields> [transcript]
    node -e "
const [extra, transcript] = process.argv.slice(1);
console.log(JSON.stringify({ conversationId: 'conv-agy-1', workspacePaths: ['/w'], transcriptPath: transcript, modelName: 'auto', lastUserInput: 'npm publish 要怎麼設定？', ...JSON.parse(extra) }));
" "$1" "${2:-$TRANSCRIPT}"
}
adapter() { "$ROOT_DIR/cli" adapter antigravity --server "$SERVER_URL" --project antigravity; }
event_count() {
    curl -sf "$SERVER_URL/v1/stats" | node -e "
const r = JSON.parse(require('fs').readFileSync(0, 'utf8'));
process.stdout.write(String(r?.data?.events ?? 0));
"
}
last_turn() {
    node -e "
const D = require('$ROOT_DIR/node_modules/better-sqlite3');
const db = new D('$TMP_DIR/home/.memory/sessions.db', { readonly: true });
const row = db.prepare(\"SELECT content FROM events WHERE event_type='ConversationTurn' ORDER BY timestamp DESC, rowid DESC LIMIT 1\").get();
db.close();
process.stdout.write(row ? row.content : '');
"
}

echo "[antigravity] hook template uses the flat handlers agy requires"
node -e "
const t = JSON.parse(require('fs').readFileSync('$ROOT_DIR/skills/memoria-memory-sync/resources/hooks/antigravity.hooks.json', 'utf8'));
for (const event of ['PreInvocation', 'Stop']) {
  const handlers = t.memoria[event];
  if (!handlers.length || !handlers.every((h) => typeof h.command === 'string' && !('hooks' in h))) {
    console.error('  ✗ ' + event + ' must list handlers directly: ' + JSON.stringify(handlers)); process.exit(1);
  }
}
console.log('  template ok');
"

echo "[antigravity] first model call -> injectSteps systemMessage referencing seeded memory"
OUT=$(payload '{"invocationNum":0,"initialNumSteps":1}' | adapter)
echo "$OUT" | node -e "
const out = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const text = out?.injectSteps?.[0]?.systemMessage?.systemMessage;
if (typeof text !== 'string' || !text.includes('npm publish')) { console.error('  ✗ missing injected memory: ' + JSON.stringify(out)); process.exit(1); }
if ('additionalContext' in out) { console.error('  ✗ agy ignores additionalContext: ' + JSON.stringify(out)); process.exit(1); }
console.log('  injectSteps ok');
"

echo "[antigravity] later model call in the same turn injects nothing"
OUT=$(payload '{"invocationNum":1,"initialNumSteps":4}' | adapter)
[ "$OUT" = "{}" ] || { echo "  ✗ expected {}, got $OUT"; exit 1; }
echo "  repeat call skipped"

echo "[antigravity] Stop -> writes the answer, skipping tool calls and tool output"
STOP_FIELDS='{"executionNum":0,"terminationReason":"NO_TOOL_CALL","error":"","fullyIdle":true}'
BEFORE=$(event_count)
payload "$STOP_FIELDS" | adapter >/dev/null
sleep 0.3
AFTER=$(event_count)
if [ "$AFTER" -le "$BEFORE" ]; then
    echo "  ✗ event count did not grow (before=$BEFORE, after=$AFTER)"
    exit 1
fi
TURN=$(last_turn)
case "$TURN" in *"npm publish 要怎麼設定"*) ;; *) echo "  ✗ user text missing: $TURN"; exit 1 ;; esac
case "$TURN" in *USER_REQUEST*) echo "  ✗ transcript wrapper leaked: $TURN"; exit 1 ;; esac
case "$TURN" in *NPM_TOKEN*) ;; *) echo "  ✗ assistant text missing: $TURN"; exit 1 ;; esac
case "$TURN" in *NOT-THE-ANSWER*) echo "  ✗ tool output stored as the answer: $TURN"; exit 1 ;; esac
echo "  Stop wrote the turn ($BEFORE -> $AFTER)"

echo "[antigravity] duplicate Stop is deduped (no double write)"
payload "$STOP_FIELDS" | adapter >/dev/null
sleep 0.3
AFTER2=$(event_count)
if [ "$AFTER2" -ne "$AFTER" ]; then
    echo "  ✗ duplicate Stop wrote again (after=$AFTER, after2=$AFTER2)"
    exit 1
fi
echo "  duplicate Stop deduped (events stayed $AFTER2)"

echo "[antigravity] a turn with no answer is not paired with the previous reply"
FAILED="$LOGS/failed.jsonl"
cp "$TRANSCRIPT" "$FAILED"
echo '{"step_index":4,"source":"USER_EXPLICIT","type":"USER_INPUT","status":"DONE","content":"<USER_REQUEST>\n第二題\n</USER_REQUEST>"}' >>"$FAILED"
echo '{"step_index":5,"source":"SYSTEM","type":"ERROR_MESSAGE","status":"DONE","content":"model failed"}' >>"$FAILED"
payload '{"executionNum":1,"terminationReason":"ERROR","error":"boom","fullyIdle":true,"lastUserInput":"第二題"}' "$FAILED" | adapter >/dev/null
sleep 0.3
[ "$(event_count)" -eq "$AFTER" ] || { echo "  ✗ unanswered turn was written"; exit 1; }
echo "  unanswered turn skipped"

echo "[antigravity] a truncated answer is read back from transcript_full.jsonl"
CUT="$TMP_DIR/cut"
mkdir -p "$CUT"
echo '{"step_index":1,"source":"MODEL","type":"PLANNER_RESPONSE","status":"DONE","content":"長回答前段","truncated_fields":["content"]}' >"$CUT/transcript.jsonl"
echo '{"step_index":1,"source":"MODEL","type":"PLANNER_RESPONSE","status":"DONE","content":"長回答前段與完整後段"}' >"$CUT/transcript_full.jsonl"
payload '{"executionNum":0,"terminationReason":"NO_TOOL_CALL","conversationId":"conv-agy-2","lastUserInput":"長回答"}' "$CUT/transcript.jsonl" | adapter >/dev/null
sleep 0.3
case "$(last_turn)" in *"完整後段"*) ;; *) echo "  ✗ full answer not recovered: $(last_turn)"; exit 1 ;; esac
echo "  full answer recovered"

echo "[antigravity] ok"
