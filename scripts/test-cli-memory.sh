#!/usr/bin/env bash
# issue-4 Phase 1 — CLI read/write/feedback path (docs/issues/issue-4).
#
# Proves the three new commands close the loop WITHOUT an HTTP server, which is the whole point:
# under skill-style deployment the agent only has bash.
#   (A) remember writes an atomic note that recall finds immediately (FTS trigger fired)
#   (B) re-running remember with identical text is idempotent — one session, and crucially
#       ONE recall_fts row per ref (a rewrite would leave a duplicate and double the hits)
#   (C) provenance is recorded as source_type='cli_note'
#   (D) feedback writes explicit utility back into memory_utility, kept apart from the reuse proxy
#   (E) an unknown recall_id is a graceful no-op, not an error
#   (N) query text is off by default; opted in it is masked and capped, and stats --zero-utility reads it

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
export MEMORIA_HOME="$TMP_DIR/home"
DB="$MEMORIA_HOME/.memory/sessions.db"
BSQ="$ROOT_DIR/node_modules/better-sqlite3"
CLI="$ROOT_DIR/cli"

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

# Query the DB with a one-liner; $1 = SQL returning a single scalar column.
q() {
    node -e "
      const D=require('$BSQ');
      const db=new D('$DB',{readonly:true});
      const r=db.prepare(process.argv[1]).get();
      console.log(r ? Object.values(r)[0] : '');
    " "$1"
}
jq_field() { node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(eval("j"+process.argv[1]))})' "$1"; }

echo "[cli-memory] init"
"$CLI" init >/dev/null

echo "[cli-memory] (A) remember writes a note that recall finds"
"$CLI" remember "改用 pnpm 作為套件管理器" --project demo --rationale "lockfile 是權威" >/dev/null
"$CLI" remember "recall 排序改用 relevance 顯示" --type skill --project demo --category cli >/dev/null

HITS=$("$CLI" recall "pnpm 套件管理器" --project demo --json | jq_field '.data.length')
[ "$HITS" -ge 1 ] || { echo "  ✗ recall found nothing right after remember"; exit 1; }
echo "  recall hits: $HITS"

SKILL_HITS=$("$CLI" recall "relevance 顯示" --project demo --json | jq_field '.data.length')
[ "$SKILL_HITS" -ge 1 ] || { echo "  ✗ skill note not recallable"; exit 1; }

echo "[cli-memory] (A2) a CJK phrase recalls like its English counterpart (issue-16)"
# Chinese multi-character queries used to get "the whole string must appear contiguously" semantics
# while English multi-word queries got OR semantics, for the same shape of question. The phrase below
# never appears as one string in the corpus, but both of its halves do — and its English analogue
# already worked, which is what made this an asymmetry rather than a vocabulary gap.
"$CLI" remember "向量索引建置流程" --project demo --rationale "先 index build 再 ingest" >/dev/null
"$CLI" remember "語意召回的降級行為" --project demo --rationale "fail-open 退回字面" >/dev/null
PHRASE_HITS=$("$CLI" recall "索引召回" --project demo --json | jq_field '.data.length')
[ "$PHRASE_HITS" -ge 1 ] || {
    echo "  ✗ a CJK phrase whose halves are both in the corpus recalled nothing"; exit 1; }
echo "  CJK phrase hits: $PHRASE_HITS (halves present, phrase itself never contiguous)"

echo "[cli-memory] (B) identical remember is idempotent (session count AND fts rows)"
SESSIONS_BEFORE=$(q "SELECT COUNT(*) c FROM sessions")
"$CLI" remember "改用 pnpm 作為套件管理器" --project demo --rationale "lockfile 是權威" >/dev/null
SESSIONS_AFTER=$(q "SELECT COUNT(*) c FROM sessions")
[ "$SESSIONS_BEFORE" = "$SESSIONS_AFTER" ] || {
    echo "  ✗ session count changed on re-run: $SESSIONS_BEFORE -> $SESSIONS_AFTER"; exit 1; }

