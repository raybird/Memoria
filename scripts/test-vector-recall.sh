#!/usr/bin/env bash
# Semantic recall (mode:'vector') contract coverage — docs/RFC-semantic-recall.md.
#
# Uses the deterministic 'stub' embedding provider so CI exercises the FULL plumbing
# (embed -> libSQL F32_BLOB upsert -> vector_top_k -> prefixed-id mapping -> local authoritative
# re-read -> RRF fusion -> degradation matrix) without downloading the real model. Real-model
# semantic quality was proven by the Phase 0' spike; run with MEMORIA_VECTOR_E2E_REAL=1 for an
# optional live-model assertion (downloads ~120MB on first use; not part of CI).
#
# Key contracts:
#   1. vector hits can surface memories the lexical route cannot (index text != local summary)
#   2. surfaced fields come from the LOCAL SQLite re-read, never the libSQL copy
#   3. unknown/stale index ids are dropped silently
#   4. LIBSQL_URL unset  -> route_mode=vector_unavailable, lexical floor still served, ok:true
#   5. helper timeout    -> route_mode=vector_timeout, lexical floor still served
#   6. stats gains vector route counters (and hides them at zero usage)

set -euo pipefail

# This script asserts the DEGRADATION matrix, so it must control every vector env var itself —
# an inherited one silently turns a "not configured" case into a configured one. A developer with
# semantic recall wired up in their shell profile has all four of these exported, and the
# "LIBSQL_URL unset -> vector_unavailable" case then reached their REAL vector store, returned ids
# that map to no local row, and fell through to route_mode=keyword. CI never sets them, so this
# only bites locally — same failure mode as the inherited MEMORIA_HOME fixed in v1.22.0.
# MEMORIA_VECTOR_E2E_REAL is deliberately NOT unset: it is the opt-in switch for the live-model
# assertion below, and the caller sets it on purpose.
unset LIBSQL_URL MEMORIA_EMBED_PROVIDER MEMORIA_VECTOR_RECALL_CMD MEMORIA_VECTOR_TIMEOUT_MS
unset MEMORIA_HOME MEMORIA_DB_PATH MEMORIA_SESSIONS_PATH MEMORIA_CONFIG_PATH

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HELPER_DIR="$ROOT_DIR/skills/memoria-vector"
TMP_DIR="$(mktemp -d)"
SERVER_PID=""

cleanup() { [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$TMP_DIR"; }
trap cleanup EXIT

# Light install: the stub path needs @libsql/client only. The local-provider model runtime
# (@huggingface/transformers, ~700MB) sits in devDependencies so a plain user `npm install` gets a
# working local provider, while CI omits it here.
echo "[vector] helper deps (--omit=dev: @libsql/client only)"
if [ ! -d "$HELPER_DIR/node_modules/@libsql/client" ]; then
    (cd "$HELPER_DIR" && npm install --omit=dev --no-audit --no-fund >/dev/null 2>&1)
fi
[ -d "$HELPER_DIR/node_modules/@libsql/client" ] || { echo "  ✗ helper deps install failed"; exit 1; }

start_server() { # $1=port, rest: env pairs
    local port="$1"; shift
    env MEMORIA_HOME="$TMP_DIR/home" MEMORIA_PORT="$port" "$@" "$ROOT_DIR/cli" setup --serve --json >"$TMP_DIR/server-$port.log" 2>&1 &
    SERVER_PID=$!
    for _ in $(seq 1 30); do curl -sf "http://localhost:$port/v1/health" >/dev/null 2>&1 && break; sleep 0.2; done
    curl -sf "http://localhost:$port/v1/health" >/dev/null || { echo "  ✗ server :$port failed"; cat "$TMP_DIR/server-$port.log"; exit 1; }
}
stop_server() { kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; SERVER_PID=""; }

PORT=$((21000 + RANDOM % 9000))
URL="http://localhost:$PORT"
VECDB="$TMP_DIR/vectors.db"

echo "[vector] seed memoria (2 sessions: lexical-visible + lexical-invisible)"
start_server "$PORT" LIBSQL_URL="file:$VECDB" MEMORIA_EMBED_PROVIDER=stub
SID_A=$(curl -sf -X POST "$URL/v1/remember" -H 'Content-Type: application/json' \
    -d '{"project":"vec","summary":"quantum flux capacitor calibration alpha","events":[]}' \
    | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).data.sessionId)")
SID_C=$(curl -sf -X POST "$URL/v1/remember" -H 'Content-Type: application/json' \
    -d '{"project":"vec","summary":"totally unrelated zebra housekeeping notes","events":[]}' \
    | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).data.sessionId)")
echo "  A=$SID_A (summary matches query) C=$SID_C (summary does NOT match query)"

