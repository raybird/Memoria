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
# issue-32 — state memories carry a verify command (docs/issues/issue-32).
#
#   (P) SCN-004 --verify and --durable are mutually exclusive on every write path; a refusal writes nothing
#   (Q) SCN-005 an empty, blank or multi-line --verify is refused and writes nothing
#   (R) SCN-001/SCN-002 recall shows "as of <date>; re-check with <command>" under a state hit, and
#       --json carries `verify` verbatim; a hit without one shows and carries nothing
#   (S) SCN-003 brief adds "as of <date>; re-check with `<command>`" under a state memory in the
#       recent-decisions, high-utility and environment blocks — whole command, backticks intact
#   (T) SCN-006 Memoria never runs a verify command — on write, recall, brief, doctor, stats or mark
#   (U) SCN-011 a brief that shows any verify line also carries one fixed note on when to run it
#   (V) SCN-012 a durable memory that carries a verify command shows it in the pinned block too
#
# issue-18 — mark marks both halves of a note (docs/issues/issue-18 AC-3).
#
#   (N) AC-3 marking either half of a note marks both; a ref with no pair gets no orphan row
#   (O) AC-4 a pinned memory with a note gets one extra line; one without stays a single line
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

echo "[attributes] (N/AC-3) mark 對 note 的兩半一致，且不為無配對的 ref 建孤兒列"
reset_home home-n
"$CLI" remember "停 server 一律用 PID 精準停" --project demo >/dev/null
SID=$(q "SELECT id FROM sessions WHERE id LIKE 'note-%' LIMIT 1")
EID="noteev-${SID#note-}"
"$CLI" mark "$SID" --durable >/dev/null
# remember --durable 本來就兩半都標,mark 不該比它弱——否則 recall 的 decay 豁免只對半邊生效。
A=$(q "SELECT retention FROM memory_attributes WHERE ref_id='$SID'")
B=$(q "SELECT retention FROM memory_attributes WHERE ref_id='$EID'")
[ "$A" = "durable" ] || { echo "  ✗ session 半未標記: '$A'"; exit 1; }
[ "$B" = "durable" ] || { echo "  ✗ event 半未標記: '$B'"; exit 1; }
# 反向:從 event 半標記也要涵蓋 session 半。
reset_home home-n2
"$CLI" remember "改用 pnpm 作為套件管理器" --project demo >/dev/null
SID2=$(q "SELECT id FROM sessions WHERE id LIKE 'note-%' LIMIT 1")
EID2="noteev-${SID2#note-}"
"$CLI" mark "$EID2" --durable >/dev/null
[ "$(q "SELECT retention FROM memory_attributes WHERE ref_id='$SID2'")" = "durable" ] || {
    echo "  ✗ 從 event 半標記時 session 半未涵蓋"; exit 1; }
# gitdec-* 沒有配對半,不得因此憑空生出第二列指向不存在的記憶。
sql "INSERT INTO events (id, session_id, timestamp, event_type, content, metadata) VALUES ('gitdec-sum_n-0', '$SID2', '2026-01-01T00:00:00.000Z', 'DecisionMade', json_object('decision','x','rationale','y','impact_level','high'), '{}')"
BEFORE=$(q "SELECT COUNT(*) FROM memory_attributes")
"$CLI" mark gitdec-sum_n-0 --durable >/dev/null
AFTER=$(q "SELECT COUNT(*) FROM memory_attributes")
[ "$AFTER" = "$((BEFORE + 1))" ] || { echo "  ✗ 無配對的 ref 應只增 1 列，實得 $BEFORE→$AFTER"; exit 1; }
echo "  兩半一致（雙向），無配對者只增一列"

echo "[attributes] (O/AC-4) pinned 有 note 時多印一行，沒有的維持一行"
reset_home home-o
"$CLI" remember "停 server 一律用 PID 精準停" --project demo --durable >/dev/null
WITH_NOTE=$(q "SELECT id FROM sessions WHERE id LIKE 'note-%' LIMIT 1")
"$CLI" mark "$WITH_NOTE" --note "範圍：停止本機 server。症狀：pkill 樣式比對會誤殺容器行程。自檢：先跑 pgrep -af memoria" >/dev/null
"$CLI" remember "改用 pnpm 作為套件管理器" --project demo --durable >/dev/null
"$CLI" brief >/dev/null
PINNED=$(section "## 常駐約束（pinned）" "$MEMORIA_HOME/knowledge/BRIEF.md")
# 有 note 的那則:主行 + 一行縮排的 note。
case "$PINNED" in
    *"自檢：先跑 pgrep -af memoria"*) ;;
    *) echo "  ✗ note 沒有被印出來:"; echo "$PINNED"; exit 1 ;;
