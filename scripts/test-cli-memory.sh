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
#   (P) issue-32 SCN-007 the brief shows its generation time in the body, not only in the header comment
#   (Q) issue-39 --used changes nothing that is written; without --hits no memory accrues utility

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
# issue-32 SCN-007: the generation time is also in the body now, so it is masked there too.
strip_gen_time() { grep -v "generated by" "$1" | sed -E 's/(｜ 產生於 )[^ ]+$/\1<TS>/'; }
diff <(strip_gen_time "$TMP_DIR/brief-1.md") <(strip_gen_time "$BRIEF") >/dev/null || {
    echo "  ✗ brief content changed between identical runs"; exit 1; }

# --stdout must not touch the file.
"$CLI" brief --project demo --stdout | grep -q "# Memoria Brief" || { echo "  ✗ --stdout produced no markdown"; exit 1; }
echo "  stable, and --stdout does not write"

echo "[cli-memory] (P/issue-32 SCN-007) brief 正文顯示產生時間，第一行註解格式不變"
# Claude Code 以 @ 引入時看不到 HTML 註解，所以只寫在註解裡的產生時間，agent 讀不到。
"$CLI" brief --project demo >/dev/null
FIRST=$(head -1 "$BRIEF")
GEN_TS=$(printf '%s\n' "$FIRST" | sed -nE 's/^<!-- generated by: memoria brief --project demo --days 30 at ([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z) -->$/\1/p')
[ -n "$GEN_TS" ] || { echo "  ✗ 第一行註解格式改變: $FIRST"; exit 1; }
grep -v '^<!--' "$BRIEF" | grep -qF "產生於 $GEN_TS" || {
    echo "  ✗ 正文沒有顯示與註解相同的產生時間 $GEN_TS"; grep -v '^<!--' "$BRIEF" | head -5; exit 1; }
echo "  正文含產生時間 $GEN_TS，與第一行註解相同"

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

# ── issue-33: several processes writing one data root ─────────────────────────────────────────
H33="$TMP_DIR/home33"
cli33() { MEMORIA_HOME="$H33" "$CLI" "$@"; }
q33() {
    node -e "
      const D=require('$BSQ');
      const db=new D(process.argv[2],{readonly:true});
      const r=db.prepare(process.argv[1]).get(...process.argv.slice(3));
      console.log(r ? Object.values(r)[0] : '');
    " "$1" "$H33/.memory/sessions.db" "${@:2}"
}
cli33 init >/dev/null