echo "[vector] ingest vectors (C indexed under query-matching text; + unknown id; + skipped project entity)"
cat > "$TMP_DIR/payload.json" <<EOF
{"entities":[
  {"id":"session:$SID_A","type":"session","name":"$SID_A","text":"quantum flux capacitor calibration alpha"},
  {"id":"session:$SID_C","type":"session","name":"$SID_C","text":"quantum flux capacitor special variant"},
  {"id":"session:does-not-exist-xyz","type":"session","name":"ghost","text":"quantum flux capacitor ghost"},
  {"id":"project:vec","type":"project","name":"vec","text":"should be skipped"}
]}
EOF
INGEST=$(LIBSQL_URL="file:$VECDB" MEMORIA_EMBED_PROVIDER=stub node "$HELPER_DIR/vector-ingest.mjs" "$TMP_DIR/payload.json")
node -e "const d=JSON.parse(process.argv[1]); if(!d.ok||d.embedded!==3||d.skipped!==1) throw new Error('ingest counts wrong: '+process.argv[1])" "$INGEST"
echo "  embedded=3 skipped=1 ok"

echo "[vector] mode:'vector' fuses semantic + lexical; authoritative fields from local SQLite"
RES=$(curl -sf -X POST "$URL/v1/recall" -H 'Content-Type: application/json' -d '{"query":"quantum flux capacitor","mode":"vector"}')
node -e "
const d=JSON.parse(process.argv[1]);
if(!d.ok) throw new Error('recall failed: '+process.argv[1]);
if(d.meta.route_mode!=='hybrid_vector') throw new Error('expected hybrid_vector, got '+d.meta.route_mode);
if(d.meta.fallback_used!==false) throw new Error('fallback_used should be false');
if(!d.meta.recall_id) throw new Error('recall_id missing (UFL correlation)');
const ids=d.data.map(h=>h.id);
if(!ids.includes('$SID_A')) throw new Error('lexical hit A missing: '+ids);
if(!ids.includes('$SID_C')) throw new Error('vector-only hit C missing (semantic surface failed): '+ids);
if(ids.includes('does-not-exist-xyz')) throw new Error('stale index id must be dropped');
const c=d.data.find(h=>h.id==='$SID_C');
if(!c.snippet.includes('zebra')) throw new Error('C snippet must be the LOCAL summary (authoritative re-read), got: '+c.snippet);
" "$RES"
echo "  hybrid_vector ok: C surfaced beyond lexical, snippet re-read locally, ghost dropped"

# issue-9: `relevance` means LEXICAL match quality, so a hit only the vector index found must not
# carry one — and `confidence` must be null rather than 0 whenever the top hit is such a hit. The
# same response carries both kinds, which is why this asserts per-hit and envelope-level together.
echo "[vector] issue-9: semantic-only hits carry no lexical relevance; confidence names its basis"
node -e "
const d=JSON.parse(process.argv[1]);
const c=d.data.find(h=>h.id==='$SID_C');
if(c.relevance!==undefined) throw new Error('vector-only hit must have NO relevance, got '+c.relevance);
const a=d.data.find(h=>h.id==='$SID_A');
if(typeof a.relevance!=='number') throw new Error('lexical hit must keep its relevance, got '+a.relevance);
if(!['lexical_coverage','unavailable'].includes(d.meta.confidence_basis)) throw new Error('confidence_basis missing/unknown: '+d.meta.confidence_basis);
const topIsLexical = typeof d.data[0].relevance === 'number';
if(topIsLexical){
  if(d.meta.confidence_basis!=='lexical_coverage') throw new Error('lexical top hit must report lexical_coverage, got '+d.meta.confidence_basis);
  if(typeof d.meta.confidence!=='number') throw new Error('lexical top hit must report a numeric confidence, got '+d.meta.confidence);
} else {
  if(d.meta.confidence_basis!=='unavailable') throw new Error('semantic top hit must report unavailable, got '+d.meta.confidence_basis);
  if(d.meta.confidence!==null) throw new Error('semantic top hit must report confidence null, got '+d.meta.confidence);
}
" "$RES"
echo "  relevance absent on vector-only hit, confidence_basis matches the top hit's origin"

echo "[vector] issue-9: zero hits report confidence 0 with basis no_hits (measured, not unmeasurable)"
RES0=$(curl -sf -X POST "$URL/v1/recall" -H 'Content-Type: application/json' -d '{"query":"zzzznothingmatchesthisquery","mode":"keyword"}')
node -e "
const d=JSON.parse(process.argv[1]);
if(!d.ok) throw new Error('recall failed');
if(d.data.length!==0) throw new Error('expected zero hits, got '+d.data.length);
if(d.meta.confidence!==0) throw new Error('zero hits must report confidence 0, got '+d.meta.confidence);
if(d.meta.confidence_basis!=='no_hits') throw new Error('expected basis no_hits, got '+d.meta.confidence_basis);
" "$RES0"
echo "  no_hits ok"

echo "[vector] project filter is enforced on vector hits"
RES=$(curl -sf -X POST "$URL/v1/recall" -H 'Content-Type: application/json' -d '{"query":"quantum flux capacitor","mode":"vector","project":"other-project"}')
node -e "
const d=JSON.parse(process.argv[1]);
if(!d.ok) throw new Error('recall failed');
if(d.data.some(h=>h.project==='vec')) throw new Error('project filter leaked: '+JSON.stringify(d.data));
" "$RES"
echo "  filter ok"
stop_server

