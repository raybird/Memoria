#!/usr/bin/env bash
# issue-28 — Unified setup, persistent install settings, host wiring, and vector onboarding E2E & safety tests.
#
# Phase 1 (Task 1.1 & Task 1.2):
#   - SCN-003: local project memory takes precedence over saved global default; explicit env overrides both;
#              project setup does not overwrite saved global default.
#   - SCN-009: unsafe targets (hand-written skill, unknown symlink, file blocking directory, unwritable path)
#              are rejected during pre-check before ANY file or DB is modified.
#   - SCN-012: explicit env overrides (MEMORIA_HOME, LIBSQL_URL, MEMORIA_EMBED_PROVIDER) win over saved settings;
#              no auth tokens are ever persisted; local vector store follows effective data root;
#              MEMORIA_DB_PATH mismatch blocks vector ingest before touching corpus.
#   - SCN-002: saved global default works across new CLI processes in arbitrary cwd without MEMORIA_HOME;
#              doctor reports homeSource='global-config' and install settings path.

set -euo pipefail

unset LIBSQL_URL LIBSQL_AUTH_TOKEN MEMORIA_EMBED_PROVIDER MEMORIA_VECTOR_RECALL_CMD MEMORIA_VECTOR_TIMEOUT_MS
unset MEMORIA_HOME MEMORIA_DB_PATH MEMORIA_SESSIONS_PATH MEMORIA_CONFIG_PATH MEMORIA_USER_CONFIG_PATH
unset XDG_DATA_HOME XDG_CONFIG_HOME CODEX_HOME APPDATA LOCALAPPDATA

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT_DIR/cli"
TMP_DIR="$(mktemp -d)"
TMP_DIR="$(cd "$TMP_DIR" && pwd -P)"
export COREPACK_HOME="${COREPACK_HOME:-$HOME/.cache/node/corepack}"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

# The inner driver also exercises real libSQL initialization (F3).
# Ensure helper has @libsql/client in cache or sibling for stub provider
HELPER_DIR="$ROOT_DIR/skills/memoria-vector"
if [ ! -d "$HELPER_DIR/node_modules/@libsql/client" ]; then
  (cd "$HELPER_DIR" && npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1)
fi

echo "[setup-onboarding] Step 1: inner unit assertions for install-settings & path precedence (SCN-003, SCN-009, SCN-012)"
(cd "$ROOT_DIR" && node --import tsx scripts/setup-onboarding-driver.mts)

echo "[setup-onboarding] Step 2: CLI subprocess precedence & isolation (SCN-002, SCN-003, SCN-012)"
H1="$TMP_DIR/home1"
XDG1="$TMP_DIR/xdg1"
GLOBAL_ROOT="$TMP_DIR/global-mem"
LOCAL_PROJ="$TMP_DIR/local-proj"
OTHER_CWD="$TMP_DIR/other-cwd"
mkdir -p "$H1" "$XDG1" "$LOCAL_PROJ" "$OTHER_CWD"

# Initialize global memory via non-interactive setup --scope global
HOME="$H1" XDG_CONFIG_HOME="$XDG1" "$CLI" setup --scope global --memoria-home "$GLOBAL_ROOT" --agent none --no-vector --yes >/dev/null

# SCN-002: In OTHER_CWD with NO MEMORIA_HOME exported, doctor / remember / recall / brief use saved global root
DOC_GLOBAL=$(cd "$OTHER_CWD" && HOME="$H1" XDG_CONFIG_HOME="$XDG1" "$CLI" doctor --json)
echo "$DOC_GLOBAL" | node -e '
const d = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
if (!d.ok) throw new Error("doctor failed: " + JSON.stringify(d));
if (d.homeSource !== "global-config") throw new Error("expected homeSource=global-config, got " + d.homeSource);
if (d.paths.memoriaHome !== process.argv[1]) throw new Error("expected home=" + process.argv[1] + ", got " + d.paths.memoriaHome);
' "$GLOBAL_ROOT"

(cd "$OTHER_CWD" && HOME="$H1" XDG_CONFIG_HOME="$XDG1" "$CLI" remember "Global note alpha from other cwd" --project global-ops --rationale "verify SCN-002" >/dev/null)
RECALL_GLOBAL=$(cd "$OTHER_CWD" && HOME="$H1" XDG_CONFIG_HOME="$XDG1" "$CLI" recall "Global note alpha" --json)
echo "$RECALL_GLOBAL" | node -e '
const d = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
if (!d.ok || !Array.isArray(d.data) || d.data.length === 0) throw new Error("expected global hit in new process");
'
echo "  ✓ SCN-002: new CLI process in arbitrary cwd resolves saved global data root without MEMORIA_HOME"

# SCN-003: Initialize local project memory in LOCAL_PROJ/memoria; project setup must NOT overwrite global default
(cd "$LOCAL_PROJ" && HOME="$H1" XDG_CONFIG_HOME="$XDG1" "$CLI" setup --scope project --agent none --no-vector --yes >/dev/null)
(cd "$LOCAL_PROJ" && HOME="$H1" XDG_CONFIG_HOME="$XDG1" "$CLI" remember "Local project beta secret note" --project local-proj --rationale "verify SCN-003" >/dev/null)

# Running inside LOCAL_PROJ uses detected local memory, NOT global memory
DOC_LOCAL=$(cd "$LOCAL_PROJ" && HOME="$H1" XDG_CONFIG_HOME="$XDG1" "$CLI" doctor --json)
echo "$DOC_LOCAL" | node -e '
const d = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
if (d.homeSource !== "detected") throw new Error("expected homeSource=detected in local project, got " + d.homeSource);
if (d.paths.memoriaHome !== process.argv[1]) throw new Error("expected local memoriaHome, got " + d.paths.memoriaHome);
' "$LOCAL_PROJ/memoria"

# And running back in OTHER_CWD still uses GLOBAL_ROOT (project setup did not hijack global config)
DOC_STILL_GLOBAL=$(cd "$OTHER_CWD" && HOME="$H1" XDG_CONFIG_HOME="$XDG1" "$CLI" doctor --json)
echo "$DOC_STILL_GLOBAL" | node -e '
const d = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
if (d.homeSource !== "global-config" || d.paths.memoriaHome !== process.argv[1]) {
  throw new Error("project setup hijacked global default: " + JSON.stringify(d));
}
' "$GLOBAL_ROOT"
echo "  ✓ SCN-003: local project memory takes precedence in-project and project setup preserves global default"

# SCN-012: Explicit MEMORIA_HOME overrides both; custom MEMORIA_DB_PATH mismatch blocks vector setup
OVERRIDE_ROOT="$TMP_DIR/override-mem"
(cd "$LOCAL_PROJ" && HOME="$H1" XDG_CONFIG_HOME="$XDG1" MEMORIA_HOME="$OVERRIDE_ROOT" "$CLI" init >/dev/null)
DOC_ENV=$(cd "$LOCAL_PROJ" && HOME="$H1" XDG_CONFIG_HOME="$XDG1" MEMORIA_HOME="$OVERRIDE_ROOT" "$CLI" doctor --json)
echo "$DOC_ENV" | node -e '
const d = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
if (d.homeSource !== "env" || d.paths.memoriaHome !== process.argv[1]) {
  throw new Error("MEMORIA_HOME did not override local/global: " + JSON.stringify(d));
}
' "$OVERRIDE_ROOT"

if HOME="$H1" XDG_CONFIG_HOME="$XDG1" MEMORIA_DB_PATH="$TMP_DIR/elsewhere.db" MEMORIA_EMBED_PROVIDER=stub "$CLI" setup --scope global --memoria-home "$GLOBAL_ROOT" --vector --yes >"$TMP_DIR/db-mismatch.out" 2>&1; then
  echo "  ✗ SCN-012: expected setup --vector with mismatched MEMORIA_DB_PATH to fail"
  exit 1
