#!/usr/bin/env bash
# issue-17 — brief scope: cwd detection and per-project output (docs/issues/issue-17).
#
#   (A) SCN-009 cwd outside every registered repo → global BRIEF.md, and the output SAYS so
#   (B) SCN-007 cwd inside a registered repo → BRIEF-<project>.md scoped to that repo
#   (C) SCN-008 a memory whose project is not a registered repo rides along into EVERY project
#   (D) SCN-011 that class is counted in both human and --json output
#   (E) SCN-012 registering the project as a repo drops the count — the drift is visible
#   (F) SCN-010 --global restores the pre-issue-17 single-file, all-projects behaviour
#   (G) SCN-013 a per-project run prints shared AGENTS.md guidance and Claude imports
#   (H) recent decisions are dealt per project, and the total counts the whole window
#   (I) pinned text survives at note length; only an outsized memory is cut
#   (J) high-utility needs 2 observations, merges one source, skips pinned, respects scope
#
# The single global BRIEF.md cannot hold a cwd-filtered result: `brief` is manual and CLAUDE.md
# `@`-imports one fixed path, so whoever ran it last from whatever directory would decide what
# every project sees. Per-project files are what makes cwd filtering meaningful at all.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
CLI="$ROOT_DIR/cli"
field() { node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(eval("j"+process.argv[1]))})' "$1"; }
MEMORIA_HOME=""
DB=""
BSQ="$ROOT_DIR/node_modules/better-sqlite3"

sql() { node -e "const D=require('$BSQ');const db=new D('$DB');db.prepare(process.argv[1]).run()" "$1"; }
section() { awk -v h="$1" 'index($0,h)==1{f=1;next} /^## /{f=0} f' "$2"; }

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

reset_home() {
    export MEMORIA_HOME="$TMP_DIR/$1"
    "$CLI" init >/dev/null
}

make_repo() { # $1=path — seed a UNIQUE file so root commits (and fingerprints) differ per fixture
    git init -q "$1"
    echo "seed: $(basename "$1") $RANDOM$RANDOM" > "$1/seed.txt"
    git -C "$1" add seed.txt
    git -C "$1" -c user.name=memoria-test -c user.email=test@memoria.local commit -q -m "init $(basename "$1")"
}

echo "[brief-scope] (A/SCN-009) cwd 不對應任何已註冊 repo 時退回全域並明說"
reset_home home-a
make_repo "$TMP_DIR/solo"   # 建立但刻意不註冊
"$CLI" remember "全域範圍的決策：改用 pnpm" --project demo >/dev/null
( cd "$TMP_DIR/solo" && "$CLI" brief > "$TMP_DIR/out-a.txt" )
[ -f "$MEMORIA_HOME/knowledge/BRIEF.md" ] || { echo "  ✗ 全域 BRIEF.md 未產出"; exit 1; }
if ls "$MEMORIA_HOME/knowledge/" | grep -q '^BRIEF-'; then
    echo "  ✗ 未註冊的目錄不該產生 per-project 檔: $(ls "$MEMORIA_HOME/knowledge/")"; exit 1
fi
# 只斷言「有講出退回這件事」,不綁完整措辭。
grep -q "退回全域" "$TMP_DIR/out-a.txt" || {
    echo "  ✗ 輸出沒有說明已退回全域範圍:"; cat "$TMP_DIR/out-a.txt"; exit 1; }
grep -q "^- 範圍: (all projects)" "$MEMORIA_HOME/knowledge/BRIEF.md" || {
    echo "  ✗ 範圍不是 (all projects)——可能任意挑了一個 repo"; exit 1; }
echo "  退回全域,未產生 per-project 檔,且輸出有說明"