DUPES=$(q "SELECT COUNT(*) c FROM (SELECT kind, ref_id FROM recall_fts GROUP BY kind, ref_id HAVING COUNT(*) > 1)")
[ "$DUPES" = "0" ] || { echo "  ✗ duplicate recall_fts rows after re-run: $DUPES"; exit 1; }

HITS_AFTER=$("$CLI" recall "pnpm 套件管理器" --project demo --json | jq_field '.data.length')
[ "$HITS" = "$HITS_AFTER" ] || { echo "  ✗ hit count changed after idempotent re-run: $HITS -> $HITS_AFTER"; exit 1; }
echo "  sessions=$SESSIONS_AFTER, no duplicate fts rows, hits stable"

echo "[cli-memory] (C) provenance recorded as cli_note"
PROV=$(q "SELECT COUNT(*) c FROM memory_sources WHERE source_type='cli_note'")
[ "$PROV" -ge 2 ] || { echo "  ✗ expected >=2 cli_note provenance rows, got $PROV"; exit 1; }
echo "  provenance rows: $PROV"

echo "[cli-memory] (D) feedback writes explicit utility back"
RID=$("$CLI" recall "pnpm 套件管理器" --project demo --json | jq_field '.meta.recall_id')
[ -n "$RID" ] || { echo "  ✗ recall did not return a recall_id"; exit 1; }
HIT_IDS=$("$CLI" recall "pnpm 套件管理器" --project demo --json | jq_field '.data.map(h=>h.id).join(",")')
"$CLI" feedback "$RID" --signal explicit --score 0.9 --hits "$HIT_IDS" >/dev/null

EXPLICIT=$(q "SELECT COUNT(*) c FROM memory_utility WHERE explicit_observations > 0")
[ "$EXPLICIT" -ge 1 ] || { echo "  ✗ no explicit observation recorded"; exit 1; }
# RFC §2.4: explicit and reuse accumulate separately and are never summed.
REUSE_LEAK=$(q "SELECT COUNT(*) c FROM memory_utility WHERE explicit_observations > 0 AND observations > 0")
[ "$REUSE_LEAK" = "0" ] || { echo "  ✗ explicit signal leaked into the reuse accumulator"; exit 1; }
echo "  explicit rows: $EXPLICIT (reuse accumulator untouched)"

echo "[cli-memory] (E) unknown recall_id is a graceful no-op"
"$CLI" feedback rt_does_not_exist --score 0.5 >/dev/null || {
    echo "  ✗ unknown recall_id should exit 0"; exit 1; }
UPDATED=$("$CLI" feedback rt_does_not_exist --score 0.5 --json | jq_field '.data.updated')
[ "$UPDATED" = "false" ] || { echo "  ✗ expected updated=false, got '$UPDATED'"; exit 1; }

echo "[cli-memory] (F) brief compiles a derived markdown view"
# The brief lists a memory only after 2 observations, so report the same hits a second time.
RID2=$("$CLI" recall "pnpm 套件管理器" --project demo --json | jq_field '.meta.recall_id')
"$CLI" feedback "$RID2" --signal explicit --score 0.9 --hits "$HIT_IDS" >/dev/null
BRIEF="$MEMORIA_HOME/knowledge/BRIEF.md"
"$CLI" brief --project demo >/dev/null
[ -f "$BRIEF" ] || { echo "  ✗ BRIEF.md not written"; exit 1; }
grep -q "generated by: memoria brief" "$BRIEF" || { echo "  ✗ missing generated header"; exit 1; }
grep -q "do not edit by hand" "$BRIEF" || { echo "  ✗ missing do-not-edit marker"; exit 1; }
grep -q "改用 pnpm 作為套件管理器" "$BRIEF" || { echo "  ✗ recent decision missing from brief"; exit 1; }
# (D) attributed explicit utility, so the UFL section must carry it — and as readable text,
# not the raw JSON blob the event stores.
grep -q "explicit ×" "$BRIEF" || { echo "  ✗ high-utility section did not pick up the explicit outcome"; exit 1; }
grep -q '"decision":' "$BRIEF" && { echo "  ✗ raw event JSON leaked into the brief"; exit 1; }
# A note owns two refs (session + event) and an outcome attributes utility to both — they must
# collapse to one line, or every CLI note is listed twice in the brief.
NOTE_LINES=$(grep -c "改用 pnpm 作為套件管理器" "$BRIEF" || true)
[ "$NOTE_LINES" = "2" ] || { echo "  ✗ expected the note once under decisions and once under high-utility, got $NOTE_LINES lines"; exit 1; }
echo "  brief written with decisions + UFL section"