fi
grep -q "MEMORIA_DB_PATH" "$TMP_DIR/db-mismatch.out" || {
  echo "  ✗ SCN-012: mismatch output did not mention MEMORIA_DB_PATH"
  cat "$TMP_DIR/db-mismatch.out"
  exit 1
}
echo "  ✓ SCN-012: explicit env overrides win and MEMORIA_DB_PATH mismatch is blocked before vector ingest"

echo "[setup-onboarding] Step 3: Interactive cancel (SCN-001) & non-interactive automation guard (SCN-011)"
H_INT="$TMP_DIR/home-int"
XDG_INT="$TMP_DIR/xdg-int"
CWD_INT="$TMP_DIR/cwd-int"
mkdir -p "$H_INT" "$XDG_INT" "$CWD_INT"

# SCN-001: Interactive cancel ('n' at confirmation) leaves zero files written
# Answers: 1 (global), 3 (both hosts), 2 (no vector), n (cancel)
CancelOut=$(cd "$CWD_INT" && printf '1\n3\n2\nn\n' | HOME="$H_INT" XDG_CONFIG_HOME="$XDG_INT" "$CLI" setup --interactive 2>&1 || true)
echo "$CancelOut" | grep -qi "cancel" || { echo "  ✗ SCN-001: interactive cancel did not report cancellation: $CancelOut"; exit 1; }
[ ! -e "$XDG_INT/memoria/install.json" ] || { echo "  ✗ SCN-001: interactive cancel still wrote install.json"; exit 1; }
[ ! -e "$H_INT/.memoria" ] || { echo "  ✗ SCN-001: interactive cancel created ~/.memoria"; exit 1; }
[ ! -e "$H_INT/.claude" ] && [ ! -e "$H_INT/.codex" ] || { echo "  ✗ SCN-001: interactive cancel touched host directories"; exit 1; }
echo "  ✓ SCN-001: interactive cancel previews plan and writes nothing when declined"

# SCN-001: Interactive confirm ('y' at confirmation) completes global + both hosts + basic mode
ConfirmOut=$(cd "$CWD_INT" && printf '1\n3\n2\ny\n' | HOME="$H_INT" XDG_CONFIG_HOME="$XDG_INT" "$CLI" setup --interactive 2>&1)
[ -f "$XDG_INT/memoria/install.json" ] || { echo "  ✗ SCN-001: interactive confirm did not save install.json"; exit 1; }
[ -x "$H_INT/.claude/skills/memoria/bin/memoria" ] || { echo "  ✗ SCN-001/004: Claude skill launcher not deployed"; exit 1; }
[ -x "$H_INT/.codex/skills/memoria/bin/memoria" ] || { echo "  ✗ SCN-001/004: Codex skill launcher not deployed"; exit 1; }
[ -f "$H_INT/.claude/CLAUDE.md" ] && [ -f "$H_INT/.codex/AGENTS.md" ] || { echo "  ✗ SCN-001/005: host instructions not wired"; exit 1; }
echo "  ✓ SCN-001: interactive confirm completes setup, host skills, brief & instruction wiring in one step"

# SCN-011: Mutual exclusion / invalid flags exit non-zero without hanging
if HOME="$H_INT" XDG_CONFIG_HOME="$XDG_INT" "$CLI" setup --global --project >/dev/null 2>&1; then
  echo "  ✗ SCN-011: --global --project should exit non-zero"; exit 1
fi
if HOME="$H_INT" XDG_CONFIG_HOME="$XDG_INT" "$CLI" setup --scope invalid >/dev/null 2>&1; then
  echo "  ✗ SCN-011: --scope invalid should exit non-zero"; exit 1
fi
echo "  ✓ SCN-011: mutually exclusive or invalid flags exit non-zero immediately"

echo "[setup-onboarding] Step 4: Multi-target pre-check conflict protection (SCN-009) & idempotent rerun (SCN-004, SCN-005, SCN-008)"
H_CONF="$TMP_DIR/home-conf"
XDG_CONF="$TMP_DIR/xdg-conf"
mkdir -p "$H_CONF/.codex/skills/memoria" "$XDG_CONF"
# Put a hand-written skill in Codex (second host), while Claude (first host) is clean.
# Pre-check must stop BEFORE modifying Claude or creating the data root!
printf -- '---\nname: memoria\ndescription: user custom codex skill\n---\nkeep me\n' > "$H_CONF/.codex/skills/memoria/SKILL.md"
cp "$H_CONF/.codex/skills/memoria/SKILL.md" "$TMP_DIR/codex-hand.md"

if HOME="$H_CONF" XDG_CONFIG_HOME="$XDG_CONF" "$CLI" setup --scope global --agent both --no-vector --yes >"$TMP_DIR/conf.out" 2>&1; then
  echo "  ✗ SCN-009: setup succeeded despite hand-written skill at second host"; exit 1
fi
cmp -s "$TMP_DIR/codex-hand.md" "$H_CONF/.codex/skills/memoria/SKILL.md" || { echo "  ✗ SCN-009: hand-written codex skill was modified"; exit 1; }
[ ! -e "$H_CONF/.claude" ] || { echo "  ✗ SCN-009: first host (.claude) was modified before second host conflict was caught"; exit 1; }
[ ! -e "$H_CONF/.memoria" ] || { echo "  ✗ SCN-009: data root was created despite pre-check conflict"; exit 1; }
echo "  ✓ SCN-009: multi-target pre-check rejects conflict at second host before touching first host or data root"

# SCN-008: Re-running on H_INT preserves user rules and memories without duplicating managed blocks
printf '\n# My custom rule after setup\nKeep this rule intact.\n' >> "$H_INT/.claude/CLAUDE.md"
(cd "$OTHER_CWD" && HOME="$H_INT" XDG_CONFIG_HOME="$XDG_INT" "$CLI" remember "Durable user memory across rerun" --project ops --rationale "SCN-008" >/dev/null)
(cd "$OTHER_CWD" && HOME="$H_INT" XDG_CONFIG_HOME="$XDG_INT" "$CLI" setup --scope global --agent both --no-vector --yes >/dev/null)
grep -q "Keep this rule intact." "$H_INT/.claude/CLAUDE.md" || { echo "  ✗ SCN-008: custom rule in CLAUDE.md lost on rerun"; exit 1; }
[ "$(grep -c 'memoria:managed:start' "$H_INT/.claude/CLAUDE.md")" -eq 1 ] || { echo "  ✗ SCN-008: duplicate managed blocks in CLAUDE.md"; exit 1; }
RECALL_RERUN=$(cd "$OTHER_CWD" && HOME="$H_INT" XDG_CONFIG_HOME="$XDG_INT" "$CLI" recall "Durable user memory" --json)
echo "$RECALL_RERUN" | node -e 'const d=JSON.parse(require("node:fs").readFileSync(0,"utf8")); if(!d.ok||d.data.length===0) throw new Error("memory lost on rerun");'
echo "  ✓ SCN-008: rerun preserves existing memories and custom rules without duplicating managed blocks"