echo "[brief-scope] (B/SCN-007) cwd 位於已註冊 repo 時產出該專案的 BRIEF"
reset_home home-b
make_repo "$TMP_DIR/alpha"
make_repo "$TMP_DIR/beta"
"$CLI" repo add "$TMP_DIR/alpha" >/dev/null
"$CLI" repo add "$TMP_DIR/beta" >/dev/null
"$CLI" remember "alpha 的決策：改用 pnpm 作為套件管理器" --project alpha >/dev/null
"$CLI" remember "beta 的決策：改用 yarn 作為套件管理器" --project beta >/dev/null
( cd "$TMP_DIR/alpha" && "$CLI" brief >/dev/null )
SCOPED="$MEMORIA_HOME/knowledge/BRIEF-alpha.md"
[ -f "$SCOPED" ] || { echo "  ✗ 未產出 BRIEF-alpha.md: $(ls "$MEMORIA_HOME/knowledge/")"; exit 1; }
grep -q "改用 pnpm" "$SCOPED" || { echo "  ✗ 本專案的決策不在其中"; exit 1; }
grep -q "改用 yarn" "$SCOPED" && { echo "  ✗ 另一個已註冊 repo 的決策混了進來"; exit 1; }
# 從 repo 的子目錄執行也要偵測得到,而不是只認 repo 根目錄。
mkdir -p "$TMP_DIR/alpha/src/deep"
( cd "$TMP_DIR/alpha/src/deep" && "$CLI" brief >/dev/null )
[ -f "$SCOPED" ] || { echo "  ✗ 從子目錄執行時偵測失敗"; exit 1; }
echo "  產出 BRIEF-alpha.md,只含本專案決策,子目錄亦可偵測"

echo "[brief-scope] (C/SCN-008) 環境類記憶出現在每一個專案的 BRIEF"
reset_home home-c
make_repo "$TMP_DIR/alpha"
make_repo "$TMP_DIR/beta"
"$CLI" repo add "$TMP_DIR/alpha" >/dev/null
"$CLI" repo add "$TMP_DIR/beta" >/dev/null
# project=ops 不對應任何已註冊 repo,所以它是環境類——跨專案的操作紀律。
"$CLI" remember "環境紀律：停 server 一律用 PID 精準停" --project ops >/dev/null
"$CLI" remember "alpha 專屬：改用 pnpm 作為套件管理器" --project alpha >/dev/null
( cd "$TMP_DIR/alpha" && "$CLI" brief >/dev/null )
( cd "$TMP_DIR/beta" && "$CLI" brief >/dev/null )
for repo in alpha beta; do
    grep -q "PID 精準停" "$MEMORIA_HOME/knowledge/BRIEF-$repo.md" \
        || { echo "  ✗ 環境類記憶不在 BRIEF-$repo.md"; exit 1; }
done
# 但 alpha 專屬的決策不該出現在 beta。
grep -q "改用 pnpm" "$MEMORIA_HOME/knowledge/BRIEF-beta.md" \
    && { echo "  ✗ alpha 的專案決策洩漏到 BRIEF-beta.md"; exit 1; }
echo "  兩邊都帶上環境類,專案決策未互相洩漏"

echo "[brief-scope] (D/SCN-011) 環境類筆數在人類輸出與 --json 都看得見"
reset_home home-d
"$CLI" remember "環境紀律一：停 server 用 PID" --project ops >/dev/null
"$CLI" remember "環境紀律二：操作前先確認 MEMORIA_HOME" --project ops >/dev/null
"$CLI" remember "環境紀律三：向量 ingest 要手動跑" --project ops >/dev/null
"$CLI" brief > "$TMP_DIR/out-d.txt"
grep -q "環境類記憶: 3" "$TMP_DIR/out-d.txt" \
    || { echo "  ✗ 人類輸出沒報出環境類筆數 3:"; cat "$TMP_DIR/out-d.txt"; exit 1; }
JSON_N=$("$CLI" brief --json | field '.data.totals.environment_memories')
[ "$JSON_N" = "3" ] || { echo "  ✗ --json 的 environment_memories 期望 3,實得 '$JSON_N'"; exit 1; }
echo "  人類輸出與 --json 都是 3"

echo "[brief-scope] (E/SCN-012) 該 project 被註冊成 repo 後筆數下降且看得見"
# 沿用 home-d 的資料:把 ops 註冊成真正的 repo,那 3 筆就不再是環境類。
make_repo "$TMP_DIR/ops"
"$CLI" repo add "$TMP_DIR/ops" >/dev/null
"$CLI" brief > "$TMP_DIR/out-e.txt"
AFTER=$("$CLI" brief --json | field '.data.totals.environment_memories')
[ "$AFTER" -lt 3 ] || { echo "  ✗ 註冊後筆數未下降,仍是 '$AFTER'"; exit 1; }
grep -q "環境類記憶: $AFTER" "$TMP_DIR/out-e.txt" \
    || { echo "  ✗ 下降後的筆數沒有反映在人類輸出:"; cat "$TMP_DIR/out-e.txt"; exit 1; }
