#!/usr/bin/env bash
# End-to-end test for the Claude Code adapter hook handler.
#
# Spawns a Memoria HTTP server, then drives the adapter CLI with mock
# UserPromptSubmit + Stop hook payloads, and verifies the round trip.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
# Isolate cross-process hook state so throttle/dedupe don't leak across test runs.
export MEMORIA_ADAPTER_STATE_DIR="$TMP_DIR/adapter-state"
PORT=$((20000 + RANDOM % 10000))
SERVER_URL="http://localhost:${PORT}"
SERVER_PID=""

cleanup() {
    [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "[claude-code] start server"
MEMORIA_HOME="$TMP_DIR/home" MEMORIA_PORT="$PORT" "$ROOT_DIR/cli" setup --serve --json >"$TMP_DIR/server.log" 2>&1 &
SERVER_PID=$!

# Wait for /v1/health
for _ in $(seq 1 30); do
    if curl -sf "$SERVER_URL/v1/health" >/dev/null 2>&1; then break; fi
    sleep 0.2
done
curl -sf "$SERVER_URL/v1/health" >/dev/null || { echo "[claude-code] server failed to start"; cat "$TMP_DIR/server.log"; exit 1; }

echo "[claude-code] seed memory (so recall has something to return)"
curl -sf -X POST "$SERVER_URL/v1/remember" -H 'Content-Type: application/json' \
    -d '{"timestamp":"2026-05-20T10:00:00Z","project":"claude-code","summary":"用 npm publish 取代 install.sh","events":[{"event_type":"DecisionMade","timestamp":"2026-05-20T10:00:00Z","content":{"decision":"用 npm publish 取代 install.sh"}}]}' \
    >/dev/null

echo "[claude-code] UserPromptSubmit -> additionalContext should reference seeded memory"
USER_PROMPT_JSON='{"hook_event_name":"UserPromptSubmit","session_id":"sess-test-1","prompt":"npm publish"}'
OUT=$(echo "$USER_PROMPT_JSON" | "$ROOT_DIR/cli" adapter claude-code --server "$SERVER_URL" --project claude-code)
echo "$OUT" | node -e "
const out = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const ctx = out?.hookSpecificOutput?.additionalContext;
if (typeof ctx !== 'string') { console.error('missing additionalContext'); process.exit(1); }
if (!ctx.includes('npm publish')) { console.error('additionalContext did not contain seed text: ' + ctx); process.exit(1); }
console.log('  additionalContext ok');
"

echo "[claude-code] Stop hook with synthetic transcript -> writes ConversationTurn"
TRANSCRIPT="$TMP_DIR/transcript.jsonl"
cat >"$TRANSCRIPT" <<'EOF'
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"如何在 GitHub Actions 上跑 npm publish？"}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"設定 NPM_TOKEN secret 並在 tag push 觸發。"}]}}
EOF

BEFORE=$(curl -sf "$SERVER_URL/v1/stats" | node -e "
const r = JSON.parse(require('fs').readFileSync(0, 'utf8'));
process.stdout.write(String(r?.data?.events ?? 0));
")

STOP_JSON="$(node -e "console.log(JSON.stringify({hook_event_name:'Stop', session_id:'sess-test-1', transcript_path: '${TRANSCRIPT}'}))")"
echo "$STOP_JSON" | "$ROOT_DIR/cli" adapter claude-code --server "$SERVER_URL" --project claude-code >/dev/null

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

echo "[claude-code] ok"
