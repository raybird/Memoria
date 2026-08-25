#!/usr/bin/env bash
# issue-17 — brief scope: cwd detection and per-project output (docs/issues/issue-17).
#
#   (A) SCN-009 cwd outside every registered repo → global BRIEF.md, and the output SAYS so
#   (B) SCN-007 cwd inside a registered repo → BRIEF-<project>.md scoped to that repo
#   (C) SCN-008 a memory whose project is not a registered repo rides along into EVERY project
#   (D) SCN-011 that class is counted in both human and --json output
#   (E) SCN-012 registering the project as a repo drops the count — the drift is visible
#   (F) SCN-010 --global restores the pre-issue-17 single-file, all-projects behaviour
#   (G) SCN-013 a per-project run prints the exact @-line to paste into THAT repo's CLAUDE.md
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
# 必須是絕對路徑：專案的 CLAUDE.md 不在 MEMORIA_HOME 底下,相對路徑在那裡解不開。
grep -qF "@$SCOPED" "$TMP_DIR/out-g.txt" || {
    echo "  ✗ 輸出沒有可直接複製的絕對路徑 @$SCOPED:"; cat "$TMP_DIR/out-g.txt"; exit 1; }
# 且要點名是「該專案的」CLAUDE.md,而不是泛稱。
grep -qF "$TMP_DIR/alpha/CLAUDE.md" "$TMP_DIR/out-g.txt" || {
    echo "  ✗ 沒有點名該專案的 CLAUDE.md:"; cat "$TMP_DIR/out-g.txt"; exit 1; }
# 全域模式維持原本的相對路徑提示,不受影響。
"$CLI" brief --global > "$TMP_DIR/out-g2.txt"
grep -qF "@knowledge/BRIEF.md" "$TMP_DIR/out-g2.txt" || {
    echo "  ✗ 全域模式的提示被改壞了:"; cat "$TMP_DIR/out-g2.txt"; exit 1; }
echo "  印出絕對路徑並點名該專案的 CLAUDE.md,全域模式不受影響"

echo "[brief-scope] ✓ all checks passed"
