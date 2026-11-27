#!/usr/bin/env bash
# issue-1 Phase 5: memory promotion + recall source attribution + HTTP /v1/repos/* contract
# (spec §29 "記憶整合" acceptance).
#
# Key contracts:
#   1. enriched high-value summaries promote into the EXISTING recall corpus (sessions/events)
#   2. recall surfaces promoted memories; hits carry {type, repository, base_sha, head_sha, summary_id}
#   3. the same summary never promotes twice (re-submit + re-sync stay idempotent)
#   4. release summaries auto-promote during sync; memory_checkpoints records the milestone
#   5. the whole flow works over HTTP (/v1/repos add→sync→pending→submit→recall)
#   6. a sync blocked by another process's live lease answers 409 repository_sync_busy (issue-33)
#   7. a write-back says which promotion outcome it got, with the error when promotion failed, and
#      sync retries every missed promotion, not only the latest 50 enriched summaries (issue-41)
#   8. re-submitting a promoted summary updates its recall memories: decisions are matched by text,
#      dropped ones are superseded (never deleted) and FTS, tree index and vector payload follow (issue-42)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$ROOT_DIR/cli"
TMP_DIR="$(mktemp -d)"
SERVER_PID=""
cleanup() { [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$TMP_DIR"; }
trap cleanup EXIT

export MEMORIA_HOME="$TMP_DIR/home"
DB_PATH="$MEMORIA_HOME/.memory/sessions.db"
GIT_ID=(-c user.name=memoria-test -c user.email=test@memoria.local)
PORT=$((22000 + RANDOM % 9000))
URL="http://localhost:$PORT"

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
db_run() { # $1 = SQL statement (write)
    (cd "$ROOT_DIR" && node -e "new (require('better-sqlite3'))(process.argv[2]).prepare(process.argv[1]).run()" "$1" "$DB_PATH")
}
assert_eq() {
    if [ "$2" != "$3" ]; then echo "  ✗ $1: expected '$3', got '$2'"; exit 1; fi
    echo "  ✓ $1"
}

echo "[repo-promotion] fixture repo"
REPO="$TMP_DIR/booking-api"
git init -q -b main "$REPO"
mkdir -p "$REPO/src"
seq 1 30 > "$REPO/src/app.js"
git -C "$REPO" add . && git -C "$REPO" "${GIT_ID[@]}" commit -q -m "c1: bootstrap"

echo "[repo-promotion] start HTTP server"
# MEMORIA_REPO_SYNC_WAIT_MS kept short so the issue-33 busy case below answers quickly.
env MEMORIA_PORT="$PORT" MEMORIA_REPO_SYNC_WAIT_MS=300 "$CLI" serve >"$TMP_DIR/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 40); do curl -sf "$URL/v1/health" >/dev/null 2>&1 && break; sleep 0.25; done
curl -sf "$URL/v1/health" >/dev/null || { echo "  ✗ server failed"; cat "$TMP_DIR/server.log"; exit 1; }
echo "  ✓ server up on :$PORT"

echo "[repo-promotion] HTTP: repo add + status"
ADD=$(curl -sf -X POST "$URL/v1/repos" -H 'Content-Type: application/json' -d "{\"path\":\"$REPO\",\"name\":\"booking-api\"}")
assert_eq "add via HTTP ok" "$(json_get "$ADD" "d.ok")" "true"
REPO_ID=$(json_get "$ADD" "d.data.repository.id")
STATUS=$(curl -sf "$URL/v1/repos/$REPO_ID/status")
assert_eq "status via HTTP" "$(json_get "$STATUS" "d.data.repository.name")" "booking-api"
NOTFOUND_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$URL/v1/repos/nope-nope/status")
assert_eq "unknown repo → 404" "$NOTFOUND_CODE" "404"

echo "[repo-promotion] HTTP: sync picks up work; pending; submit"
git -C "$REPO" switch -q -c feature/reservation
seq 1 40 > "$REPO/src/reservation.js"
git -C "$REPO" add . && git -C "$REPO" "${GIT_ID[@]}" commit -q -m "c2: reservation conflict check"
seq 1 25 > "$REPO/src/guard.js"
git -C "$REPO" add . && git -C "$REPO" "${GIT_ID[@]}" commit -q -m "c3: db uniqueness guard"
git -C "$REPO" switch -q main
git -C "$REPO" "${GIT_ID[@]}" merge -q --no-ff -m "Merge branch 'feature/reservation'" feature/reservation

SYNC=$(curl -sf -X POST "$URL/v1/repos/$REPO_ID/sync" -H 'Content-Type: application/json' -d '{}')
assert_eq "sync ok" "$(json_get "$SYNC" "d.ok")" "true"
assert_eq "summaries created" "$(json_get "$SYNC" "d.data.summaries_created >= 2")" "true"
# issue-2 Phase 2 (+R1): no pending skeleton is auto-promoted — not milestones, not high-importance
# ranges — otherwise the corpus gets a commit-subject list with empty decisions and confidence 0.4.
assert_eq "no skeleton auto-promoted (issue-2 Phase 2 + R1)" "$(json_get "$SYNC" "d.data.memories_promoted")" "0"
assert_eq "every skeleton is still pending" \
    "$(db_get "SELECT COUNT(*) FROM git_summaries WHERE status <> 'pending'")" "0"
assert_eq "high-importance skeleton not promoted either (R1)" \
    "$(db_get "SELECT COUNT(*) FROM memory_sources")" "0"
MERGE_ID=$(json_get "$(curl -sf "$URL/v1/repos/$REPO_ID/summaries/pending")" "d.data.requests.find(r => r.summary_type === 'merge').summary_id")
assert_eq "merge skeleton still pending" "$(test -n "$MERGE_ID" && echo yes)" "yes"
PENDING=$(curl -sf "$URL/v1/repos/$REPO_ID/summaries/pending")
SUM_ID=$(json_get "$PENDING" "d.data.requests.find(r => r.summary_type === 'commit_range').summary_id")
assert_eq "pending commit_range request found" "$(test -n "$SUM_ID" && echo yes)" "yes"
MERGE_SUBMIT=$(curl -sf -X POST "$URL/v1/repos/$REPO_ID/summaries/$MERGE_ID" -H 'Content-Type: application/json' -d '{
  "title": "合併預訂衝突驗證分支", "summary": "把 feature/reservation 併回 main。",
  "decisions": [{"decision": "以資料庫唯一約束為最終防線", "reason": "應用層檢查有 race window"}],
  "importance": 0.5, "confidence": 0.8
}')
assert_eq "merge promoted after enrichment" "$(json_get "$MERGE_SUBMIT" "d.data.promoted")" "true"
assert_eq "issue-41 AC-2: promotion outcome promoted" "$(json_get "$MERGE_SUBMIT" "d.data.promotion")" "promoted"
assert_eq "merge write-back dismisses the range it covers" "$(json_get "$MERGE_SUBMIT" "d.data.dismissed_covered")" "1"
assert_eq "covered range left pending" "$(db_get "SELECT status FROM git_summaries WHERE id = '$SUM_ID'")" "dismissed"

# Dismissed by coverage, not closed: an agent with more to say can still write the range back.
SUBMIT=$(curl -sf -X POST "$URL/v1/repos/$REPO_ID/summaries/$SUM_ID" -H 'Content-Type: application/json' -d '{
  "title": "完成預訂衝突驗證流程",
  "summary": "預訂建立流程的衝突判斷與資料庫唯一約束防護完成。",
  "key_changes": ["新增預訂時段衝突檢查", "加入資料庫唯一約束"],
  "decisions": [{ "decision": "衝突判斷放置於 application service", "reason": "避免 controller 承擔業務規則" }],
  "known_limitations": ["尚未支援跨時區預訂"],
  "risks": ["高併發下仍需依賴資料庫約束"],
  "affected_domains": ["reservation"],
  "importance": 0.84,
  "confidence": 0.88
}')
assert_eq "submit ok" "$(json_get "$SUBMIT" "d.ok")" "true"
assert_eq "auto-promoted on submit (importance ≥ threshold)" "$(json_get "$SUBMIT" "d.data.promoted")" "true"

echo "[repo-promotion] provenance rows"
assert_eq "memory_sources link summary" \
    "$(db_get "SELECT COUNT(*) FROM memory_sources WHERE source_id = '$SUM_ID'")" "2"
assert_eq "checkpoint recorded" \
    "$(db_get "SELECT COUNT(*) FROM memory_checkpoints WHERE checkpoint_type = 'commit_range_completed'")" "1"
assert_eq "promoted session exists" \
    "$(db_get "SELECT COUNT(*) FROM sessions WHERE id = 'gitsum-$SUM_ID'")" "1"
assert_eq "promoted decision event exists" \
    "$(db_get "SELECT COUNT(*) FROM events WHERE session_id = 'gitsum-$SUM_ID' AND event_type = 'DecisionMade'")" "1"

echo "[repo-promotion] recall surfaces promoted memory WITH git source"
RECALL=$(curl -sf -X POST "$URL/v1/recall" -H 'Content-Type: application/json' -d '{"query":"預訂衝突驗證"}')
assert_eq "recall ok" "$(json_get "$RECALL" "d.ok")" "true"
node -e "
const d = JSON.parse(process.argv[1]);
const hit = (d.data ?? []).find(h => h.source && h.source.summary_id === '$SUM_ID');
if (!hit) { console.error('  ✗ no hit carrying git source for the promoted summary'); console.error(JSON.stringify(d.data, null, 2)); process.exit(1); }
if (hit.source.type !== 'git_commit_range') { console.error('  ✗ wrong source.type: ' + hit.source.type); process.exit(1); }
if (hit.source.repository !== 'booking-api') { console.error('  ✗ wrong source.repository: ' + hit.source.repository); process.exit(1); }
if (!hit.source.head_sha) { console.error('  ✗ source.head_sha missing'); process.exit(1); }
console.log('  ✓ hit.source = {type: git_commit_range, repository: booking-api, head_sha: ' + hit.source.head_sha.slice(0,8) + '}');
" "$RECALL"

echo "[repo-promotion] idempotency: re-submit + re-sync never double-promote"
MS_BEFORE=$(db_get "SELECT COUNT(*) FROM memory_sources")
SESS_BEFORE=$(db_get "SELECT COUNT(*) FROM sessions")
RESUBMIT=$(curl -sf -X POST "$URL/v1/repos/$REPO_ID/summaries/$SUM_ID" -H 'Content-Type: application/json' -d '{
  "title": "完成預訂衝突驗證流程 v2", "summary": "更新後摘要。", "importance": 0.9, "confidence": 0.9
}')
assert_eq "re-submit ok (enrich in place)" "$(json_get "$RESUBMIT" "d.ok")" "true"
assert_eq "re-submit does not re-promote" "$(json_get "$RESUBMIT" "d.data.promoted")" "false"
# issue-42 AC-1: different text now updates recall; only an identical re-submit is already_promoted.
assert_eq "issue-42 AC-1: re-submit with new text says updated" "$(json_get "$RESUBMIT" "d.data.promotion")" "updated"
RESUBMIT_SAME=$(curl -sf -X POST "$URL/v1/repos/$REPO_ID/summaries/$SUM_ID" -H 'Content-Type: application/json' -d '{
  "title": "完成預訂衝突驗證流程 v2", "summary": "更新後摘要。", "importance": 0.9, "confidence": 0.9
}')
assert_eq "issue-41 AC-2: identical re-submit says already_promoted" "$(json_get "$RESUBMIT_SAME" "d.data.promotion")" "already_promoted"
curl -sf -X POST "$URL/v1/repos/$REPO_ID/sync" -H 'Content-Type: application/json' -d '{}' >/dev/null
assert_eq "memory_sources unchanged" "$(db_get "SELECT COUNT(*) FROM memory_sources")" "$MS_BEFORE"
assert_eq "sessions unchanged" "$(db_get "SELECT COUNT(*) FROM sessions")" "$SESS_BEFORE"

echo "[repo-promotion] release skeleton waits for enrichment (issue-2 Phase 2)"
git -C "$REPO" "${GIT_ID[@]}" tag -a v1.0.0 -m "v1"
SYNC2=$(curl -sf -X POST "$URL/v1/repos/$REPO_ID/sync" -H 'Content-Type: application/json' -d '{}')
assert_eq "release skeleton not promoted in sync" "$(json_get "$SYNC2" "d.data.memories_promoted")" "0"
assert_eq "no release checkpoint yet" \
    "$(db_get "SELECT COUNT(*) FROM memory_checkpoints WHERE checkpoint_type = 'release_created'")" "0"
REL_ID=$(json_get "$(curl -sf "$URL/v1/repos/$REPO_ID/summaries/pending")" "d.data.requests.find(r => r.summary_type === 'release').summary_id")
REL_SUBMIT=$(curl -sf -X POST "$URL/v1/repos/$REPO_ID/summaries/$REL_ID" -H 'Content-Type: application/json' -d '{
  "title": "Release v1.0.0", "summary": "首個正式版本。",
  "known_limitations": ["尚未支援跨時區預訂"], "importance": 0.6, "confidence": 0.8
}')
assert_eq "release promoted after enrichment" "$(json_get "$REL_SUBMIT" "d.data.promoted")" "true"
assert_eq "release checkpoint" \
    "$(db_get "SELECT COUNT(*) FROM memory_checkpoints WHERE checkpoint_type = 'release_created'")" "1"

echo "[repo-promotion] CLI --promote forces promotion"
git -C "$REPO" switch -q -c feature/reports
seq 1 45 > "$REPO/src/reports.js"
git -C "$REPO" add . && git -C "$REPO" "${GIT_ID[@]}" commit -q -m "c4: reports"
git -C "$REPO" switch -q main
BRANCH=$("$CLI" repo summarize "$REPO_ID" --branch feature/reports --promote --json)
assert_eq "branch summary force-promoted" "$(json_get "$BRANCH" "d.data.memories_promoted")" "1"
assert_eq "branch checkpoint" \
    "$(db_get "SELECT COUNT(*) FROM memory_checkpoints WHERE checkpoint_type = 'branch_progress'")" "1"

# issue-7: promotion must land in the tree index too. issue-1 specified that a promoted memory
# "automatically enters FTS and buildMemoryIndex's existing path", but only FTS is trigger-driven —
# without an explicit index build, `tree` recall cannot see git memories at all and the MCP bridge
# payload (scope derived from memory_nodes) silently skips them.
echo "[repo-promotion] promoted memories reach the tree index"
PROMOTED_SESSIONS=$(db_get "SELECT COUNT(*) FROM sessions WHERE id LIKE 'gitsum-%'")
INDEXED_SESSIONS=$(db_get "SELECT COUNT(DISTINCT session_id) FROM memory_node_sources WHERE session_id LIKE 'gitsum-%'")
assert_eq "every promoted session has a memory_node" "$INDEXED_SESSIONS" "$PROMOTED_SESSIONS"
[ "$PROMOTED_SESSIONS" -gt 0 ] || { echo "  ✗ fixture promoted nothing"; exit 1; }
TREE_HITS=$(curl -sf -X POST "$URL/v1/recall" -H 'Content-Type: application/json' \
    -d '{"query":"reports","mode":"tree"}' \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.data.length)})')
