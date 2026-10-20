#!/bin/bash
# test-bootstrap.sh
# Simulates AI agent self-installation of Memoria (Phase 1.5 verification)
# Tests: preflight --json, setup --json, setup --serve --json, SDK health poll

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

CLI="$ROOT_DIR/cli"

echo "[bootstrap] Step 1: preflight --json"
PREFLIGHT_OUTPUT=$(MEMORIA_HOME="$TMP" "$CLI" preflight --json)
echo "$PREFLIGHT_OUTPUT"
OK=$(echo "$PREFLIGHT_OUTPUT" | node -e "const r=require('fs').readFileSync('/dev/stdin','utf8'); process.exit(JSON.parse(r).ok ? 0 : 1)" 2>/dev/null) || {
  echo "✗ preflight --json: ok != true"
  exit 1
}
echo "✓ preflight --json passed"

echo ""
echo "[bootstrap] Step 2: setup --json (no serve)"
PASS_COUNT=0
FAIL_COUNT=0
while IFS= read -r line; do
  STEP=$(echo "$line" | node -e "const r=require('fs').readFileSync('/dev/stdin','utf8'); const o=JSON.parse(r.trim()); process.stdout.write(o.step||'')" 2>/dev/null || true)
  STEP_OK=$(echo "$line" | node -e "const r=require('fs').readFileSync('/dev/stdin','utf8'); process.exit(JSON.parse(r.trim()).ok ? 0 : 1)" 2>/dev/null && echo "yes" || echo "no")
  if [ "$STEP_OK" = "yes" ]; then
    echo "  ✓ step[$STEP]"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "  ✗ step[$STEP] FAILED: $line"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done < <(MEMORIA_HOME="$TMP" "$CLI" setup --json 2>&1)

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo "✗ setup --json: $FAIL_COUNT step(s) failed"
  exit 1
fi
echo "✓ setup --json: $PASS_COUNT steps passed"

echo ""
echo "[bootstrap] Step 3: verify database created"
if [ ! -f "$TMP/.memory/sessions.db" ]; then
  echo "✗ sessions.db was not created"
  exit 1
fi
echo "✓ sessions.db exists"

echo ""
echo "[bootstrap] Step 3b: verify deployed skill"
if [ ! -f "$TMP/.agents/skills/memoria/SKILL.md" ]; then
  echo "✗ deployed skill missing"
  exit 1
fi
if [ ! -f "$TMP/.agents/skills/memoria/REFERENCE.md" ]; then
  echo "✗ deployed skill reference missing"
  exit 1
fi
if grep -q './cli\|bash skills/\|node skills/\|git clone' "$TMP/.agents/skills/memoria/SKILL.md"; then
  echo "✗ deployed SKILL.md still contains repo-only guidance"
  exit 1
fi
if ! grep -q '^name: memoria$' "$TMP/.agents/skills/memoria/SKILL.md"; then
  echo "✗ deployed SKILL.md must expose 'name: memoria' for active_skills discovery"
  exit 1
fi
if ! grep -q 'homeSource' "$TMP/.agents/skills/memoria/SKILL.md"; then
  echo "✗ deployed SKILL.md missing fail-closed guidance (doctor homeSource check)"
  exit 1
fi
if ! grep -q 'memoria setup\|memoria" setup\|MEMORIA_BIN" setup' "$TMP/.agents/skills/memoria/SKILL.md"; then
  echo "✗ deployed SKILL.md missing new-folder setup guidance"
  exit 1
fi
MEMORIA_BIN="$CLI" bash "$TMP/.agents/skills/memoria/scripts/run-sync.sh" "$ROOT_DIR/examples/session.sample.json" "$TMP" >/dev/null
echo "✓ deployed skill works"

echo ""
echo "[bootstrap] Step 3c: host agent skill deployment (issue-22) — isolated HOME"
TEMPLATE="$ROOT_DIR/skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md"
HOST_SKILL_REL=".claude/skills/memoria/SKILL.md"
# A corepack-shimmed pnpm keeps its cache under $HOME; pin it before HOME is swapped, or preflight fails.
export COREPACK_HOME="${COREPACK_HOME:-$HOME/.cache/node/corepack}"

