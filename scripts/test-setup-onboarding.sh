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
# Ensure helper has @libsql/client in cache or sibling for stub provider
HELPER_DIR="$ROOT_DIR/skills/memoria-vector"
if [ ! -d "$HELPER_DIR/node_modules/@libsql/client" ]; then
  (cd "$HELPER_DIR" && npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1)
fi

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

echo "[setup-onboarding] ok"