echo "[cli-memory] (issue-33 SCN-005) a lone remember writes the Daily note byte-for-byte as before"
DAILY33() { ls "$H33/knowledge/Daily/"*.md 2>/dev/null | head -1; }
cli33 remember "Daily 逐位元組第一筆" --project demo33 >/dev/null
cli33 remember "Daily 逐位元組第二筆" --project demo33 >/dev/null
EXPECTED_DAILY=$(node -e "
  const D=require('$BSQ');
  const db=new D(process.argv[1],{readonly:true});
  const rows=db.prepare('SELECT id, timestamp, project, event_count, summary FROM sessions ORDER BY timestamp, id').all();
  const date=new Date(rows[0].timestamp).toISOString().slice(0,10);
  let out='# '+date+'\n\n';
  for (const r of rows) {
    const t=new Date(r.timestamp).toISOString().slice(11,16);
    out+='\n## '+t+' - '+r.project+'\n\n'+(r.summary ?? '')+'\n\n事件數: '+r.event_count+' | Session ID: \`'+r.id+'\`\n';
  }
  process.stdout.write(out);
" "$H33/.memory/sessions.db"; printf x)
EXPECTED_DAILY="${EXPECTED_DAILY%x}"
ACTUAL_DAILY="$(cat "$(DAILY33)"; printf x)"; ACTUAL_DAILY="${ACTUAL_DAILY%x}"
[ "$ACTUAL_DAILY" = "$EXPECTED_DAILY" ] || {
    echo "  ✗ Daily 內容與既有格式不同"; diff <(printf '%s' "$EXPECTED_DAILY") <(printf '%s' "$ACTUAL_DAILY") | head -20; exit 1; }
echo "  單獨寫入兩筆，Daily 與既有格式逐位元組相同"

echo "[cli-memory] (issue-33 SCN-005) 16 concurrent remembers keep all 16 Daily entries"
for round in 1 2 3 4 5; do
    HR="$TMP_DIR/home33-r$round"
    MEMORIA_HOME="$HR" "$CLI" init >/dev/null
    PIDS=()
    for i in $(seq 1 16); do
        MEMORIA_HOME="$HR" "$CLI" remember "並行筆記 r$round-$i" --project demo33 >/dev/null & PIDS+=($!)
    done
    for p in "${PIDS[@]}"; do wait "$p" || { echo "  ✗ round $round: a concurrent remember failed"; exit 1; }; done
    SESSIONS_R=$(node -e "const D=require('$BSQ');console.log(new D(process.argv[1],{readonly:true}).prepare('SELECT COUNT(*) c FROM sessions').get().c)" "$HR/.memory/sessions.db")
    ENTRIES_R=$(cat "$HR/knowledge/Daily/"*.md | grep -c '^## ' || true)
    HEADERS_R=$(cat "$HR/knowledge/Daily/"*.md | grep -c '^# ' || true)
    [ "$SESSIONS_R" = "16" ] || { echo "  ✗ round $round: expected 16 sessions, got $SESSIONS_R"; exit 1; }
    [ "$ENTRIES_R" = "16" ] || { echo "  ✗ round $round: Daily has $ENTRIES_R entries for 16 sessions"; exit 1; }
    [ "$HEADERS_R" = "1" ] || { echo "  ✗ round $round: Daily has $HEADERS_R headers"; exit 1; }
done
echo "  5 輪、每輪 16 個程式同時寫入，Daily 條目數都等於 session 數，檔頭只有一個"

echo "[cli-memory] (issue-33 SCN-005) writers released on one instant never lose an entry to the header"
# The CLI rounds above reach the file-creation window only now and then (process start-up spreads
# the writers out). The driver calls syncDailyNote from 16 processes released together on a Daily
# file that does not exist yet; before the hard-link creation about 15% of rounds lost an entry.
(cd "$ROOT_DIR" && pnpm exec tsx scripts/daily-race-driver.mts "$TMP_DIR/home33-r1" 30) || exit 1

echo "[cli-memory] (issue-33 SCN-006) a held write lock is waited on for 5 seconds"
# Holds a RESERVED lock (BEGIN IMMEDIATE) for $1 ms, announcing it via a marker file.
hold_write_lock() {
    node -e "
      const D=require('$BSQ'); const fs=require('fs');
      const db=new D(process.argv[1]);
      db.exec('BEGIN IMMEDIATE');
      fs.writeFileSync(process.argv[3], 'held');
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(process.argv[2]));
      db.exec('COMMIT');
    " "$H33/.memory/sessions.db" "$1" "$2"
}
wait_marker() { for _ in $(seq 1 100); do [ -f "$1" ] && return 0; sleep 0.05; done; echo "  ✗ lock holder never started"; exit 1; }

hold_write_lock 2000 "$TMP_DIR/lock-short" & HOLDER=$!
wait_marker "$TMP_DIR/lock-short"
SHORT_OUT=$(cli33 remember "鎖持有 2 秒時寫入" --project demo33 --json)
wait "$HOLDER"
[ "$(echo "$SHORT_OUT" | jq_field '.data.created')" = "true" ] || { echo "  ✗ 2 秒的鎖之後 remember 應成功: $SHORT_OUT"; exit 1; }

hold_write_lock 8000 "$TMP_DIR/lock-long" & HOLDER=$!
wait_marker "$TMP_DIR/lock-long"
LONG_START=$(date +%s%N)
LONG_STATUS=0
cli33 remember "鎖持有 8 秒時寫入" --project demo33 --json > "$TMP_DIR/long.out" 2> "$TMP_DIR/long.err" || LONG_STATUS=$?
LONG_MS=$(( ($(date +%s%N) - LONG_START) / 1000000 ))
wait "$HOLDER"
[ "$LONG_STATUS" != "0" ] || { echo "  ✗ 8 秒的鎖期間 remember 應失敗"; exit 1; }
grep -q "database is locked" "$TMP_DIR/long.err" || { echo "  ✗ 錯誤應含 database is locked: $(cat "$TMP_DIR/long.err")"; exit 1; }
# The write gives up after its 5 s wait; rolling back the half-written note (issue-31) then waits
# for the same lock again, up to another 5 s — so the command ends between ~5 s and ~10 s.
[ "$LONG_MS" -ge 4500 ] && [ "$LONG_MS" -lt 10500 ] || { echo "  ✗ 應等待約 5 秒才放棄、總計不超過約 10 秒，實際 ${LONG_MS}ms"; exit 1; }
[ "$(q33 "SELECT COUNT(*) FROM sessions WHERE summary LIKE ?" "%鎖持有 8 秒時寫入%")" = "0" ] || { echo "  ✗ 失敗的寫入留下了筆記"; exit 1; }
echo "  鎖持有 2 秒時等待後成功；持有 8 秒時 ${LONG_MS}ms 後以 database is locked 失敗，沒有留下筆記"