[ "$TREE_HITS" -gt 0 ] || { echo "  ✗ tree recall still cannot see promoted git memories"; exit 1; }
echo "  ✓ $INDEXED_SESSIONS/$PROMOTED_SESSIONS indexed, tree recall returns $TREE_HITS"

echo "[repo-promotion] stats reports index coverage"
COVERAGE=$(curl -sf "$URL/v1/stats" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const m=JSON.parse(d).data.memoryIndex;console.log(m.missing)})')
assert_eq "no missing sessions after promotion" "$COVERAGE" "0"

echo "[repo-promotion] invalid submit payload → 400"
BAD_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL/v1/repos/$REPO_ID/summaries/$SUM_ID" \
    -H 'Content-Type: application/json' -d '{"title":"x"}')
assert_eq "schema violation → 400" "$BAD_CODE" "400"

echo "[repo-promotion] dismissed merge is never promoted and leaves 待增強 (issue-21 SCN-005)"
git -C "$REPO" switch -q -c feature/teammate
seq 1 30 > "$REPO/src/teammate.js"
git -C "$REPO" add . && git -C "$REPO" "${GIT_ID[@]}" commit -q -m "c5: teammate work"
git -C "$REPO" switch -q main
git -C "$REPO" "${GIT_ID[@]}" merge -q --no-ff -m "Merge branch 'feature/teammate'" feature/teammate
curl -sf -X POST "$URL/v1/repos/$REPO_ID/sync" -H 'Content-Type: application/json' -d '{}' >/dev/null
TEAM_ID=$(db_get "SELECT s.id FROM git_summaries s JOIN git_summary_ranges r ON r.id = s.summary_range_id WHERE r.source_ref = 'feature/teammate'")
assert_eq "teammate merge skeleton exists" "$(test -n "$TEAM_ID" && echo yes)" "yes"
PENDING_BEFORE=$(db_get "SELECT COUNT(*) FROM git_summaries WHERE status = 'pending'")
"$CLI" repo summarize "$REPO_ID" --dismiss "$TEAM_ID" --json >/dev/null
curl -sf -X POST "$URL/v1/repos/$REPO_ID/sync" -H 'Content-Type: application/json' -d '{}' >/dev/null
assert_eq "re-sync keeps it dismissed" "$(db_get "SELECT status FROM git_summaries WHERE id = '$TEAM_ID'")" "dismissed"
assert_eq "dismissed merge not promoted" "$(db_get "SELECT COUNT(*) FROM memory_sources WHERE source_id = '$TEAM_ID'")" "0"
"$CLI" brief --project booking-api >/dev/null
BRIEF_LINE=$(grep -F -- "- **booking-api**" "$MEMORIA_HOME/knowledge/BRIEF.md")
assert_eq "brief 待增強 excludes the dismissed one" "$(echo "$BRIEF_LINE" | grep -o '待增強: [0-9]*')" "待增強: $((PENDING_BEFORE - 1))"
assert_eq "brief shows 已略過" "$(echo "$BRIEF_LINE" | grep -o '已略過: [0-9]*')" "已略過: 1"