esac
# 沒有 note 的那則不得多出空行或佔位:縮排行的總數必須剛好等於「有 note 的則數」= 1。
NOTE_LINES=$(echo "$PINNED" | grep -c '^  - ' || true)
[ "$NOTE_LINES" = "1" ] || {
    echo "  ✗ 期望剛好 1 行縮排 note，實得 $NOTE_LINES:"; echo "$PINNED"; exit 1; }
[ "$(echo "$PINNED" | grep -c '^- ')" = "2" ] || {
    echo "  ✗ 期望兩則 pinned 主行，實得 $(echo "$PINNED" | grep -c '^- ')"; exit 1; }
echo "  有 note 者多一行，無 note 者維持一行"

echo "[attributes] (P/issue-32 SCN-004) --verify 與 --durable 互斥，拒絕時不寫入"
reset_home home-p
counts() { echo "$(q "SELECT COUNT(*) FROM sessions")/$(q "SELECT COUNT(*) FROM events")/$(q "SELECT COUNT(*) FROM memory_attributes")"; }
attr_state() { q "SELECT group_concat(ref_id||':'||coalesce(retention,'')||':'||coalesce(verify_cmd,''), ',') FROM (SELECT * FROM memory_attributes ORDER BY ref_id)"; }
BEFORE=$(counts)
set +e
ERR=$("$CLI" remember "demo 的 release 分支已併入 main" --project demo --durable --verify "git log main --oneline -1" 2>&1)
CODE=$?
set -e
[ "$CODE" != "0" ] || { echo "  ✗ --durable 加 --verify 應該失敗"; exit 1; }
case "$ERR" in *durable*"two notes"*) ;; *) echo "  ✗ 錯誤沒有說明 durable 互斥並建議拆成兩則: $ERR"; exit 1 ;; esac
[ "$(counts)" = "$BEFORE" ] || { echo "  ✗ 被拒絕的命令仍寫入了資料 ($BEFORE→$(counts))"; exit 1; }
# 已 durable 的筆記，用相同文字重跑並加 --verify
"$CLI" remember "停 server 一律用 PID 精準停" --project demo --durable >/dev/null
BEFORE=$(counts); STATE=$(attr_state)
if "$CLI" remember "停 server 一律用 PID 精準停" --project demo --verify "pgrep -af memoria" >/dev/null 2>&1; then
    echo "  ✗ 對 durable 筆記補 --verify 應該失敗"; exit 1
fi
[ "$(counts)" = "$BEFORE" ] && [ "$(attr_state)" = "$STATE" ] || { echo "  ✗ durable 筆記的標記被改動"; exit 1; }
# 帶查證命令的筆記：相同文字重跑加 --durable、以及 mark 任一半 --durable，都要拒絕
"$CLI" remember "截至 2026-11-10，helper 雜湊目錄為 690ebce" --project demo --verify "ls ~/.cache/memoria/vector/" >/dev/null
VSID=$(q "SELECT id FROM sessions WHERE summary LIKE '截至 2026-11-10%'")
[ -n "$VSID" ] || { echo "  ✗ 帶 --verify 的筆記沒有寫入"; exit 1; }
[ "$(q "SELECT verify_cmd FROM memory_attributes WHERE ref_id='$VSID'")" = "ls ~/.cache/memoria/vector/" ] || { echo "  ✗ 查證命令沒有原樣存下"; exit 1; }
BEFORE=$(counts); STATE=$(attr_state)
if "$CLI" remember "截至 2026-11-10，helper 雜湊目錄為 690ebce" --project demo --durable >/dev/null 2>&1; then
    echo "  ✗ 對帶查證命令的筆記補 --durable 應該失敗"; exit 1
