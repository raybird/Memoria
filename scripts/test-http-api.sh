#!/usr/bin/env bash
# HTTP contract coverage for endpoints not exercised by other tests:
#   GET /v1/sessions/:id/summary, POST/GET /v1/sources, POST /v1/wiki/build,
#   POST /v1/wiki/file-query, POST /v1/wiki/lint — plus their 400/404 error paths.
# Also covers the SDK read methods behind these routes (summarizeSession, listSources).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
PORT=$((20000 + RANDOM % 10000))
SERVER_URL="http://localhost:${PORT}"
SERVER_PID=""

cleanup() { [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$TMP_DIR"; }
trap cleanup EXIT

echo "[http] start server"
# MEMORIA_MAX_BODY_BYTES kept small so the 413 oversized-body case below stays cheap.
MEMORIA_HOME="$TMP_DIR/home" MEMORIA_PORT="$PORT" MEMORIA_MAX_BODY_BYTES=2048 "$ROOT_DIR/cli" setup --serve --json >"$TMP_DIR/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 30); do curl -sf "$SERVER_URL/v1/health" >/dev/null 2>&1 && break; sleep 0.2; done
curl -sf "$SERVER_URL/v1/health" >/dev/null || { echo "[http] server failed to start"; cat "$TMP_DIR/server.log"; exit 1; }

assert_ok() {
    node -e "const d=JSON.parse(process.argv[1]); if(!d||d.ok!==true){throw new Error('expected ok=true, got: '+process.argv[1])}" "$1"
}
assert_status() {
    local want="$1"; shift
    local code
    code=$(curl -s -o /dev/null -w '%{http_code}' "$@")
    [ "$code" = "$want" ] || { echo "  ✗ expected HTTP $want, got $code"; exit 1; }
}

echo "[http] POST /v1/remember -> capture session id"
REMEMBER=$(curl -sf -X POST "$SERVER_URL/v1/remember" -H 'Content-Type: application/json' \
    -d '{"project":"http","summary":"HTTP contract test session","events":[{"event_type":"DecisionMade","timestamp":"2026-06-01T00:00:00Z","content":{"decision":"cover HTTP endpoints with tests"}}]}')
assert_ok "$REMEMBER"
SID=$(node -e "process.stdout.write(String(JSON.parse(process.argv[1]).data.sessionId))" "$REMEMBER")
echo "  session_id=$SID"

echo "[http] GET /v1/sessions/:id/summary"
SUMMARY=$(curl -sf "$SERVER_URL/v1/sessions/$SID/summary")
node -e "const d=JSON.parse(process.argv[1]); if(!d.ok || d.data.sessionId!=='$SID' || !(d.data.eventCount>=1)){throw new Error('bad summary: '+process.argv[1])}" "$SUMMARY"
echo "  summary ok (eventCount>=1)"

echo "[http] GET /v1/sessions/:id/summary (unknown -> 404)"
assert_status 404 "$SERVER_URL/v1/sessions/does-not-exist-xyz/summary"
echo "  404 ok"

echo "[http] GET /v1/brief (issue-13)"
# The endpoint exists so a sidecar deployment can read the brief without shipping the CLI. Two
# properties carry that: the markdown must come from Memoria (a caller re-rendering BriefData would
# be a second renderer free to drift from the CLI's), and the server must NOT write BRIEF.md — in
# that deployment the knowledge dir belongs to the server container, not the agent asking for it.
# days spans the seeded event deliberately: the fixture's decision is dated well outside the 30-day
# default, so a content assertion on a plain GET would only be testing the window, not the endpoint.
BRIEF=$(curl -sf "$SERVER_URL/v1/brief?days=3650")
assert_ok "$BRIEF"
node -e "
const d=JSON.parse(process.argv[1]);
if(!Array.isArray(d.data.decisions)) throw new Error('structured brief missing decisions[]');
if(typeof d.data.markdown!=='string'||!d.data.markdown.includes('# Memoria Brief')) throw new Error('rendered markdown missing');
if(!d.data.markdown.includes('cover HTTP endpoints with tests')) throw new Error('brief did not pick up the seeded decision');
if(!d.data.decisions.some(x=>x.decision.includes('cover HTTP endpoints with tests'))) throw new Error('structured half disagrees with the markdown half');
if(typeof d.meta.latency_ms!=='number'||!Array.isArray(d.meta.evidence)) throw new Error('MemoriaResult envelope not preserved');
" "$BRIEF"
[ ! -e "$TMP_DIR/home/knowledge/BRIEF.md" ] || { echo "  ✗ GET must not write BRIEF.md"; exit 1; }
echo "  structured + markdown agree, nothing written"

echo "[http] GET /v1/brief?project= filters, bad params -> 400"
SCOPED=$(curl -sf "$SERVER_URL/v1/brief?project=http&days=30&top_k=5")
node -e "
const d=JSON.parse(process.argv[1]);
if(d.data.project!=='http') throw new Error('project filter not applied');
if(d.data.days!==30) throw new Error('days not applied');
" "$SCOPED"
assert_status 400 "$SERVER_URL/v1/brief?days=0"
assert_status 400 "$SERVER_URL/v1/brief?days=abc"
assert_status 400 "$SERVER_URL/v1/brief?top_k=-1"
echo "  filters applied, invalid days/top_k rejected"

echo "[http] POST /v1/sources"
SRCFILE="$TMP_DIR/note.md"
printf '# Research Note\n\nMemoria HTTP source ingest coverage.\n' > "$SRCFILE"
SRC=$(curl -sf -X POST "$SERVER_URL/v1/sources" -H 'Content-Type: application/json' -d "{\"filePath\":\"$SRCFILE\",\"title\":\"HTTP Note\"}")
assert_ok "$SRC"
echo "  source added"

echo "[http] POST /v1/sources (missing filePath -> 400)"
assert_status 400 -X POST "$SERVER_URL/v1/sources" -H 'Content-Type: application/json' -d '{}'
echo "  400 ok"

echo "[http] GET /v1/sources"
LIST=$(curl -sf "$SERVER_URL/v1/sources")
node -e "const d=JSON.parse(process.argv[1]); if(!d.ok || !Array.isArray(d.data) || d.data.length<1){throw new Error('expected >=1 source: '+process.argv[1])}" "$LIST"
echo "  list ok (>=1)"

echo "[http] POST /v1/wiki/build"
assert_ok "$(curl -sf -X POST "$SERVER_URL/v1/wiki/build")"
echo "  wiki build ok"

echo "[http] POST /v1/wiki/file-query"
assert_ok "$(curl -sf -X POST "$SERVER_URL/v1/wiki/file-query" -H 'Content-Type: application/json' -d '{"query":"HTTP endpoints","title":"HTTP Coverage Brief","kind":"synthesis"}')"
echo "  file-query ok"

echo "[http] POST /v1/wiki/file-query (missing query -> 400)"
assert_status 400 -X POST "$SERVER_URL/v1/wiki/file-query" -H 'Content-Type: application/json' -d '{"title":"x"}'
echo "  400 ok"

echo "[http] POST /v1/wiki/lint"
assert_ok "$(curl -sf -X POST "$SERVER_URL/v1/wiki/lint" -H 'Content-Type: application/json' -d '{}')"
echo "  wiki lint ok"

echo "[http] Zod boundary rejects malformed bodies with 400"
# wrong type on a required field (query as number) — old hand-validation only checked presence
assert_status 400 -X POST "$SERVER_URL/v1/recall" -H 'Content-Type: application/json' -d '{"query":123}'
# invalid enum value for recall mode
assert_status 400 -X POST "$SERVER_URL/v1/recall" -H 'Content-Type: application/json' -d '{"query":"x","mode":"bogus"}'
# wrong type on a nested field (events must be an array)
assert_status 400 -X POST "$SERVER_URL/v1/remember" -H 'Content-Type: application/json' -d '{"events":"not-an-array"}'
echo "  malformed bodies rejected (400)"

echo "[http] POST /v1/recall/:id/outcome writes utility back (UFL)"
RID=$(curl -sf -X POST "$SERVER_URL/v1/recall" -H 'Content-Type: application/json' -d '{"query":"HTTP contract test session","mode":"keyword"}' | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(0,'utf8')).meta.recall_id||''))")
[ -n "$RID" ] || { echo "  ✗ recall did not return a recall_id"; exit 1; }
OUT=$(curl -sf -X POST "$SERVER_URL/v1/recall/$RID/outcome" -H 'Content-Type: application/json' -d '{"signal":"reuse","utility_score":0.75}')
node -e "const d=JSON.parse(process.argv[1]); if(!d.ok||d.data.updated!==true) throw new Error('outcome not applied: '+process.argv[1])" "$OUT"
curl -sf "$SERVER_URL/v1/telemetry/recall?window=P7D&limit=50" | node -e "
const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
const row=d.data.rows.find(r=>r.id==='$RID');
if(!row) throw new Error('telemetry row missing for $RID');
if(row.utility_score!==0.75||row.outcome_kind!=='reuse'||!row.observed_at) throw new Error('utility not persisted: '+JSON.stringify(row));
"
echo "  outcome persisted (utility_score=0.75)"
echo "[http] telemetry exposes confidence×utility calibration (UFL Phase 2)"
curl -sf "$SERVER_URL/v1/telemetry/recall?window=P7D&limit=50" | node -e "
const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
const cal=d.data.calibration;
if(!cal) throw new Error('telemetry calibration missing after outcome write');
if(cal.scoredQueries<1) throw new Error('expected scoredQueries>=1, got '+cal.scoredQueries);
if(!Array.isArray(cal.buckets)||cal.buckets.length<1) throw new Error('expected at least one calibration bucket');
const b=cal.buckets[0];
if(typeof b.meanConfidence!=='number'||typeof b.meanUtility!=='number'||typeof b.count!=='number') throw new Error('bucket shape wrong: '+JSON.stringify(b));
"
echo "[http] stats exposes calibration under recallRouting"
curl -sf "$SERVER_URL/v1/stats" | node -e "
const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
const cal=d.data.recallRouting && d.data.recallRouting.calibration;
if(!cal||cal.scoredQueries<1) throw new Error('stats calibration missing/empty after outcome write');
"
echo "  calibration exposed (stats + telemetry)"
echo "[http] outcome hits[] accrue per-memory utility (UFL Phase 3)"
RID2=$(curl -sf -X POST "$SERVER_URL/v1/recall" -H 'Content-Type: application/json' -d '{"query":"HTTP contract test session","mode":"keyword"}' | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(0,'utf8')).meta.recall_id||''))")
[ -n "$RID2" ] || { echo "  ✗ no recall_id for phase-3 attribution"; exit 1; }
curl -sf -X POST "$SERVER_URL/v1/recall/$RID2/outcome" -H 'Content-Type: application/json' -d "{\"signal\":\"reuse\",\"utility_score\":0.4,\"hits\":[{\"id\":\"$SID\",\"utility_score\":0.4}]}" >/dev/null
node -e "
const D=require('$ROOT_DIR/node_modules/better-sqlite3'); const db=new D('$TMP_DIR/home/.memory/sessions.db',{readonly:true});
const row=db.prepare('SELECT observations, utility_sum FROM memory_utility WHERE ref_id = ?').get('$SID');
db.close();
if(!row||row.observations<1) throw new Error('memory_utility not accrued for $SID: '+JSON.stringify(row));
if(Math.abs(row.utility_sum-0.4)>1e-9) throw new Error('utility_sum wrong: '+JSON.stringify(row));
"
echo "  per-memory utility accrued (memory_utility ref=$SID)"
echo "[http] explicit signal is high-fidelity + kept separate from reuse (UFL Phase 3(a))"
RID3=$(curl -sf -X POST "$SERVER_URL/v1/recall" -H 'Content-Type: application/json' -d '{"query":"HTTP contract test session","mode":"keyword"}' | node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(0,'utf8')).meta.recall_id||''))")
OUT3=$(curl -sf -X POST "$SERVER_URL/v1/recall/$RID3/outcome" -H 'Content-Type: application/json' -d "{\"signal\":\"explicit\",\"used\":true,\"hits\":[{\"id\":\"$SID\",\"utility_score\":1}]}")
node -e "const d=JSON.parse(process.argv[1]); if(!d.ok||d.data.updated!==true) throw new Error('explicit outcome not applied: '+process.argv[1])" "$OUT3"
node -e "
const D=require('$ROOT_DIR/node_modules/better-sqlite3'); const db=new D('$TMP_DIR/home/.memory/sessions.db',{readonly:true});
const mu=db.prepare('SELECT observations, utility_sum, explicit_observations, explicit_sum FROM memory_utility WHERE ref_id = ?').get('$SID');
const tel=db.prepare('SELECT outcome_kind FROM recall_telemetry WHERE id = ?').get('$RID3');
db.close();
if(!mu||mu.explicit_observations!==1||Math.abs(mu.explicit_sum-1)>1e-9) throw new Error('explicit not accrued to its own columns: '+JSON.stringify(mu));
if(mu.observations!==1) throw new Error('explicit must NOT be mixed into reuse columns (observations should stay 1): '+JSON.stringify(mu));
if(!tel||tel.outcome_kind!=='explicit') throw new Error('telemetry outcome_kind should be explicit: '+JSON.stringify(tel));
"
echo "  explicit accrued separately (explicit_observations=1, reuse observations still 1)"
echo "[http] unknown recall id -> ok:true, updated:false (no-op)"
curl -sf -X POST "$SERVER_URL/v1/recall/rt_does_not_exist/outcome" -H 'Content-Type: application/json' -d '{"signal":"reuse","utility_score":0.5}' | node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!d.ok||d.data.updated!==false) throw new Error('expected no-op ok:true updated:false')"
echo "  no-op ok"
echo "[http] outcome missing required 'signal' -> 400"
assert_status 400 -X POST "$SERVER_URL/v1/recall/$RID/outcome" -H 'Content-Type: application/json' -d '{"utility_score":0.5}'
echo "  400 ok"