echo "[repo-promotion] a dismissed summary can still be enriched (issue-21 SCN-006)"
TEAM_SUBMIT=$(curl -sf -X POST "$URL/v1/repos/$REPO_ID/summaries/$TEAM_ID" -H 'Content-Type: application/json' -d '{
  "title": "合併隊友分支", "summary": "改變主意，這筆值得記。",
  "decisions": [{"decision": "沿用既有預訂模組", "reason": "避免重複實作"}],
  "importance": 0.5, "confidence": 0.8
}')
assert_eq "re-submit flips dismissed → enriched" "$(json_get "$TEAM_SUBMIT" "d.data.summary.status")" "enriched"
assert_eq "and promotes under the normal rule" "$(json_get "$TEAM_SUBMIT" "d.data.promoted")" "true"

echo "[repo-promotion] HTTP dismiss endpoints (issue-21 SCN-007)"
git -C "$REPO" "${GIT_ID[@]}" tag -a v1.1.0 -m "v1.1"
curl -sf -X POST "$URL/v1/repos/$REPO_ID/sync" -H 'Content-Type: application/json' -d '{}' >/dev/null
REL2_ID=$(db_get "SELECT s.id FROM git_summaries s JOIN git_summary_ranges r ON r.id = s.summary_range_id WHERE r.tag_name = 'v1.1.0'")
ONE=$(curl -s -X POST "$URL/v1/repos/$REPO_ID/summaries/$REL2_ID/dismiss")
assert_eq "single dismiss envelope ok" "$(json_get "$ONE" "d.ok")" "true"
assert_eq "single dismiss returns dismissed summary" "$(json_get "$ONE" "d.data.summary.status")" "dismissed"
assert_eq "envelope carries evidence" "$(json_get "$ONE" "Array.isArray(d.meta.evidence) && d.meta.evidence[0] === '$REL2_ID'")" "true"
CONFLICT_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL/v1/repos/$REPO_ID/summaries/$TEAM_ID/dismiss")
assert_eq "dismissing an enriched summary → 409" "$CONFLICT_CODE" "409"
NOTYPES_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL/v1/repos/$REPO_ID/summaries/dismiss" -H 'Content-Type: application/json' -d '{}')
assert_eq "batch without types → 400" "$NOTYPES_CODE" "400"
BUSY_LEASE_SQL="INSERT INTO git_sync_leases (repository_id, token, holder_pid, holder_host, acquired_at, expires_at)
    VALUES ('$REPO_ID', 'http-busy', 999999, 'other-host', '2026-11-17T00:00:00.000Z', '2999-01-01T00:00:00.000Z')"
