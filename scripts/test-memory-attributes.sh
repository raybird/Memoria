#!/usr/bin/env bash
# issue-5 — long-term memory semantics (docs/issues/issue-5).
#
#   (A) durable undoes time-decay: score returns to its decay-free value (× 1/decay)
#   (B) durable survives stale pruning; an unmarked peer of the same age does not
#   (C) superseded memories drop out of recall by default, --include-superseded brings them back
#   (D) --supersedes pointing at nothing is rejected before anything is written
#   (E) a chain A←B←C leaves only C in the default view (no recursive resolution needed)
#   (F) export --redact code-names known entities in private memories, and REPORTS what it skipped
#   (G) zero-marker behaviour: marking nothing leaves recall ordering untouched
#
# Time is manipulated by rewriting timestamps directly, the same trick test-migrations.sh uses.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
BSQ="$ROOT_DIR/node_modules/better-sqlite3"
CLI="$ROOT_DIR/cli"
MEMORIA_HOME=""
DB=""

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

# `init` is not a reset — it creates directories and patches the schema but keeps existing rows.
# Each section therefore needs its own home, or leftovers from earlier sections skew the counts.
reset_home() {
    export MEMORIA_HOME="$TMP_DIR/$1"
    DB="$MEMORIA_HOME/.memory/sessions.db"
    "$CLI" init >/dev/null
}

q() { node -e "const D=require('$BSQ');const db=new D('$DB',{readonly:true});const r=db.prepare(process.argv[1]).get();console.log(r?Object.values(r)[0]:'')" "$1"; }
sql() { node -e "const D=require('$BSQ');const db=new D('$DB');db.prepare(process.argv[1]).run()" "$1"; }
field() { node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(eval("j"+process.argv[1]))})' "$1"; }

echo "[attributes] (G) baseline: nothing marked yet"
reset_home home-a
"$CLI" remember "改用 pnpm 作為套件管理器" --project demo >/dev/null
sql "UPDATE sessions SET timestamp='2025-08-09T00:00:00.000Z'"
sql "UPDATE events SET timestamp='2025-08-09T00:00:00.000Z'"
BASE_ORDER=$("$CLI" recall "pnpm 套件管理器" --project demo --json | field '.data.map(h=>h.id).join(",")')
BASE_SCORE=$("$CLI" recall "pnpm 套件管理器" --project demo --json | field '.data[0].score')
[ -n "$BASE_ORDER" ] || { echo "  ✗ baseline recall empty"; exit 1; }
echo "  baseline order: $BASE_ORDER"

echo "[attributes] (A) --durable undoes time-decay"
# Re-running an identical note applies markers without rewriting the memory.
"$CLI" remember "改用 pnpm 作為套件管理器" --project demo --durable >/dev/null
DUR_SCORE=$("$CLI" recall "pnpm 套件管理器" --project demo --json | field '.data[0].score')
node -e '
const before=Number(process.argv[1]), after=Number(process.argv[2]);
const ageDays=(Date.now()-Date.parse("2025-08-09T00:00:00.000Z"))/86400000;
const expected=1+ageDays/90;                    // 1/decay, decay = 1/(1+age/90)
const ratio=after/before;
const off=Math.abs(ratio-expected)/expected;
console.log("  ratio="+ratio.toFixed(4)+" expected≈"+expected.toFixed(4));
if(off>0.02){console.error("  ✗ durable did not restore the decay-free score");process.exit(1);}
' "$BASE_SCORE" "$DUR_SCORE"
MARKED=$("$CLI" recall "pnpm 套件管理器" --project demo --json | field '.data[0].retention')
[ "$MARKED" = "durable" ] || { echo "  ✗ hit does not carry retention=durable"; exit 1; }