echo "[vector] degradation: LIBSQL_URL unset -> vector_unavailable + lexical floor"
PORT2=$((PORT+1)); URL2="http://localhost:$PORT2"
start_server "$PORT2" MEMORIA_EMBED_PROVIDER=stub
RES=$(curl -sf -X POST "$URL2/v1/recall" -H 'Content-Type: application/json' -d '{"query":"quantum flux capacitor","mode":"vector"}')
node -e "
const d=JSON.parse(process.argv[1]);
if(!d.ok) throw new Error('must stay ok:true');
if(d.meta.route_mode!=='vector_unavailable') throw new Error('expected vector_unavailable, got '+d.meta.route_mode);
if(d.meta.fallback_used!==true) throw new Error('fallback_used should be true');
if(!d.data.map(h=>h.id).includes('$SID_A')) throw new Error('lexical floor missing');
" "$RES"
echo "  vector_unavailable ok"
stop_server

echo "[vector] degradation: helper timeout -> vector_timeout + lexical floor"
cat > "$TMP_DIR/slow.mjs" <<'EOF'
await new Promise((r) => setTimeout(r, 60000))
EOF
PORT3=$((PORT+2)); URL3="http://localhost:$PORT3"
start_server "$PORT3" LIBSQL_URL="file:$VECDB" MEMORIA_EMBED_PROVIDER=stub MEMORIA_VECTOR_RECALL_CMD="$TMP_DIR/slow.mjs" MEMORIA_VECTOR_TIMEOUT_MS=300
RES=$(curl -sf -X POST "$URL3/v1/recall" -H 'Content-Type: application/json' -d '{"query":"quantum flux capacitor","mode":"vector"}')
node -e "
const d=JSON.parse(process.argv[1]);
if(!d.ok) throw new Error('must stay ok:true');
if(d.meta.route_mode!=='vector_timeout') throw new Error('expected vector_timeout, got '+d.meta.route_mode);
if(!d.data.map(h=>h.id).includes('$SID_A')) throw new Error('lexical floor missing');
" "$RES"
echo "  vector_timeout ok"

echo "[vector] stats exposes vector route counters"
STATS=$(env MEMORIA_HOME="$TMP_DIR/home" "$ROOT_DIR/cli" stats --json)
node -e "
const d=JSON.parse(process.argv[1]);
const rc=d.data.recallRouting.routeCounts;
for (const k of ['vector','hybrid_vector','vector_unavailable','vector_timeout']) if(typeof rc[k]!=='number') throw new Error('routeCounts missing '+k);
if(rc.hybrid_vector<1||rc.vector_unavailable<1||rc.vector_timeout<1) throw new Error('vector routes not counted: '+JSON.stringify(rc));
" "$STATS"
env MEMORIA_HOME="$TMP_DIR/home" "$ROOT_DIR/cli" stats | grep -q "vector_routes:" || { echo "  ✗ stats text missing vector_routes line"; exit 1; }
echo "  stats counters ok"
stop_server

if [ "${MEMORIA_VECTOR_E2E_REAL:-0}" = "1" ]; then
    echo "[vector] REAL model semantic assertion (lexically-disjoint query)"
    PORT4=$((PORT+3)); URL4="http://localhost:$PORT4"
    VECDB2="$TMP_DIR/vectors-real.db"
    start_server "$PORT4" LIBSQL_URL="file:$VECDB2" MEMORIA_EMBED_PROVIDER=local MEMORIA_VECTOR_TIMEOUT_MS=120000
    SID_R=$(curl -sf -X POST "$URL4/v1/remember" -H 'Content-Type: application/json' \
        -d '{"project":"vec","summary":"Q3 budget and revenue forecast","events":[]}' \
        | node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(0,'utf8')).data.sessionId)")
    cat > "$TMP_DIR/payload-real.json" <<EOF
{"entities":[{"id":"session:$SID_R","type":"session","name":"$SID_R","text":"Q3 budget and revenue forecast"}]}
EOF
    LIBSQL_URL="file:$VECDB2" MEMORIA_EMBED_PROVIDER=local node "$HELPER_DIR/vector-ingest.mjs" "$TMP_DIR/payload-real.json" >/dev/null
    RES=$(curl -sf -X POST "$URL4/v1/recall" -H 'Content-Type: application/json' -d '{"query":"money planning and financial projections","mode":"vector"}')
    node -e "
const d=JSON.parse(process.argv[1]);
if(!d.data.map(h=>h.id).includes('$SID_R')) throw new Error('semantic recall failed to surface lexically-disjoint memory: '+JSON.stringify(d.data));
if(!['vector','hybrid_vector'].includes(d.meta.route_mode)) throw new Error('unexpected route: '+d.meta.route_mode);
" "$RES"
    echo "  real-model semantic hit ok"
    stop_server
fi

echo "[vector] ok"