echo "[cli-memory] (G) brief is stable across runs (timestamp aside)"
cp "$BRIEF" "$TMP_DIR/brief-1.md"
"$CLI" brief --project demo >/dev/null
diff <(grep -v "generated by" "$TMP_DIR/brief-1.md") <(grep -v "generated by" "$BRIEF") >/dev/null || {
    echo "  ✗ brief content changed between identical runs"; exit 1; }

# --stdout must not touch the file.
"$CLI" brief --project demo --stdout | grep -q "# Memoria Brief" || { echo "  ✗ --stdout produced no markdown"; exit 1; }
echo "  stable, and --stdout does not write"

echo "[cli-memory] (H) stats reports observed utility per route"
# Additive discipline first: with no outcomes recorded, the block must be absent entirely.
FRESH="$TMP_DIR/home-fresh"
MEMORIA_HOME="$FRESH" "$CLI" init >/dev/null
MEMORIA_HOME="$FRESH" "$CLI" remember "改用 pnpm 作為套件管理器" --project demo >/dev/null
ABSENT=$(MEMORIA_HOME="$FRESH" "$CLI" stats --json | jq_field '.data.recallRouting?.routeUtility === undefined')
[ "$ABSENT" = "true" ] || { echo "  ✗ routeUtility must be absent until an outcome exists"; exit 1; }

# Two routes, deliberately different utility, so the comparison has something to say.
report_on() { # $1 = mode, $2 = utility score
    local rid hits
    rid=$(MEMORIA_HOME="$FRESH" "$CLI" recall "pnpm 套件管理器" --project demo --mode "$1" --json | jq_field '.meta.recall_id')
    [ -n "$rid" ] && [ "$rid" != "undefined" ] || { echo "  ✗ recall on route $1 issued no recall_id"; exit 1; }
    hits=$(MEMORIA_HOME="$FRESH" "$CLI" recall "pnpm 套件管理器" --project demo --mode "$1" --json | jq_field '.data.map(h=>h.id).join(",")')
    MEMORIA_HOME="$FRESH" "$CLI" feedback "$rid" --score "$2" --hits "$hits" >/dev/null
}
report_on keyword 0.4
report_on keyword 0.6
report_on tree 0.9
report_on tree 0.8

MEMORIA_HOME="$FRESH" "$CLI" stats --json | node -e '
const ru = JSON.parse(require("fs").readFileSync(0, "utf8")).data.recallRouting.routeUtility;
const fail = (m) => { console.error("  ✗ " + m + ": " + JSON.stringify(ru)); process.exit(1); };
if (ru.scoredQueries !== 4) fail("expected 4 scored queries");
if (ru.routes.length !== 2) fail("expected 2 routes");
if (ru.routes[0].route_mode !== "tree") fail("routes must be sorted best-first");
if (ru.best !== "tree") fail("best route should be tree (0.85 vs 0.5)");
if (Math.abs(ru.uplift - 0.35) > 1e-6) fail("uplift should be 0.35");
'
MEMORIA_HOME="$FRESH" "$CLI" stats | grep -q "route_utility:" || { echo "  ✗ human-readable stats missing route_utility line"; exit 1; }
echo "  absent with no outcomes; after 2 routes: best=tree uplift=0.35"

echo "[cli-memory] (N) 查詢文字預設不存，opt-in 後遮罩、限長，stats --zero-utility 可讀"
TEXT_HOME="$TMP_DIR/home-text"
DB="$TEXT_HOME/.memory/sessions.db"
export MEMORIA_HOME="$TEXT_HOME"
"$CLI" init >/dev/null
"$CLI" remember "資料庫備份一律走排程 pipeline" --project demo >/dev/null
last_recall_id() { q "SELECT id FROM recall_telemetry ORDER BY created_at DESC, rowid DESC LIMIT 1"; }

