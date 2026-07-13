#!/usr/bin/env bash
# issue-1 Phase 6: non-invasive acceptance (spec §5/§29).
#
# Snapshot a repository's complete observable git state, run EVERY Memoria repo flow against it
# (add → sync → dry-run → summarize → pending → submit → promote → status → prune), then assert
# the state is byte-identical: working tree, .git/config, hooks dir, all refs, HEAD, index mtime
# untouched (GIT_OPTIONAL_LOCKS=0 keeps even `git status` from refreshing it).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT_DIR/cli"
TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

export MEMORIA_HOME="$TMP_DIR/home"
GIT_ID=(-c user.name=memoria-test -c user.email=test@memoria.local)

echo "[noninvasive] build a realistic repo (branches, merge, tag, dirty file)"
REPO="$TMP_DIR/proj"
git init -q -b main "$REPO"
mkdir -p "$REPO/src"
seq 1 30 > "$REPO/src/core.js"
git -C "$REPO" add . && git -C "$REPO" "${GIT_ID[@]}" commit -q -m "c1: core"
git -C "$REPO" switch -q -c feature/a
seq 1 25 > "$REPO/src/feature.js"
git -C "$REPO" add . && git -C "$REPO" "${GIT_ID[@]}" commit -q -m "c2: feature"
git -C "$REPO" switch -q main
git -C "$REPO" "${GIT_ID[@]}" merge -q --no-ff -m "Merge branch 'feature/a'" feature/a
git -C "$REPO" "${GIT_ID[@]}" tag -a v1.0.0 -m "v1"
echo "uncommitted work" > "$REPO/wip.txt"   # deliberately dirty: Memoria must not touch it

snapshot() { # $1=outfile — the snapshot itself must not take optional locks either
    {
        echo "== status ==";      git --no-optional-locks -C "$REPO" status --porcelain=v2
        echo "== refs ==";        git -C "$REPO" for-each-ref --format='%(refname) %(objectname)'
        echo "== HEAD ==";        cat "$REPO/.git/HEAD"
        echo "== config ==";      cat "$REPO/.git/config"
        echo "== hooks ==";       ls -A "$REPO/.git/hooks" | sort
        echo "== worktree ==";    find "$REPO" -path "$REPO/.git" -prune -o -type f -print | sort | xargs md5sum
    } > "$1"
}

snapshot "$TMP_DIR/before.txt"
INDEX_MTIME_BEFORE=$(stat -c %Y "$REPO/.git/index")

echo "[noninvasive] run the complete Memoria flow"
ADD=$("$CLI" repo add "$REPO" --name ni-proj --json)
REPO_ID=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).data.repository.id)" "$ADD")
"$CLI" repo sync "$REPO_ID" --json >/dev/null
"$CLI" repo sync "$REPO_ID" --dry-run --json >/dev/null
"$CLI" repo summarize "$REPO_ID" --branch feature/a --promote --json >/dev/null
PENDING=$("$CLI" repo summarize "$REPO_ID" --pending --json)
SUM_ID=$(node -e "
const r = JSON.parse(process.argv[1]).data.requests;
process.stdout.write(r.length ? r[0].summary_id : '')" "$PENDING")
if [ -n "$SUM_ID" ]; then
    printf '{"title":"t","summary":"s","importance":0.9,"confidence":0.9}' > "$TMP_DIR/p.json"
    "$CLI" repo summarize "$REPO_ID" --submit "$SUM_ID" --file "$TMP_DIR/p.json" --json >/dev/null
fi
"$CLI" repo status "$REPO_ID" --json >/dev/null
"$CLI" prune --git-observations-days 0 --json >/dev/null
"$CLI" repo sync "$REPO_ID" --json >/dev/null

echo "[noninvasive] compare snapshots"
INDEX_MTIME_AFTER=$(stat -c %Y "$REPO/.git/index")
snapshot "$TMP_DIR/after.txt"
if ! diff -u "$TMP_DIR/before.txt" "$TMP_DIR/after.txt"; then
    echo "  ✗ repository state changed — Memoria is NOT non-invasive"
    exit 1
fi
echo "  ✓ working tree / refs / HEAD / config / hooks byte-identical"

if [ "$INDEX_MTIME_BEFORE" != "$INDEX_MTIME_AFTER" ]; then
    echo "  ✗ .git/index was refreshed (mtime changed) — GIT_OPTIONAL_LOCKS breach"
    exit 1
fi
echo "  ✓ .git/index untouched (optional locks disabled)"

echo "[noninvasive] PASS"
