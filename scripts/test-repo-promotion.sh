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
env MEMORIA_PORT="$PORT" "$CLI" serve >"$TMP_DIR/server.log" 2>&1 &
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
MERGE_SUBMIT=$(curl -sf -X POST "$URL/v1/repos/$REPO_ID/summaries/$MERGE_ID" -H 'Content-Type: application/json' -d '{
  "title": "合併預訂衝突驗證分支", "summary": "把 feature/reservation 併回 main。",
  "decisions": [{"decision": "以資料庫唯一約束為最終防線", "reason": "應用層檢查有 race window"}],
  "importance": 0.5, "confidence": 0.8
}')
assert_eq "merge promoted after enrichment" "$(json_get "$MERGE_SUBMIT" "d.data.promoted")" "true"

PENDING=$(curl -sf "$URL/v1/repos/$REPO_ID/summaries/pending")
SUM_ID=$(json_get "$PENDING" "d.data.requests.find(r => r.summary_type === 'commit_range').summary_id")
assert_eq "pending commit_range request found" "$(test -n "$SUM_ID" && echo yes)" "yes"

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

echo "[repo-promotion] non-invasive"
STATUS_OUT="$(git -C "$REPO" status --porcelain)"
if [ -n "$STATUS_OUT" ]; then echo "  ✗ repo has unexpected changes"; echo "$STATUS_OUT"; exit 1; fi
echo "  ✓ git status clean"

echo "[repo-promotion] PASS"