echo "[http] oversized body rejected with 413 (MAX_BODY_BYTES=2048)"
BIG=$(node -e "process.stdout.write('{\"query\":\"'+'x'.repeat(4096)+'\"}')")
assert_status 413 -X POST "$SERVER_URL/v1/recall" -H 'Content-Type: application/json' -d "$BIG"
echo "  413 ok"

echo "[http] health survives a write from another process (issue-14)"
# The regression this pins: better-sqlite3 caches connection-level state that a cross-process write
# should invalidate and does not, so the long-lived server handle begins reporting the FTS5 index as
# malformed for a database that is fine — permanently, until restart. Routine maintenance (one CLI
# write into the same home) was enough to make /v1/health claim corruption forever.
#
# It also guards the fix from being "optimised" away: runVerify's integrity check must keep opening
# its own connection and closing it. Pool that connection and this test goes red again, which is the
# only thing standing between a future reader and a very reasonable-looking performance tidy-up.
HEALTH_BEFORE=$(curl -sf "$SERVER_URL/v1/health")
assert_ok "$HEALTH_BEFORE"
MEMORIA_HOME="$TMP_DIR/home" "$ROOT_DIR/cli" remember "外部行程寫入，用來觸發 issue-14" --project http >/dev/null 2>&1
HEALTH_AFTER=$(curl -sf "$SERVER_URL/v1/health")
node -e "
const d = JSON.parse(process.argv[1])
const integrity = d.data.checks.find((c) => c.id === 'db_integrity')
if (!integrity) throw new Error('db_integrity check missing entirely')
if (integrity.status !== 'pass') {
  throw new Error('db_integrity turned to ' + integrity.status + ' after an external write: ' + integrity.detail)
}
if (!d.ok) throw new Error('health went unhealthy after an external write: ' + JSON.stringify(d.data.checks.filter(c => c.status !== 'pass')))
" "$HEALTH_AFTER"
echo "  db_integrity still passes after an external writer touched the same DB"

echo "[http] ok"
