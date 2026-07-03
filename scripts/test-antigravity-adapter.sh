#!/usr/bin/env bash
# End-to-end test for the Antigravity CLI adapter hook handler.
#
# Spawns a Memoria HTTP server, then drives the adapter CLI with mock
# PreInvocation + Stop hook payloads, and verifies the round trip.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
# Isolate cross-process hook state so throttle/dedupe/prompt-buffer don't leak across test runs.
export MEMORIA_ADAPTER_STATE_DIR="$TMP_DIR/adapter-state"
PORT=$((20000 + RANDOM % 10000))
SERVER_URL="http://localhost:${PORT}"
SERVER_PID=""

cleanup() {
    [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "[antigravity] start server"
MEMORIA_HOME="$TMP_DIR/home" MEMORIA_PORT="$PORT" "$ROOT_DIR/cli" setup --serve --json >"$TMP_DIR/server.log" 2>&1 &
SERVER_PID=$!

# Wait for /v1/health
for _ in $(seq 1 30); do
    if curl -sf "$SERVER_URL/v1/health" >/dev/null 2>&1; then break; fi
    sleep 0.2
done
curl -sf "$SERVER_URL/v1/health" >/dev/null || { echo "[antigravity] server failed to start"; cat "$TMP_DIR/server.log"; exit 1; }

echo "[antigravity] seed memory (so recall has something to return)"
curl -sf -X POST "$SERVER_URL/v1/remember" -H 'Content-Type: application/json' \
    -d '{"timestamp":"2026-05-20T10:00:00Z","project":"antigravity","summary":"用 npm publish 取代 install.sh","events":[{"event_type":"DecisionMade","timestamp":"2026-05-20T10:00:00Z","content":{"decision":"用 npm publish 取代 install.sh"}}]}' \
    >/dev/null

echo "[antigravity] PreInvocation -> additionalContext (top-level + nested) should reference seeded memory"
PRE_JSON='{"hook_event_name":"PreInvocation","session_id":"sess-agy-1","prompt":"npm publish"}'
OUT=$(echo "$PRE_JSON" | "$ROOT_DIR/cli" adapter antigravity --server "$SERVER_URL" --project antigravity)
echo "$OUT" | node -e "
const out = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const top = out?.additionalContext;
const nested = out?.hookSpecificOutput?.additionalContext;
if (typeof top !== 'string' || typeof nested !== 'string') { console.error('missing additionalContext (top/nested)'); process.exit(1); }
if (!top.includes('npm publish') || !nested.includes('npm publish')) { console.error('additionalContext did not contain seed text: ' + top); process.exit(1); }
console.log('  additionalContext ok (top-level + hookSpecificOutput)');
"

echo "[antigravity] Stop hook with last_assistant_message -> writes ConversationTurn"
BEFORE=$(curl -sf "$SERVER_URL/v1/stats" | node -e "
const r = JSON.parse(require('fs').readFileSync(0, 'utf8'));
process.stdout.write(String(r?.data?.events ?? 0));
")

STOP_JSON='{"hook_event_name":"Stop","session_id":"sess-agy-1","last_assistant_message":"設定 NPM_TOKEN secret 並在 tag push 觸發 release。"}'
echo "$STOP_JSON" | "$ROOT_DIR/cli" adapter antigravity --server "$SERVER_URL" --project antigravity >/dev/null

# Give the server a moment to commit
sleep 0.3

AFTER=$(curl -sf "$SERVER_URL/v1/stats" | node -e "
const r = JSON.parse(require('fs').readFileSync(0, 'utf8'));
process.stdout.write(String(r?.data?.events ?? 0));
")

if [ "$AFTER" -le "$BEFORE" ]; then
    echo "  ✗ event count did not grow (before=$BEFORE, after=$AFTER)"
    exit 1
fi
echo "  Stop hook wrote events ($BEFORE -> $AFTER)"

echo "[antigravity] Stop turn carries the user prompt buffered by PreInvocation"
node -e "
const D = require('$ROOT_DIR/node_modules/better-sqlite3');
const db = new D('$TMP_DIR/home/.memory/sessions.db', { readonly: true });
const row = db.prepare(\"SELECT content FROM events WHERE event_type='ConversationTurn' ORDER BY timestamp DESC LIMIT 1\").get();
db.close();
if (!row) { console.error('  ✗ no ConversationTurn event written'); process.exit(1); }
const c = JSON.parse(row.content);
if (!String(c.user || '').includes('npm publish')) { console.error('  ✗ user prompt not attached to turn: ' + row.content); process.exit(1); }
console.log('  user prompt attached to turn: ' + c.user);
"

echo "[antigravity] duplicate Stop is deduped (no double write)"
echo "$STOP_JSON" | "$ROOT_DIR/cli" adapter antigravity --server "$SERVER_URL" --project antigravity >/dev/null
sleep 0.3
AFTER2=$(curl -sf "$SERVER_URL/v1/stats" | node -e "
const r = JSON.parse(require('fs').readFileSync(0, 'utf8'));
process.stdout.write(String(r?.data?.events ?? 0));
")
if [ "$AFTER2" -ne "$AFTER" ]; then
    echo "  ✗ duplicate Stop wrote again (after=$AFTER, after2=$AFTER2)"
    exit 1
fi
echo "  duplicate Stop deduped (events stayed $AFTER2)"

echo "[antigravity] ok"