echo "  3 → $AFTER，且人類輸出即可察覺"

echo "[brief-scope] (F/SCN-010) --global 還原成實作前的單檔全域行為"
reset_home home-f
make_repo "$TMP_DIR/alpha"
"$CLI" repo add "$TMP_DIR/alpha" >/dev/null
"$CLI" remember "alpha 專屬：改用 pnpm 作為套件管理器" --project alpha >/dev/null
"$CLI" remember "環境紀律：停 server 一律用 PID 精準停" --project ops >/dev/null
# 在已註冊 repo 內執行——沒有旗標時這裡會走 per-project 路徑（見 B 段）。
( cd "$TMP_DIR/alpha" && "$CLI" brief --global > "$TMP_DIR/out-f.txt" )
[ -f "$MEMORIA_HOME/knowledge/BRIEF.md" ] || { echo "  ✗ --global 未產出全域 BRIEF.md"; exit 1; }
if ls "$MEMORIA_HOME/knowledge/" | grep -q '^BRIEF-'; then
    echo "  ✗ --global 仍產出了 per-project 檔: $(ls "$MEMORIA_HOME/knowledge/")"; exit 1
fi
BRIEF="$MEMORIA_HOME/knowledge/BRIEF.md"
grep -q "^- 範圍: (all projects)" "$BRIEF" || { echo "  ✗ 範圍不是 (all projects)"; exit 1; }
# 實作前的行為是「所有專案混在同一份近期決策」——兩筆都要在。
grep -q "改用 pnpm" "$BRIEF" || { echo "  ✗ 專案決策不在全域 brief"; exit 1; }
grep -q "PID 精準停" "$BRIEF" || { echo "  ✗ 環境類決策不在全域 brief"; exit 1; }
# 明示要全域時,不該再說「未偵測到已註冊 repo」——那是退回,不是使用者的選擇。
grep -q "退回全域" "$TMP_DIR/out-f.txt" && {
    echo "  ✗ 明示 --global 卻報成退回:"; cat "$TMP_DIR/out-f.txt"; exit 1; }
echo "  單檔全域,兩個專案的決策都在,且未誤報為退回"

echo "[brief-scope] (G/SCN-013) per-project 產出後印出可直接複製的接線指引"
reset_home home-g
make_repo "$TMP_DIR/alpha"
"$CLI" repo add "$TMP_DIR/alpha" >/dev/null
"$CLI" remember "alpha 專屬：改用 pnpm 作為套件管理器" --project alpha >/dev/null
( cd "$TMP_DIR/alpha" && "$CLI" brief > "$TMP_DIR/out-g.txt" )
SCOPED="$MEMORIA_HOME/knowledge/BRIEF-alpha.md"
[ -f "$SCOPED" ] || { echo "  ✗ 未產出 BRIEF-alpha.md"; exit 1; }
# 共用入口必須點名該專案的 AGENTS.md，並提供完整路徑的讀取指令。
grep -qF "$TMP_DIR/alpha/AGENTS.md" "$TMP_DIR/out-g.txt" || {
    echo "  ✗ 沒有點名該專案的 AGENTS.md:"; cat "$TMP_DIR/out-g.txt"; exit 1; }
grep -qF "Before starting work, read $SCOPED if it is not already in context." "$TMP_DIR/out-g.txt" || {
    echo "  ✗ 缺少 AGENTS.md 可用的讀取指令:"; cat "$TMP_DIR/out-g.txt"; exit 1; }
# Claude 的 @-import 必須是絕對路徑：專案的 CLAUDE.md 不在 MEMORIA_HOME 底下。
grep -qF "@$SCOPED" "$TMP_DIR/out-g.txt" || {
    echo "  ✗ 輸出沒有可直接複製的絕對路徑 @$SCOPED:"; cat "$TMP_DIR/out-g.txt"; exit 1; }
grep -qF '@AGENTS.md' "$TMP_DIR/out-g.txt" || {
    echo "  ✗ 缺少 Claude 引入共用規範的 @AGENTS.md:"; cat "$TMP_DIR/out-g.txt"; exit 1; }
# 且要點名是「該專案的」CLAUDE.md,而不是泛稱。
grep -qF "$TMP_DIR/alpha/CLAUDE.md" "$TMP_DIR/out-g.txt" || {
    echo "  ✗ 沒有點名該專案的 CLAUDE.md:"; cat "$TMP_DIR/out-g.txt"; exit 1; }