db_run "$BUSY_LEASE_SQL"
BUSY_BODY=$(curl -s -w '\n%{http_code}' -X POST "$URL/v1/repos/$REPO_ID/sync" -H 'Content-Type: application/json' -d '{}')
assert_eq "sync while another process holds the lease → 409 (issue-33)" "$(tail -n1 <<<"$BUSY_BODY")" "409"
assert_eq "409 body names repository_sync_busy" \
    "$(json_get "$(sed '$d' <<<"$BUSY_BODY")" "d.ok === false && d.error.startsWith('repository_sync_busy: ')")" "true"
db_run "DELETE FROM git_sync_leases WHERE token = 'http-busy'"
RANGES_LEFT=$(db_get "SELECT COUNT(*) FROM git_summaries WHERE status = 'pending' AND summary_type = 'commit_range'")
BATCH=$(curl -s -X POST "$URL/v1/repos/$REPO_ID/summaries/dismiss" -H 'Content-Type: application/json' -d '{"types":["commit_range"]}')
assert_eq "batch dismiss envelope ok" "$(json_get "$BATCH" "d.ok")" "true"
assert_eq "batch reports the count" "$(json_get "$BATCH" "d.data.dismissed")" "$RANGES_LEFT"

echo "[repo-promotion] a dismissed range brought back by sync --from/--to is not promoted (issue-21, review S-2)"
# With the threshold at 0 every commit_range clears the importance gate, so only the status check
# can keep this one out — the pre-issue-21 gate (`status === 'pending'`) let dismissed through.
mkdir -p "$MEMORIA_HOME/configs"
echo '{"git":{"summarization":{"promoteImportanceThreshold":0}}}' > "$MEMORIA_HOME/configs/config.json"
# `repo summarize --range` and `repo sync --from/--to` build the same explicit range, so the second
# hands sync the existing (dismissed) summary as a promotion candidate.
RANGE_BASE=$(git -C "$REPO" rev-parse HEAD)
seq 1 40 > "$REPO/src/audit.js"
git -C "$REPO" add . && git -C "$REPO" "${GIT_ID[@]}" commit -q -m "c6: audit trail"
RANGE_HEAD=$(git -C "$REPO" rev-parse HEAD)
RANGE_ID=$(json_get "$("$CLI" repo summarize "$REPO_ID" --range "$RANGE_BASE..$RANGE_HEAD" --json)" "d.data.summaries[0].id")
assert_eq "range skeleton exists" "$(test -n "$RANGE_ID" && echo yes)" "yes"
"$CLI" repo summarize "$REPO_ID" --dismiss "$RANGE_ID" --json >/dev/null
"$CLI" repo sync "$REPO_ID" --from "$RANGE_BASE" --to "$RANGE_HEAD" --json >/dev/null
assert_eq "explicit range returned the same summary" \
    "$(db_get "SELECT COUNT(*) FROM git_summary_ranges WHERE summary_type = 'commit_range' AND head_sha = '$RANGE_HEAD'")" "1"
assert_eq "dismissed range not promoted" "$(db_get "SELECT COUNT(*) FROM memory_sources WHERE source_id = '$RANGE_ID'")" "0"
rm "$MEMORIA_HOME/configs/config.json"

