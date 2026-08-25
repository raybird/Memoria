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
# issue-17 — the `mark` command (docs/issues/issue-17).
#
#   (H) SCN-001 mark reaches a ref `remember` cannot construct (gitdec-*), and leaves the event alone
#   (I) SCN-002 mark on an unknown ref fails loudly and writes nothing
#   (J) SCN-005 zero markers leave the brief byte-identical to its pre-issue-17 output
#   (K) SCN-003 the pinned block ignores the --days window and topK, and collapses note pairs
#   (L) SCN-004 a pinned memory is not repeated in the recent-decisions block
#   (M) SCN-006 durable + superseded stays out of the pinned block
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
# 取出某個 ## 標題底下、到下一個 ## 之前的內容。
section() { awk -v h="$1" 'index($0,h)==1{f=1;next} /^## /{f=0} f' "$2"; }
# BRIEF 帶生成時間戳,逐位元組比對前先正規化掉所有 ISO 時間。
normalize_brief() { sed -E 's/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z/<TS>/g' "$1"; }
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

echo "[attributes] (H/SCN-001) mark 可標記 remember 構造不出的 ref（gitdec-*）"
reset_home home-h
"$CLI" remember "選品線用具名 agent，未設即該線未開放" --project demo >/dev/null
SID=$(q "SELECT id FROM sessions LIMIT 1")
# git 促升的事件 id 形如 gitdec-<summary>-<n>。note id 是內容指紋，remember 構造不出這個 id 空間,
# 所以「重跑 remember 即可標記既有記憶」對它結構上無效——這正是本命令存在的理由。
sql "INSERT INTO events (id, session_id, timestamp, event_type, content, metadata) VALUES ('gitdec-sum_test-0', '$SID', '2026-01-01T00:00:00.000Z', 'DecisionMade', json_object('decision','履約過濾抽成後端純函式','rationale','前端用不到這個判斷','impact_level','high'), '{}')"
BEFORE_CONTENT=$(q "SELECT content FROM events WHERE id='gitdec-sum_test-0'")
BEFORE_TS=$(q "SELECT timestamp FROM events WHERE id='gitdec-sum_test-0'")
"$CLI" mark gitdec-sum_test-0 --durable >/dev/null
RETENTION=$(q "SELECT retention FROM memory_attributes WHERE ref_id='gitdec-sum_test-0'")
[ "$RETENTION" = "durable" ] || { echo "  ✗ expected retention=durable, got '$RETENTION'"; exit 1; }
AFTER_CONTENT=$(q "SELECT content FROM events WHERE id='gitdec-sum_test-0'")
AFTER_TS=$(q "SELECT timestamp FROM events WHERE id='gitdec-sum_test-0'")
[ "$BEFORE_CONTENT" = "$AFTER_CONTENT" ] || { echo "  ✗ event content was rewritten"; exit 1; }
[ "$BEFORE_TS" = "$AFTER_TS" ] || { echo "  ✗ event timestamp was rewritten"; exit 1; }
echo "  gitdec ref marked durable, event content and timestamp untouched"

echo "[attributes] (I/SCN-002) mark 指向不存在的記憶時明確失敗且不寫入"
BEFORE_ROWS=$(q "SELECT COUNT(*) FROM memory_attributes")
if "$CLI" mark gitdec-does-not-exist-0 --durable >/dev/null 2>&1; then
    echo "  ✗ expected non-zero exit"; exit 1
fi
# 只斷言錯誤訊息「點名了那個 ref」,不綁定確切措辭——措辭會改,契約不會。
ERR=$("$CLI" mark gitdec-does-not-exist-0 --durable 2>&1 || true)
case "$ERR" in
    *gitdec-does-not-exist-0*) ;;
    *) echo "  ✗ error does not name the rejected ref: $ERR"; exit 1 ;;
esac
AFTER_ROWS=$(q "SELECT COUNT(*) FROM memory_attributes")
[ "$BEFORE_ROWS" = "$AFTER_ROWS" ] || { echo "  ✗ dangling marker was written anyway ($BEFORE_ROWS→$AFTER_ROWS)"; exit 1; }
echo "  rejected with the ref named, no dangling row"