# 全域模式維持原本的相對路徑提示,不受影響。
"$CLI" brief --global > "$TMP_DIR/out-g2.txt"
grep -qF "$MEMORIA_HOME/AGENTS.md" "$TMP_DIR/out-g2.txt" || {
    echo "  ✗ 全域模式沒有點名 data root 的 AGENTS.md:"; cat "$TMP_DIR/out-g2.txt"; exit 1; }
grep -qF '@AGENTS.md' "$TMP_DIR/out-g2.txt" || {
    echo "  ✗ 全域模式缺少 @AGENTS.md:"; cat "$TMP_DIR/out-g2.txt"; exit 1; }
grep -qF "@knowledge/BRIEF.md" "$TMP_DIR/out-g2.txt" || {
    echo "  ✗ 全域模式的提示被改壞了:"; cat "$TMP_DIR/out-g2.txt"; exit 1; }
echo "  AGENTS.md 共用入口與 Claude imports 皆明確，保留全域相對路徑"

"$CLI" brief --global --out "$MEMORIA_HOME/knowledge/Brief With Space.md" > "$TMP_DIR/out-g3.txt"
grep -qF '@knowledge/Brief\ With\ Space.md' "$TMP_DIR/out-g3.txt" || {
    echo "  ✗ Claude import 未跳脫路徑中的空白:"; cat "$TMP_DIR/out-g3.txt"; exit 1; }

echo "[brief-scope] (H) 近期決策依專案輪流分配,總數是窗口內的真實筆數"
reset_home home-h
make_repo "$TMP_DIR/alpha"
make_repo "$TMP_DIR/beta"
"$CLI" repo add "$TMP_DIR/alpha" >/dev/null
"$CLI" repo add "$TMP_DIR/beta" >/dev/null
"$CLI" remember "beta 的較舊決策" --project beta >/dev/null
"$CLI" remember "環境紀律：較舊的操作規則" --project ops >/dev/null
for n in 1 2 3 4; do "$CLI" remember "alpha 的新決策 $n" --project alpha >/dev/null; done
BRIEF="$MEMORIA_HOME/knowledge/BRIEF.md"
"$CLI" brief --global --top-k 3 >/dev/null
for expected in "beta 的較舊決策" "環境紀律：較舊的操作規則" "alpha 的新決策 4"; do
    grep -qF "$expected" "$BRIEF" || { echo "  ✗ 專案被擠出近期決策,缺 '$expected':"; cat "$BRIEF"; exit 1; }
done
grep -q "期間決策: 6 " "$BRIEF" || { echo "  ✗ 總數不是窗口內的 6 筆:"; sed -n 7,9p "$BRIEF"; exit 1; }
"$CLI" brief --global --top-k 3 --json | field '.data.decisions.map(d=>d.timestamp).join("\n")' > "$TMP_DIR/ts-h.txt"
sort -r "$TMP_DIR/ts-h.txt" | cmp -s - "$TMP_DIR/ts-h.txt" || { echo "  ✗ 顯示順序不是新到舊"; exit 1; }
# 專案數少於 topK 時,剩下的格子要繼續分出去,不能空著。
"$CLI" brief --global --top-k 5 >/dev/null
[ "$(grep -c "alpha 的新決策" "$BRIEF")" = "3" ] || { echo "  ✗ 第二輪起未補滿剩餘格數:"; cat "$BRIEF"; exit 1; }
# 單一專案時等同取最新 topK,與分配前行為相同。
SCOPED_N=$("$CLI" brief --project alpha --top-k 2 --json | field '.data.decisions.map(d=>d.decision).join("|")')
[ "$SCOPED_N" = "alpha 的新決策 4|alpha 的新決策 3" ] || { echo "  ✗ 單一專案未取最新兩筆: $SCOPED_N"; exit 1; }
echo "  每個專案都有一格,總數 6 筆,剩餘格數補滿,單一專案維持最新優先"