echo "[repo-promotion] issue-41: write-back reports the promotion outcome; sync retries every missed promotion"
# Explicit ranges, as in the section above: which skeletons a plain sync plans is not what this tests.
range_skeleton() { # $1 = file, $2 = commit subject -> prints the new commit_range summary id
    local base; base=$(git -C "$REPO" rev-parse HEAD)
    seq 1 7 > "$REPO/src/$1"
    git -C "$REPO" add . && git -C "$REPO" "${GIT_ID[@]}" commit -q -m "$2"
    json_get "$("$CLI" repo summarize "$REPO_ID" --range "$base..$(git -C "$REPO" rev-parse HEAD)" --json)" "d.data.summaries[0].id"
}
LOW_ID=$(range_skeleton low.js "c-low: tidy constants")
LOW=$(curl -sf -X POST "$URL/v1/repos/$REPO_ID/summaries/$LOW_ID" -H 'Content-Type: application/json' -d '{
  "title": "整理常數", "summary": "常數檔排版調整。", "importance": 0.3, "confidence": 0.8
}')
assert_eq "AC-2: low-importance commit_range is not_eligible" "$(json_get "$LOW" "d.data.promotion")" "not_eligible"
assert_eq "AC-2: not_eligible keeps promoted:false" "$(json_get "$LOW" "d.data.promoted")" "false"

FAIL_ID=$(range_skeleton fail.js "c-fail: cancellation window")
# Promotion writes memory_sources; this trigger makes exactly that write fail, nothing else.
db_run "CREATE TRIGGER t41_fail BEFORE INSERT ON memory_sources BEGIN SELECT RAISE(ABORT, 'injected promotion failure'); END"
FAILED=$(curl -sf -X POST "$URL/v1/repos/$REPO_ID/summaries/$FAIL_ID" -H 'Content-Type: application/json' -d '{
  "title": "取消時限檢查", "summary": "預訂取消加入時限檢查，逾時不可取消。", "importance": 0.85, "confidence": 0.8
}')
assert_eq "AC-1: write-back still ok" "$(json_get "$FAILED" "d.ok")" "true"
assert_eq "AC-1: summary stays enriched" "$(db_get "SELECT status FROM git_summaries WHERE id = '$FAIL_ID'")" "enriched"
assert_eq "AC-1: promotion outcome failed" "$(json_get "$FAILED" "d.data.promotion")" "failed"
assert_eq "AC-1: the error is carried" "$(json_get "$FAILED" "String(d.data.promotion_error).includes('injected promotion failure')")" "true"
printf '%s' '{"title":"取消時限檢查","summary":"預訂取消加入時限檢查，逾時不可取消。","importance":0.85,"confidence":0.8}' > "$TMP_DIR/fail.json"
CLI_OUT=$("$CLI" repo summarize booking-api --submit "$FAIL_ID" --file "$TMP_DIR/fail.json" 2>&1)
case "$CLI_OUT" in *"injected promotion failure"*) echo "  ✓ AC-1: CLI prints the promotion failure" ;; *) echo "  ✗ AC-1: CLI output lacks the failure: $CLI_OUT"; exit 1 ;; esac

# AC-1 for a merge, through the CLI's --json (review-91a8edc S1): the failure is reported and the
# commit-range skeleton the merge covers is still dismissed afterwards.
git -C "$REPO" switch -q -c feature/refund
M_BASE=$(git -C "$REPO" rev-parse main)
seq 1 6 > "$REPO/src/refund.js"
git -C "$REPO" add . && git -C "$REPO" "${GIT_ID[@]}" commit -q -m "c-refund: partial refunds"
M_RANGE=$(json_get "$("$CLI" repo summarize "$REPO_ID" --range "$M_BASE..$(git -C "$REPO" rev-parse HEAD)" --json)" "d.data.summaries[0].id")
git -C "$REPO" switch -q main
git -C "$REPO" "${GIT_ID[@]}" merge -q --no-ff -m "Merge branch 'feature/refund'" feature/refund
M_ID=$(json_get "$("$CLI" repo summarize "$REPO_ID" --merge "$(git -C "$REPO" rev-parse HEAD)" --json)" "d.data.summaries[0].id")
printf '%s' '{"title":"合併部分退款","summary":"把 feature/refund 併回 main。","importance":0.5,"confidence":0.8}' > "$TMP_DIR/merge.json"
MERGE_FAILED=$("$CLI" repo summarize booking-api --submit "$M_ID" --file "$TMP_DIR/merge.json" --json)
assert_eq "AC-1 merge: promotion outcome failed" "$(json_get "$MERGE_FAILED" "d.data.promotion")" "failed"
assert_eq "AC-1 merge: the error is carried" "$(json_get "$MERGE_FAILED" "String(d.data.promotion_error).includes('injected promotion failure')")" "true"
assert_eq "AC-1 merge: covered range still dismissed" "$(json_get "$MERGE_FAILED" "d.data.dismissed_covered")" "1"
assert_eq "AC-1 merge: the covered range is dismissed" "$(db_get "SELECT status FROM git_summaries WHERE id = '$M_RANGE'")" "dismissed"
assert_eq "AC-1 merge: no half-written promotion" "$(db_get "SELECT COUNT(*) FROM sessions WHERE id = 'gitsum-$M_ID'")" "0"

# A second failure, created after FAIL_ID, keeps failing during sync (review-91a8edc N3).
STUCK_ID=$(range_skeleton stuck.js "c-stuck: waitlist")
STUCK=$(curl -sf -X POST "$URL/v1/repos/$REPO_ID/summaries/$STUCK_ID" -H 'Content-Type: application/json' -d '{
  "title": "候補名單", "summary": "滿額時可登記候補。", "importance": 0.85, "confidence": 0.8
}')
assert_eq "N3 premise: the second write-back failed too" "$(json_get "$STUCK" "d.data.promotion")" "failed"
db_run "DROP TRIGGER t41_fail"
db_run "CREATE TRIGGER t41_stuck BEFORE INSERT ON memory_sources WHEN NEW.source_id = '$STUCK_ID' BEGIN SELECT RAISE(ABORT, 'injected stuck promotion'); END"
assert_eq "AC-1 premise: nothing promoted for the failed summary" "$(db_get "SELECT COUNT(*) FROM memory_sources WHERE source_id = '$FAIL_ID'")" "0"