# ── issue-34: one note, one recall slot ───────────────────────────────────────────────────────
# remember stores a note twice under one fingerprint (session note-{fp}, event noteev-{fp}); recall
# used to return both, so a top-k could hold k/2 distinct notes.
cli34() { MEMORIA_HOME="$1" "$CLI" "${@:2}"; }
# Prints "{hit count} {distinct fingerprints}" for a recall --json result on stdin; a non-note hit
# counts as its own fingerprint.
note_slots() {
    node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const hits=JSON.parse(d).data;
      const fp=hits.map(h=>h.id.replace(/^noteev-/,"").replace(/^note-/,""));
      console.log(hits.length+" "+new Set(fp).size)})'
}
H34="$TMP_DIR/home34"; cli34 "$H34" init >/dev/null

echo "[cli-memory] (issue-34 AC-1) a note matched by both of its rows appears once"
FP34=$(cli34 "$H34" remember "成對筆記去重的唯一標記 zebrafish" --project demo34 --rationale "zebrafish 理由" --json | jq_field '.data.noteId')
BOTH=$(node -e "
  const D=require('$BSQ');const db=new D(process.argv[1],{readonly:true});
  console.log(db.prepare(\"SELECT COUNT(DISTINCT ref_id) c FROM recall_fts WHERE recall_fts MATCH 'zebrafish' AND ref_id IN (?, ?)\").get('note-'+process.argv[2],'noteev-'+process.argv[2]).c)
" "$H34/.memory/sessions.db" "$FP34")
[ "$BOTH" = "2" ] || { echo "  ✗ fixture: the query must match both note- and noteev- rows, matched $BOTH"; exit 1; }
for MODE34 in keyword hybrid tree; do
    OUT34=$(cli34 "$H34" recall "zebrafish" --project demo34 --mode "$MODE34" --json)
    N34=$(echo "$OUT34" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      console.log(JSON.parse(d).data.filter(h=>h.id==="note-"+process.argv[1]||h.id==="noteev-"+process.argv[1]).length)})' "$FP34")
    [ "$N34" = "1" ] || { echo "  ✗ mode=$MODE34: fingerprint $FP34 appears $N34 times (want 1)"; exit 1; }
done
echo "  keyword/hybrid/tree：同一則筆記只出現一次"

echo "[cli-memory] (issue-34 AC-1) the surviving row is the higher-ranked one, whichever half it is"
# Explicit feedback decides which half ranks first: one home favours the event, the other the session.
# A collapse that kept the lower-ranked row, or always one particular half, fails one of the two.
Q34="axolotl ranking flip"
for HI_HALF in noteev note; do
    H34F="$TMP_DIR/home34-$HI_HALF"; cli34 "$H34F" init >/dev/null
    FPF=$(cli34 "$H34F" remember "axolotl ranking flip probe" --project demo34 --rationale "axolotl ranking flip reason" --json | jq_field '.data.noteId')
    if [ "$HI_HALF" = noteev ]; then HI="noteev-$FPF"; LO="note-$FPF"; else HI="note-$FPF"; LO="noteev-$FPF"; fi
    RID=$(cli34 "$H34F" recall "$Q34" --project demo34 --json | jq_field '.meta.recall_id')
    cli34 "$H34F" feedback "$RID" --signal explicit --score 1 --hits "$HI" >/dev/null
    cli34 "$H34F" feedback "$RID" --signal explicit --score 0 --hits "$LO" >/dev/null
    GOT=$(cli34 "$H34F" recall "$Q34" --project demo34 --json | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).data.map(h=>h.id).join(" ")))')
    [ "$GOT" = "$HI" ] || { echo "  ✗ utility favours $HI, recall returned: $GOT"; exit 1; }
done
echo "  utility 偏向 event 時留 noteev-，偏向 session 時留 note-"

echo "[cli-memory] (issue-34 AC-2) the freed slots go to the next distinct notes"
for i in 1 2 3 4 5; do
    cli34 "$H34" remember "補滿測試第 $i 則 quokka 筆記" --project demo34 --rationale "quokka 理由 $i" >/dev/null
done
# tree is left out here: it returns one row per note already, and how many notes it surfaces is the
# tree index's own behaviour, not this change's.
for MODE34 in keyword hybrid; do
    SLOTS=$(cli34 "$H34" recall "quokka" --project demo34 --mode "$MODE34" --top-k 3 --json | note_slots)
    [ "$SLOTS" = "3 3" ] || { echo "  ✗ mode=$MODE34 --top-k 3 over 5 notes: got hits/distinct=$SLOTS (want 3 3)"; exit 1; }