echo "[brief-scope] (I) pinned 完整保留常見長度,只擋異常長的內容"
reset_home home-i
LONG_TAIL="結尾的操作指令"
LONG=$(printf '常駐約束%.0s' $(seq 1 100))
"$CLI" remember "${LONG}${LONG_TAIL}" --project ops --durable >/dev/null
HUGE=$(printf '超長內容%.0s' $(seq 1 300))
"$CLI" remember "${HUGE}不該出現的尾端" --project ops --durable >/dev/null
"$CLI" brief --global >/dev/null
BRIEF="$MEMORIA_HOME/knowledge/BRIEF.md"
grep -qF "$LONG_TAIL" "$BRIEF" || { echo "  ✗ 400 字的 pinned 被截斷"; exit 1; }
grep -qF "不該出現的尾端" "$BRIEF" && { echo "  ✗ 超長 pinned 未被上限擋下"; exit 1; }
echo "  400 字完整列出,1200 字才截斷"

echo "[brief-scope] (J) 高效用區塊要 2 次觀察、依來源合併、不重複 pinned"
reset_home home-j
make_repo "$TMP_DIR/alpha"
make_repo "$TMP_DIR/beta"
"$CLI" repo add "$TMP_DIR/alpha" >/dev/null
"$CLI" repo add "$TMP_DIR/beta" >/dev/null
DB="$MEMORIA_HOME/.memory/sessions.db"
seed_memory() { # $1=session id $2=event id $3=project $4=text
    sql "INSERT INTO sessions (id, timestamp, project, event_count, summary) VALUES ('$1', '2026-01-01T00:00:00.000Z', '$3', 1, '$4')"
    sql "INSERT INTO events (id, session_id, timestamp, event_type, content) VALUES ('$2', '$1', '2026-01-01T00:00:00.000Z', 'DecisionMade', '{\"decision\":\"$4\"}')"
}
seed_utility() { # $1=ref $2=observations $3=mean
    sql "INSERT INTO memory_utility (ref_id, observations, utility_sum, explicit_observations, explicit_sum, last_outcome_at) VALUES ('$1', 0, 0, $2, $2 * $3, '2026-01-01T00:00:00.000Z')"
}
seed_memory gitsum-sum_aaa gitdec-sum_aaa-0 alpha "同一個合併的摘要"
seed_utility gitsum-sum_aaa 1 1
"$CLI" brief --global >/dev/null
BRIEF="$MEMORIA_HOME/knowledge/BRIEF.md"
UFL=$(section "## 高效用記憶（UFL）" "$BRIEF")
case "$UFL" in *"未累積到 2 次"*) ;; *) echo "  ✗ 只有 1 次觀察時沒有說明原因: $UFL"; exit 1 ;; esac
sql "UPDATE memory_utility SET explicit_observations=2, explicit_sum=2 WHERE ref_id='gitsum-sum_aaa'"
seed_utility gitdec-sum_aaa-0 2 0.9
seed_memory note-once noteev-once alpha "只被回報一次的筆記"
seed_utility note-once 1 1
seed_memory note-pin noteev-pin alpha "已經釘選的記憶"
seed_utility note-pin 2 1
seed_memory note-other noteev-other beta "另一個專案的高分記憶"
seed_utility note-other 3 1
seed_memory note-alpha noteev-alpha alpha "本專案的記憶"
seed_utility note-alpha 2 0.6
"$CLI" mark note-pin --durable >/dev/null
"$CLI" brief --global >/dev/null
UFL=$(section "## 高效用記憶（UFL）" "$BRIEF")
[ "$(printf '%s\n' "$UFL" | grep -cF "同一個合併的摘要")" = "1" ] || { echo "  ✗ 同一來源未合併: $UFL"; exit 1; }
case "$UFL" in *"只被回報一次"*) echo "  ✗ 未達 2 次觀察卻上榜: $UFL"; exit 1 ;; esac
case "$UFL" in *"已經釘選"*) echo "  ✗ pinned 記憶重複列在高效用區塊: $UFL"; exit 1 ;; esac
# 範圍外的高分記憶不能占掉 topK 的格子。
SCOPED_UFL=$("$CLI" brief --project alpha --top-k 1 --json | field '.data.high_utility.map(m=>m.ref_id).join(",")')
[ "$SCOPED_UFL" = "gitsum-sum_aaa" ] || { echo "  ✗ 範圍內記憶被其他專案擠掉: '$SCOPED_UFL'"; exit 1; }
echo "  門檻、來源合併、pinned 去重與範圍過濾皆符合預期"

echo "[brief-scope] ✓ all checks passed"