# SCN-006 (primary): a hand-written skill without the setup marker is never overwritten.
H6="$TMP/home-scn6"; mkdir -p "$H6/.claude/skills/memoria"
printf -- '---\nname: memoria\ndescription: hand-written by the user\n---\n\nmine\n' > "$H6/$HOST_SKILL_REL"
cp "$H6/$HOST_SKILL_REL" "$TMP/hand-written.md"
if HOME="$H6" MEMORIA_HOME="$TMP/data-scn6" "$CLI" setup --agent claude-code >"$TMP/scn6.out" 2>&1; then
  echo "✗ SCN-006: setup overwrote a hand-written skill (exit 0)"; exit 1
fi
cmp -s "$TMP/hand-written.md" "$H6/$HOST_SKILL_REL" || { echo "✗ SCN-006: hand-written SKILL.md changed"; exit 1; }
grep -qF "$H6/.claude/skills/memoria" "$TMP/scn6.out" || { echo "✗ SCN-006: refusal does not name the target path"; cat "$TMP/scn6.out"; exit 1; }
echo "✓ SCN-006: hand-written skill left byte-identical, non-zero exit names the path"

# SCN-003: without --agent, setup never touches the host agent directory.
H3="$TMP/home-scn3"; mkdir -p "$H3"
HOME="$H3" MEMORIA_HOME="$TMP/data-scn3" "$CLI" setup --json >/dev/null
[ ! -e "$H3/.claude" ] || { echo "✗ SCN-003: setup without --agent created ~/.claude"; exit 1; }
if HOME="$H3" MEMORIA_HOME="$TMP/data-scn3" "$CLI" setup --agent nope >"$TMP/scn3.out" 2>&1; then
  echo "✗ SCN-003: unknown --agent value accepted"; exit 1
fi
grep -q 'claude-code' "$TMP/scn3.out" || { echo "✗ SCN-003: unknown --agent error does not list the valid values"; exit 1; }
[ ! -e "$H3/.claude" ] || { echo "✗ SCN-003: rejected --agent still wrote ~/.claude"; exit 1; }
echo "✓ SCN-003: no --agent → ~/.claude untouched; unknown value rejected"

# SCN-004: --agent claude-code deploys the template where Claude Code looks.
H4="$TMP/home-scn4"; mkdir -p "$H4"
HOME="$H4" MEMORIA_HOME="$TMP/data-scn4" "$CLI" setup --agent claude-code --json >/dev/null
cmp -s "$TEMPLATE" "$H4/$HOST_SKILL_REL" || { echo "✗ SCN-004: deployed SKILL.md differs from the template"; exit 1; }
[ "$(cat "$H4/.claude/skills/memoria/DATA_ROOT")" = "$TMP/data-scn4" ] || { echo "✗ SCN-004: DATA_ROOT does not name the data root"; exit 1; }
[ -x "$H4/.claude/skills/memoria/bin/memoria" ] || { echo "✗ SCN-004: bin/memoria wrapper missing"; exit 1; }
echo "✓ SCN-004: ~/.claude/skills/memoria deployed from the template, bound to its data root"

# SCN-005: a copy setup wrote (marker present) is refreshed in place.
printf '\nstale line from an older deploy\n' >> "$H4/$HOST_SKILL_REL"
HOME="$H4" MEMORIA_HOME="$TMP/data-scn4" "$CLI" setup --agent claude-code --json >/dev/null
cmp -s "$TEMPLATE" "$H4/$HOST_SKILL_REL" || { echo "✗ SCN-005: marked copy not refreshed"; exit 1; }
echo "✓ SCN-005: marked copy refreshed to the current template"

# SCN-001: the deployed skill states WHEN to use it, with a command and a done criterion per moment.
DEPLOYED="$TMP/.agents/skills/memoria/SKILL.md"
DESCRIPTION=$(grep -m1 '^description:' "$DEPLOYED")
for trigger in "before starting work on an issue or feature" "after making a decision" "pitfall" "after a merge" "release"; do
  echo "$DESCRIPTION" | grep -qiF "$trigger" || { echo "✗ SCN-001: description lacks trigger '$trigger'"; exit 1; }
done
for cmd in ' recall "' ' feedback <recall_id>' ' remember "' ' repo sync <repo>' ' --submit '; do
  grep -qF -- "$cmd" "$DEPLOYED" || { echo "✗ SCN-001: body lacks command '$cmd'"; exit 1; }
done
[ "$(grep -c '^Done when:' "$DEPLOYED")" -ge 5 ] || { echo "✗ SCN-001: fewer than 5 done criteria"; exit 1; }
grep -qF -- 'recall "<issue id or topic>" --mode vector' "$DEPLOYED" || { echo "✗ SCN-001: recall example lacks --mode vector"; exit 1; }
echo "✓ SCN-001: triggers in description; recall/feedback/remember/repo sync each with a command and done criterion"