echo "[attributes] (B) durable survives stale pruning, unmarked peer does not"
MEMORIA_INDEX_AUTOBUILD=0 "$CLI" remember "這週除錯 tsx watch 的過程" --project demo >/dev/null
sql "UPDATE sessions SET timestamp='2025-01-01T00:00:00.000Z'"
sql "DELETE FROM memory_node_sources"
BEFORE=$(q "SELECT COUNT(*) c FROM sessions")
"$CLI" prune --stale-days 180 >/dev/null
AFTER=$(q "SELECT COUNT(*) c FROM sessions")
SURVIVOR=$(q "SELECT summary FROM sessions LIMIT 1")
[ "$BEFORE" = "2" ] && [ "$AFTER" = "1" ] || { echo "  ✗ expected 2→1 sessions, got $BEFORE→$AFTER"; exit 1; }
[ "$SURVIVOR" = "改用 pnpm 作為套件管理器" ] || { echo "  ✗ wrong survivor: '$SURVIVOR'"; exit 1; }
echo "  sessions $BEFORE→$AFTER, durable one survived"

echo "[attributes] (C) supersedes hides the old memory by default"
reset_home home-c
"$CLI" remember "資料庫改用 PostgreSQL" --project demo >/dev/null
OLD_ID=$("$CLI" recall "資料庫 改用" --project demo --json | field '.data.find(h=>h.type==="session").id')
"$CLI" remember "資料庫改用 SQLite" --project demo --supersedes "$OLD_ID" --supersede-note "單機部署不需要 PG" >/dev/null
DEFAULT_IDS=$("$CLI" recall "資料庫 改用" --project demo --json | field '.data.map(h=>h.id).join(",")')
case "$DEFAULT_IDS" in
    *"$OLD_ID"*) echo "  ✗ superseded memory still surfaced by default: $DEFAULT_IDS"; exit 1 ;;
esac
INCLUDED=$("$CLI" recall "資料庫 改用" --project demo --include-superseded --json | field '.data.map(h=>h.id).join(",")')
case "$INCLUDED" in
    *"$OLD_ID"*) : ;;
    *) echo "  ✗ --include-superseded did not bring it back: $INCLUDED"; exit 1 ;;