echo "[attributes] (J/SCN-005) 零標記時 brief 與實作前的產出 byte-identical"
reset_home home-j
"$CLI" remember "改用 pnpm 作為套件管理器" --project demo >/dev/null
"$CLI" remember "停 server 一律用 PID 精準停" --project demo >/dev/null
"$CLI" brief >/dev/null
# golden 由 issue-17 步驟 2 實作「之前」的程式碼產出（HEAD=967a82d),提交在 repo 內。
# 這支斷言唯一會紅的情況,就是零標記路徑的產出真的變了——那正是 issue-5 立下的不變式。
normalize_brief "$MEMORIA_HOME/knowledge/BRIEF.md" > "$TMP_DIR/brief-actual.md"
diff -u "$ROOT_DIR/scripts/fixtures/brief-zero-marker.golden.md" "$TMP_DIR/brief-actual.md" \
    || { echo "  ✗ 零標記的 brief 產出已改變（上方為 golden,下方為實際）"; exit 1; }
echo "  zero-marker brief unchanged"

echo "[attributes] (K/SCN-003) pinned 區無視時間窗口與 topK,且收斂 note 配對"
reset_home home-k
"$CLI" remember "停 server 一律用 PID 精準停" --project demo --durable >/dev/null
# 推到 30 天窗口之外:近期決策撈不到它,pinned 區仍必須有。
sql "UPDATE sessions SET timestamp='2025-01-01T00:00:00.000Z'"
sql "UPDATE events SET timestamp='2025-01-01T00:00:00.000Z'"
"$CLI" brief >/dev/null
BRIEF="$MEMORIA_HOME/knowledge/BRIEF.md"
PINNED=$(section "## 常駐約束（pinned）" "$BRIEF")
case "$PINNED" in
    *"PID 精準停"*) ;;
    *) echo "  ✗ 窗口外的 durable 記憶不在 pinned 區: $PINNED"; exit 1 ;;
esac
# remember --durable 會標記 note-* 與 noteev-* 兩半,同一則記憶只能出現一次。
PINNED_LINES=$(echo "$PINNED" | grep -c '^- ' || true)
[ "$PINNED_LINES" = "1" ] || { echo "  ✗ 期望 pinned 區 1 行,實得 $PINNED_LINES 行"; exit 1; }
echo "  出現在 pinned 區,配對收斂為 1 行"

echo "[attributes] (L/SCN-004) pinned 的記憶不在近期決策重複出現"
reset_home home-l
"$CLI" remember "停 server 一律用 PID 精準停" --project demo --durable >/dev/null
"$CLI" remember "改用 pnpm 作為套件管理器" --project demo >/dev/null
"$CLI" brief >/dev/null
BRIEF="$MEMORIA_HOME/knowledge/BRIEF.md"
case "$(section "## 常駐約束（pinned）" "$BRIEF")" in
    *"PID 精準停"*) ;;
    *) echo "  ✗ durable 記憶不在 pinned 區"; exit 1 ;;
esac
RECENT=$(section "## 近期決策" "$BRIEF")
case "$RECENT" in
    *"PID 精準停"*) echo "  ✗ pinned 的記憶在近期決策重複出現"; exit 1 ;;
esac
case "$RECENT" in
    *"pnpm"*) ;;
    *) echo "  ✗ 未標記的記憶反而從近期決策消失了: $RECENT"; exit 1 ;;
esac
echo "  pinned 不重複,未標記者仍在近期決策"

echo "[attributes] (M/SCN-006) durable 但已被取代者不進 pinned 區"
reset_home home-m
"$CLI" remember "改用 PostgreSQL" --project demo --durable >/dev/null
OLD_ID=$(q "SELECT id FROM sessions WHERE id LIKE 'note-%' LIMIT 1")
"$CLI" remember "改用 SQLite" --project demo --durable --supersedes "$OLD_ID" >/dev/null
"$CLI" brief >/dev/null
PINNED=$(section "## 常駐約束（pinned）" "$MEMORIA_HOME/knowledge/BRIEF.md")
case "$PINNED" in
    *PostgreSQL*) echo "  ✗ 已被取代的 durable 記憶仍在 pinned 區: $PINNED"; exit 1 ;;
esac
case "$PINNED" in
    *SQLite*) ;;
    *) echo "  ✗ 取代者不在 pinned 區: $PINNED"; exit 1 ;;
esac
echo "  取代者留下,被取代者移除"

echo "[attributes] ✓ all checks passed"
