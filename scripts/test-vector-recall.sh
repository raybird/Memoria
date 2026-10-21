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
#   7. issue-18 AC-2: LIBSQL_URL unset -> doctor stays ok (an opt-in feature that is OFF is not unhealthy)
#   8. issue-18 AC-1: doctor reports vector coverage (embedded/expected/missing) + the ingest fix

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

# issue-11: `local` is the DEFAULT provider while its runtime is a devDependency, so the standard
# production install recipes install cleanly and then fail at the first query. The message has to
# name that cause — "run npm install" alone reads as a contradiction to someone who just ran it with
# --omit=dev and watched it succeed. Copied somewhere with no node_modules above it so the import
# genuinely fails, rather than mocking the failure.
echo "[vector] local provider names the cause when the embedder is absent (issue-11)"
ISO_DIR="$TMP_DIR/embed-isolated"
mkdir -p "$ISO_DIR"
cp "$HELPER_DIR/embed.mjs" "$HELPER_DIR/deps.mjs" "$ISO_DIR/"
ERR_OUT=$(cd "$ISO_DIR" && MEMORIA_EMBED_PROVIDER=local node --input-type=module -e "
const { embedTexts } = await import('./embed.mjs')
try { await embedTexts(['x'], 'query'); console.log('NO_ERROR') }
catch (e) { console.log(e.message) }
" 2>&1)
case "$ERR_OUT" in
    *"--omit=dev"*) ;;
    *) echo "  ✗ error message must name --omit=dev as the cause, got: $ERR_OUT"; exit 1 ;;
esac
case "$ERR_OUT" in
    *"NODE_ENV=production"*) ;;
    *) echo "  ✗ error message must name NODE_ENV=production, got: $ERR_OUT"; exit 1 ;;
esac
echo "  cause named, not just the cure"

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

echo "[vector] doctor reports the vector layer without punishing an install that opted out (issue-12)"
# The degradation matrix above is silent by design — every one of those routes still answers ok:true.
# doctor is the only place that says which of them the operator is actually in, so it gets the same
# three states asserted here.
DOC_OFF=$(env MEMORIA_HOME="$TMP_DIR/home" "$ROOT_DIR/cli" doctor --json)
node -e "
const d=JSON.parse(process.argv[1]);
const v=d.checks.find(c=>c.name==='vector recall');
if(!v) throw new Error('vector recall check missing');
if(!v.ok||!v.value.includes('not enabled')) throw new Error('opt-out must read as not enabled, got '+JSON.stringify(v));
if(d.checks.some(c=>c.name.startsWith('vector')&&!c.ok)) throw new Error('an opt-out install must not fail any vector check');
if(!d.ok) throw new Error('doctor overall ok must survive an unset LIBSQL_URL');
" "$DOC_OFF"
echo "  LIBSQL_URL unset -> not enabled, still healthy"

DOC_GONE=$(env MEMORIA_HOME="$TMP_DIR/home" LIBSQL_URL="file:$VECDB" \
  MEMORIA_VECTOR_RECALL_CMD="$TMP_DIR/does-not-exist.mjs" "$ROOT_DIR/cli" doctor --json)
node -e "
const d=JSON.parse(process.argv[1]);
const h=d.checks.find(c=>c.name==='vector helper');
if(!h) throw new Error('vector helper check missing');
if(h.ok) throw new Error('a helper path that does not exist must not report healthy');
if(!h.fix||!h.fix.includes('vector_unavailable')) throw new Error('fix must name the silent degradation');
const o=d.checks.find(c=>c.name==='vector helper (overridden)');
if(!o||!o.value.includes('does-not-exist.mjs')) throw new Error('override must be surfaced so the reader knows which helper was diagnosed');
if(d.ok) throw new Error('an enabled-but-broken vector layer must fail doctor');
" "$DOC_GONE"
echo "  enabled + missing helper -> fails, names the override"