esac
MARK=$("$CLI" recall "資料庫 改用" --project demo --include-superseded --json | field '.data.find(h=>h.superseded_by)?.superseded_by || ""')
[ -n "$MARK" ] || { echo "  ✗ superseded hit carries no superseded_by"; exit 1; }
# Data is never deleted — export is the audit path and must still see it.
"$CLI" export --type decisions --format json >/dev/null
grep -q "PostgreSQL" "$MEMORIA_HOME"/.memory/exports/*.json || { echo "  ✗ superseded memory missing from export"; exit 1; }
echo "  hidden by default, recoverable via flag, still in export"

# The brief is the only artifact loaded into every session, so a replaced claim
# surviving there is worse than one surviving in recall: it sits next to its own
# correction with nothing marking which one is current.
"$CLI" brief --project demo >/dev/null
BRIEF="$MEMORIA_HOME/knowledge/BRIEF.md"
grep -q "SQLite" "$BRIEF" || { echo "  ✗ superseding memory missing from brief"; exit 1; }
grep -q "PostgreSQL" "$BRIEF" && { echo "  ✗ superseded memory still listed in brief"; exit 1; }
echo "  brief lists the replacement and drops the replaced one"

echo "[attributes] (D) --supersedes with an unknown target is rejected"
if "$CLI" remember "某個新決策" --project demo --supersedes note-does-not-exist >/dev/null 2>&1; then
    echo "  ✗ expected non-zero exit"; exit 1
fi
ORPHAN=$(q "SELECT COUNT(*) c FROM memory_attributes WHERE superseded_by IS NOT NULL AND ref_id='note-does-not-exist'")
[ "$ORPHAN" = "0" ] || { echo "  ✗ dangling marker was written anyway"; exit 1; }

echo "[attributes] (E) chain A←B←C leaves only C"
reset_home home-e
"$CLI" remember "快取用 A 方案" --project chain >/dev/null
A_ID=$("$CLI" recall "快取用 方案" --project chain --json | field '.data.find(h=>h.type==="session").id')
"$CLI" remember "快取用 B 方案" --project chain --supersedes "$A_ID" >/dev/null
B_ID=$("$CLI" recall "快取用 方案" --project chain --json | field '.data.find(h=>h.type==="session").id')
"$CLI" remember "快取用 C 方案" --project chain --supersedes "$B_ID" >/dev/null
CHAIN=$("$CLI" recall "快取用 方案" --project chain --json | field '.data.filter(h=>h.type==="session").map(h=>h.snippet).join(" | ")')
case "$CHAIN" in
    *"A 方案"*|*"B 方案"*) echo "  ✗ an older link survived: $CHAIN"; exit 1 ;;
esac
case "$CHAIN" in
    *"C 方案"*) : ;;
    *) echo "  ✗ current version missing: $CHAIN"; exit 1 ;;
esac
echo "  only the current version remains"

echo "[attributes] (F) export --redact code-names private memories and reports coverage"
reset_home home-f
"$CLI" remember "acme-internal 的部署走內網 registry" --project acme-internal --sensitivity private >/dev/null
"$CLI" remember "公開專案照常用 npm registry" --project acme-internal >/dev/null
"$CLI" export --type decisions --format json >/dev/null
grep -q "acme-internal" "$MEMORIA_HOME"/.memory/exports/*.json || { echo "  ✗ fixture is wrong: entity absent without --redact"; exit 1; }
rm -f "$MEMORIA_HOME"/.memory/exports/*.json

REPORT=$("$CLI" export --type decisions --format json --redact --json)
REDACTED=$(echo "$REPORT" | field '.redaction.redacted')
UNCLASSIFIED=$(echo "$REPORT" | field '.redaction.unclassified')
[ "$REDACTED" = "1" ] || { echo "  ✗ expected redacted=1, got '$REDACTED'"; exit 1; }
[ "$UNCLASSIFIED" = "1" ] || { echo "  ✗ expected unclassified=1, got '$UNCLASSIFIED'"; exit 1; }

EXPORTED="$(ls "$MEMORIA_HOME"/.memory/exports/*.json | head -1)"
PRIVATE_LINE=$(node -pe "JSON.parse(require('fs').readFileSync('$EXPORTED','utf8')).decisions.find(d=>d.decision.includes('內網')).decision")
case "$PRIVATE_LINE" in
    *acme-internal*) echo "  ✗ private memory still names the entity: $PRIVATE_LINE"; exit 1 ;;
    *proj-*) : ;;
    *) echo "  ✗ no code name applied: $PRIVATE_LINE"; exit 1 ;;
esac
# Unmarked memories are exported verbatim — that is the documented contract, not a leak to fix here.
node -pe "JSON.parse(require('fs').readFileSync('$EXPORTED','utf8')).decisions.some(d=>d.project==='acme-internal')" | grep -q true || {
    echo "  ✗ unmarked memory should have been left verbatim"; exit 1; }

# Code names must be stable across exports, otherwise diffing two exports is meaningless.
rm -f "$MEMORIA_HOME"/.memory/exports/*.json
"$CLI" export --type decisions --format json --redact >/dev/null
EXPORTED2="$(ls "$MEMORIA_HOME"/.memory/exports/*.json | head -1)"
SECOND=$(node -pe "JSON.parse(require('fs').readFileSync('$EXPORTED2','utf8')).decisions.find(d=>d.decision.includes('內網')).decision")
[ "$PRIVATE_LINE" = "$SECOND" ] || { echo "  ✗ code name not deterministic: '$PRIVATE_LINE' vs '$SECOND'"; exit 1; }
echo "  redacted=1 unclassified=1, code name stable across runs"

echo "[attributes] ✓ all checks passed"
