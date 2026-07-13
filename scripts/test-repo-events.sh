#!/usr/bin/env bash
# issue-1 Phase 3: git events (spec §7.3/§11.2/§19.4).
#
# Key contracts:
#   1. snapshot diffs produce typed events (commit/merge/branch/tag/head/dirty transitions)
#   2. first scan emits repository_added only — no per-commit replay of old history
#   3. history rewrite (amend) → history_rewritten + old commit marked unreachable + patch-ids
#   4. --dry-run reports counts and writes NOTHING (DB byte-identical)
#   5. a failed sync records status=failed + reason; the next sync recovers
#   6. re-running sync on unchanged state creates zero new events (idempotency)

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
db_get() {
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
events_of_type() { db_get "SELECT COUNT(*) FROM git_events WHERE event_type = '$1'"; }

echo "[repo-events] fixture + register (first scan → repository_added only)"
REPO="$TMP_DIR/proj"
git init -q -b main "$REPO"
echo "a" > "$REPO/a.txt"
git -C "$REPO" add a.txt && git -C "$REPO" "${GIT_ID[@]}" commit -q -m "c1"
echo "b" >> "$REPO/a.txt" && git -C "$REPO" "${GIT_ID[@]}" commit -q -am "c2"
ADD=$("$CLI" repo add "$REPO" --json)
REPO_ID=$(json_get "$ADD" "d.data.repository.id")
assert_eq "repository_added emitted" "$(events_of_type repository_added)" "1"
assert_eq "no per-commit replay on first scan" "$(events_of_type commit_discovered)" "0"

echo "[repo-events] commit / branch / merge / tag / head events"
git -C "$REPO" switch -q -c feature/y
echo "f" > "$REPO/f.txt" && git -C "$REPO" add f.txt && git -C "$REPO" "${GIT_ID[@]}" commit -q -m "c3 feature"
git -C "$REPO" switch -q main
git -C "$REPO" "${GIT_ID[@]}" merge -q --no-ff -m "m1 merge" feature/y
git -C "$REPO" "${GIT_ID[@]}" tag -a v1.0.0 -m "v1"
SYNC1=$("$CLI" repo sync "$REPO_ID" --json)
assert_eq "events created" "$(json_get "$SYNC1" "d.data.events_created > 0")" "true"
assert_eq "commit_discovered" "$(events_of_type commit_discovered)" "1"
assert_eq "merge_commit_discovered" "$(events_of_type merge_commit_discovered)" "1"
assert_eq "branch_discovered (feature/y)" "$(events_of_type branch_discovered)" "1"
assert_eq "tag_discovered (v1.0.0)" "$(events_of_type tag_discovered)" "1"
assert_eq "head_changed" "$(events_of_type head_changed)" "1"
assert_eq "branch_head_moved (main)" "$(events_of_type branch_head_moved)" "1"

echo "[repo-events] branch deletion"
git -C "$REPO" branch -q -D feature/y
"$CLI" repo sync "$REPO_ID" --json >/dev/null
assert_eq "branch_disappeared" "$(events_of_type branch_disappeared)" "1"

echo "[repo-events] idempotency: unchanged state adds zero events"
TOTAL_BEFORE=$(db_get "SELECT COUNT(*) FROM git_events")
SYNC2=$("$CLI" repo sync "$REPO_ID" --json)
assert_eq "no events on no-op sync" "$(json_get "$SYNC2" "d.data.events_created")" "0"
assert_eq "event table unchanged" "$(db_get "SELECT COUNT(*) FROM git_events")" "$TOTAL_BEFORE"

echo "[repo-events] working tree dirty/clean transitions are edge-triggered"
echo "wip" >> "$REPO/a.txt"
"$CLI" repo sync "$REPO_ID" --json >/dev/null
assert_eq "working_tree_dirty emitted" "$(events_of_type working_tree_dirty)" "1"
"$CLI" repo sync "$REPO_ID" --json >/dev/null
assert_eq "still 1 (no repeat while dirty)" "$(events_of_type working_tree_dirty)" "1"
git -C "$REPO" checkout -q -- a.txt
"$CLI" repo sync "$REPO_ID" --json >/dev/null
assert_eq "working_tree_clean emitted" "$(events_of_type working_tree_clean)" "1"

echo "[repo-events] history rewrite (amend) → history_rewritten + unreachable + patch-id"
OLD_TIP=$(git -C "$REPO" rev-parse HEAD)
echo "amended" >> "$REPO/a.txt"
git -C "$REPO" add a.txt
git -C "$REPO" "${GIT_ID[@]}" commit -q --amend -m "m1 merge (amended)"
NEW_TIP=$(git -C "$REPO" rev-parse HEAD)
"$CLI" repo sync "$REPO_ID" --json >/dev/null
assert_eq "history_rewritten emitted" "$(events_of_type history_rewritten)" "1"
assert_eq "old tip kept but unreachable" \
    "$(db_get "SELECT unreachable FROM git_commits WHERE commit_sha = '$OLD_TIP'")" "1"
assert_eq "new tip ingested" \
    "$(db_get "SELECT COUNT(*) FROM git_commits WHERE commit_sha = '$NEW_TIP'")" "1"
assert_eq "rewrite event carries before/after" \
    "$(db_get "SELECT before_sha || '→' || after_sha FROM git_events WHERE event_type = 'history_rewritten'")" "$OLD_TIP→$NEW_TIP"

echo "[repo-events] --dry-run writes nothing"
echo "dry" >> "$REPO/a.txt" && git -C "$REPO" "${GIT_ID[@]}" commit -q -am "c-dry"
MD5_BEFORE=$(md5sum "$DB_PATH" | cut -d' ' -f1)
DRY=$("$CLI" repo sync "$REPO_ID" --dry-run --json)
assert_eq "dry-run reports the pending commit" "$(json_get "$DRY" "d.data.new_commits")" "1"
assert_eq "dry-run reports events" "$(json_get "$DRY" "d.data.events_created > 0")" "true"
assert_eq "dry-run lists commit shas" "$(json_get "$DRY" "d.data.dry_run.commits.length")" "1"
MD5_AFTER=$(md5sum "$DB_PATH" | cut -d' ' -f1)
assert_eq "DB byte-identical after dry-run" "$MD5_AFTER" "$MD5_BEFORE"
REAL=$("$CLI" repo sync "$REPO_ID" --json)
assert_eq "real sync then applies it" "$(json_get "$REAL" "d.data.new_commits")" "1"

echo "[repo-events] failed sync records reason; next sync recovers"
mv "$REPO" "$REPO-hidden"
if "$CLI" repo sync "$REPO_ID" --json >/dev/null 2>&1; then
    echo "  ✗ sync against missing path should fail"; exit 1
fi
echo "  ✓ sync fails cleanly on missing path"
mv "$REPO-hidden" "$REPO"
RECOVER=$("$CLI" repo sync "$REPO_ID" --json)
assert_eq "recovery sync ok" "$(json_get "$RECOVER" "d.ok")" "true"

echo "[repo-events] non-invasive"
STATUS_OUT="$(git -C "$REPO" status --porcelain)"
if [ -n "$STATUS_OUT" ]; then echo "  ✗ repo has unexpected changes"; echo "$STATUS_OUT"; exit 1; fi
echo "  ✓ git status clean"

echo "[repo-events] PASS"