# SCN-002: the data-root line as written in the deployed skill — exported MEMORIA_HOME wins, else DATA_ROOT.
ROOT_LINE=$(grep -m1 '^MEMORIA_HOME="\${MEMORIA_HOME:-' "$DEPLOYED") || { echo "✗ SCN-002: deployed skill has no MEMORIA_HOME fallback line"; exit 1; }
SKILL_ROOT="$H4/.claude/skills/memoria"
RESOLVED=$(MEMORIA_HOME="/srv/shared-home" SKILL_ROOT="$SKILL_ROOT" bash -c "$ROOT_LINE"'; echo "$MEMORIA_HOME"')
[ "$RESOLVED" = "/srv/shared-home" ] || { echo "✗ SCN-002: exported MEMORIA_HOME not kept (got $RESOLVED)"; exit 1; }
RESOLVED=$(env -u MEMORIA_HOME SKILL_ROOT="$SKILL_ROOT" bash -c "$ROOT_LINE"'; echo "$MEMORIA_HOME"')
[ "$RESOLVED" = "$TMP/data-scn4" ] || { echo "✗ SCN-002: unset MEMORIA_HOME did not fall back to DATA_ROOT (got $RESOLVED)"; exit 1; }
echo "✓ SCN-002: exported MEMORIA_HOME wins; otherwise DATA_ROOT"

echo ""
echo "[bootstrap] Step 4: setup --serve --json (background)"
SERVE_PORT=13917
MEMORIA_HOME="$TMP" "$CLI" setup --serve --port "$SERVE_PORT" --json &
SERVE_PID=$!
trap 'rm -rf "$TMP"; kill "$SERVE_PID" 2>/dev/null || true' EXIT

# Wait for server to be ready (up to 10s)
echo "  Waiting for server on port $SERVE_PORT..."
READY=0
for i in $(seq 1 20); do
  if curl -sf "http://localhost:$SERVE_PORT/v1/health" > /dev/null 2>&1; then
    READY=1
    break
  fi
  sleep 0.5
done

if [ "$READY" -eq 0 ]; then
  echo "✗ Server did not become ready within 10 seconds"
  exit 1
fi

echo ""
echo "[bootstrap] Step 5: GET /v1/health"
HEALTH=$(curl -sf "http://localhost:$SERVE_PORT/v1/health")
echo "$HEALTH" | node -e "const r=require('fs').readFileSync('/dev/stdin','utf8'); const o=JSON.parse(r); process.exit((o.ok && o.data && o.data.ok) ? 0 : 1)" 2>/dev/null || {
  echo "✗ /v1/health: response not ok"
  echo "  Response: $HEALTH"
  exit 1
}
echo "✓ /v1/health returned ok"

echo ""
echo "[bootstrap] Step 6: POST /v1/remember (sample session)"
SESSION_FILE="$ROOT_DIR/examples/session.sample.json"
REMEMBER=$(curl -sf -X POST "http://localhost:$SERVE_PORT/v1/remember" \
  -H "Content-Type: application/json" \
  -d "@$SESSION_FILE")
echo "$REMEMBER" | node -e "const r=require('fs').readFileSync('/dev/stdin','utf8'); process.exit(JSON.parse(r).ok ? 0 : 1)" 2>/dev/null || {
  echo "✗ /v1/remember failed"
  echo "  Response: $REMEMBER"
  exit 1
}
SESSION_ID=$(echo "$REMEMBER" | node -e "const r=require('fs').readFileSync('/dev/stdin','utf8'); process.stdout.write(JSON.parse(r).data.sessionId||'')" 2>/dev/null || true)
echo "✓ /v1/remember ok (sessionId: $SESSION_ID)"

echo ""
echo "[bootstrap] Step 7: POST /v1/recall"
RECALL=$(curl -sf -X POST "http://localhost:$SERVE_PORT/v1/recall" \
  -H "Content-Type: application/json" \
  -d '{"query":"decision","top_k":3}')
echo "$RECALL" | node -e "const r=require('fs').readFileSync('/dev/stdin','utf8'); process.exit(JSON.parse(r).ok ? 0 : 1)" 2>/dev/null || {
  echo "✗ /v1/recall failed"
  echo "  Response: $RECALL"
  exit 1
}
echo "✓ /v1/recall ok"

kill "$SERVE_PID" 2>/dev/null || true

echo ""
echo "[bootstrap] ok"