# The people most likely to be missing the embedder are the ones running an override, and that is
# precisely the case the probe cannot judge. Skipping it is right; skipping it SILENTLY is not —
# an absent line reads as "nothing to report" rather than "not checked".
DOC_OVERRIDE=$(env MEMORIA_HOME="$TMP_DIR/home" LIBSQL_URL="file:$VECDB" \
  MEMORIA_VECTOR_RECALL_CMD="$ROOT_DIR/skills/memoria-vector/vector-recall.mjs" "$ROOT_DIR/cli" doctor --json)
node -e "
const d=JSON.parse(process.argv[1]);
const e=d.checks.find(c=>c.name==='vector embedder');
if(!e) throw new Error('a skipped embedder probe must still be reported, not omitted');
if(!e.ok) throw new Error('an unprobeable embedder must not be reported as broken');
if(!e.value.includes('not checked')) throw new Error('the line must say it was skipped, got '+e.value);
if(!d.ok) throw new Error('an overridden helper is not by itself an unhealthy install');
" "$DOC_OVERRIDE"
echo "  enabled + overridden helper -> embedder reported as skipped, not omitted"

DOC_OK=$(env MEMORIA_HOME="$TMP_DIR/home" LIBSQL_URL="file:$VECDB" MEMORIA_EMBED_PROVIDER=stub "$ROOT_DIR/cli" doctor --json)
node -e "
const d=JSON.parse(process.argv[1]);
const h=d.checks.find(c=>c.name==='vector helper');
if(!h||!h.ok||!h.value.endsWith('vector-recall.mjs')) throw new Error('shipped helper should resolve, got '+JSON.stringify(h));
if(d.checks.some(c=>c.name==='vector embedder')) throw new Error('stub provider needs no embedder check');
" "$DOC_OK"
echo "  enabled + stub provider -> helper resolves, embedder not applicable"