fi
for ref in "$VSID" "noteev-${VSID#note-}"; do
    if "$CLI" mark "$ref" --durable >/dev/null 2>&1; then echo "  ✗ mark $ref --durable 應該失敗"; exit 1; fi
done
[ "$(counts)" = "$BEFORE" ] && [ "$(attr_state)" = "$STATE" ] || { echo "  ✗ 帶查證命令的筆記標記被改動"; exit 1; }
"$CLI" brief >/dev/null
PINNED=$(section "## 常駐約束（pinned）" "$MEMORIA_HOME/knowledge/BRIEF.md")
case "$PINNED" in *"截至 2026-11-10"*) echo "  ✗ 帶查證命令的筆記進了常駐約束區"; exit 1 ;; esac
echo "  三條寫入路徑都拒絕，資料與標記不變，狀態類不進常駐約束區"

echo "[attributes] (Q/issue-32 SCN-005) 空白或多行的 --verify 被拒絕"
reset_home home-q
BEFORE=$(counts)
# SCN-005（2026-11-11 擴充）：其他會換行的字元與控制字元也拒絕，Tab 除外。
for bad in "" "   " $'git status\nrm -rf /tmp/x' $'git status\u2028rm -rf /tmp/x' $'git status\u2029rm -rf /tmp/x' \
           $'git status\u0085rm -rf /tmp/x' $'git status\e[2Krm -rf /tmp/x' $'git status\rrm -rf /tmp/x'; do
    set +e
    ERR=$("$CLI" remember "某個會變的狀態" --project demo --verify "$bad" 2>&1)
    CODE=$?
    set -e
    [ "$CODE" != "0" ] || { echo "  ✗ --verify '$bad' 應該失敗"; exit 1; }
    case "$ERR" in *--verify*) ;; *) echo "  ✗ 錯誤沒有指出 --verify: $ERR"; exit 1 ;; esac
done
[ "$(counts)" = "$BEFORE" ] || { echo "  ✗ 被拒絕的命令仍寫入了資料 ($BEFORE→$(counts))"; exit 1; }
"$CLI" remember "Tab 分隔的查證命令可以寫入" --project demo --verify $'git\tstatus' >/dev/null \
    || { echo "  ✗ 含 Tab 的 --verify 不該被拒絕"; exit 1; }
echo "  空字串、空白、多行、U+2028／U+2029／U+0085、控制字元都拒絕，沒有寫入；Tab 可以"

echo "[attributes] (R/issue-32 SCN-001, SCN-002) recall 顯示截至日期與查證命令"
reset_home home-r
VERIFY_R="git log main --oneline -1"
"$CLI" remember "demo 的 release 分支已併入 main" --project demo --verify "$VERIFY_R" >/dev/null
"$CLI" remember "demo 的 release 流程改用 release.sh" --project demo >/dev/null
DAY_R=$(q "SELECT substr(timestamp,1,10) FROM sessions WHERE summary='demo 的 release 分支已併入 main'")
EXPECT_R="  ⟳ 截至 ${DAY_R}；據以行動前先跑：${VERIFY_R}"
for mode in keyword tree hybrid; do
    "$CLI" recall "demo release" --project demo --top-k 10 --mode "$mode" > "$TMP_DIR/recall-r.txt"
    node -e "