# AC-3: 50 newer enriched summaries push the failed ones out of the latest 50. They are not promotable
# (low importance, nothing listed), so sync can only promote the summaries that failed. Newest first,
# STUCK_ID is tried before FAIL_ID, so FAIL_ID is promoted only if sync goes on past a failure.
FAIL_RANGE=$(db_get "SELECT summary_range_id FROM git_summaries WHERE id = '$FAIL_ID'")
(cd "$ROOT_DIR" && node -e "
const db = new (require('better-sqlite3'))(process.argv[1]);
const ins = db.prepare(\"INSERT INTO git_summaries (id, repository_id, summary_range_id, summary_type, title, summary, key_changes_json, decisions_json, known_limitations_json, risks_json, affected_domains_json, importance, confidence, generator, generator_version, prompt_version, status, created_at, updated_at) VALUES (?, ?, ?, 'commit_range', 'pad', 'pad', '[]', '[]', '[]', '[]', '[]', 0.1, 0.5, 'agent', 'test', ?, 'enriched', ?, ?)\");
const base = Date.now() + 60000;
for (let i = 0; i < 50; i++) { const t = new Date(base + i * 1000).toISOString(); ins.run('sum_pad41_' + i, process.argv[2], process.argv[3], 'pad-' + i, t, t); }
db.close();
" "$DB_PATH" "$REPO_ID" "$FAIL_RANGE")
MS_PAD=$(db_get "SELECT COUNT(*) FROM memory_sources")
SYNC41=$(curl -sf -X POST "$URL/v1/repos/$REPO_ID/sync" -H 'Content-Type: application/json' -d '{}')
assert_eq "AC-3: sync promotes the summary that failed, beyond the latest 50" "$(db_get "SELECT COUNT(*) FROM memory_sources WHERE source_id = '$FAIL_ID' AND memory_id = 'gitsum-$FAIL_ID'")" "1"
assert_eq "N3: the still-failing summary is not promoted" "$(db_get "SELECT COUNT(*) FROM memory_sources WHERE source_id = '$STUCK_ID'")" "0"
assert_eq "N3: sync warns about the failure, naming the summary" \
    "$(json_get "$SYNC41" "d.data.warnings.some(w => w.startsWith('memory_promotion_failed') && w.includes('$STUCK_ID') && w.includes('injected stuck promotion'))")" "true"
assert_eq "AC-3: the merge whose write-back failed is promoted too" "$(db_get "SELECT COUNT(*) FROM memory_sources WHERE source_id = '$M_ID' AND memory_id = 'gitsum-$M_ID'")" "1"
assert_eq "AC-3: nothing else promoted" "$(db_get "SELECT COUNT(*) FROM memory_sources WHERE source_id NOT IN ('$FAIL_ID', '$STUCK_ID', '$M_ID')")" "$MS_PAD"
assert_eq "AC-3: padding summaries not promoted" "$(db_get "SELECT COUNT(*) FROM memory_sources WHERE source_id LIKE 'sum_pad41_%'")" "0"
db_run "DROP TRIGGER t41_stuck"
curl -sf -X POST "$URL/v1/repos/$REPO_ID/sync" -H 'Content-Type: application/json' -d '{}' >/dev/null
assert_eq "N3: once the failure clears, the next sync promotes it" "$(db_get "SELECT COUNT(*) FROM memory_sources WHERE source_id = '$STUCK_ID' AND memory_id = 'gitsum-$STUCK_ID'")" "1"
MS_AFTER=$(db_get "SELECT COUNT(*) FROM memory_sources")
curl -sf -X POST "$URL/v1/repos/$REPO_ID/sync" -H 'Content-Type: application/json' -d '{}' >/dev/null
assert_eq "AC-3: a further sync promotes nothing twice" "$(db_get "SELECT COUNT(*) FROM memory_sources")" "$MS_AFTER"
db_run "DELETE FROM git_summaries WHERE id LIKE 'sum_pad41_%'"

echo "[repo-promotion] issue-42: re-submitting a promoted summary updates recall"
HELPER_DIR="$ROOT_DIR/skills/memoria-vector"
if [ ! -d "$HELPER_DIR/node_modules/@libsql/client" ]; then
    (cd "$HELPER_DIR" && npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1)
fi
[ -d "$HELPER_DIR/node_modules/@libsql/client" ] || { echo "  ✗ vector helper deps install failed"; exit 1; }
VEC42="$TMP_DIR/vectors-42.db"
ingest42() {
    local out="$TMP_DIR/bridge42"; rm -rf "$out"; mkdir -p "$out"
    node "$ROOT_DIR/skills/memoria-memory-sync/scripts/build-mcp-bridge-payload.mjs" --memoria-home "$MEMORIA_HOME" --sync-target t42 --out "$out" >/dev/null
    LIBSQL_URL="file:$VEC42" MEMORIA_EMBED_PROVIDER=stub node "$HELPER_DIR/vector-ingest.mjs" "$out"/*.json
}
vec_text42() { (cd "$HELPER_DIR" && LIBSQL_URL="file:$VEC42" node --input-type=module -e "
const { importDep } = await import('./deps.mjs')
const { createClient } = await importDep('@libsql/client')
const db = createClient({ url: process.env.LIBSQL_URL })
const r = await db.execute({ sql: 'SELECT text FROM memoria_vectors WHERE name = ?', args: [process.argv[1]] })
process.stdout.write(String(r.rows[0]?.text ?? ''))
db.close()
" "$1"); }
recall_ids() { json_get "$("$CLI" recall "$1" --project booking-api --top-k 20 --json)" "(d.data ?? []).map(h => h.id).join(',')"; }
has_id() { case ",$1," in *",$2,"*) echo yes ;; *) echo no ;; esac; }

git -C "$REPO" switch -q -c feature/notify
seq 1 9 > "$REPO/src/notify.js"
git -C "$REPO" add . && git -C "$REPO" "${GIT_ID[@]}" commit -q -m "c-notify: queue notifications"
git -C "$REPO" switch -q main
git -C "$REPO" "${GIT_ID[@]}" merge -q --no-ff -m "Merge branch 'feature/notify'" feature/notify
N_ID=$(json_get "$("$CLI" repo summarize "$REPO_ID" --merge "$(git -C "$REPO" rev-parse HEAD)" --json)" "d.data.summaries[0].id")
N_SESSION="gitsum-$N_ID"; A_ID="gitdec-$N_ID-0"; B_ID="gitdec-$N_ID-1"
cat > "$TMP_DIR/n1.json" <<'EOF'
{"title": "合併通知佇列", "summary": "通知改走佇列寄送 kumquatalpha。",
 "decisions": [{"decision": "通知寄送改走佇列 plumtoken", "reason": "避免請求逾時"},
               {"decision": "保留舊版 webhook 通道", "reason": "相容既有客戶"}],
 "importance": 0.6, "confidence": 0.8}
EOF
assert_eq "issue-42 premise: first write-back promotes" "$(json_get "$("$CLI" repo summarize booking-api --submit "$N_ID" --file "$TMP_DIR/n1.json" --json)" "d.data.promotion")" "promoted"
RID=$(json_get "$("$CLI" recall "通知寄送改走佇列 plumtoken webhook" --project booking-api --json)" "d.meta.recall_id")
"$CLI" feedback "$RID" --signal explicit --score 0.9 --used --hits "$A_ID,$B_ID" >/dev/null
"$CLI" mark "$A_ID" --durable >/dev/null
A_UTIL=$(db_get "SELECT observations || '/' || utility_sum FROM memory_utility WHERE ref_id = '$A_ID'")
B_UTIL=$(db_get "SELECT observations || '/' || utility_sum FROM memory_utility WHERE ref_id = '$B_ID'")
assert_eq "issue-42 premise: utility recorded on A and B" "$(test -n "$A_UTIL" && test -n "$B_UTIL" && echo yes)" "yes"
ingest42 >/dev/null
assert_eq "issue-42 premise: vector row holds the old text" "$(vec_text42 "session:$N_SESSION" | grep -c kumquatalpha)" "1"

# AC-1/AC-2: new text; A kept with a new reason, B dropped, C added.
cat > "$TMP_DIR/n2.json" <<'EOF'
{"title": "合併通知佇列", "summary": "通知改走佇列寄送 persimmonbeta。",
 "decisions": [{"decision": "通知寄送改走佇列 plumtoken", "reason": "避免請求逾時並可重試"},
               {"decision": "失敗通知寫入死信佇列", "reason": "方便追查"}],
 "importance": 0.6, "confidence": 0.8}
EOF
N2=$("$CLI" repo summarize booking-api --submit "$N_ID" --file "$TMP_DIR/n2.json" --json)
assert_eq "AC-1: re-submit says updated" "$(json_get "$N2" "d.data.promotion")" "updated"
assert_eq "AC-1: promoted stays false for an update" "$(json_get "$N2" "d.data.promoted")" "false"
assert_eq "AC-1: session text is the new summary" "$(db_get "SELECT instr(summary, 'persimmonbeta') > 0 AND instr(summary, 'kumquatalpha') = 0 FROM sessions WHERE id = '$N_SESSION'")" "1"
assert_eq "AC-1/AC-3: recall finds the new text" "$(has_id "$(recall_ids persimmonbeta)" "$N_SESSION")" "yes"
assert_eq "AC-1/AC-3: recall no longer finds the old text" "$(has_id "$(recall_ids kumquatalpha)" "$N_SESSION")" "no"
assert_eq "AC-2: A keeps its id and takes the new reason" "$(db_get "SELECT json_extract(content, '\$.rationale') FROM events WHERE id = '$A_ID'")" "避免請求逾時並可重試"
assert_eq "AC-2: A keeps its utility" "$(db_get "SELECT observations || '/' || utility_sum FROM memory_utility WHERE ref_id = '$A_ID'")" "$A_UTIL"
assert_eq "AC-2: A keeps its marker" "$(db_get "SELECT retention FROM memory_attributes WHERE ref_id = '$A_ID'")" "durable"
assert_eq "AC-2: B is superseded by the summary's session" "$(db_get "SELECT superseded_by FROM memory_attributes WHERE ref_id = '$B_ID'")" "$N_SESSION"
assert_eq "AC-2: B's row and utility are kept" "$(db_get "SELECT COUNT(*) FROM events WHERE id = '$B_ID'")/$(db_get "SELECT observations || '/' || utility_sum FROM memory_utility WHERE ref_id = '$B_ID'")" "1/$B_UTIL"
assert_eq "AC-2: B leaves recall" "$(has_id "$(recall_ids "保留舊版 webhook 通道")" "$B_ID")" "no"
assert_eq "AC-2: C takes the next unused sequence number" "$(db_get "SELECT json_extract(content, '\$.decision') FROM events WHERE id = 'gitdec-$N_ID-2'")" "失敗通知寫入死信佇列"
assert_eq "AC-2: C carries provenance" "$(db_get "SELECT COUNT(*) FROM memory_sources WHERE memory_id = 'gitdec-$N_ID-2' AND source_id = '$N_ID'")" "1"
"$CLI" brief --project booking-api >/dev/null
assert_eq "AC-2: brief drops B" "$(grep -c '保留舊版 webhook 通道' "$MEMORIA_HOME/knowledge/BRIEF.md" || true)" "0"
assert_eq "AC-2: brief shows C" "$(grep -c '失敗通知寫入死信佇列' "$MEMORIA_HOME/knowledge/BRIEF.md" || true)" "1"
assert_eq "AC-3: tree index node holds the new text" "$(db_get "SELECT instr(summary, 'persimmonbeta') > 0 AND instr(summary, 'kumquatalpha') = 0 FROM memory_nodes WHERE id = 'node:session:$N_SESSION'")" "1"
assert_eq "AC-3: no tree index gap" "$(json_get "$("$CLI" stats --json)" "d.data.memoryIndex.missing")" "0"
INGEST42=$(ingest42)
assert_eq "AC-3: vector ingest re-embeds the changed rows" "$(json_get "$INGEST42" "d.embedded > 0")" "true"
assert_eq "AC-3: vector row holds the new text" "$(vec_text42 "session:$N_SESSION" | grep -c persimmonbeta)" "1"
assert_eq "AC-3: vector decision row holds the new reason" "$(vec_text42 "decision:$A_ID" | grep -c '避免請求逾時並可重試')" "1"

# AC-2: bringing B back revives its original id.
cat > "$TMP_DIR/n3.json" <<'EOF'
{"title": "合併通知佇列", "summary": "通知改走佇列寄送 persimmonbeta。",
 "decisions": [{"decision": "通知寄送改走佇列 plumtoken", "reason": "避免請求逾時並可重試"},
               {"decision": "失敗通知寫入死信佇列", "reason": "方便追查"},
               {"decision": "保留舊版 webhook 通道", "reason": "相容既有客戶"}],
 "importance": 0.6, "confidence": 0.8}
EOF
assert_eq "AC-2: re-adding B is an update" "$(json_get "$("$CLI" repo summarize booking-api --submit "$N_ID" --file "$TMP_DIR/n3.json" --json)" "d.data.promotion")" "updated"
assert_eq "AC-2: B is no longer superseded" "$(db_get "SELECT COALESCE(superseded_by, '') FROM memory_attributes WHERE ref_id = '$B_ID'")" ""
assert_eq "AC-2: B is back in recall under its id" "$(has_id "$(recall_ids "保留舊版 webhook 通道")" "$B_ID")" "yes"
assert_eq "AC-2: no fourth decision was created" "$(db_get "SELECT COUNT(*) FROM events WHERE session_id = '$N_SESSION'")" "3"
assert_eq "AC-4: an identical re-submit changes nothing" "$(json_get "$("$CLI" repo summarize booking-api --submit "$N_ID" --file "$TMP_DIR/n3.json" --json)" "d.data.promotion")" "already_promoted"

# AC-3 (review-28ec168 MUST FIX 1): the first decision names the tree-index topic, so dropping it must
# take its text out of the tree index and the vector payload too, not only out of the session.
# Corrections recorded by hand (`remember --supersedes`) stay as they are, whether or not the payload
# still lists the decision (review-28ec168 NICE TO HAVE).
assert_eq "AC-3 premise: the topic is named after decision A" \
    "$(db_get "SELECT COUNT(*) FROM memory_nodes n JOIN memory_node_sources s ON s.node_id = n.id WHERE s.session_id = '$N_SESSION' AND instr(n.title || ' ' || n.summary, 'plumtoken') > 0")" "1"
C_ID="gitdec-$N_ID-2"
"$CLI" remember "更正：通知不走 webhook 通道" --project booking-api --supersedes "$B_ID" >/dev/null
"$CLI" remember "更正：死信改為重試表" --project booking-api --supersedes "$C_ID" >/dev/null
B_MARK=$(db_get "SELECT superseded_by FROM memory_attributes WHERE ref_id = '$B_ID'")
C_MARK=$(db_get "SELECT superseded_by FROM memory_attributes WHERE ref_id = '$C_ID'")
assert_eq "premise: B and C are superseded by notes" "$(case "$B_MARK/$C_MARK" in note-*/note-*) echo yes ;; *) echo "$B_MARK/$C_MARK" ;; esac)" "yes"
cat > "$TMP_DIR/n4.json" <<'EOF'
{"title": "合併通知佇列", "summary": "通知改走佇列寄送 persimmonbeta。",
 "decisions": [{"decision": "失敗通知寫入死信佇列", "reason": "方便追查"}],
 "importance": 0.6, "confidence": 0.8}