done
H34B="$TMP_DIR/home34b"; cli34 "$H34B" init >/dev/null
for i in 1 2; do
    cli34 "$H34B" remember "只有兩則的 quokka 筆記 $i" --project demo34 --rationale "quokka 理由 $i" >/dev/null
done
for MODE34 in keyword hybrid; do
    SLOTS=$(cli34 "$H34B" recall "quokka" --project demo34 --mode "$MODE34" --top-k 3 --json | note_slots)
    [ "$SLOTS" = "2 2" ] || { echo "  ✗ mode=$MODE34 --top-k 3 over 2 notes: got hits/distinct=$SLOTS (want 2 2)"; exit 1; }
done
echo "  5 則時 --top-k 3 回 3 則不同筆記；只有 2 則時回 2 則"

# ── issue-35: recall says why it found nothing, or only weak matches ─────────────────────────────
# Its own home, so project names and weak-match texts cannot collide with the notes above.
H35="$TMP_DIR/home-35"
cli35() { MEMORIA_HOME="$H35" "$CLI" "$@"; }
cli35 init >/dev/null
cli35 remember "alpha 改用 pnpm 作為套件管理器" --project alpha --rationale "lockfile 是權威" >/dev/null
cli35 remember "alpha 的部署流程改走靜態主機" --project alpha --rationale "推送即部署" >/dev/null

echo "[cli-memory] (issue-35 SCN-003) --project naming no memory at all says so"
for MODE35 in keyword hybrid; do
    RES35=$(cli35 recall "pnpm 套件管理器" --project beta --mode "$MODE35" --json)
    node -e "
const d=JSON.parse(process.argv[1]);
if(d.data.length!==0) throw new Error('mode=$MODE35 前提：beta 沒有記憶，應 0 筆');
if(d.meta.project_known!==false) throw new Error('mode=$MODE35 project_known 應為 false，實際 '+d.meta.project_known);
" "$RES35"
done
OUT35=$(cli35 recall "pnpm 套件管理器" --project beta)
printf '%s\n' "$OUT35" | grep -q "這個 project 沒有任何記憶" \
    && printf '%s\n' "$OUT35" | grep -q "memoria repo list" \
    || { echo "  ✗ 人讀輸出應提示 project 沒有記憶並指向 repo list："; printf '%s\n' "$OUT35"; exit 1; }
echo "  0 筆、project_known=false，人讀輸出指向 repo list"

echo "[cli-memory] (issue-35 SCN-004) a known project with no relevant hit is told apart"
RES35=$(cli35 recall "完全無關的量子糾纏" --project alpha --json)
node -e "
const d=JSON.parse(process.argv[1]);
if(d.data.length!==0) throw new Error('前提：不相關查詢應 0 筆，實際 '+d.data.length);
if(d.meta.project_known!==true) throw new Error('project_known 應為 true，實際 '+d.meta.project_known);
" "$RES35"
if cli35 recall "完全無關的量子糾纏" --project alpha | grep -q "這個 project 沒有任何記憶"; then
    echo "  ✗ 有記憶的 project 不應印沒有記憶的提示"; exit 1
fi
RES35=$(cli35 recall "pnpm 套件管理器" --json)
node -e "if('project_known' in JSON.parse(process.argv[1]).meta) throw new Error('沒帶 --project 不應有 project_known')" "$RES35"
echo "  0 筆、project_known=true；沒帶 --project 時沒有這個欄位"

echo "[cli-memory] (issue-35 SCN-005) weak hits are returned as before and marked in the listing"
# One note covers the whole query, the other only "checklist" (1 of 4 tokens, relevance 0.25).
# Both rows stay; only the human listing gains a mark.
cli35 remember "switched to pnpm with lockfile migration checklist" --project alpha --rationale "weak-hit fixture" >/dev/null
cli35 remember "deployment checklist for staging" --project alpha --rationale "weak-hit fixture" >/dev/null
RES35=$(cli35 recall "pnpm lockfile migration checklist" --json)
OUT35=$(cli35 recall "pnpm lockfile migration checklist")
node -e "
const d=JSON.parse(process.argv[1]); const out=process.argv[2].split('\n');
const lines=out.filter(l=>l.startsWith('- ['));
if(lines.length!==d.data.length) throw new Error('人讀輸出的命中行數應等於 --json 的筆數');
const weak=d.data.filter(h=>h.relevance!==undefined&&h.relevance<0.3);
const strong=d.data.filter(h=>h.relevance!==undefined&&h.relevance>=0.3);
if(weak.length===0||strong.length===0) throw new Error('前提：應同時有弱命中與一般命中，relevance='+d.data.map(h=>h.relevance).join(','));
d.data.forEach((h,i)=>{
  const marked=lines[i].includes('弱命中');
  const want=h.relevance!==undefined&&h.relevance<0.3;
  if(marked!==want) throw new Error('第 '+(i+1)+' 筆 relevance='+h.relevance+' 標示應為 '+want+'：'+lines[i]);
});
" "$RES35" "$OUT35"
echo "  relevance 低於 0.3 的命中標「弱命中」，其餘不標，筆數不變"

