#!/usr/bin/env bash
# issue-1 Phase 4: summary pipeline (spec §29 "摘要" acceptance).
#
# Key contracts:
#   1. multiple commits group into ONE commit_range summary; range_fingerprint dedupes re-runs
#   2. trivial changes (lockfile-only) are filtered; important files (migrations) override size gates
#   3. merge → merge summary; release tag → release summary (first from root, next from prev tag)
#   4. summaries carry key_changes/decisions/limitations/risks and trace to base/head SHA
#   5. sensitive paths are excluded and secrets masked in pending-request context
#   6. agent write-back enriches the SAME row (no duplicate), validated via Zod

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
summaries_of_type() { db_get "SELECT COUNT(*) FROM git_summaries WHERE summary_type = '$1'"; }

echo "[repo-summary] fixture + register"
REPO="$TMP_DIR/proj"
git init -q -b main "$REPO"
mkdir -p "$REPO/src"
seq 1 30 > "$REPO/src/app.js"
git -C "$REPO" add . && git -C "$REPO" "${GIT_ID[@]}" commit -q -m "c1: bootstrap app"
"$CLI" repo add "$REPO" --json >/dev/null
REPO_ID=$("$CLI" repo list --json | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).data[0].repository.id)")

echo "[repo-summary] commit range: multiple commits → one summary; dedupe on re-sync"
seq 1 40 > "$REPO/src/service.js"
git -C "$REPO" add . && git -C "$REPO" "${GIT_ID[@]}" commit -q -m "c2: add booking service"
seq 1 25 > "$REPO/src/validator.js"
git -C "$REPO" add . && git -C "$REPO" "${GIT_ID[@]}" commit -q -m "c3: add conflict validator"
SYNC1=$("$CLI" repo sync "$REPO_ID" --json)
assert_eq "one range summary from two commits" "$(json_get "$SYNC1" "d.data.summaries_created")" "1"
assert_eq "type commit_range" "$(summaries_of_type commit_range)" "1"
assert_eq "range traces base/head" \
    "$(db_get "SELECT COUNT(*) FROM git_summary_ranges WHERE base_sha IS NOT NULL AND head_sha IS NOT NULL")" "1"
SYNC1B=$("$CLI" repo sync "$REPO_ID" --json)
assert_eq "re-sync creates nothing (fingerprint dedupe)" "$(json_get "$SYNC1B" "d.data.summaries_created")" "0"

echo "[repo-summary] trivial filter: lockfile-only change skipped"
printf 'lockfileVersion: 9\n%s\n' "$(seq 1 40)" > "$REPO/pnpm-lock.yaml"
git -C "$REPO" add . && git -C "$REPO" "${GIT_ID[@]}" commit -q -m "chore: lockfile bump"
SYNC2=$("$CLI" repo sync "$REPO_ID" --json)
assert_eq "lockfile-only commit not summarized" "$(json_get "$SYNC2" "d.data.summaries_created")" "0"
assert_eq "its event marked ignored" \
    "$(db_get "SELECT COUNT(*) FROM git_events WHERE event_type = 'commit_discovered' AND status = 'ignored'")" "1"

echo "[repo-summary] important-file exception: tiny migration change IS summarized"
mkdir -p "$REPO/migrations"
echo "ALTER TABLE bookings ADD COLUMN tz TEXT;" > "$REPO/migrations/0002_tz.sql"
git -C "$REPO" add . && git -C "$REPO" "${GIT_ID[@]}" commit -q -m "feat: add tz column migration"
SYNC3=$("$CLI" repo sync "$REPO_ID" --json)
assert_eq "1-line migration summarized" "$(json_get "$SYNC3" "d.data.summaries_created")" "1"

echo "[repo-summary] merge summary"
git -C "$REPO" switch -q -c feature/pricing
seq 1 30 > "$REPO/src/pricing.js"
git -C "$REPO" add . && git -C "$REPO" "${GIT_ID[@]}" commit -q -m "c5: pricing engine"
git -C "$REPO" switch -q main
git -C "$REPO" "${GIT_ID[@]}" merge -q --no-ff -m "Merge branch 'feature/pricing'" feature/pricing
SYNC4=$("$CLI" repo sync "$REPO_ID" --json)
assert_eq "merge produces merge summary" "$(json_get "$SYNC4" "d.data.summaries_created >= 1")" "true"
assert_eq "merge summary exists" "$(db_get "SELECT COUNT(*) FROM git_summaries WHERE summary_type = 'merge'")" "1"
assert_eq "merge source_ref recovered" \
    "$(db_get "SELECT source_ref FROM git_summary_ranges WHERE summary_type = 'merge'")" "feature/pricing"

echo "[repo-summary] release summaries: first from root, second from previous tag"
git -C "$REPO" "${GIT_ID[@]}" tag -a v1.0.0 -m "v1"
"$CLI" repo sync "$REPO_ID" --json >/dev/null
assert_eq "first release summary (root base)" \
    "$(db_get "SELECT COUNT(*) FROM git_summary_ranges WHERE summary_type = 'release' AND base_sha IS NULL")" "1"
