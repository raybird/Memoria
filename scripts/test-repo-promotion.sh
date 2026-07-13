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
assert_eq "merge summary auto-promoted (§7.6 merge rule)" "$(json_get "$SYNC" "d.data.memories_promoted >= 1")" "true"

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

echo "[repo-promotion] release auto-promotion during sync"
git -C "$REPO" "${GIT_ID[@]}" tag -a v1.0.0 -m "v1"
SYNC2=$(curl -sf -X POST "$URL/v1/repos/$REPO_ID/sync" -H 'Content-Type: application/json' -d '{}')
assert_eq "release promoted in sync" "$(json_get "$SYNC2" "d.data.memories_promoted >= 1")" "true"
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

echo "[repo-promotion] invalid submit payload → 400"
BAD_CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$URL/v1/repos/$REPO_ID/summaries/$SUM_ID" \
    -H 'Content-Type: application/json' -d '{"title":"x"}')
assert_eq "schema violation → 400" "$BAD_CODE" "400"

echo "[repo-promotion] non-invasive"
STATUS_OUT="$(git -C "$REPO" status --porcelain)"
if [ -n "$STATUS_OUT" ]; then echo "  ✗ repo has unexpected changes"; echo "$STATUS_OUT"; exit 1; fi
echo "  ✓ git status clean"

echo "[repo-promotion] PASS"