"$CLI" recall "資料庫備份 pipeline" --project demo >/dev/null
[ "$(q "SELECT COUNT(*) FROM recall_telemetry WHERE query_text IS NOT NULL")" = "0" ] || { echo "  ✗ 預設不該存查詢文字"; exit 1; }
"$CLI" feedback "$(last_recall_id)" --score 0 >/dev/null
OUT=$("$CLI" stats --zero-utility)
case "$OUT" in *"hash:"*"telemetry.storeQueryText"*) ;; *) echo "  ✗ 沒有文字時應顯示 hash 與啟用方式: $OUT"; exit 1 ;; esac

mkdir -p "$TEXT_HOME/configs"
echo '{"telemetry":{"storeQueryText":true}}' > "$TEXT_HOME/configs/config.json"
"$CLI" recall "資料庫備份 password=hunter2hunter2 pipeline" --project demo >/dev/null
SECRET_ID=$(last_recall_id)
TEXT=$(q "SELECT query_text FROM recall_telemetry WHERE id = '$SECRET_ID'")
case "$TEXT" in *hunter2*) echo "  ✗ 祕密未遮罩: $TEXT"; exit 1 ;; *"[MASKED]"*) ;; *) echo "  ✗ 查詢文字未寫入: '$TEXT'"; exit 1 ;; esac
[ -n "$(q "SELECT query_hash FROM recall_telemetry WHERE id = '$SECRET_ID'")" ] || { echo "  ✗ hash 不該因此消失"; exit 1; }

LONG=$(node -e 'console.log("資料庫備份 ".repeat(100))')
"$CLI" recall "$LONG" --project demo >/dev/null
[ "$(q "SELECT LENGTH(query_text) FROM recall_telemetry ORDER BY created_at DESC, rowid DESC LIMIT 1")" = "200" ] || { echo "  ✗ 查詢文字未限長"; exit 1; }

"$CLI" recall "這是完全不會命中的查詢 zzqqxx" --project demo >/dev/null
"$CLI" recall "資料庫備份 排程" --project demo >/dev/null
"$CLI" feedback "$(last_recall_id)" --score 0.9 --used >/dev/null
Z_JSON=$("$CLI" stats --zero-utility --json)
node -e '
const d = JSON.parse(process.argv[1]).data;
const fail = (m) => { console.error("  ✗ " + m + ": " + process.argv[1]); process.exit(1); };
if (d.rows.some((r) => r.utility_score > 0)) fail("有效用的查詢不該列出");
if (!d.rows.some((r) => r.utility_score === 0)) fail("回報 0 分的查詢應列出");
if (!d.rows.some((r) => r.hit_count === 0 && r.query_text && r.query_text.includes("zzqqxx"))) fail("零命中的查詢應列出且可讀");
if (d.calibration || d.routeUtility) fail("只含失敗的清單不該給校準讀數");
' "$Z_JSON"
"$CLI" stats --zero-utility --limit 1 --json | jq_field '.data.rows.length' | grep -qx 1 || { echo "  ✗ --limit 無效"; exit 1; }
if "$CLI" stats --zero-utility --window 30d >/dev/null 2>&1; then echo "  ✗ 無效 --window 應該失敗"; exit 1; fi

# 設定檔壞掉時 recall 照常，而且不能因此開始寫文字。
BEFORE=$(q "SELECT COUNT(*) FROM recall_telemetry WHERE query_text IS NOT NULL")
echo '{not json' > "$TEXT_HOME/configs/config.json"
"$CLI" recall "資料庫備份 pipeline" --project demo >/dev/null
[ "$(q "SELECT COUNT(*) FROM recall_telemetry WHERE query_text IS NOT NULL")" = "$BEFORE" ] || { echo "  ✗ 設定損毀時不該寫入文字"; exit 1; }
echo "  預設只存 hash；opt-in 後遮罩、限長並可列出，設定損毀時不寫入"