seq 1 35 > "$REPO/src/notify.js"
git -C "$REPO" add . && git -C "$REPO" "${GIT_ID[@]}" commit -q -m "c6: notifications"
git -C "$REPO" "${GIT_ID[@]}" commit -q --allow-empty -m "c7: docs touch-up"
git -C "$REPO" "${GIT_ID[@]}" tag -a v1.1.0 -m "v1.1"
"$CLI" repo sync "$REPO_ID" --json >/dev/null
V1_SHA=$(git -C "$REPO" rev-parse 'v1.0.0^{commit}')
assert_eq "second release based on v1.0.0" \
    "$(db_get "SELECT base_sha FROM git_summary_ranges WHERE summary_type = 'release' AND tag_name = 'v1.1.0'")" "$V1_SHA"
assert_eq "non-release tag names would be ignored (2 releases total)" "$(summaries_of_type release)" "2"

echo "[repo-summary] secret filtering in pending-request context"
mkdir -p "$REPO/conf"
echo "SECRET_TOKEN=verysecretvalue12345" > "$REPO/.env"
{ echo "const apiKey = \"sk-live1234567890abcdefghij\""; seq 1 30; } > "$REPO/conf/client.js"
git -C "$REPO" add -f . && git -C "$REPO" "${GIT_ID[@]}" commit -q -m "c8: client config"
"$CLI" repo sync "$REPO_ID" --json >/dev/null
PENDING=$("$CLI" repo summarize "$REPO_ID" --pending --json)
assert_eq "pending requests exist" "$(json_get "$PENDING" "d.data.requests.length > 0")" "true"
node -e "
const d = JSON.parse(process.argv[1]);
const text = JSON.stringify(d);
if (text.includes('verysecretvalue12345')) { console.error('  ✗ .env secret leaked into context'); process.exit(1); }
if (text.includes('sk-live1234567890abcdefghij')) { console.error('  ✗ api key not masked in diff'); process.exit(1); }
const anyEnv = d.data.requests.some(r => r.context.changed_files.some(f => f.path === '.env'));
if (anyEnv) { console.error('  ✗ .env listed in changed files'); process.exit(1); }
console.log('  ✓ secrets excluded/masked in context');
" "$PENDING"

echo "[repo-summary] agent write-back enriches in place (no duplicate row)"
SUM_ID=$(json_get "$PENDING" "d.data.requests[0].summary_id")
TOTAL_BEFORE=$(db_get "SELECT COUNT(*) FROM git_summaries")
cat > "$TMP_DIR/payload.json" <<'EOF'
{
  "title": "完成預訂衝突驗證流程",
  "summary": "此範圍完成預訂建立流程的衝突判斷與資料庫防護。",
  "key_changes": ["新增預訂時段衝突檢查", "加入資料庫唯一約束"],
  "decisions": [{ "decision": "衝突判斷放置於 application service", "reason": "避免 controller 承擔業務規則" }],
  "known_limitations": ["尚未支援跨時區預訂"],
  "risks": ["高併發下仍需依賴資料庫約束"],
  "affected_domains": ["reservation"],
  "importance": 0.84,
  "confidence": 0.88,
  "generator_version": "test-agent/1"
}
EOF
SUBMIT=$("$CLI" repo summarize "$REPO_ID" --submit "$SUM_ID" --file "$TMP_DIR/payload.json" --json)
assert_eq "submit ok" "$(json_get "$SUBMIT" "d.ok")" "true"
assert_eq "generator flips to agent" "$(json_get "$SUBMIT" "d.data.summary.generator")" "agent"
assert_eq "status enriched" "$(json_get "$SUBMIT" "d.data.summary.status")" "enriched"
assert_eq "no duplicate summary row" "$(db_get "SELECT COUNT(*) FROM git_summaries")" "$TOTAL_BEFORE"
assert_eq "decision persisted" \
    "$(db_get "SELECT json_extract(decisions_json, '\$[0].decision') FROM git_summaries WHERE id = '$SUM_ID'")" \
    "衝突判斷放置於 application service"

echo "[repo-summary] invalid payload rejected by schema"
echo '{"title": "x"}' > "$TMP_DIR/bad.json"
if "$CLI" repo summarize "$REPO_ID" --submit "$SUM_ID" --file "$TMP_DIR/bad.json" --json >/dev/null 2>&1; then
    echo "  ✗ invalid payload accepted"; exit 1
fi
echo "  ✓ invalid payload rejected"

echo "[repo-summary] branch summary via CLI"
git -C "$REPO" switch -q -c feature/reports
seq 1 45 > "$REPO/src/reports.js"
git -C "$REPO" add . && git -C "$REPO" "${GIT_ID[@]}" commit -q -m "c9: reports module"
git -C "$REPO" switch -q main
BRANCH=$("$CLI" repo summarize "$REPO_ID" --branch feature/reports --json)
assert_eq "branch summary created" "$(json_get "$BRANCH" "d.data.created")" "1"
assert_eq "branch range source_ref" \
    "$(db_get "SELECT source_ref FROM git_summary_ranges WHERE summary_type = 'branch'")" "feature/reports"
BRANCH2=$("$CLI" repo summarize "$REPO_ID" --branch feature/reports --json)
assert_eq "branch summarize idempotent" "$(json_get "$BRANCH2" "d.data.created")" "0"

echo "[repo-summary] non-invasive"
STATUS_OUT="$(git -C "$REPO" status --porcelain)"
if [ -n "$STATUS_OUT" ]; then echo "  ✗ repo has unexpected changes:"; echo "$STATUS_OUT"; exit 1; fi
echo "  ✓ git status clean"

echo "[repo-summary] PASS"