# issue-23: the embedder lives in the helper's node_modules inside the global package, so every
# `npm i -g` upgrade wipes it (and the model cache with it) — the fix has to say so, or nobody thinks
# to rerun it after an upgrade. A checkout may carry the full install, so assemble a layout whose
# helper has no node_modules rather than depend on how this machine installed it.
# doctor reports the realpath (macOS mktemp lands under /var -> /private/var), so compare against it.
ISO_PKG="$(cd "$TMP_DIR" && pwd -P)/pkg-no-embedder"
mkdir -p "$ISO_PKG/dist" "$ISO_PKG/skills/memoria-vector"
cp "$ROOT_DIR/dist/cli.mjs" "$ISO_PKG/dist/"
cp "$ROOT_DIR/package.json" "$ISO_PKG/"
ln -s "$ROOT_DIR/node_modules" "$ISO_PKG/node_modules"
cp "$HELPER_DIR"/*.mjs "$HELPER_DIR/package.json" "$HELPER_DIR/package-lock.json" "$ISO_PKG/skills/memoria-vector/"
# issue-25: the dependencies may now live in the user cache, so every doctor probe below pins
# XDG_CACHE_HOME to a temp dir — the maintainer's real ~/.cache must not decide a test outcome.
DOC_XDG="$(cd "$TMP_DIR" && pwd -P)/xdg-doctor"
doctor_iso() { env MEMORIA_HOME="$TMP_DIR/home" LIBSQL_URL="file:$VECDB" XDG_CACHE_HOME="$DOC_XDG" node "$ISO_PKG/dist/cli.mjs" doctor --json || true; }
ISO_HASH=$(node -e "process.stdout.write(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync(process.argv[1])).digest('hex').slice(0,16))" "$ISO_PKG/skills/memoria-vector/package-lock.json")
ISO_CACHE="$DOC_XDG/memoria/vector/$ISO_HASH"
DOC_NOEMB=$(doctor_iso)
node -e "
const d=JSON.parse(process.argv[1]);
const e=d.checks.find(c=>c.name==='vector embedder');
if(!e||e.ok) throw new Error('a helper without @huggingface/transformers must fail the embedder check, got '+JSON.stringify(e));
const f=e.fix||'';
for (const s of ['memoria setup --vector','npm i -g','vector_timeout','MEMORIA_EMBED_PROVIDER=stub',process.argv[2]])
  if(!f.includes(s)) throw new Error('embedder fix must mention '+JSON.stringify(s)+', got: '+f);
" "$DOC_NOEMB" "$ISO_CACHE"
# Doctor reads that directory from deps.mjs rather than hashing on its own, and ISO_CACHE was hashed
# independently above — the fix naming it is what pins "one implementation".
echo "  enabled + embedder missing (global-install shape) -> fix names setup --vector and \$XDG_CACHE_HOME/memoria/vector/<lock hash>"

echo "[vector] issue-25: doctor follows the helper's resolution order"
mkdir -p "$ISO_CACHE/node_modules/@huggingface/transformers"
DOC_INCOMPLETE=$(doctor_iso)
node -e "
const e=JSON.parse(process.argv[1]).checks.find(c=>c.name==='vector embedder');
if(!e||e.ok) throw new Error('a cache dir without .complete must not count as installed, got '+JSON.stringify(e));
" "$DOC_INCOMPLETE"
echo "  cache dir without .complete -> still failing"

touch "$ISO_CACHE/.complete"
DOC_CACHE=$(doctor_iso)
node -e "
const d=JSON.parse(process.argv[1]);
const e=d.checks.find(c=>c.name==='vector embedder');
if(!e||!e.ok) throw new Error('a completed cache install must pass, got '+JSON.stringify(e));
if(!e.value.includes(process.argv[2])) throw new Error('embedder value must name the cache dir it uses, got '+e.value);
" "$DOC_CACHE" "$ISO_CACHE"
echo "  completed cache install -> embedder ok, names the cache dir"

rm -rf "$ISO_CACHE/node_modules/@huggingface"
DOC_CACHE_NODEV=$(doctor_iso)
node -e "
const e=JSON.parse(process.argv[1]).checks.find(c=>c.name==='vector embedder');
if(!e||e.ok) throw new Error('a cache install without transformers must fail, got '+JSON.stringify(e));
if(!(e.fix||'').includes('memoria setup --vector')) throw new Error('fix must name setup --vector, got '+e.fix);
" "$DOC_CACHE_NODEV"
echo "  cache install without transformers -> failing, fix names setup --vector"

# Sibling node_modules wins even over a completed cache install — the downstream-image and
# developer-checkout shape — and keeps the pre-issue-25 judgement and remedy (SCN-004).
mkdir -p "$ISO_PKG/skills/memoria-vector/node_modules"
mkdir -p "$ISO_CACHE/node_modules/@huggingface/transformers"
DOC_SIB=$(doctor_iso)
node -e "
const d=JSON.parse(process.argv[1]);
const e=d.checks.find(c=>c.name==='vector embedder');
if(!e||e.ok) throw new Error('sibling node_modules without transformers must fail even with a cache install, got '+JSON.stringify(e));
if(e.value.includes('/memoria/vector/')) throw new Error('sibling must win over the cache, got '+e.value);
const f=e.fix||'';
for (const s of ['--omit=dev','NODE_ENV=production','npm i -g','vector-recall.mjs','vector_timeout','inside '+process.argv[2]])
  if(!f.includes(s)) throw new Error('sibling fix must mention '+JSON.stringify(s)+', got: '+f);
" "$DOC_SIB" "$ISO_PKG/skills/memoria-vector"
echo "  sibling node_modules wins over the cache; fix keeps the in-place npm install remedy"

# issue-25: a global `npm i -g` upgrade replaces the helper's directory, so its dependencies now live
# in the user cache under a hash of the helper's lockfile. Exercised on a helper copy with NO sibling
# node_modules (the shape of a fresh global install) and only @libsql/client in the cache, which is
# all the stub provider needs.
echo "[vector] issue-25: helper without sibling node_modules loads deps from the user cache"
ISO_HELPER="$TMP_DIR/helper-cache-deps"
XDG="$TMP_DIR/xdg"
mkdir -p "$ISO_HELPER"
cp "$HELPER_DIR"/*.mjs "$HELPER_DIR/package.json" "$HELPER_DIR/package-lock.json" "$ISO_HELPER/"
LOCK_HASH=$(node -e "process.stdout.write(require('node:crypto').createHash('sha256').update(require('node:fs').readFileSync(process.argv[1])).digest('hex').slice(0,16))" "$ISO_HELPER/package-lock.json")
CACHE_DEPS="$XDG/memoria/vector/$LOCK_HASH"
mkdir -p "$CACHE_DEPS"
cp "$HELPER_DIR/package.json" "$HELPER_DIR/package-lock.json" "$CACHE_DEPS/"
(cd "$CACHE_DEPS" && npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1) || { echo "  ✗ cache deps install failed"; exit 1; }
VEC25="$TMP_DIR/vectors-25.db"
run25() { env XDG_CACHE_HOME="$XDG" LIBSQL_URL="file:$VEC25" MEMORIA_EMBED_PROVIDER=stub "$@"; }

if run25 node "$ISO_HELPER/vector-ingest.mjs" "$TMP_DIR/payload.json" >/dev/null 2>&1; then
    echo "  ✗ an install without .complete must not be used (an interrupted setup --vector would look installed)"; exit 1
fi
echo "  cache dir without .complete -> not used"

touch "$CACHE_DEPS/.complete"
INGEST25=$(run25 node "$ISO_HELPER/vector-ingest.mjs" "$TMP_DIR/payload.json")
node -e "const d=JSON.parse(process.argv[1]); if(!d.ok||d.embedded!==3) throw new Error('ingest from cache deps failed: '+process.argv[1])" "$INGEST25"
REC25=$(echo '{"query":"quantum flux capacitor","topK":5}' | run25 node "$ISO_HELPER/vector-recall.mjs")
node -e "const d=JSON.parse(process.argv[1]); if(!d.hits.some(h=>h.name==='session:$SID_A')) throw new Error('recall from cache deps missing A: '+process.argv[1])" "$REC25"
echo "  ingest + recall resolve @libsql/client from \$XDG_CACHE_HOME/memoria/vector/<lock hash>"

# A newer helper whose lockfile differs must not load a cache built for another dependency set.
printf '\n' >> "$ISO_HELPER/package-lock.json"
if echo '{"query":"quantum flux capacitor"}' | run25 node "$ISO_HELPER/vector-recall.mjs" >/dev/null 2>&1; then
    echo "  ✗ a lockfile change must not reuse the cache built for the old one"; exit 1
fi
echo "  changed lockfile -> old cache dir ignored"

# Sibling node_modules wins and keeps today's behaviour, model cache location included (SCN-004).
node --input-type=module -e "
const { resolveDepsLocation } = await import(process.argv[1])
const loc = resolveDepsLocation(process.argv[2])
if (loc.source !== 'sibling') throw new Error('sibling node_modules must win, got '+JSON.stringify(loc))
if (loc.modelCacheDir !== null) throw new Error('sibling deps must keep transformers.js default model cache, got '+loc.modelCacheDir)
" "$HELPER_DIR/deps.mjs" "$HELPER_DIR"
echo "  sibling node_modules -> source=sibling, model cache untouched"
# deps.mjs prints its resolution only when run directly; importing it with an argv[1] that is not a
# real path (`node -e '…' foo`) must stay silent and must not throw out of every helper import.
DEPS_IMPORT=$(cd "$HELPER_DIR" && node --input-type=module -e "await import('./deps.mjs'); process.stdout.write('ok')" no-such-file)
[ "$DEPS_IMPORT" = "ok" ] || { echo "  ✗ importing deps.mjs with a bogus argv[1] must neither throw nor print, got: $DEPS_IMPORT"; exit 1; }
echo "  deps.mjs import with a non-path argv[1] -> silent, no throw"

# Review 1ffc3a2 S-4: the model cache location is set by embed.mjs, per source — exercised here with an
# offline stand-in for @huggingface/transformers that records the env.cacheDir it was handed.
FAKE_TF_PKG="$TMP_DIR/fake-tf-pkg"
mkdir -p "$FAKE_TF_PKG"
printf '{"name":"@huggingface/transformers","version":"0.0.0-fake","main":"index.cjs","exports":{".":{"import":"./index.mjs","require":"./index.cjs"}}}\n' > "$FAKE_TF_PKG/package.json"
cat > "$FAKE_TF_PKG/index.cjs" <<'EOF'
const fs = require('node:fs')
exports.env = {}
exports.pipeline = async () => {
  fs.writeFileSync(process.env.FAKE_TF_LOG, JSON.stringify({ cacheDir: exports.env.cacheDir ?? null }))
  return async (texts) => ({ dims: [texts.length, 384], data: new Float32Array(texts.length * 384) })
}
EOF
printf "import cjs from './index.cjs'\nexport const env = cjs.env\nexport const pipeline = cjs.pipeline\nexport default cjs\n" > "$FAKE_TF_PKG/index.mjs"
embed_once() { (cd "$1" && env XDG_CACHE_HOME="$2" FAKE_TF_LOG="$3" MEMORIA_EMBED_PROVIDER=local node --input-type=module -e "const { embedTexts } = await import('./embed.mjs'); await embedTexts(['x'], 'query')"); }

SIB_HELPER="$TMP_DIR/helper-sibling-fake"
mkdir -p "$SIB_HELPER/node_modules/@huggingface"
cp "$HELPER_DIR"/*.mjs "$HELPER_DIR/package.json" "$HELPER_DIR/package-lock.json" "$SIB_HELPER/"
cp -R "$FAKE_TF_PKG" "$SIB_HELPER/node_modules/@huggingface/transformers"
embed_once "$SIB_HELPER" "$TMP_DIR/xdg-sib" "$TMP_DIR/tf-sib.log"
node -e "const l=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); if(l.cacheDir!==null) throw new Error('sibling deps must leave env.cacheDir at the transformers.js default, got '+l.cacheDir)" "$TMP_DIR/tf-sib.log"
echo "  sibling deps -> embed.mjs leaves the model cache at transformers.js's default"

CACHE_HELPER="$TMP_DIR/helper-cache-fake"
mkdir -p "$CACHE_HELPER"
cp "$HELPER_DIR"/*.mjs "$HELPER_DIR/package.json" "$HELPER_DIR/package-lock.json" "$CACHE_HELPER/"
XDG_FAKE="$(cd "$TMP_DIR" && pwd -P)/xdg-fake-tf"
FAKE_CACHE="$XDG_FAKE/memoria/vector/$LOCK_HASH"
mkdir -p "$FAKE_CACHE/node_modules/@huggingface"
cp "$HELPER_DIR/package.json" "$FAKE_CACHE/"
cp -R "$FAKE_TF_PKG" "$FAKE_CACHE/node_modules/@huggingface/transformers"
touch "$FAKE_CACHE/.complete"
embed_once "$CACHE_HELPER" "$XDG_FAKE" "$TMP_DIR/tf-cache.log"
node -e "const l=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); if(l.cacheDir!==process.argv[2]) throw new Error('cache deps must put the model in '+process.argv[2]+', got '+l.cacheDir)" "$TMP_DIR/tf-cache.log" "$XDG_FAKE/memoria/vector/models"
echo "  cache deps -> embed.mjs points the model cache at \$XDG_CACHE_HOME/memoria/vector/models"

# Review 1ffc3a2 S-3: the sibling path must not newly depend on a resolvable home directory.
cat > "$TMP_DIR/no-home.mjs" <<'EOF'
import os from 'node:os'
import { syncBuiltinESMExports } from 'node:module'
os.homedir = () => { throw new Error('uv_os_homedir: no home') }
syncBuiltinESMExports()
EOF
NOHOME=$(env -u XDG_CACHE_HOME node --import "$TMP_DIR/no-home.mjs" --input-type=module -e "
const { resolveDepsLocation } = await import(process.argv[1]); process.stdout.write(resolveDepsLocation(process.argv[2]).source)
" "$HELPER_DIR/deps.mjs" "$SIB_HELPER")
[ "$NOHOME" = "sibling" ] || { echo "  ✗ sibling resolution must survive an unresolvable home directory, got: $NOHOME"; exit 1; }
echo "  sibling resolution -> independent of os.homedir()"

# Review 1ffc3a2 N-2: a relative XDG_CACHE_HOME is invalid per XDG and must be ignored.
REL=$(cd "$TMP_DIR" && env XDG_CACHE_HOME=relcache HOME="$TMP_DIR/fakehome" node "$CACHE_HELPER/deps.mjs")
node -e "const d=JSON.parse(process.argv[1]); if(!d.cacheDir.startsWith(process.argv[2]+'/.cache/memoria/vector/')) throw new Error('relative XDG_CACHE_HOME must fall back to ~/.cache, got '+d.cacheDir)" "$REL" "$TMP_DIR/fakehome"
echo "  relative XDG_CACHE_HOME -> ignored, falls back to ~/.cache"

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

echo "[vector] (AC-2/issue-18) 向量層未啟用時 doctor 不得變紅"
# 這是 characterization 守門:它現在就該是綠的,價值在「加了覆蓋率之後仍然綠」。
# issue-12 明文立過這條——讓沒開這個選用功能的人看到紅燈,會訓練所有人忽略 doctor。
DOC_OFF=$(env -u LIBSQL_URL MEMORIA_HOME="$TMP_DIR/home" "$ROOT_DIR/cli" doctor --json)
node -e "
const d=JSON.parse(process.argv[1]);
if(d.ok !== true) throw new Error('doctor 在未啟用向量層時變紅了: '+JSON.stringify(d.checks.filter(c=>!c.ok)));
const cov=d.checks.find(c=>/coverage|覆蓋/.test(c.name));
if(cov && cov.ok !== true) throw new Error('未啟用時覆蓋率檢查不得為 false: '+JSON.stringify(cov));
" "$DOC_OFF"
echo "  ok=true，未啟用不算不健康"

echo "[vector] (AC-1/issue-18) doctor 報出向量覆蓋率與補救指令"
# 此時 $VECDB 只 ingest 了少數實體,而 home 裡的 sessions/decisions/nodes 更多——天然的缺口。
DOC_ON=$(env LIBSQL_URL="file:$VECDB" MEMORIA_EMBED_PROVIDER=stub MEMORIA_HOME="$TMP_DIR/home" \
    "$ROOT_DIR/cli" doctor --json)
node -e "
const d=JSON.parse(process.argv[1]);
const cov=d.checks.find(c=>c.name==='vector coverage');
if(!cov) throw new Error('沒有 vector coverage 這一項: '+d.checks.map(c=>c.name).join(', '));
const m=/embedded=(\\d+).*expected=(\\d+).*missing=(\\d+)/.exec(cov.value);
if(!m) throw new Error('coverage 的 value 沒有三個數字: '+cov.value);
const [,e,x,ms]=m.map(Number);
if(x <= 0) throw new Error('expected 必須 > 0,實得 '+x);
if(e + ms !== x) throw new Error('embedded + missing 應等於 expected: '+cov.value);
if(ms > 0 && cov.ok !== false) throw new Error('missing>0 時應為 not ok');
if(ms > 0 && !/vector-ingest/.test(cov.fix||'')) throw new Error('fix 未指出 ingest 步驟: '+cov.fix);
" "$DOC_ON"
echo "  embedded/expected/missing 齊備，缺口時附上 ingest 指令"

# 設了 LIBSQL_URL 但從未 ingest——向量庫檔案根本不存在。那不是「量不到」,那是量到 0,
# 而且正是語意召回會安靜回空的那個狀態,必須亮紅燈並給出補救。
DOC_NEVER=$(env LIBSQL_URL="file:$TMP_DIR/never-ingested.db" MEMORIA_HOME="$TMP_DIR/home" \
    MEMORIA_EMBED_PROVIDER=stub "$ROOT_DIR/cli" doctor --json)
node -e "
const d=JSON.parse(process.argv[1]);
const cov=d.checks.find(c=>c.name==='vector coverage');
if(!cov) throw new Error('未 ingest 時仍須報出覆蓋率');
if(!/embedded=0 /.test(cov.value)) throw new Error('應為量到 0，而非 not measured: '+cov.value);
if(cov.ok !== false) throw new Error('從未 ingest 是紅燈狀態');
if(!/vector-ingest/.test(cov.fix||'')) throw new Error('未給出補救指令');
" "$DOC_NEVER"
echo "  從未 ingest -> 量到 0 並亮紅燈，非 not measured"

# override 時該向量庫可能根本不是我們的 ingest 在填的,量了也不代表什麼,而印出的補救指令
# 更可能不適用——跳過是對的,但要具名說「沒量」,不能靜默省略那一行。
DOC_OVR=$(env LIBSQL_URL="file:$VECDB" MEMORIA_HOME="$TMP_DIR/home" \
    MEMORIA_VECTOR_RECALL_CMD="$ROOT_DIR/skills/memoria-vector/vector-recall.mjs" \
    "$ROOT_DIR/cli" doctor --json)
node -e "
const d=JSON.parse(process.argv[1]);
const cov=d.checks.find(c=>c.name==='vector coverage');
if(!cov) throw new Error('override 時仍須報出這一行（具名跳過，不得省略）');
if(cov.ok !== true) throw new Error('無法量測不等於不健康');
if(!/not measured/.test(cov.value)) throw new Error('必須說明是沒量，而非量到 0: '+cov.value);
" "$DOC_OVR"
echo "  override -> 具名跳過，未誤報為不健康"

echo "[vector] (issue-27) doctor 的覆蓋率修法可原樣執行，執行後 missing=0"
# 修法原本是兩行說明：相對於套件根目錄的 skills/... 路徑加上 <home>、<payload.json> 佔位符，照著打跑不起來。
# 這裡把 "Run: " 之後的命令原樣交給 bash -c，工作目錄刻意不在 repo 裡。
fix_cmd() {
  node -e "
const cov=JSON.parse(process.argv[1]).checks.find(c=>c.name==='vector coverage');
const i=(cov&&cov.fix||'').lastIndexOf('Run: ');
if(cov.ok!==false||i<0) throw new Error('missing>0 時 fix 必須以 Run: <命令> 結尾: '+JSON.stringify(cov));
process.stdout.write(cov.fix.slice(i+5));
" "$1"
}
EXPORTS_BEFORE=$(find "$TMP_DIR/home" -path '*exports*' -type f 2>/dev/null | wc -l)
FIX_CMD=$(fix_cmd "$DOC_ON")
(cd "$TMP_DIR" && env LIBSQL_URL="file:$VECDB" MEMORIA_EMBED_PROVIDER=stub bash -c "$FIX_CMD") >/dev/null \
  || { echo "✗ doctor 的修法執行失敗: $FIX_CMD"; exit 1; }
DOC_FIXED=$(env LIBSQL_URL="file:$VECDB" MEMORIA_EMBED_PROVIDER=stub MEMORIA_HOME="$TMP_DIR/home" "$ROOT_DIR/cli" doctor --json)
node -e "
const cov=JSON.parse(process.argv[1]).checks.find(c=>c.name==='vector coverage');
if(!/missing=0\$/.test(cov.value)||cov.ok!==true) throw new Error('照修法執行後仍有缺口: '+cov.value);
" "$DOC_FIXED"
EXPORTS_AFTER=$(find "$TMP_DIR/home" -path '*exports*' -type f 2>/dev/null | wc -l)
[ "$EXPORTS_AFTER" -eq "$EXPORTS_BEFORE" ] || { echo "✗ 修法在資料根留下 payload 檔（$EXPORTS_BEFORE -> $EXPORTS_AFTER）"; exit 1; }
echo "  修法原樣執行後 missing=0，資料根沒有多出檔案"

# 失敗路徑：ingest 失敗時整串命令必須以非 0 結束，不能被最後的清理吞掉。
FIX_NEVER=$(fix_cmd "$DOC_NEVER")
FIX_RC=0
(cd "$TMP_DIR" && env LIBSQL_URL="file:$TMP_DIR/no-such-dir/x.db" MEMORIA_EMBED_PROVIDER=stub bash -c "$FIX_NEVER") >/dev/null 2>&1 || FIX_RC=$?
[ "$FIX_RC" -ne 0 ] || { echo "✗ ingest 失敗時修法仍以 0 結束: $FIX_NEVER"; exit 1; }
echo "  ingest 失敗時修法以非 0 結束（rc=$FIX_RC）"

echo "[vector] ok"