EOF
assert_eq "AC-2: dropping decision A is an update" "$(json_get "$("$CLI" repo summarize booking-api --submit "$N_ID" --file "$TMP_DIR/n4.json" --json)" "d.data.promotion")" "updated"
assert_eq "AC-2: A is superseded by the summary's session" "$(db_get "SELECT superseded_by FROM memory_attributes WHERE ref_id = '$A_ID'")" "$N_SESSION"
assert_eq "manual supersede on a dropped decision keeps its note" "$(db_get "SELECT superseded_by FROM memory_attributes WHERE ref_id = '$B_ID'")" "$B_MARK"
assert_eq "manual supersede on a listed decision stays" "$(db_get "SELECT superseded_by FROM memory_attributes WHERE ref_id = '$C_ID'")" "$C_MARK"
assert_eq "AC-3: no tree-index node of the session holds the dropped decision" \
    "$(db_get "SELECT COUNT(*) FROM memory_nodes n JOIN memory_node_sources s ON s.node_id = n.id WHERE s.session_id = '$N_SESSION' AND instr(n.title || ' ' || n.summary, 'plumtoken') > 0")" "0"
assert_eq "AC-3: tree recall no longer finds the session by the dropped decision" \
    "$(has_id "$(json_get "$("$CLI" recall plumtoken --mode tree --project booking-api --top-k 20 --json)" "(d.data ?? []).map(h => h.id).join(',')")" "$N_SESSION")" "no"
assert_eq "AC-3: no tree index gap after the rebuild" "$(json_get "$("$CLI" stats --json)" "d.data.memoryIndex.missing")" "0"
rm -rf "$TMP_DIR/bridge42n"; mkdir -p "$TMP_DIR/bridge42n"
node "$ROOT_DIR/skills/memoria-memory-sync/scripts/build-mcp-bridge-payload.mjs" --memoria-home "$MEMORIA_HOME" --sync-target t42n --out "$TMP_DIR/bridge42n" >/dev/null
assert_eq "AC-3: no memory-node entity in the vector payload holds the dropped decision" \
    "$(node -e "const p=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); process.stdout.write(String((p.entities ?? []).filter(e => e.type === 'memory_node' && (String(e.name) + ' ' + String(e.text)).includes('plumtoken')).length))" "$(ls "$TMP_DIR/bridge42n"/*.json)")" "0"

echo "[repo-promotion] non-invasive"
STATUS_OUT="$(git -C "$REPO" status --porcelain)"
if [ -n "$STATUS_OUT" ]; then echo "  ✗ repo has unexpected changes"; echo "$STATUS_OUT"; exit 1; fi
echo "  ✓ git status clean"

echo "[repo-promotion] PASS"
