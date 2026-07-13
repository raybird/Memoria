#!/usr/bin/env bash
# issue-1 Phase 6: edge cases (spec §24/§25/§8.3/§17) + git-observations prune target.
#
# Key contracts:
#   1. shallow clone → limited_history status + shallow fingerprint; unshallow upgrades the SAME
#      logical repository in place (no duplicate)
#   2. linked git worktree shares the repository identity but gets its own instance/worktree rows
#   3. relocate then sync works end-to-end
#   4. maxDiffBytes (config.json) truncates pending-request diffs with a warning
#   5. prune --git-observations-days removes superseded refs / consumed events / finished scan
#      runs but NEVER git_commits or git_summaries

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

echo "[repo-edge] origin repo with history"
ORIGIN="$TMP_DIR/origin"
git init -q -b main "$ORIGIN"
for i in 1 2 3; do
    echo "line $i" >> "$ORIGIN/file.txt"
    git -C "$ORIGIN" add file.txt
    git -C "$ORIGIN" "${GIT_ID[@]}" commit -q -m "origin c$i"
done

echo "[repo-edge] shallow clone → limited_history, then unshallow upgrades in place"
SHALLOW="$TMP_DIR/shallow"
git clone -q --depth 1 "file://$ORIGIN" "$SHALLOW"
ADD=$("$CLI" repo add "$SHALLOW" --name shallow-proj --json)
assert_eq "shallow status" "$(json_get "$ADD" "d.data.repository.status")" "limited_history"
SHALLOW_ID=$(json_get "$ADD" "d.data.repository.id")
SYNC=$("$CLI" repo sync "$SHALLOW_ID" --json)
assert_eq "shallow sync works" "$(json_get "$SYNC" "d.ok")" "true"

git -C "$SHALLOW" fetch -q --unshallow
ADD2=$("$CLI" repo add "$SHALLOW" --json)
assert_eq "unshallow re-add is NOT a new repository" "$(json_get "$ADD2" "d.data.created")" "false"
assert_eq "same logical repository id" "$(json_get "$ADD2" "d.data.repository.id")" "$SHALLOW_ID"
assert_eq "status upgraded to active" "$(json_get "$ADD2" "d.data.repository.status")" "active"
assert_eq "root commit now recorded" "$(json_get "$ADD2" "d.data.repository.root_commit_sha ? 'yes' : 'no'")" "yes"
assert_eq "exactly one repositories row" "$(db_get "SELECT COUNT(*) FROM repositories")" "1"

echo "[repo-edge] linked worktree shares identity, own instance"
MAIN="$TMP_DIR/main-clone"
git clone -q "file://$ORIGIN" "$MAIN"
"$CLI" repo add "$MAIN" --name main-proj --json >/dev/null
MAIN_ID=$("$CLI" repo status main-proj --json | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).data.repository.id)")
git -C "$MAIN" worktree add -q "$TMP_DIR/wt-feature" -b feature/wt >/dev/null
ADD_WT=$("$CLI" repo add "$TMP_DIR/wt-feature" --json)
assert_eq "worktree maps to same repository" "$(json_get "$ADD_WT" "d.data.repository.id")" "$MAIN_ID"
assert_eq "worktree is not main" "$(json_get "$ADD_WT" "d.data.worktree.is_main_worktree")" "false"
assert_eq "worktree own instance path" "$(json_get "$ADD_WT" "d.data.instance.local_path")" "$TMP_DIR/wt-feature"
SYNC_WT=$("$CLI" repo sync "$TMP_DIR/wt-feature" --json)
assert_eq "sync via worktree path works" "$(json_get "$SYNC_WT" "d.ok")" "true"