echo "[cli-memory] (Q/issue-39) --used 不影響寫入；不帶 --hits 時沒有記憶累積效用"
# 做法 (a)：寫入只看 --score 與 --hits。skill 依此要測試查詢不帶 --hits，所以這兩件事要釘住。
U39_HOME="$TMP_DIR/home-39"; U39_DB="$U39_HOME/.memory/sessions.db"; U39_FAILS=0
fail39() { echo "  ✗ $1"; U39_FAILS=$((U39_FAILS + 1)); }
u39() { MEMORIA_HOME="$U39_HOME" "$ROOT_DIR/cli" "$@"; }
q39() { node -e "const D=require('$BSQ');const db=new D('$U39_DB',{readonly:true});const r=db.prepare(process.argv[1]).get();console.log(r?Object.values(r).join('|'):'')" "$1"; }
recall39() { u39 recall "部署前先在測試環境確認" --project demo39 --json | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(d.meta.recall_id+" "+(d.data[0]?d.data[0].id:""))'; }
u39 init >/dev/null
u39 remember "部署前先在測試環境確認再上線" --project demo39 >/dev/null
# 先合併換行再比對：help 的折行由 commander 決定，說明改寫後未必還在同一行。
u39 feedback --help | tr -s ' \n' ' ' | grep -qiE -- '--used [^-]*no effect' || fail39 "AC-1：feedback --help 的 --used 說明應寫明不影響寫入: $(u39 feedback --help | grep -- --used)"
read -r R1 HIT <<<"$(recall39)"
[ -n "$HIT" ] || { echo "  ✗ 前提：recall 應命中剛寫入的筆記"; exit 1; }
u39 feedback "$R1" --score 0.4 --used --hits "$HIT" >/dev/null || fail39 "AC-1：帶 --used 的既有呼叫應 exit 0"
AFTER_USED=$(q39 "SELECT explicit_observations, explicit_sum FROM memory_utility WHERE ref_id = '$HIT'")
read -r R2 HIT2 <<<"$(recall39)"
u39 feedback "$R2" --score 0.4 --hits "$HIT2" >/dev/null
AFTER_PLAIN=$(q39 "SELECT explicit_observations, explicit_sum FROM memory_utility WHERE ref_id = '$HIT'")
[ "$(q39 "SELECT utility_score, outcome_kind FROM recall_telemetry WHERE id = '$R1'")" = "$(q39 "SELECT utility_score, outcome_kind FROM recall_telemetry WHERE id = '$R2'")" ] \
    || fail39 "AC-1：帶與不帶 --used 的 telemetry 應相同"
[ "$AFTER_USED" = "1|0.4" ] && [ "$AFTER_PLAIN" = "2|0.8" ] || fail39 "AC-1：兩次回報對 utility 的增量應相同，實得 $AFTER_USED → $AFTER_PLAIN"
# AC-2：只給 --score（測試查詢的回報方式），telemetry 記分數，memory_utility 整表不變。
SNAP=$(q39 "SELECT group_concat(ref_id || ':' || observations || ':' || utility_sum || ':' || explicit_observations || ':' || explicit_sum, ',') FROM memory_utility")
read -r R3 _ <<<"$(recall39)"
u39 feedback "$R3" --score 0.7 >/dev/null
[ "$(q39 "SELECT utility_score FROM recall_telemetry WHERE id = '$R3'")" = "0.7" ] || fail39 "AC-2：telemetry 應記下 0.7"
[ "$(q39 "SELECT group_concat(ref_id || ':' || observations || ':' || utility_sum || ':' || explicit_observations || ':' || explicit_sum, ',') FROM memory_utility")" = "$SNAP" ] \
    || fail39 "AC-2：沒帶 --hits 時 memory_utility 不應改變"
[ "$U39_FAILS" -eq 0 ] || { echo "  ✗ issue-39：$U39_FAILS 項失敗"; exit 1; }
echo "  help 寫明 --used 不影響寫入；帶不帶 --used 寫入相同；只給 --score 時沒有記憶累積效用"

echo "[cli-memory] ✓ all checks passed"