echo "[setup-onboarding] Step 5: Vector enablement on empty & populated DB, cursor immunity, failure & retry (SCN-006, SCN-007, SCN-010, SCN-013)"
# SCN-007 & SCN-013: Empty DB with --vector runs isolated probe, leaves 0 sessions/events/telemetry in real DB
H_EMPTY="$TMP_DIR/home-empty"
XDG_EMPTY="$TMP_DIR/xdg-empty"
mkdir -p "$H_EMPTY" "$XDG_EMPTY"
EMPTY_OUT=$(HOME="$H_EMPTY" XDG_CONFIG_HOME="$XDG_EMPTY" MEMORIA_EMBED_PROVIDER=stub "$CLI" setup --scope global --agent none --vector --yes --json)
echo "$EMPTY_OUT" | node -e '
const lines = require("node:fs").readFileSync(0, "utf8").trim().split("\n").map(l => JSON.parse(l));
const r = lines.find(x => x.step === "readiness");
if (!r || !r.ok) throw new Error("expected readiness step ok on empty vector setup: " + JSON.stringify(lines));
if (r.vector?.status !== "ready" || r.vector?.corpusVerified !== false || r.vector?.isolatedProbeVerified !== true) {
  throw new Error("empty DB must report isolatedProbeVerified=true and corpusVerified=false, got: " + JSON.stringify(r));
}
'
STATS_EMPTY=$(cd "$OTHER_CWD" && HOME="$H_EMPTY" XDG_CONFIG_HOME="$XDG_EMPTY" "$CLI" stats --json)
echo "$STATS_EMPTY" | node -e '
const d = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
if (d.data.sessions !== 0 || d.data.events !== 0) {
  throw new Error("SCN-013: setup polluted empty DB with probe records: " + JSON.stringify(d.data));
}
'
echo "  ✓ SCN-007/013: empty DB vector setup verifies pipeline in isolated temp root and leaves 0 test records in real DB"

# SCN-006: Populated DB with advanced MCP sync cursor still embeds full corpus and verifies vector route_mode
H_POP="$TMP_DIR/home-pop"
XDG_POP="$TMP_DIR/xdg-pop"
POP_ROOT="$H_POP/.memoria"
mkdir -p "$H_POP" "$XDG_POP"
(cd "$OTHER_CWD" && HOME="$H_POP" XDG_CONFIG_HOME="$XDG_POP" "$CLI" setup --scope global --agent codex --no-vector --yes >/dev/null)
(cd "$OTHER_CWD" && HOME="$H_POP" XDG_CONFIG_HOME="$XDG_POP" "$CLI" remember "採用原生 install.json 保存設定以支援跨程序讀取" --project memoria --rationale "不依賴 shell export" >/dev/null)
# Advance the default mcp-memory-libsql cursor far into the future to prove setup's full ingest is not masked by it!
node -e '
const Database = require("better-sqlite3");
const db = new Database(process.argv[1]);
db.prepare("INSERT OR REPLACE INTO memory_sync_state (target, cursor_updated_at, updated_at) VALUES (?, ?, ?)").run("mcp-memory-libsql", "2099-12-31T23:59:59.000Z", "2099-12-31T23:59:59.000Z");
db.close();
' "$POP_ROOT/.memory/sessions.db"

POP_OUT=$(HOME="$H_POP" XDG_CONFIG_HOME="$XDG_POP" MEMORIA_EMBED_PROVIDER=stub "$CLI" setup --scope global --agent codex --vector --yes --json)
echo "$POP_OUT" | node -e '
const lines = require("node:fs").readFileSync(0, "utf8").trim().split("\n").map(l => JSON.parse(l));
const r = lines.find(x => x.step === "readiness");
if (!r || !r.ok || r.vector?.status !== "ready" || r.vector?.corpusVerified !== true) {
  throw new Error("expected readiness.vector.status=ready & corpusVerified=true: " + JSON.stringify(lines));
}
'
DOC_POP=$(cd "$OTHER_CWD" && HOME="$H_POP" XDG_CONFIG_HOME="$XDG_POP" "$CLI" doctor --json)
echo "$DOC_POP" | node -e '
const d = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
if (!d.ok) throw new Error("doctor not ok after vector setup: " + JSON.stringify(d));
const cov = d.checks.find(c => c.name === "vector coverage");
if (!cov || !cov.ok || !cov.value.includes("missing=0") || cov.value.includes("expected=0")) {
  throw new Error("expected full non-zero vector coverage with missing=0, got: " + JSON.stringify(cov));
}
'
# Verify new process recall with --mode vector uses vector / hybrid_vector without needing LIBSQL_URL exported in shell
REC_POP=$(cd "$OTHER_CWD" && HOME="$H_POP" XDG_CONFIG_HOME="$XDG_POP" "$CLI" recall "install.json 跨程序" --mode vector --json)
echo "$REC_POP" | node -e '
const d = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
if (!d.ok || (d.meta.route_mode !== "vector" && d.meta.route_mode !== "hybrid_vector") || d.meta.fallback_used !== false) {
  throw new Error("expected vector/hybrid_vector with fallback_used=false in new process, got: " + JSON.stringify(d.meta));
}
'
# SCN-012 (outer-loop cross-root isolation): when switching to another data root via MEMORIA_HOME without LIBSQL_URL,
# it must NOT leak the global root's vector store into the switched root.
ISOLATED_VEC_ROOT="$TMP_DIR/isolated-vec-root"
mkdir -p "$ISOLATED_VEC_ROOT"
(cd "$OTHER_CWD" && HOME="$H_POP" XDG_CONFIG_HOME="$XDG_POP" MEMORIA_HOME="$ISOLATED_VEC_ROOT" "$CLI" init >/dev/null)
DOC_ISO_VEC=$(cd "$OTHER_CWD" && HOME="$H_POP" XDG_CONFIG_HOME="$XDG_POP" MEMORIA_HOME="$ISOLATED_VEC_ROOT" "$CLI" doctor --json)
echo "$DOC_ISO_VEC" | node -e '
const d = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
const vr = d.checks.find(c => c.name === "vector recall");
if (!vr || vr.value !== "not enabled (LIBSQL_URL unset)") {
  throw new Error("expected switched root without vector setup to have vector recall not enabled, got: " + JSON.stringify(d.checks));
}
'
echo "  ✓ SCN-006/012: populated DB vector setup indexes full corpus despite future sync cursor, missing=0, new process recall routes via vector, and switched root stays isolated"

# SCN-010: Simulated failure during vector setup reports core=ready, vector=failed, exits non-zero, and succeeds on retry
H_FAIL="$TMP_DIR/home-fail"
XDG_FAIL="$TMP_DIR/xdg-fail"
mkdir -p "$H_FAIL" "$XDG_FAIL"
if HOME="$H_FAIL" XDG_CONFIG_HOME="$XDG_FAIL" MEMORIA_EMBED_PROVIDER=invalid_provider "$CLI" setup --scope global --agent none --vector --yes >"$TMP_DIR/fail10.out" 2>&1; then
  echo "  ✗ SCN-010: setup exited 0 despite vector failure"; exit 1
fi
grep -q "core: ready" "$TMP_DIR/fail10.out" && grep -q "vector: failed" "$TMP_DIR/fail10.out" || {
  echo "  ✗ SCN-010: failure output did not distinguish core: ready and vector: failed"
  cat "$TMP_DIR/fail10.out"
  exit 1
}
# Retry with valid provider recovers and succeeds
HOME="$H_FAIL" XDG_CONFIG_HOME="$XDG_FAIL" MEMORIA_EMBED_PROVIDER=stub "$CLI" setup --scope global --agent none --vector --yes >/dev/null
echo "  ✓ SCN-010: vector failure exits non-zero, reports core=ready & vector=failed, and recovers on retry"