const fs = require('fs'); const out = fs.readFileSync(process.argv[1], 'utf8'); const expect = process.argv[2]; const mode = process.argv[3];
const blocks = out.split(/\n(?=- \[)/).filter((b) => b.startsWith('- ['));
const state = blocks.filter((b) => b.includes('已併入 main'));
const plain = blocks.filter((b) => !b.includes('已併入 main'));
if (state.length === 0 || plain.length === 0) { console.error('  ✗ ' + mode + ': fixture not recalled\n' + out); process.exit(1); }
for (const b of state) {
  const lines = b.split('\n');
  const at = lines.indexOf(expect);
  // 查證行緊接在 snippet（第 2 行）之後
  if (at !== 2) { console.error('  ✗ ' + mode + ': 狀態類 hit 沒有在 snippet 後顯示查證行\n' + b); process.exit(1); }
}
for (const b of plain) if (b.includes('⟳')) { console.error('  ✗ ' + mode + ': 一般記憶多了查證行\n' + b); process.exit(1); }
" "$TMP_DIR/recall-r.txt" "$EXPECT_R" "$mode"
    "$CLI" recall "demo release" --project demo --top-k 10 --mode "$mode" --json > "$TMP_DIR/recall-r.json"
    node -e "
const d = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')); const want = process.argv[2]; const mode = process.argv[3];
const state = d.data.filter((h) => h.snippet.includes('已併入 main'));
const plain = d.data.filter((h) => !h.snippet.includes('已併入 main'));
if (state.length === 0 || plain.length === 0) { console.error('  ✗ ' + mode + ' --json: fixture not recalled'); process.exit(1); }
for (const h of state) if (h.verify !== want) { console.error('  ✗ ' + mode + ' --json: verify 不是原命令: ' + JSON.stringify(h)); process.exit(1); }
for (const h of plain) if ('verify' in h) { console.error('  ✗ ' + mode + ' --json: 一般記憶帶了 verify: ' + JSON.stringify(h)); process.exit(1); }
" "$TMP_DIR/recall-r.json" "$VERIFY_R" "$mode"
done
echo "  keyword／tree／hybrid：狀態類 hit 在 snippet 後顯示查證行、--json 帶原命令；一般記憶兩者皆無"

echo "[attributes] (S/issue-32 SCN-003) brief 三個區塊都附上截至日期與完整命令"
reset_home home-s
# 命令含反引號：code span 的分隔要比命令內最長的反引號多一個，命令以反引號結尾時兩側補空白。
VERIFY_S='echo `git rev-parse HEAD`'
"$CLI" remember "demo 的 release 分支已併入 main" --project demo --verify "$VERIFY_S" >/dev/null
"$CLI" remember "demo 的 release 流程改用 release.sh" --project demo >/dev/null
SID_S=$(q "SELECT id FROM sessions WHERE summary='demo 的 release 分支已併入 main'")
DAY_S=$(q "SELECT substr(timestamp,1,10) FROM sessions WHERE id='$SID_S'")
EXPECT_S="  - 截至 ${DAY_S}；據以行動前先跑 \`\` echo \`git rev-parse HEAD\` \`\`"
# 兩次明確回饋，讓它進高效用區塊（brief 門檻是 2 次觀測）
for _ in 1 2; do
    RID_S=$("$CLI" recall "demo release" --project demo --json | field '.meta.recall_id')
    "$CLI" feedback "$RID_S" --signal explicit --score 0.9 --used --hits "$SID_S,noteev-${SID_S#note-}" >/dev/null
done
"$CLI" brief >/dev/null
BRIEF_S="$MEMORIA_HOME/knowledge/BRIEF.md"
entry_block() { # $1=section heading, $2=entry substring, $3=file → the entry line plus its indented lines
    section "$1" "$3" | awk -v k="$2" 'index($0,"- ")==1{f=index($0,k)>0; if(f){print; next}} f && /^  /{print} /^- /&&!index($0,k){f=0}'
}
DEC_BLOCK=$(entry_block "## 近期決策" "已併入 main" "$BRIEF_S")
printf '%s\n' "$DEC_BLOCK" | grep -qxF "$EXPECT_S" || { echo "  ✗ 近期決策沒有完整的查證行:"; echo "$DEC_BLOCK"; echo "  期望: $EXPECT_S"; exit 1; }
PLAIN_BLOCK=$(entry_block "## 近期決策" "改用 release.sh" "$BRIEF_S")
[ -n "$PLAIN_BLOCK" ] || { echo "  ✗ 一般決策不在近期決策"; exit 1; }
case "$PLAIN_BLOCK" in *截至*) echo "  ✗ 一般決策多了查證行:"; echo "$PLAIN_BLOCK"; exit 1 ;; esac
UFL_BLOCK=$(entry_block "## 高效用記憶（UFL）" "已併入 main" "$BRIEF_S")
printf '%s\n' "$UFL_BLOCK" | grep -qxF "$EXPECT_S" || { echo "  ✗ 高效用區塊沒有完整的查證行:"; echo "$UFL_BLOCK"; exit 1; }
# 環境紀律區塊：只在 scoped brief 出現，需要一個已註冊 repo
git init -q "$TMP_DIR/repo-s"
echo "seed $RANDOM$RANDOM" > "$TMP_DIR/repo-s/seed.txt"
git -C "$TMP_DIR/repo-s" add seed.txt
git -C "$TMP_DIR/repo-s" -c user.name=memoria-test -c user.email=test@memoria.local commit -q -m init
"$CLI" repo add "$TMP_DIR/repo-s" --name repo-s >/dev/null
"$CLI" remember "ops 主機的 swap 已關閉" --project ops --verify "swapon --show" >/dev/null
DAY_ENV=$(q "SELECT substr(timestamp,1,10) FROM sessions WHERE summary='ops 主機的 swap 已關閉'")
"$CLI" brief --project repo-s --stdout > "$TMP_DIR/brief-s-env.md"
ENV_BLOCK=$(entry_block "## 環境紀律（跨專案）" "swap 已關閉" "$TMP_DIR/brief-s-env.md")
printf '%s\n' "$ENV_BLOCK" | grep -qxF "  - 截至 ${DAY_ENV}；據以行動前先跑 \`swapon --show\`" || {
    echo "  ✗ 環境紀律區塊沒有完整的查證行:"; echo "$ENV_BLOCK"; exit 1; }