echo "[cli-memory] 日文與韓文的完整句子查得回記憶，平假名語尾不搶排序"
SCRIPT_HOME="$TMP_DIR/script-home"
script_cli() { MEMORIA_HOME="$SCRIPT_HOME" "$ROOT_DIR/cli" "$@"; }
script_cli init >/dev/null
script_cli remember "デプロイ手順はステージングで確認してから本番へ反映する" --project demo >/dev/null
script_cli remember "배포 절차는 스테이징 환경에서 확인한 뒤 운영에 반영한다" --project demo >/dev/null
script_cli remember "部署流程要先在測試環境確認再上線" --project demo >/dev/null
script_cli remember "ログの保存期間は三十日に設定しています" --project demo >/dev/null
script_cli remember "キャッシュの有効期限は一時間にしています" --project demo >/dev/null
for pair in "배포 절차가 뭐야|배포 절차는" "배포절차|배포 절차는" "デプロイのやりかたをおしえて|デプロイ手順は" "ログをどのくらい保存していますか|ログの保存期間" "部署流程是什麼|部署流程要先"; do
    QUERY="${pair%%|*}"; EXPECT="${pair##*|}"
    TOP=$(script_cli recall "$QUERY" --project demo --json | node -e '
const d = JSON.parse(require("fs").readFileSync(0, "utf8"));
process.stdout.write((d.data[0] && d.data[0].snippet) || "");')
    case "$TOP" in *"$EXPECT"*) ;; *) echo "  ✗ 查詢 $QUERY 的首筆不對: '$TOP'"; exit 1 ;; esac
done
[ "$(script_cli recall "ましたか" --project demo --json | jq_field '.data.length')" = "0" ] || { echo "  ✗ 只有語尾的查詢不該命中不相干的記憶"; exit 1; }
[ "$(script_cli recall "しています" --project demo --json | jq_field '.data.length')" != "0" ] || { echo "  ✗ 逐字出現的平假名應由整句比對命中"; exit 1; }
echo "  日文、韓文與中文的句子都取回對應語言的記憶"