echo "[setup-onboarding] Step 6: Third-party review regression checks (review-f38ce84 MUST FIX #1-#7)"
# MUST FIX #2: Plain file at ~/.codex/skills (second host parent) is rejected during pre-check before touching ~/.claude or sessions.db
H_MF2="$TMP_DIR/home-mf2"
XDG_MF2="$TMP_DIR/xdg-mf2"
mkdir -p "$H_MF2/.codex" "$XDG_MF2"
printf 'not a directory\n' > "$H_MF2/.codex/skills"
if HOME="$H_MF2" XDG_CONFIG_HOME="$XDG_MF2" "$CLI" setup --scope global --agent both --no-vector --yes >"$TMP_DIR/mf2.out" 2>&1; then
  echo "  ✗ MUST FIX #2: setup succeeded despite ~/.codex/skills being a plain file"; exit 1
fi
[ ! -e "$H_MF2/.claude" ] || { echo "  ✗ MUST FIX #2: first host (.claude) was created before second host parent file was caught"; exit 1; }
[ ! -e "$H_MF2/.memoria" ] || { echo "  ✗ MUST FIX #2: data root was created before second host parent file was caught"; exit 1; }
echo "  ✓ MUST FIX #2: plain file blocking host skill ancestor or settings ancestor is rejected during pre-check before any writes"

# MUST FIX #4: Interactive setup with --memoria-home <custom> previews <custom> BEFORE confirmation
H_MF4="$TMP_DIR/home-mf4"
XDG_MF4="$TMP_DIR/xdg-mf4"
CUSTOM_MF4="$TMP_DIR/custom-mf4-root"
mkdir -p "$H_MF4" "$XDG_MF4"
PreviewMF4=$(cd "$OTHER_CWD" && printf '1\n4\n2\nn\n' | HOME="$H_MF4" XDG_CONFIG_HOME="$XDG_MF4" "$CLI" setup --interactive --memoria-home "$CUSTOM_MF4" 2>&1 || true)
echo "$PreviewMF4" | grep -q "Data root:.*$CUSTOM_MF4" || {
  echo "  ✗ MUST FIX #4: interactive preview did not show --memoria-home $CUSTOM_MF4 before confirmation:"
  echo "$PreviewMF4"
  exit 1
}
echo "  ✓ MUST FIX #4: interactive preview reflects --memoria-home / MEMORIA_HOME before confirmation"

# MUST FIX #5: In a folder that already has ./.memory, setup --scope project uses cwd (matching doctor/recall), not cwd/memoria
DOTMEM_PROJ="$TMP_DIR/dotmem-proj"
mkdir -p "$DOTMEM_PROJ/.memory"
(cd "$DOTMEM_PROJ" && HOME="$H1" XDG_CONFIG_HOME="$XDG1" "$CLI" setup --scope project --agent codex --no-vector --yes >/dev/null)
[ -f "$DOTMEM_PROJ/.memory/sessions.db" ] || { echo "  ✗ MUST FIX #5: expected $DOTMEM_PROJ/.memory/sessions.db to be initialized"; exit 1; }
[ ! -d "$DOTMEM_PROJ/memoria/.memory" ] || { echo "  ✗ MUST FIX #5: setup created duplicate $DOTMEM_PROJ/memoria/.memory alongside existing .memory"; exit 1; }
DOC_DOTMEM=$(cd "$DOTMEM_PROJ" && HOME="$H1" XDG_CONFIG_HOME="$XDG1" "$CLI" doctor --json)
echo "$DOC_DOTMEM" | node -e '
const d = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
if (!d.ok || d.paths.memoriaHome !== process.argv[1]) {
  throw new Error("MUST FIX #5: doctor home mismatch: " + JSON.stringify(d));
}
' "$DOTMEM_PROJ"
echo "  ✓ MUST FIX #5: setup --scope project in a folder with existing ./.memory targets cwd (matching doctor/recall)"

# MUST FIX #3: Existing empty SQLite file at LIBSQL_URL (no memoria_vectors table yet) still ingests populated corpus
H_MF3="$TMP_DIR/home-mf3"
XDG_MF3="$TMP_DIR/xdg-mf3"
ROOT_MF3="$H_MF3/.memoria"
EMPTY_VEC_FILE="$TMP_DIR/precreated-empty-vec.db"
mkdir -p "$H_MF3" "$XDG_MF3"
: > "$EMPTY_VEC_FILE"
(cd "$OTHER_CWD" && HOME="$H_MF3" XDG_CONFIG_HOME="$XDG_MF3" "$CLI" setup --scope global --agent none --no-vector --yes >/dev/null)
(cd "$OTHER_CWD" && HOME="$H_MF3" XDG_CONFIG_HOME="$XDG_MF3" "$CLI" remember "預先存在的空白向量資料庫檔案仍須完成語料索引" --project mf3 --rationale "review-f38ce84 #3" >/dev/null)
MF3_OUT=$(HOME="$H_MF3" XDG_CONFIG_HOME="$XDG_MF3" LIBSQL_URL="file:$EMPTY_VEC_FILE" MEMORIA_EMBED_PROVIDER=stub "$CLI" setup --scope global --agent none --vector --yes --json)
echo "$MF3_OUT" | node -e '
const lines = require("node:fs").readFileSync(0, "utf8").trim().split("\n").map(l => JSON.parse(l));
const r = lines.find(x => x.step === "readiness");
if (!r || !r.ok || r.vector?.status !== "ready" || r.vector?.corpusVerified !== true) {
  throw new Error("MUST FIX #3: expected corpusVerified=true when LIBSQL_URL pointed at empty file: " + JSON.stringify(lines));
}
'
echo "  ✓ MUST FIX #3: populated DB with pre-existing empty vector file still runs full ingest and verifies corpusVerified=true"

# MUST FIX #1, #6, #7:
# - #1: After global vector setup on POP_ROOT (root A), running setup --memoria-home PROJ_VEC_B --scope project --vector --yes
#       must write vectors into PROJ_VEC_B/.memory/vectors.db and NEVER into POP_ROOT/.memory/vectors.db.
# - #6: Running setup --scope project --no-vector --yes on PROJ_VEC_B removes PROJ_VEC_B from vector.roots while keeping POP_ROOT enabled.
# - #7: Re-enabling PROJ_VEC_B and then running setup --scope global --no-vector --yes on POP_ROOT disables POP_ROOT while keeping PROJ_VEC_B enabled.
PROJ_VEC_B="$TMP_DIR/proj-vec-b"
mkdir -p "$PROJ_VEC_B"
(cd "$PROJ_VEC_B" && HOME="$H_POP" XDG_CONFIG_HOME="$XDG_POP" MEMORIA_HOME="$PROJ_VEC_B" "$CLI" init >/dev/null)
(cd "$PROJ_VEC_B" && HOME="$H_POP" XDG_CONFIG_HOME="$XDG_POP" "$CLI" remember "Project B exclusive vector decision" --project proj-b --rationale "review-f38ce84 #1" >/dev/null)

