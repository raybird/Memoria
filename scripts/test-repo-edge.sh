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
#   6. issue-33: syncs of one repository from SEPARATE processes are serialized by a lease in
#      the DB — concurrent syncs record exactly what one sync records; a live lease past
#      MEMORIA_REPO_SYNC_WAIT_MS fails with repository_sync_busy and writes nothing; an
#      expired lease is taken over; --dry-run waits for the lease without taking it; a sync that
#      outlives the lease TTL keeps it by renewing (test-only MEMORIA_REPO_SYNC_LEASE_TTL_MS)

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

# ── issue-33: cross-process sync serialization ────────────────────────────────────────────────
db_at() { # $1 db path, $2 sql → first column of first row ('' when none)
    (cd "$ROOT_DIR" && node -e "
      const Database = require('better-sqlite3');
      const db = new Database(process.argv[2], { readonly: true });
      const row = db.prepare(process.argv[1]).raw().get();
      process.stdout.write(String(row === undefined ? '' : row[0]));
    " "$2" "$1")
}
db_exec() { # $1 db path, $2 sql (write)
    (cd "$ROOT_DIR" && node -e "
      const Database = require('better-sqlite3');
      const db = new Database(process.argv[2]);
      db.prepare(process.argv[1]).run();
    " "$2" "$1")
}
# Every git observation a sync writes, as one comparable line.
sync_shape() { # $1 db path
    db_at "$1" "SELECT
        (SELECT group_concat(event_type || '=' || n, ',') FROM
            (SELECT event_type, COUNT(*) n FROM git_events GROUP BY event_type ORDER BY event_type))
        || ' | commits=' || (SELECT COUNT(*) FROM git_commits)
        || ' | current_refs=' || (SELECT COUNT(*) FROM git_refs WHERE is_current = 1)
        || ' | current_ref_names=' || (SELECT COUNT(DISTINCT ref_name) FROM git_refs WHERE is_current = 1)
        || ' | summaries=' || (SELECT COUNT(*) FROM git_summaries)"
}
# Builds a repo registered in $1 (home), then adds a feature branch, a --no-ff merge and a tag.
conc_fixture() { # $1 home, $2 repo dir
    git init -q -b main "$2"
    for i in 1 2 3; do
        echo "base $i" >> "$2/base.txt"
        git -C "$2" add base.txt
        git -C "$2" "${GIT_ID[@]}" commit -q -m "base c$i"
    done
    MEMORIA_HOME="$1" "$CLI" init >/dev/null
    MEMORIA_HOME="$1" "$CLI" repo add "$2" --name conc --json >/dev/null
    git -C "$2" checkout -q -b feat
    for i in 4 5 6; do
        echo "feat $i" >> "$2/feat.txt"
        git -C "$2" add feat.txt
        git -C "$2" "${GIT_ID[@]}" commit -q -m "feat c$i"
    done
    git -C "$2" checkout -q main
    git -C "$2" "${GIT_ID[@]}" merge -q --no-ff feat -m "Merge feat"
    git -C "$2" "${GIT_ID[@]}" tag -a v1 -m v1
}

echo "[repo-edge] (issue-33 SCN-001) two processes syncing one repo record what one sync records"
CTRL_HOME="$TMP_DIR/conc-control"
conc_fixture "$CTRL_HOME" "$TMP_DIR/conc-control-repo"
MEMORIA_HOME="$CTRL_HOME" "$CLI" repo sync conc --json >/dev/null
CTRL_SHAPE=$(sync_shape "$CTRL_HOME/.memory/sessions.db")

CONC_HOME="$TMP_DIR/conc"
CONC_DB="$CONC_HOME/.memory/sessions.db"
conc_fixture "$CONC_HOME" "$TMP_DIR/conc-repo"
MEMORIA_HOME="$CONC_HOME" "$CLI" repo sync conc --json > "$TMP_DIR/conc-a.json" 2>&1 & PID_A=$!
MEMORIA_HOME="$CONC_HOME" "$CLI" repo sync conc --json > "$TMP_DIR/conc-b.json" 2>&1 & PID_B=$!
STATUS_A=0; wait "$PID_A" || STATUS_A=$?
STATUS_B=0; wait "$PID_B" || STATUS_B=$?
assert_eq "first concurrent sync exits 0" "$STATUS_A" "0"
assert_eq "second concurrent sync exits 0" "$STATUS_B" "0"
assert_eq "first concurrent sync ok" "$(json_get "$(cat "$TMP_DIR/conc-a.json")" "d.ok")" "true"
assert_eq "second concurrent sync ok" "$(json_get "$(cat "$TMP_DIR/conc-b.json")" "d.ok")" "true"
assert_eq "concurrent syncs record exactly what one sync records" "$(sync_shape "$CONC_DB")" "$CTRL_SHAPE"
assert_eq "no lease left behind" "$(db_at "$CONC_DB" "SELECT COUNT(*) FROM git_sync_leases")" "0"

# A new commit, so a sync that DID run would have something to write.
echo "after" >> "$TMP_DIR/conc-repo/base.txt"
git -C "$TMP_DIR/conc-repo" add base.txt
git -C "$TMP_DIR/conc-repo" "${GIT_ID[@]}" commit -q -m "after conc"
CONC_REPO_ID=$(db_at "$CONC_DB" "SELECT id FROM repositories WHERE name = 'conc'")
writes_shape() { # every table a sync writes, counted
    db_at "$CONC_DB" "SELECT (SELECT COUNT(*) FROM git_scan_runs) || '/' || (SELECT COUNT(*) FROM git_commits)
        || '/' || (SELECT COUNT(*) FROM git_refs) || '/' || (SELECT COUNT(*) FROM git_events)"
}
FAR_FUTURE="2999-01-01T00:00:00.000Z"
LONG_AGO="2000-01-01T00:00:00.000Z"
insert_lease() { # $1 token, $2 expires_at
    db_exec "$CONC_DB" "INSERT INTO git_sync_leases (repository_id, token, holder_pid, holder_host, acquired_at, expires_at)
        VALUES ('$CONC_REPO_ID', '$1', 999999, 'other-host', '2026-11-17T00:00:00.000Z', '$2')"
}

echo "[repo-edge] (issue-33 SCN-002) a live lease past the wait limit → repository_sync_busy, nothing written"
insert_lease live-token "$FAR_FUTURE"
BEFORE_BUSY=$(writes_shape)
BUSY_STATUS=0
MEMORIA_HOME="$CONC_HOME" MEMORIA_REPO_SYNC_WAIT_MS=500 "$CLI" repo sync conc --json > "$TMP_DIR/busy.out" 2> "$TMP_DIR/busy.err" || BUSY_STATUS=$?
assert_eq "busy sync exits non-zero" "$(test "$BUSY_STATUS" -ne 0 && echo yes)" "yes"
BUSY_ERR=$(cat "$TMP_DIR/busy.err")
assert_eq "error names repository_sync_busy" "$(grep -q 'repository_sync_busy: ' <<<"$BUSY_ERR" && echo yes)" "yes"
assert_eq "error names the holder pid and host" \
    "$(grep -q 'pid 999999 on other-host' <<<"$BUSY_ERR" && grep -q '2026-11-17T00:00:00.000Z' <<<"$BUSY_ERR" && echo yes)" "yes"
assert_eq "busy sync wrote nothing" "$(writes_shape)" "$BEFORE_BUSY"
assert_eq "the live lease is untouched" "$(db_at "$CONC_DB" "SELECT token FROM git_sync_leases")" "live-token"

echo "[repo-edge] (issue-33 SCN-004) --dry-run waits for a live lease without taking it, writes nothing"
BEFORE_DRY=$(writes_shape)
DRY_START=$(date +%s%N)
MEMORIA_HOME="$CONC_HOME" MEMORIA_REPO_SYNC_WAIT_MS=20000 "$CLI" repo sync conc --dry-run --json > "$TMP_DIR/dry.json" 2>&1 & PID_DRY=$!
sleep 1.5
assert_eq "dry-run still waiting while the lease is live" "$(kill -0 "$PID_DRY" 2>/dev/null && echo waiting)" "waiting"
assert_eq "waiting dry-run left the lease as it was" \
    "$(db_at "$CONC_DB" "SELECT token || '|' || expires_at FROM git_sync_leases")" "live-token|$FAR_FUTURE"
db_exec "$CONC_DB" "DELETE FROM git_sync_leases"
DRY_STATUS=0; wait "$PID_DRY" || DRY_STATUS=$?
DRY_MS=$(( ($(date +%s%N) - DRY_START) / 1000000 ))
assert_eq "dry-run exits 0 once the lease is released" "$DRY_STATUS" "0"
assert_eq "dry-run returned only after the release" "$(test "$DRY_MS" -ge 1500 && echo yes)" "yes"
assert_eq "dry-run previews the pending commit" "$(json_get "$(cat "$TMP_DIR/dry.json")" "d.data.dry_run.commits.length")" "1"
assert_eq "dry-run wrote nothing" "$(writes_shape)" "$BEFORE_DRY"
assert_eq "dry-run took no lease" "$(db_at "$CONC_DB" "SELECT COUNT(*) FROM git_sync_leases")" "0"

echo "[repo-edge] (issue-33 SCN-003) an expired lease from a dead holder is taken over"
insert_lease dead-token "$LONG_AGO"
TAKEOVER_START=$(date +%s%N)
TAKEOVER=$(MEMORIA_HOME="$CONC_HOME" MEMORIA_REPO_SYNC_WAIT_MS=20000 "$CLI" repo sync conc --json)
TAKEOVER_MS=$(( ($(date +%s%N) - TAKEOVER_START) / 1000000 ))
assert_eq "takeover sync ok" "$(json_get "$TAKEOVER" "d.ok")" "true"
assert_eq "takeover did not wait for the limit" "$(test "$TAKEOVER_MS" -lt 10000 && echo yes)" "yes"
assert_eq "takeover recorded the pending commit" "$(json_get "$TAKEOVER" "d.data.new_commits")" "1"
assert_eq "no lease left behind after takeover" "$(db_at "$CONC_DB" "SELECT COUNT(*) FROM git_sync_leases")" "0"
# The control home gets the same extra commit and one plain sync: the busy sync, the dry run and
# the takeover together must have recorded exactly what that records.
echo "after" >> "$TMP_DIR/conc-control-repo/base.txt"
git -C "$TMP_DIR/conc-control-repo" add base.txt
git -C "$TMP_DIR/conc-control-repo" "${GIT_ID[@]}" commit -q -m "after conc"
MEMORIA_HOME="$CTRL_HOME" "$CLI" repo sync conc --json >/dev/null
assert_eq "takeover records what a sync with no stale lease records" \
    "$(sync_shape "$CONC_DB")" "$(sync_shape "$CTRL_HOME/.memory/sessions.db")"

echo "[repo-edge] (issue-33) a sync that outlives the lease TTL renews it and is not taken over"
# Every git call of the first sync sleeps, so it runs well past a 3s TTL; the second sync starts
# while it is running. Without renewal the lease expires mid-sync, the second one takes it over and
# both record every event (as SCN-001 without a lease).
SLOW_BIN="$TMP_DIR/slow-git-bin"
mkdir -p "$SLOW_BIN"
printf '#!/usr/bin/env bash\nsleep 0.4\nexec %q "$@"\n' "$(command -v git)" > "$SLOW_BIN/git"
chmod +x "$SLOW_BIN/git"
RENEW_HOME="$TMP_DIR/renew"
conc_fixture "$RENEW_HOME" "$TMP_DIR/renew-repo"
RENEW_START=$(date +%s%N)
( PATH="$SLOW_BIN:$PATH" MEMORIA_HOME="$RENEW_HOME" MEMORIA_REPO_SYNC_LEASE_TTL_MS=3000 \
    "$CLI" repo sync conc --json > "$TMP_DIR/renew-a.json" 2>&1
  echo $(( ($(date +%s%N) - RENEW_START) / 1000000 )) > "$TMP_DIR/renew-a.ms" ) & PID_RA=$!
# Start the second sync only once the slow one holds the lease: with a fixed delay, a busy machine
# could let the second one run first, and the test would pass without exercising renewal.
for _ in $(seq 1 200); do
    [ "$(db_at "$RENEW_HOME/.memory/sessions.db" "SELECT COUNT(*) FROM git_sync_leases")" = "1" ] && break
    sleep 0.05
done
assert_eq "the slow sync holds the lease before the second one starts" \
    "$(db_at "$RENEW_HOME/.memory/sessions.db" "SELECT COUNT(*) FROM git_sync_leases")" "1"
MEMORIA_HOME="$RENEW_HOME" MEMORIA_REPO_SYNC_LEASE_TTL_MS=3000 MEMORIA_REPO_SYNC_WAIT_MS=60000 \
    "$CLI" repo sync conc --json > "$TMP_DIR/renew-b.json" 2>&1 & PID_RB=$!
STATUS_RA=0; wait "$PID_RA" || STATUS_RA=$?
STATUS_RB=0; wait "$PID_RB" || STATUS_RB=$?
assert_eq "slow sync exits 0" "$STATUS_RA" "0"
assert_eq "waiting sync exits 0" "$STATUS_RB" "0"
assert_eq "the slow sync really outlived the TTL" "$(test "$(cat "$TMP_DIR/renew-a.ms")" -gt 4000 && echo yes)" "yes"
assert_eq "renewed lease: the two syncs record what one sync records" \
    "$(sync_shape "$RENEW_HOME/.memory/sessions.db")" "$CTRL_SHAPE"
assert_eq "no lease left behind after renewal" \
    "$(db_at "$RENEW_HOME/.memory/sessions.db" "SELECT COUNT(*) FROM git_sync_leases")" "0"

echo "[repo-edge] (issue-33) a lease TTL beyond the timer ceiling does not renew every millisecond"
# ttl/4 above 2^31-1 ms makes Node print TimeoutOverflowWarning and fire every 1 ms instead.
HUGE_TTL_OUT=$(MEMORIA_HOME="$RENEW_HOME" MEMORIA_REPO_SYNC_LEASE_TTL_MS=10000000000 \
    "$CLI" repo sync conc --json 2>&1 >/dev/null)
assert_eq "no timer overflow with a huge test TTL" \
    "$(printf '%s' "$HUGE_TTL_OUT" | grep -c TimeoutOverflowWarning || true)" "0"

echo "[repo-edge] PASS"