# issue-31: a skill note's file name came straight from the whole note text, so a long note died with
# ENAMETOOLONG AFTER its session and event were in the DB — no tree node, a vector coverage gap no
# repair could close, and a retry that answered created:false over the wreck.
H31="$TMP_DIR/home-31"
cli31() { MEMORIA_HOME="$H31" "$ROOT_DIR/cli" "$@"; }
q31() { node -e "
  const D=require('$BSQ'); const db=new D('$H31/.memory/sessions.db',{readonly:true});
  const r=db.prepare(process.argv[1]).get(...process.argv.slice(2)); console.log(r ? Object.values(r)[0] : '');
" "$@"; }
index_missing31() { cli31 stats --json | jq_field '.data.memoryIndex.missing'; }
cli31 init >/dev/null

echo "[cli-memory] SCN-001 長名稱 skill 筆記完整寫入，檔名有上限"
LONG_SKILL="$(printf '雙分頁對打實測時在主控端擺位再派發事件%.0s' $(seq 1 12))"
if ! OUT=$(cli31 remember "$LONG_SKILL" --type skill --project demo --json 2>&1); then
    echo "  ✗ 長名稱 skill 筆記寫入失敗: $OUT"; exit 1
fi
[ "$(echo "$OUT" | jq_field '.data.created')" = "true" ] || { echo "  ✗ 應回 created:true: $OUT"; exit 1; }
LONG_FILE=$(cd "$H31/knowledge/Skills" && ls | grep '^雙分頁對打' || true)
[ -n "$LONG_FILE" ] || { echo "  ✗ 找不到長名稱 skill 的檔案"; exit 1; }
LONG_BYTES=$(printf '%s' "$LONG_FILE" | wc -c)
[ "$LONG_BYTES" -le 255 ] || { echo "  ✗ 檔名 $LONG_BYTES bytes 超過 255"; exit 1; }
echo "$LONG_FILE" | grep -Eq '_[0-9a-f]{8}\.md$' || { echo "  ✗ 截斷後的檔名缺少 8 碼雜湊後綴: $LONG_FILE"; exit 1; }
[ "$(index_missing31)" = "0" ] || { echo "  ✗ 長名稱筆記沒有記憶節點"; exit 1; }
cli31 remember "短名稱技巧 pnpm 優先" --type skill --project demo >/dev/null
[ -f "$H31/knowledge/Skills/短名稱技巧_pnpm_優先.md" ] || { echo "  ✗ 短名稱的檔名不應改變"; ls "$H31/knowledge/Skills"; exit 1; }
echo "  長名稱截斷為 $LONG_BYTES bytes 並帶雜湊，短名稱檔名不變"

echo "[cli-memory] SCN-002/003 新筆記寫衍生檔失敗時撤回，既有筆記不受影響"
if [ "$(id -u)" = "0" ]; then
    echo "  - 略過：以 root 執行時 chmod 擋不住寫入，無法製造 I/O 失敗（不算通過）"
else
    KEPT_TEXT="既有技巧 A：先跑 check 再 build"
    KEPT_SID="note-$(cli31 remember "$KEPT_TEXT" --type skill --project demo --json | jq_field '.data.noteId')"
    chmod 555 "$H31/knowledge/Skills"
    NEW_TEXT="新技巧 B：失敗時不應留下殘骸"
    if FAIL_OUT=$(cli31 remember "$NEW_TEXT" --type skill --project demo --json 2>&1); then
        chmod 755 "$H31/knowledge/Skills"; echo "  ✗ Skills 目錄不可寫時 remember 應失敗: $FAIL_OUT"; exit 1
    fi
    [ "$(q31 "SELECT COUNT(*) FROM sessions WHERE summary = ?" "$NEW_TEXT")" = "0" ] || {
        chmod 755 "$H31/knowledge/Skills"; echo "  ✗ 失敗的新筆記仍留在 sessions"; exit 1; }
    [ "$(q31 "SELECT COUNT(*) FROM events WHERE content LIKE ?" "%新技巧 B%")" = "0" ] || {
        chmod 755 "$H31/knowledge/Skills"; echo "  ✗ 失敗的新筆記仍留在 events"; exit 1; }
    [ "$(cli31 recall "失敗時不應留下殘骸" --json | jq_field '.data.length')" = "0" ] || {
        chmod 755 "$H31/knowledge/Skills"; echo "  ✗ recall 仍查得到被撤回的筆記"; exit 1; }
    RERUN_A=$(cli31 remember "$KEPT_TEXT" --type skill --project demo --json)
    chmod 755 "$H31/knowledge/Skills"
    [ "$(echo "$RERUN_A" | jq_field '.data.created')" = "false" ] || { echo "  ✗ 既有筆記 A 重跑應回 created:false: $RERUN_A"; exit 1; }
    [ "$(q31 "SELECT COUNT(*) FROM sessions WHERE id = ?" "$KEPT_SID")" = "1" ] || { echo "  ✗ 既有筆記 A 被刪除"; exit 1; }
    [ "$(q31 "SELECT COUNT(*) FROM memory_node_sources WHERE session_id = ?" "$KEPT_SID")" != "0" ] || { echo "  ✗ 既有筆記 A 的記憶節點不見了"; exit 1; }
    [ "$(cli31 recall "先跑 check 再 build" --json | jq_field '.data.length')" != "0" ] || { echo "  ✗ recall 查不到既有筆記 A"; exit 1; }
    RETRY=$(cli31 remember "$NEW_TEXT" --type skill --project demo --json)
    [ "$(echo "$RETRY" | jq_field '.data.created')" = "true" ] || { echo "  ✗ 恢復權限後重試應回 created:true: $RETRY"; exit 1; }
    [ "$(index_missing31)" = "0" ] || { echo "  ✗ 重試後的筆記沒有記憶節點"; exit 1; }
    echo "  失敗的新筆記已撤回，重試完整寫入；既有筆記 A 保留"
fi

echo "[cli-memory] ✓ all checks passed"