# Count rows in POP_ROOT's vectors.db before setting up PROJ_VEC_B
POP_VEC_COUNT_BEFORE=$(node -e '
const Database = require("better-sqlite3");
const db = new Database(process.argv[1], { readonly: true });
console.log(db.prepare("SELECT COUNT(*) AS c FROM memoria_vectors").get().c);
db.close();
' "$POP_ROOT/.memory/vectors.db")

(cd "$OTHER_CWD" && HOME="$H_POP" XDG_CONFIG_HOME="$XDG_POP" MEMORIA_EMBED_PROVIDER=stub "$CLI" setup --scope project --memoria-home "$PROJ_VEC_B" --agent none --vector --yes >/dev/null)
[ -f "$PROJ_VEC_B/.memory/vectors.db" ] || { echo "  ✗ MUST FIX #1: $PROJ_VEC_B/.memory/vectors.db was not created (polluted global vectors.db instead!)"; exit 1; }

POP_VEC_COUNT_AFTER=$(node -e '
const Database = require("better-sqlite3");
const db = new Database(process.argv[1], { readonly: true });
console.log(db.prepare("SELECT COUNT(*) AS c FROM memoria_vectors").get().c);
db.close();
' "$POP_ROOT/.memory/vectors.db")
[ "$POP_VEC_COUNT_BEFORE" = "$POP_VEC_COUNT_AFTER" ] || {
  echo "  ✗ MUST FIX #1: global vectors.db row count changed from $POP_VEC_COUNT_BEFORE to $POP_VEC_COUNT_AFTER during project B setup!"
  exit 1
}
echo "  ✓ MUST FIX #1: setting up vector on a second root creates its own vectors.db and does not pollute the startup root's vectors.db"

# MUST FIX #6: Disable vector on project B via non-interactive `--scope project --no-vector --yes`
(cd "$OTHER_CWD" && HOME="$H_POP" XDG_CONFIG_HOME="$XDG_POP" "$CLI" setup --scope project --memoria-home "$PROJ_VEC_B" --agent none --no-vector --yes >/dev/null)
DOC_B_DISABLED=$(cd "$OTHER_CWD" && HOME="$H_POP" XDG_CONFIG_HOME="$XDG_POP" MEMORIA_HOME="$PROJ_VEC_B" "$CLI" doctor --json)
echo "$DOC_B_DISABLED" | node -e '
const d = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
const vr = d.checks.find(c => c.name === "vector recall");
if (!vr || vr.value !== "not enabled (LIBSQL_URL unset)") {
  throw new Error("MUST FIX #6: expected project B vector recall to be disabled after --no-vector, got: " + JSON.stringify(vr));
}
'
DOC_A_STILL_ENABLED=$(cd "$OTHER_CWD" && HOME="$H_POP" XDG_CONFIG_HOME="$XDG_POP" "$CLI" doctor --json)
echo "$DOC_A_STILL_ENABLED" | node -e '
const d = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
const vr = d.checks.find(c => c.name === "vector recall");
if (!vr || !vr.ok || !vr.value.startsWith("enabled")) {
  throw new Error("MUST FIX #6: disabling project B accidentally disabled global root A: " + JSON.stringify(vr));
}
'
echo "  ✓ MUST FIX #6: setup --scope project --no-vector --yes removes project root from vector.roots while keeping global root enabled"

# MUST FIX #7: Re-enable project B, then disable global root A via `--scope global --no-vector --yes`;
# global root A must be disabled while project B remains enabled!
(cd "$OTHER_CWD" && HOME="$H_POP" XDG_CONFIG_HOME="$XDG_POP" MEMORIA_EMBED_PROVIDER=stub "$CLI" setup --scope project --memoria-home "$PROJ_VEC_B" --agent none --vector --yes >/dev/null)
(cd "$OTHER_CWD" && HOME="$H_POP" XDG_CONFIG_HOME="$XDG_POP" "$CLI" setup --scope global --agent none --no-vector --yes >/dev/null)
DOC_A_DISABLED=$(cd "$OTHER_CWD" && HOME="$H_POP" XDG_CONFIG_HOME="$XDG_POP" "$CLI" doctor --json)
echo "$DOC_A_DISABLED" | node -e '
const d = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
const vr = d.checks.find(c => c.name === "vector recall");
if (!vr || vr.value !== "not enabled (LIBSQL_URL unset)") {
  throw new Error("MUST FIX #7: expected global root A vector recall to be disabled after --scope global --no-vector, got: " + JSON.stringify(vr));
}
'
DOC_B_STILL_ENABLED=$(cd "$OTHER_CWD" && HOME="$H_POP" XDG_CONFIG_HOME="$XDG_POP" MEMORIA_HOME="$PROJ_VEC_B" "$CLI" doctor --json)
echo "$DOC_B_STILL_ENABLED" | node -e '
const d = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
const vr = d.checks.find(c => c.name === "vector recall");
if (!vr || !vr.ok || !vr.value.startsWith("enabled")) {
  throw new Error("MUST FIX #7: disabling global root A accidentally disabled project B: " + JSON.stringify(vr));
}
'
echo "  ✓ MUST FIX #7: setup --scope global --no-vector disables global root while preserving project B's vector enablement"

echo "[setup-onboarding] Step 7: Follow-up review regression checks (review-62075c8-followup F-1, F-2, F-3)"
# F-1a: Plain file at <dataRoot>/.agents/skills must be rejected BEFORE init creates sessions.db
F1_ROOT_A="$TMP_DIR/f1-root-a"
mkdir -p "$F1_ROOT_A/.agents"
printf 'plain file\n' > "$F1_ROOT_A/.agents/skills"
if HOME="$H1" XDG_CONFIG_HOME="$XDG1" "$CLI" setup --scope project --memoria-home "$F1_ROOT_A" --agent none --no-vector --yes >"$TMP_DIR/f1a.out" 2>&1; then
  echo "  ✗ F-1a: setup succeeded despite plain file at <dataRoot>/.agents/skills"; exit 1
fi
[ ! -e "$F1_ROOT_A/.memory" ] || { echo "  ✗ F-1a: .memory was created before <dataRoot>/.agents/skills conflict was caught"; exit 1; }

# F-1b: Hand-written <dataRoot>/.agents/skills/memoria/SKILL.md without deployment marks must NOT be overwritten
F1_ROOT_B="$TMP_DIR/f1-root-b"
mkdir -p "$F1_ROOT_B/.agents/skills/memoria"
printf -- '---\nname: custom\n---\nHand-written data-root skill\n' > "$F1_ROOT_B/.agents/skills/memoria/SKILL.md"
if HOME="$H1" XDG_CONFIG_HOME="$XDG1" "$CLI" setup --scope project --memoria-home "$F1_ROOT_B" --agent none --no-vector --yes >"$TMP_DIR/f1b.out" 2>&1; then
  echo "  ✗ F-1b: setup succeeded despite unmarked <dataRoot>/.agents/skills/memoria/SKILL.md"; exit 1
fi
grep -q "Hand-written data-root skill" "$F1_ROOT_B/.agents/skills/memoria/SKILL.md" || {
  echo "  ✗ F-1b: hand-written <dataRoot>/.agents/skills/memoria/SKILL.md was overwritten!"
  exit 1
}
[ ! -e "$F1_ROOT_B/.memory" ] || { echo "  ✗ F-1b: .memory was created before unmarked data-root skill was caught"; exit 1; }

# F-1c: Symlink at <dataRoot>/.memory must be rejected BEFORE writing into symlink target
F1_ROOT_C="$TMP_DIR/f1-root-c"
F1_OUTSIDE_MEM="$TMP_DIR/f1-outside-mem"
mkdir -p "$F1_ROOT_C" "$F1_OUTSIDE_MEM"
ln -s "$F1_OUTSIDE_MEM" "$F1_ROOT_C/.memory"
if HOME="$H1" XDG_CONFIG_HOME="$XDG1" "$CLI" setup --scope project --memoria-home "$F1_ROOT_C" --agent none --no-vector --yes >"$TMP_DIR/f1c.out" 2>&1; then
  echo "  ✗ F-1c: setup succeeded despite <dataRoot>/.memory being a symlink"; exit 1
fi
[ ! -e "$F1_OUTSIDE_MEM/sessions.db" ] || { echo "  ✗ F-1c: sessions.db was written into symlinked .memory target"; exit 1; }
echo "  ✓ F-1: data-root internal paths (.memory, .agents/skills/memoria, etc.) are pre-checked and protected before any write"

# F-2: ~/.codex is a symlink to an unselected directory that already has a real skills/ dir and AGENTS.md
H_F2="$TMP_DIR/home-f2"
XDG_F2="$TMP_DIR/xdg-f2"
F2_UNSELECTED="$TMP_DIR/f2-unselected"
mkdir -p "$H_F2" "$XDG_F2" "$F2_UNSELECTED/skills"
printf '# Unselected Host Rules\n' > "$F2_UNSELECTED/AGENTS.md"
ln -s "$F2_UNSELECTED" "$H_F2/.codex"
if HOME="$H_F2" XDG_CONFIG_HOME="$XDG_F2" "$CLI" setup --scope global --agent codex --no-vector --yes >"$TMP_DIR/f2.out" 2>&1; then
  echo "  ✗ F-2: setup succeeded despite ~/.codex being a symlink to an unselected directory"; exit 1
fi
[ ! -e "$F2_UNSELECTED/skills/memoria" ] || { echo "  ✗ F-2: skill was deployed through ~/.codex symlink into unselected directory"; exit 1; }
grep -q "memoria:instructions:start" "$F2_UNSELECTED/AGENTS.md" && {
  echo "  ✗ F-2: AGENTS.md in unselected directory was modified through ~/.codex symlink"
  exit 1
}
[ ! -e "$H_F2/.memoria" ] || { echo "  ✗ F-2: data root was created before ~/.codex symlink was caught"; exit 1; }
echo "  ✓ F-2: symlinked ancestor directory (~/.codex -> unselected dir with existing skills/ & AGENTS.md) is rejected before any write"

# F-2 deep (review-a02c01c): arbitrary-depth user symlink ancestor (<fixture>/link/a/b/c/d/e) must ALSO be rejected before any write
H_F2D="$TMP_DIR/home-f2-deep"
XDG_F2D="$TMP_DIR/xdg-f2-deep"
F2D_UNSELECTED="$TMP_DIR/f2-deep-unselected"
F2D_SUB="$F2D_UNSELECTED/a/b/c/d/e"
F2D_LINK="$TMP_DIR/f2-deep-link"
mkdir -p "$H_F2D" "$XDG_F2D" "$F2D_SUB/skills"
printf '# Deep Unselected Host Rules\n' > "$F2D_SUB/AGENTS.md"
ln -s "$F2D_UNSELECTED" "$F2D_LINK"
if HOME="$H_F2D" XDG_CONFIG_HOME="$XDG_F2D" CODEX_HOME="$F2D_LINK/a/b/c/d/e" "$CLI" setup --scope global --agent codex --no-vector --yes >"$TMP_DIR/f2d.out" 2>&1; then
  echo "  ✗ F-2 deep: setup succeeded despite CODEX_HOME traversing a user symlink 6 levels up"; exit 1
fi
[ ! -e "$F2D_SUB/skills/memoria" ] || { echo "  ✗ F-2 deep: skill was deployed through deep CODEX_HOME symlink into unselected directory"; exit 1; }
grep -q "memoria:managed:start" "$F2D_SUB/AGENTS.md" && {
  echo "  ✗ F-2 deep: AGENTS.md in unselected directory was modified through deep CODEX_HOME symlink"
  exit 1
}
[ ! -e "$H_F2D/.memoria" ] || { echo "  ✗ F-2 deep: data root was created before deep CODEX_HOME symlink was caught"; exit 1; }
echo "  ✓ F-2 deep: arbitrary-depth symlinked ancestor (<fixture>/link/a/b/c/d/e) is rejected before any write"

# F-3: Empty corpus (0 memories) + pre-existing 0-byte vectors.db file succeeds with --vector and passes doctor
H_F3="$TMP_DIR/home-f3"
XDG_F3="$TMP_DIR/xdg-f3"
ROOT_F3="$H_F3/.memoria"
mkdir -p "$ROOT_F3/.memory" "$XDG_F3"
: > "$ROOT_F3/.memory/vectors.db"
F3_OUT=$(HOME="$H_F3" XDG_CONFIG_HOME="$XDG_F3" MEMORIA_EMBED_PROVIDER=stub "$CLI" setup --scope global --agent none --vector --yes --json)
echo "$F3_OUT" | node -e '
const lines = require("node:fs").readFileSync(0, "utf8").trim().split("\n").map(l => JSON.parse(l));
const r = lines.find(x => x.step === "readiness");
if (!r || !r.ok || r.vector?.status !== "ready" || r.vector?.isolatedProbeVerified !== true) {
  throw new Error("F-3: expected readiness.vector.status=ready on empty corpus with 0-byte vectors.db: " + JSON.stringify(lines));
}
'
DOC_F3=$(cd "$OTHER_CWD" && HOME="$H_F3" XDG_CONFIG_HOME="$XDG_F3" "$CLI" doctor --json)
echo "$DOC_F3" | node -e '
const d = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
if (!d.ok) throw new Error("F-3: doctor failed after empty-corpus 0-byte vectors.db setup: " + JSON.stringify(d));
'
echo "  ✓ F-3: empty corpus with pre-existing 0-byte vectors.db initializes vector table and passes readiness & doctor"

echo "[setup-onboarding] Step 6: host skills link to the canonical data-root skill (issue-29 SCN-001~SCN-008)"
# Each case builds its own Given state, so one missing behaviour does not hide the others; the step
# fails once at the end with every ✗ above it.
I29="$TMP_DIR/i29"
mkdir -p "$I29"
TEMPLATE="$ROOT_DIR/skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md"
I29_FAILS=0
fail29() { echo "  ✗ $1"; I29_FAILS=$((I29_FAILS + 1)); }
canon() { printf '%s/.agents/skills/memoria' "$1"; }
realdir() { (cd -P "$1" 2>/dev/null && pwd) || true; }
links_to() { [ -L "$1" ] && [ "$(realdir "$1")" = "$(realdir "$2")" ]; }
backup_count() { find "$1/.agents/skill-backups" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' '; }
# Paths, link texts and file hashes: equal snapshots mean nothing under the tree was added, removed or rewritten.
snap() { (cd "$1" && find . | LC_ALL=C sort | while IFS= read -r p; do
  if [ -L "$p" ]; then printf '%s -> %s\n' "$p" "$(readlink "$p")"
  elif [ -f "$p" ]; then printf '%s %s\n' "$p" "$(sha256sum < "$p" | cut -d' ' -f1)"
  else printf '%s/\n' "$p"; fi
done); }
# setup in the bootstrap style (no onboarding flags), from a neutral cwd, isolated HOME and settings.
setup29() { local home="$1" root="$2"; shift 2; (cd "$OTHER_CWD" && HOME="$home" XDG_CONFIG_HOME="$home/.xdg" MEMORIA_HOME="$root" "$CLI" setup "$@"); }
# Checks a host path serves the canonical skill of $2: template SKILL.md, DATA_ROOT and a working launcher.
serves29() {
  local label="$1" host="$2" root="$3"
  links_to "$host" "$(canon "$root")" || { fail29 "$label: $host is not a symlink to $(canon "$root")"; return; }
  cmp -s "$TEMPLATE" "$host/SKILL.md" || fail29 "$label: SKILL.md read through $host differs from the template"
  [ "$(cat "$host/DATA_ROOT" 2>/dev/null)" = "$root" ] || fail29 "$label: DATA_ROOT read through $host does not name $root"
  "$host/bin/memoria" --help >/dev/null 2>&1 || fail29 "$label: $host/bin/memoria does not run"
}

# SCN-001: fresh deployment — canonical is a real directory, both hosts link to it (plus a custom CODEX_HOME).
H29_1="$I29/home-1"; R29_1="$I29/root-1"; mkdir -p "$H29_1"
if setup29 "$H29_1" "$R29_1" --agent both --json >"$I29/scn1.out" 2>&1; then
  [ -d "$(canon "$R29_1")" ] && [ ! -L "$(canon "$R29_1")" ] || fail29 "SCN-001: canonical $(canon "$R29_1") is not a real directory"
  [ -x "$(canon "$R29_1")/bin/memoria" ] || fail29 "SCN-001: canonical launcher missing"
  serves29 "SCN-001 claude-code" "$H29_1/.claude/skills/memoria" "$R29_1"
  serves29 "SCN-001 codex" "$H29_1/.codex/skills/memoria" "$R29_1"
else
  fail29 "SCN-001: setup --agent both failed: $(tail -3 "$I29/scn1.out")"
fi
H29_1C="$I29/home-1c"; R29_1C="$I29/root-1c"; mkdir -p "$H29_1C"
if (export CODEX_HOME="$I29/custom-codex"; setup29 "$H29_1C" "$R29_1C" --agent codex --json >"$I29/scn1c.out" 2>&1); then
  serves29 "SCN-001 custom CODEX_HOME" "$I29/custom-codex/skills/memoria" "$R29_1C"
else
  fail29 "SCN-001: setup --agent codex with custom CODEX_HOME failed: $(tail -3 "$I29/scn1c.out")"
fi

# Given state for SCN-002/SCN-008: a set-up data root and host links pointing where the case needs.
prepare_root() { setup29 "$1" "$2" --json >"$I29/prepare.out" 2>&1 || fail29 "Given: setup of $2 failed: $(tail -3 "$I29/prepare.out")"; }
link_hosts() { mkdir -p "$1/.claude/skills" "$1/.codex/skills"; ln -s "$2" "$1/.claude/skills/memoria"; ln -s "$3" "$1/.codex/skills/memoria"; }

# SCN-002a: rerun on the same root relinks without a backup.
H29_2="$I29/home-2"; RA="$I29/root-a"; mkdir -p "$H29_2"
prepare_root "$H29_2" "$RA"
link_hosts "$H29_2" "$(canon "$RA")" "../../../root-a/.agents/skills/memoria"
if setup29 "$H29_2" "$RA" --agent both --json >"$I29/scn2a.out" 2>&1; then
  serves29 "SCN-002 rerun claude-code" "$H29_2/.claude/skills/memoria" "$RA"
  serves29 "SCN-002 rerun codex (was a relative link)" "$H29_2/.codex/skills/memoria" "$RA"
  [ "$(backup_count "$RA")" -eq 0 ] || fail29 "SCN-002: rerun created a skill backup"
else
  fail29 "SCN-002: rerun over Memoria links failed: $(tail -3 "$I29/scn2a.out")"
fi

# SCN-002b: switching to another root relinks, leaves the old canonical untouched, backs nothing up.
H29_2B="$I29/home-2b"; RA2="$I29/root-a2"; RB="$I29/root-b"; mkdir -p "$H29_2B"
prepare_root "$H29_2B" "$RA2"
link_hosts "$H29_2B" "$(canon "$RA2")" "$(canon "$RA2")"
snap "$(canon "$RA2")" > "$I29/scn2b-old.snap"
if setup29 "$H29_2B" "$RB" --agent both --json >"$I29/scn2b.out" 2>&1; then
  serves29 "SCN-002 switch claude-code" "$H29_2B/.claude/skills/memoria" "$RB"
  serves29 "SCN-002 switch codex" "$H29_2B/.codex/skills/memoria" "$RB"
  snap "$(canon "$RA2")" | cmp -s "$I29/scn2b-old.snap" - || fail29 "SCN-002: switching roots changed the old canonical"
  [ "$(backup_count "$RA2")" -eq 0 ] && [ "$(backup_count "$RB")" -eq 0 ] || fail29 "SCN-002: switching roots created a skill backup"
else
  fail29 "SCN-002: switching data roots over Memoria links failed: $(tail -3 "$I29/scn2b.out")"
fi

# SCN-003: unsafe targets are refused before any write; target and external content stay byte-identical.
refuse29() {
  local label="$1" home="$2" agent="$3" target="$4" external="$5" root="$I29/refuse-root-$6"
  local before_t before_e
  before_t="$(snap "$(dirname "$target")")"; before_e="$(snap "$external")"
  if setup29 "$home" "$root" --agent "$agent" >"$I29/refuse-$6.out" 2>&1; then
    fail29 "SCN-003: $label was accepted (exit 0)"; return
  fi
  grep -qF "$target" "$I29/refuse-$6.out" || fail29 "SCN-003: $label refusal does not name $target"
  [ "$(snap "$(dirname "$target")")" = "$before_t" ] || fail29 "SCN-003: $label target changed"
  [ "$(snap "$external")" = "$before_e" ] || fail29 "SCN-003: $label external content changed"
  [ ! -e "$root" ] || fail29 "SCN-003: $label refusal still created the data root"
}
EXT="$I29/external"
mkdir -p "$EXT/marked" "$EXT/plain/.agents/skills/memoria" "$EXT/file/.agents/skills" "$EXT/chain/.agents/skills" "$EXT/canon-src/.agents/skills/memoria"
cp "$TEMPLATE" "$EXT/marked/SKILL.md"
printf -- '---\nname: memoria\n---\nmine\n' > "$EXT/plain/.agents/skills/memoria/SKILL.md"
echo "not a directory" > "$EXT/file/.agents/skills/memoria"
cp "$TEMPLATE" "$EXT/canon-src/.agents/skills/memoria/SKILL.md"
ln -s "$EXT/canon-src/.agents/skills/memoria" "$EXT/chain/.agents/skills/memoria"
n=0
for spec in "marked target, path not ending in .agents/skills/memoria|$EXT/marked" \
            "relative link to a marked target, path not ending in .agents/skills/memoria|../../../external/marked" \
            "canonical-tailed target without deployment marks|$EXT/plain/.agents/skills/memoria" \
            "canonical-tailed target that is a regular file|$EXT/file/.agents/skills/memoria" \
            "canonical-tailed target that is another symlink|$EXT/chain/.agents/skills/memoria" \
            "broken link not ending in .agents/skills/memoria|$EXT/gone/memoria"; do
  n=$((n + 1)); label="${spec%%|*}"; linkto="${spec#*|}"
  home="$I29/home-refuse-$n"; mkdir -p "$home/.codex/skills"; ln -s "$linkto" "$home/.codex/skills/memoria"
  refuse29 "codex host symlink to a $label" "$home" codex "$home/.codex/skills/memoria" "$EXT" "$n"
done
# The canonical skill directory itself as a symlink is refused even when it points at a marked canonical.
H29_3C="$I29/home-refuse-canon"; R29_3C="$I29/refuse-canon-root"; mkdir -p "$H29_3C" "$R29_3C/.agents/skills"
ln -s "$EXT/canon-src/.agents/skills/memoria" "$(canon "$R29_3C")"
before_ext="$(snap "$EXT")"
if setup29 "$H29_3C" "$R29_3C" --agent claude-code >"$I29/refuse-canon.out" 2>&1; then
  fail29 "SCN-003: a symlinked canonical skill directory was accepted"
else
  [ "$(snap "$EXT")" = "$before_ext" ] || fail29 "SCN-003: canonical symlink refusal changed the external content"
  [ ! -e "$R29_3C/.memory" ] && [ ! -e "$H29_3C/.claude" ] || fail29 "SCN-003: canonical symlink refusal wrote the data root or host"
fi

# SCN-004: a legacy setup-deployed physical copy with user additions is backed up whole, then linked.
H29_4="$I29/home-4"; R29_4="$I29/root-4"; LEGACY="$H29_4/.claude/skills/memoria"
mkdir -p "$LEGACY/bin"
{ cat "$TEMPLATE"; printf '\nmy own trigger notes\n'; } > "$LEGACY/SKILL.md"
echo "/old/data/root" > "$LEGACY/DATA_ROOT"
printf '#!/bin/sh\nexit 0\n' > "$LEGACY/bin/memoria"; chmod +x "$LEGACY/bin/memoria"
echo "keep me" > "$LEGACY/NOTES.md"
ln -s NOTES.md "$LEGACY/notes-link"
snap "$LEGACY" > "$I29/scn4-legacy.snap"
if setup29 "$H29_4" "$R29_4" --agent claude-code --json >"$I29/scn4.out" 2>&1; then
  BACKUP4=$(node -e 'for (const l of require("fs").readFileSync(process.argv[1], "utf8").split("\n")) { try { const r = JSON.parse(l); if (r.step === "agent-skill" && r.backup) console.log(r.backup) } catch {} }' "$I29/scn4.out")
  case "$BACKUP4" in "$R29_4/.agents/skill-backups/claude-code-"*) ;; *) fail29 "SCN-004: backup not reported under $R29_4/.agents/skill-backups/claude-code-* (got '$BACKUP4')" ;; esac
  [ -n "$BACKUP4" ] && snap "$BACKUP4" | cmp -s "$I29/scn4-legacy.snap" - || fail29 "SCN-004: backup is not a byte-identical copy of the legacy directory (internal symlink included)"
  [ "$(backup_count "$R29_4")" -eq 1 ] || fail29 "SCN-004: expected exactly one backup"
  serves29 "SCN-004" "$LEGACY" "$R29_4"
