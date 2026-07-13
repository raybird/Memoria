#!/usr/bin/env bash
# issue-1 Phase 2: incremental git scan (spec §29 "Git 掃描" acceptance).
#
# Key contracts:
#   1. new commits / merge commits / tags / branch movement are detected incrementally
#   2. parent relationships and is_merge are stored; special-char messages survive intact
#   3. re-running sync on unchanged state inserts NOTHING (idempotency)
#   4. --history-limit caps the initial scan; detached HEAD scans fine
#   5. the scanned repo stays untouched (non-invasive)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT_DIR/cli"
TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

export MEMORIA_HOME="$TMP_DIR/home"
DB_PATH="$MEMORIA_HOME/.memory/sessions.db"

GIT_ID=(-c user.name=memoria-test -c user.email=test@memoria.local)

json_get() {
    node -e "const d=JSON.parse(process.argv[1]); const v=($2); process.stdout.write(String(v))" "$1"
}
db_get() { # $1=sql returning a single value
    (cd "$ROOT_DIR" && node -e "
      const Database = require('better-sqlite3');
      const db = new Database(process.argv[2], { readonly: true });
      const row = db.prepare(process.argv[1]).raw().get();
      process.stdout.write(String(row === undefined ? '' : row[0]));
    " "$1" "$DB_PATH")
}
assert_eq() {
    if [ "$2" != "$3" ]; then echo "  ✗ $1: expected '$3', got '$2'"; exit 1; fi
    echo "  ✓ $1"
}

echo "[repo-sync] fixture + register"
REPO="$TMP_DIR/proj"
git init -q -b main "$REPO"
echo "a" > "$REPO/a.txt"
git -C "$REPO" add a.txt && git -C "$REPO" "${GIT_ID[@]}" commit -q -m "c1: base"
echo "b" >> "$REPO/a.txt"
git -C "$REPO" "${GIT_ID[@]}" commit -q -am "c2: more"

ADD=$("$CLI" repo add "$REPO" --json)
REPO_ID=$(json_get "$ADD" "d.data.repository.id")
assert_eq "initial scan picked up base commits" "$(json_get "$ADD" "d.data.initial_scan.new_commits")" "2"

echo "[repo-sync] idempotency: no-change sync inserts nothing"
SYNC0=$("$CLI" repo sync "$REPO_ID" --json)
assert_eq "no new commits" "$(json_get "$SYNC0" "d.data.new_commits")" "0"
assert_eq "no new refs" "$(json_get "$SYNC0" "d.data.new_refs")" "0"
assert_eq "no new tags" "$(json_get "$SYNC0" "d.data.new_tags")" "0"

echo "[repo-sync] branch + merge + tag detected incrementally"
git -C "$REPO" switch -q -c feature/x
printf '中文訊息 with "quotes" and\nsecond line' > "$REPO/msg.txt"
git -C "$REPO" add msg.txt
git -C "$REPO" "${GIT_ID[@]}" commit -q -m "c3: 中文訊息 with \"quotes\" and
multi-line body"
git -C "$REPO" switch -q main
echo "main work" > "$REPO/main.txt"
git -C "$REPO" add main.txt && git -C "$REPO" "${GIT_ID[@]}" commit -q -m "c4: main work"
git -C "$REPO" "${GIT_ID[@]}" merge -q --no-ff -m "m1: merge feature/x" feature/x
git -C "$REPO" "${GIT_ID[@]}" tag -a v0.1.0 -m "release v0.1.0"

SYNC1=$("$CLI" repo sync "$REPO_ID" --json)
assert_eq "3 new commits (c3, c4, m1)" "$(json_get "$SYNC1" "d.data.new_commits")" "3"
assert_eq "1 new branch ref" "$(json_get "$SYNC1" "d.data.new_refs")" "1"
assert_eq "1 new tag" "$(json_get "$SYNC1" "d.data.new_tags")" "1"
assert_eq "head recorded" "$(json_get "$SYNC1" "d.data.current_head ? 'yes' : 'no'")" "yes"

echo "[repo-sync] stored facts: parents / is_merge / message fidelity"
MERGE_SHA=$(git -C "$REPO" rev-parse HEAD)
assert_eq "merge commit is_merge=1" \
    "$(db_get "SELECT is_merge FROM git_commits WHERE commit_sha = '$MERGE_SHA'")" "1"
assert_eq "merge has 2 parents" \
    "$(db_get "SELECT json_array_length(parent_shas_json) FROM git_commits WHERE commit_sha = '$MERGE_SHA'")" "2"
C3_SHA=$(git -C "$REPO" rev-parse feature/x)
MSG=$(db_get "SELECT message FROM git_commits WHERE commit_sha = '$C3_SHA'")
case "$MSG" in
    *中文訊息*\"quotes\"*multi-line*) echo "  ✓ special-char multi-line message intact" ;;
    *) echo "  ✗ message mangled: $MSG"; exit 1 ;;
esac
assert_eq "tag observed as current ref" \
    "$(db_get "SELECT COUNT(*) FROM git_refs WHERE ref_name = 'refs/tags/v0.1.0' AND is_current = 1")" "1"

echo "[repo-sync] second sync after changes is a no-op"
SYNC2=$("$CLI" repo sync "$REPO_ID" --json)
assert_eq "idempotent commits" "$(json_get "$SYNC2" "d.data.new_commits")" "0"
assert_eq "idempotent tags" "$(json_get "$SYNC2" "d.data.new_tags")" "0"
TOTAL_COMMITS=$(db_get "SELECT COUNT(*) FROM git_commits WHERE repository_id = '$REPO_ID'")
assert_eq "total commits stored" "$TOTAL_COMMITS" "5"

echo "[repo-sync] detached HEAD scans fine"
git -C "$REPO" -c advice.detachedHead=false checkout -q "$C3_SHA"
SYNC3=$("$CLI" repo sync "$REPO_ID" --json)
assert_eq "detached sync ok" "$(json_get "$SYNC3" "d.ok")" "true"
git -C "$REPO" switch -q main

echo "[repo-sync] --history-limit caps initial scan"
REPO2="$TMP_DIR/proj2"
git init -q -b main "$REPO2"
for i in 1 2 3 4; do
    echo "$i" >> "$REPO2/f.txt"
    git -C "$REPO2" add f.txt
    git -C "$REPO2" "${GIT_ID[@]}" commit -q -m "commit $i"
done
ADD2=$("$CLI" repo add "$REPO2" --history-limit 2 --json)
assert_eq "capped initial scan" "$(json_get "$ADD2" "d.data.initial_scan.new_commits")" "2"
assert_eq "cap warning surfaced" "$(json_get "$ADD2" "d.data.initial_scan.warnings.length >= 1")" "true"

echo "[repo-sync] non-invasive"
STATUS_OUT="$(git -C "$REPO" status --porcelain)"
if [ -n "$STATUS_OUT" ]; then echo "  ✗ repo has unexpected changes:"; echo "$STATUS_OUT"; exit 1; fi
echo "  ✓ git status clean"

echo "[repo-sync] PASS"