echo "[repo-edge] relocate then sync"
mv "$MAIN" "$TMP_DIR/main-moved"
git -C "$TMP_DIR/main-moved" worktree repair >/dev/null 2>&1 || true
"$CLI" repo relocate "$MAIN_ID" "$TMP_DIR/main-moved" --json >/dev/null
echo "post-move" >> "$TMP_DIR/main-moved/file.txt"
git -C "$TMP_DIR/main-moved" "${GIT_ID[@]}" commit -q -am "after relocate"
SYNC_MOVED=$("$CLI" repo sync "$MAIN_ID" --json)
assert_eq "sync after relocate ok" "$(json_get "$SYNC_MOVED" "d.ok")" "true"
assert_eq "new commit picked up" "$(json_get "$SYNC_MOVED" "d.data.new_commits")" "1"

echo "[repo-edge] maxDiffBytes truncation via config.json"
mkdir -p "$MEMORIA_HOME/configs"
cat > "$MEMORIA_HOME/configs/config.json" <<'EOF'
{ "git": { "summarization": { "maxDiffBytes": 500, "minimumCommits": 1, "minimumChangedLines": 5 } } }
EOF
BIG="$TMP_DIR/big"
git init -q -b main "$BIG"
seq 1 20 > "$BIG/seed.txt"
git -C "$BIG" add . && git -C "$BIG" "${GIT_ID[@]}" commit -q -m "seed"
"$CLI" repo add "$BIG" --name big-proj --json >/dev/null
seq 1 500 > "$BIG/huge.txt"
git -C "$BIG" add . && git -C "$BIG" "${GIT_ID[@]}" commit -q -m "huge change"
"$CLI" repo sync big-proj --json >/dev/null
PENDING=$("$CLI" repo summarize big-proj --pending --json)
node -e "
const d = JSON.parse(process.argv[1]);
const reqs = d.data.requests;
if (!reqs.length) { console.error('  ✗ no pending request for big change'); process.exit(1); }
const r = reqs[reqs.length - 1];
const diffLen = (r.context.diff ?? '').length;
if (diffLen > 500) { console.error('  ✗ diff not truncated: ' + diffLen + ' bytes'); process.exit(1); }
console.log('  ✓ diff capped at maxDiffBytes (' + diffLen + ' bytes)');
" "$PENDING"
rm -f "$MEMORIA_HOME/configs/config.json"

echo "[repo-edge] prune --git-observations keeps facts, drops operational history"
git -C "$TMP_DIR/main-moved" "${GIT_ID[@]}" commit -q --allow-empty -m "move ref once more"
"$CLI" repo sync "$MAIN_ID" --json >/dev/null
COMMITS_BEFORE=$(db_get "SELECT COUNT(*) FROM git_commits")
SUMMARIES_BEFORE=$(db_get "SELECT COUNT(*) FROM git_summaries")
DEMOTED=$(db_get "SELECT COUNT(*) FROM git_refs WHERE is_current = 0")
assert_eq "there are superseded ref observations to prune" "$(test "$DEMOTED" -gt 0 && echo yes)" "yes"
PRUNE=$("$CLI" prune --git-observations-days 0 --json)
assert_eq "prune ok" "$(json_get "$PRUNE" "d.ok")" "true"
assert_eq "superseded refs removed" "$(db_get "SELECT COUNT(*) FROM git_refs WHERE is_current = 0")" "0"
assert_eq "consumed events removed" \
    "$(db_get "SELECT COUNT(*) FROM git_events WHERE status IN ('processed','ignored')")" "0"
assert_eq "git_commits untouched" "$(db_get "SELECT COUNT(*) FROM git_commits")" "$COMMITS_BEFORE"
assert_eq "git_summaries untouched" "$(db_get "SELECT COUNT(*) FROM git_summaries")" "$SUMMARIES_BEFORE"
assert_eq "current refs kept" "$(test "$(db_get "SELECT COUNT(*) FROM git_refs WHERE is_current = 1")" -gt 0 && echo yes)" "yes"
SYNC_AFTER_PRUNE=$("$CLI" repo sync "$MAIN_ID" --json)
assert_eq "sync still works after prune" "$(json_get "$SYNC_AFTER_PRUNE" "d.data.new_commits")" "0"

echo "[repo-edge] PASS"