else
  fail29 "SCN-004: setup over a legacy marked copy failed: $(tail -3 "$I29/scn4.out")"
fi

# SCN-005: CODEX_HOME=<dataRoot>/.agents makes the Codex host path the canonical path — refused before any write.
H29_5="$I29/home-5"; R29_5A="$I29/root-5a"; mkdir -p "$H29_5"
if (export CODEX_HOME="$R29_5A/.agents"; setup29 "$H29_5" "$R29_5A" --agent codex >"$I29/scn5a.out" 2>&1); then
  fail29 "SCN-005: overlapping host and canonical paths accepted (canonical absent)"
else
  grep -qF "$(canon "$R29_5A")" "$I29/scn5a.out" || fail29 "SCN-005: overlap refusal does not name $(canon "$R29_5A")"
  [ ! -e "$R29_5A" ] || fail29 "SCN-005: overlap refusal still created the data root"
fi
R29_5B="$I29/root-5b"
prepare_root "$H29_5" "$R29_5B"
snap "$R29_5B" > "$I29/scn5b.snap"
if (export CODEX_HOME="$R29_5B/.agents"; setup29 "$H29_5" "$R29_5B" --agent codex >"$I29/scn5b.out" 2>&1); then
  fail29 "SCN-005: overlapping host and canonical paths accepted (canonical deployed)"
