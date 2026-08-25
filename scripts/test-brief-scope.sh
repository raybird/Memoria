#!/usr/bin/env bash
# issue-17 — brief scope: cwd detection and per-project output (docs/issues/issue-17).
#
#   (A) SCN-009 cwd outside every registered repo → global BRIEF.md, and the output SAYS so
#   (B) SCN-007 cwd inside a registered repo → BRIEF-<project>.md scoped to that repo
#
# The single global BRIEF.md cannot hold a cwd-filtered result: `brief` is manual and CLAUDE.md
# `@`-imports one fixed path, so whoever ran it last from whatever directory would decide what
# every project sees. Per-project files are what makes cwd filtering meaningful at all.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
CLI="$ROOT_DIR/cli"
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

echo "[brief-scope] ✓ all checks passed"
