#!/usr/bin/env bash
# End-to-end test for the Codex CLI adapter hook handler.
#
# Spawns a Memoria HTTP server, then drives the adapter CLI with mock
# UserPromptSubmit + Stop hook payloads, and verifies the round trip.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
PORT=$((20000 + RANDOM % 10000))
SERVER_URL="http://localhost:${PORT}"
SERVER_PID=""

cleanup() {
    [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true
    rm -rf "$TMP_DIR"
}
trap cleanup EXIT

echo "[codex] start server"
MEMORIA_HOME="$TMP_DIR/home" MEMORIA_PORT="$PORT" "$ROOT_DIR/cli" setup --serve --json >"$TMP_DIR/server.log" 2>&1 &
SERVER_PID=$!

# Wait for /v1/health
for _ in $(seq 1 30); do
    if curl -sf "$SERVER_URL/v1/health" >/dev/null 2>&1; then break; fi
    sleep 0.2
done
curl -sf "$SERVER_URL/v1/health" >/dev/null || { echo "[codex] server failed to start"; cat "$TMP_DIR/server.log"; exit 1; }

echo "[codex] seed memory (so recall has something to return)"
curl -sf -X POST "$SERVER_URL/v1/remember" -H 'Content-Type: application/json' \
    -d '{"timestamp":"2026-05-20T10:00:00Z","project":"codex","summary":"用 npm publish 取代 install.sh","events":[{"event_type":"DecisionMade","timestamp":"2026-05-20T10:00:00Z","content":{"decision":"用 npm publish 取代 install.sh"}}]}' \
    >/dev/null

echo "[codex] UserPromptSubmit -> additionalContext should reference seeded memory"
USER_PROMPT_JSON='{"hook_event_name":"UserPromptSubmit","session_id":"sess-codex-1","prompt":"npm publish"}'
OUT=$(echo "$USER_PROMPT_JSON" | "$ROOT_DIR/cli" adapter codex --server "$SERVER_URL" --project codex)
echo "$OUT" | node -e "
const out = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const ctx = out?.hookSpecificOutput?.additionalContext;
if (typeof ctx !== 'string') { console.error('missing additionalContext'); process.exit(1); }
if (!ctx.includes('npm publish')) { console.error('additionalContext did not contain seed text: ' + ctx); process.exit(1); }
console.log('  additionalContext ok');
"

echo "[codex] Stop hook with last_assistant_message -> writes ConversationTurn"
BEFORE=$(curl -sf "$SERVER_URL/v1/stats" | node -e "
const r = JSON.parse(require('fs').readFileSync(0, 'utf8'));
process.stdout.write(String(r?.data?.events ?? 0));
")

STOP_JSON='{"hook_event_name":"Stop","session_id":"sess-codex-1","last_assistant_message":"設定 NPM_TOKEN secret 並在 tag push 觸發 release。"}'
echo "$STOP_JSON" | "$ROOT_DIR/cli" adapter codex --server "$SERVER_URL" --project codex >/dev/null

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

echo "[codex] ok"