else
  grep -qF "$(canon "$R29_5B")" "$I29/scn5b.out" || fail29 "SCN-005: overlap refusal does not name $(canon "$R29_5B")"
fi
[ -d "$(canon "$R29_5B")" ] && [ ! -L "$(canon "$R29_5B")" ] || fail29 "SCN-005: canonical is no longer a real directory"
snap "$R29_5B" | cmp -s "$I29/scn5b.snap" - || fail29 "SCN-005: overlap run wrote into the data root"

# SCN-006: existing empty host directories become links without a backup.
H29_6="$I29/home-6"; R29_6="$I29/root-6"; mkdir -p "$H29_6/.claude/skills/memoria" "$H29_6/.codex/skills/memoria"
if setup29 "$H29_6" "$R29_6" --agent both --json >"$I29/scn6.out" 2>&1; then
  serves29 "SCN-006 claude-code" "$H29_6/.claude/skills/memoria" "$R29_6"
  serves29 "SCN-006 codex" "$H29_6/.codex/skills/memoria" "$R29_6"
  [ "$(backup_count "$R29_6")" -eq 0 ] || fail29 "SCN-006: an empty directory was backed up"
else
  fail29 "SCN-006: setup over empty host directories failed: $(tail -3 "$I29/scn6.out")"
fi