# --json 的資料項帶 verify（SCN-002 的 brief 部分）
"$CLI" brief --json | node -e "
const d = JSON.parse(require('fs').readFileSync(0, 'utf8')).data; const want = process.argv[1];
const dec = d.decisions.find((x) => x.decision.includes('已併入 main'));
if (!dec || dec.verify !== want) { console.error('  ✗ brief --json 的決策項沒有原樣的 verify: ' + JSON.stringify(dec)); process.exit(1); }
const plain = d.decisions.find((x) => x.decision.includes('改用 release.sh'));
if (!plain || 'verify' in plain) { console.error('  ✗ 一般決策項不該帶 verify: ' + JSON.stringify(plain)); process.exit(1); }
const ufl = d.high_utility.find((x) => x.snippet.includes('已併入 main'));
if (!ufl || ufl.verify !== want || typeof ufl.verify_as_of !== 'string') { console.error('  ✗ 高效用項沒有 verify／verify_as_of: ' + JSON.stringify(ufl)); process.exit(1); }
" "$VERIFY_S"
echo "  近期決策、高效用、環境紀律都附上完整命令（含反引號），一般決策沒有；--json 帶 verify"

echo "[attributes] (U/issue-32 SCN-011) 有查證行時，brief 在統計行之後帶一行固定說明"
NOTE_U='- 查證行：「截至…；據以行動前先跑 `<命令>`」只列出命令，Memoria 不執行；只在命令是唯讀檢查時才跑，並以它的輸出為準'
AFTER_STATS=$(awk 'f{print; exit} /^- sessions: /{f=1}' "$BRIEF_S")
[ "$AFTER_STATS" = "$NOTE_U" ] || { echo "  ✗ 統計行之後不是固定說明: [$AFTER_STATS]"; exit 1; }
[ "$(grep -cxF -- "$NOTE_U" "$BRIEF_S")" = "1" ] || { echo "  ✗ 固定說明不是剛好一行"; exit 1; }
# 沒有查證行的 brief 不出現這一行（零標記的 golden 由 (J) 逐位元組守著）
reset_home home-u
"$CLI" remember "demo 的 release 流程改用 release.sh" --project demo >/dev/null
"$CLI" brief >/dev/null
grep -qF -- '- 查證行：' "$MEMORIA_HOME/knowledge/BRIEF.md" && { echo "  ✗ 沒有查證行的 brief 出現了固定說明"; exit 1; }
echo "  有查證行時說明緊接在統計行之後且只有一行；沒有查證行時不出現"