# SCN-007: after setup --agent both, a plain setup refreshes the canonical and both hosts see it.
H29_7="$I29/home-7"; R29_7="$I29/root-7"; mkdir -p "$H29_7"
if setup29 "$H29_7" "$R29_7" --agent both --json >"$I29/scn7-deploy.out" 2>&1; then
  C7="$(canon "$R29_7")"
  printf '\nstale line from an older deploy\n' >> "$C7/SKILL.md"
  echo "/stale/root" > "$C7/DATA_ROOT"
  printf '#!/bin/sh\nexit 3\n' > "$C7/bin/memoria"
  for host in "$H29_7/.claude/skills/memoria" "$H29_7/.codex/skills/memoria"; do
    grep -qF 'stale line from an older deploy' "$host/SKILL.md" || fail29 "SCN-007: $host does not see the canonical's content (not linked)"
  done
  links_before="$(readlink "$H29_7/.claude/skills/memoria" "$H29_7/.codex/skills/memoria" || true)"
  setup29 "$H29_7" "$R29_7" --json >"$I29/scn7.out" 2>&1 || fail29 "SCN-007: setup without --agent failed: $(tail -3 "$I29/scn7.out")"
  serves29 "SCN-007 claude-code" "$H29_7/.claude/skills/memoria" "$R29_7"
  serves29 "SCN-007 codex" "$H29_7/.codex/skills/memoria" "$R29_7"
  [ "$(readlink "$H29_7/.claude/skills/memoria" "$H29_7/.codex/skills/memoria" || true)" = "$links_before" ] || fail29 "SCN-007: host links changed"
  [ "$(backup_count "$R29_7")" -eq 0 ] || fail29 "SCN-007: refreshing the canonical created a backup"
else
  fail29 "SCN-007: initial setup --agent both failed: $(tail -3 "$I29/scn7-deploy.out")"
fi

# SCN-008: links ending in .agents/skills/memoria whose target is gone are repaired without a backup.
H29_8="$I29/home-8"; R29_8="$I29/root-8"; mkdir -p "$H29_8"
link_hosts "$H29_8" "$I29/gone-root/.agents/skills/memoria" "../../../gone-rel/.agents/skills/memoria"
if setup29 "$H29_8" "$R29_8" --agent both --json >"$I29/scn8.out" 2>&1; then
  serves29 "SCN-008 claude-code (absolute)" "$H29_8/.claude/skills/memoria" "$R29_8"
  serves29 "SCN-008 codex (relative)" "$H29_8/.codex/skills/memoria" "$R29_8"
  [ "$(backup_count "$R29_8")" -eq 0 ] || fail29 "SCN-008: repairing a broken link created a backup"
else
  fail29 "SCN-008: repairing broken canonical-tailed links failed: $(tail -3 "$I29/scn8.out")"
fi

[ "$I29_FAILS" -eq 0 ] || { echo "  ✗ issue-29: $I29_FAILS host skill link check(s) failed"; exit 1; }
echo "  ✓ issue-29: hosts link to the canonical skill; reruns, root switches and broken links relink; legacy copies are backed up once; unsafe targets and overlaps are refused before any write"

echo "[setup-onboarding] ok"