echo "[attributes] (V/issue-32 SCN-012) 常駐區的狀態類記憶也顯示查證行"
reset_home home-v
"$CLI" remember "demo 的 helper 雜湊目錄是 abc123" --project demo --verify "ls ~/.cache/demo" >/dev/null
"$CLI" remember "demo 一律用 pnpm" --project demo --durable >/dev/null
SID_V=$(q "SELECT id FROM sessions WHERE summary='demo 的 helper 雜湊目錄是 abc123'")
DAY_V=$(q "SELECT substr(timestamp,1,10) FROM sessions WHERE id='$SID_V'")
# 本 issue 之前的 runtime 不擋互斥，能把狀態類記憶標成 durable；這裡直接寫出那個狀態。
sql "UPDATE memory_attributes SET retention='durable' WHERE ref_id IN ('$SID_V','noteev-${SID_V#note-}')"
"$CLI" brief >/dev/null
BRIEF_V="$MEMORIA_HOME/knowledge/BRIEF.md"
PIN_STATE=$(section "## 常駐約束（pinned）" "$BRIEF_V" | grep -A1 -F "helper 雜湊目錄是 abc123")
printf '%s\n' "$PIN_STATE" | sed -n 2p | grep -qxF "  - 截至 ${DAY_V}；據以行動前先跑 \`ls ~/.cache/demo\`" || {
    echo "  ✗ 常駐區的狀態類記憶沒有查證行:"; echo "$PIN_STATE"; exit 1; }
PIN_PLAIN=$(section "## 常駐約束（pinned）" "$BRIEF_V" | grep -A1 -F "demo 一律用 pnpm")
case "$(printf '%s\n' "$PIN_PLAIN" | sed -n 2p)" in *截至*) echo "  ✗ 一般常駐約束多了查證行:"; echo "$PIN_PLAIN"; exit 1 ;; esac
grep -qxF -- "$NOTE_U" "$BRIEF_V" || { echo "  ✗ 只有常駐區有查證行時，缺少固定說明"; exit 1; }
"$CLI" brief --json | node -e "
const d = JSON.parse(require('fs').readFileSync(0, 'utf8')).data;
const pin = d.pinned.find((x) => x.snippet.includes('abc123'));
if (!pin || pin.verify !== 'ls ~/.cache/demo' || typeof pin.verify_as_of !== 'string') { console.error('  ✗ pinned 項沒有 verify／verify_as_of: ' + JSON.stringify(pin)); process.exit(1); }
const plain = d.pinned.find((x) => x.snippet.includes('pnpm'));
if (!plain || 'verify' in plain) { console.error('  ✗ 一般 pinned 項不該帶 verify: ' + JSON.stringify(plain)); process.exit(1); }
"
echo "  常駐區的狀態類記憶附查證行，一般常駐約束不變；--json 的 pinned 項帶 verify"

echo "[attributes] (T/issue-32 SCN-006) Memoria 不執行查證命令"
reset_home home-t
RAN_T="$TMP_DIR/ran-t"
VERIFY_T="touch $RAN_T"
# 對照組：同一字串交給 shell 真的會建出檔案，證明下面的斷言抓得到「被執行」。
sh -c "$VERIFY_T"
[ -e "$RAN_T" ] || { echo "  ✗ 對照組沒有建出檔案，斷言無效"; exit 1; }
rm -f "$RAN_T"
"$CLI" remember "demo 的 release 分支已併入 main" --project demo --verify "$VERIFY_T" >/dev/null
SID_T=$(q "SELECT id FROM sessions WHERE summary='demo 的 release 分支已併入 main'")
[ "$(q "SELECT verify_cmd FROM memory_attributes WHERE ref_id='$SID_T'")" = "$VERIFY_T" ] || { echo "  ✗ fixture 沒有寫入查證命令"; exit 1; }
for mode in keyword tree hybrid; do
    "$CLI" recall "demo release" --project demo --mode "$mode" >/dev/null
    "$CLI" recall "demo release" --project demo --mode "$mode" --json >/dev/null
done
"$CLI" brief >/dev/null
"$CLI" brief --stdout >/dev/null
"$CLI" brief --json >/dev/null
"$CLI" doctor >/dev/null 2>&1 || true
"$CLI" stats >/dev/null
"$CLI" mark "$SID_T" --sensitivity private >/dev/null
"$CLI" remember "demo 的 release 分支已併入 main" --project demo --verify "$VERIFY_T" >/dev/null
[ ! -e "$RAN_T" ] || { echo "  ✗ Memoria 執行了查證命令"; exit 1; }
echo "  寫入、recall（三種模式、--json）、brief、doctor、stats、mark、重跑 remember 之後，檔案都不存在；對照組會建出"

echo "[attributes] ✓ all checks passed"
