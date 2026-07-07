#!/usr/bin/env bash
# UFL Phase 3 — utility-weighted recall ranking (docs/RFC-utility-feedback.md §10).
#
# Proves the behaviour end-to-end through the HTTP API:
#   (A) zero-data: recall ordering is stable / byte-identical when no outcomes exist;
#   (C) below the observation threshold (1 obs): ordering is UNCHANGED;
#   (B) at the threshold (2 low-utility obs on the top hit): its score is down-weighted
#       and it sinks below the other hit — the ranking flips.
# A third unrelated session makes the query terms rare enough for bm25 to give the two
# matching sessions distinct, non-zero scores (a shared-by-all term has IDF 0).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
PORT=$((20000 + RANDOM % 10000))
URL="http://localhost:${PORT}"
SERVER_PID=""
BSQ="$ROOT_DIR/node_modules/better-sqlite3"
DB="$TMP_DIR/home/.memory/sessions.db"

cleanup() { [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null || true; rm -rf "$TMP_DIR"; }
trap cleanup EXIT

echo "[ranking] start server"
MEMORIA_HOME="$TMP_DIR/home" MEMORIA_PORT="$PORT" "$ROOT_DIR/cli" setup --serve --json >"$TMP_DIR/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 30); do curl -sf "$URL/v1/health" >/dev/null 2>&1 && break; sleep 0.2; done
curl -sf "$URL/v1/health" >/dev/null || { echo "[ranking] server failed to start"; cat "$TMP_DIR/server.log"; exit 1; }

remember() { curl -sf -X POST "$URL/v1/remember" -H 'Content-Type: application/json' -d "$1" >/dev/null; }
remember '{"id":"sess_a","timestamp":"2026-07-01T00:00:00Z","project":"demo","summary":"quantum flux capacitor alpha","events":[]}'
remember '{"id":"sess_b","timestamp":"2026-06-01T00:00:00Z","project":"demo","summary":"quantum flux capacitor beta","events":[]}'
remember '{"id":"sess_c","timestamp":"2026-05-01T00:00:00Z","project":"demo","summary":"unrelated cooking pasta noodles","events":[]}'

# Print the recalled ids in ranked order, space-joined.
order() {
    curl -sf -X POST "$URL/v1/recall" -H 'Content-Type: application/json' -d '{"query":"quantum flux","mode":"keyword"}' \
        | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{console.log(JSON.parse(d).data.map(h=>h.id).join(" "))})'
}
rid() {
    curl -sf -X POST "$URL/v1/recall" -H 'Content-Type: application/json' -d '{"query":"quantum flux","mode":"keyword"}' \
        | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{console.log(JSON.parse(d).meta.recall_id)})'
}
low_outcome_on() { # $1 = hit id — one low-utility (0.0) observation attributed to that memory
    local r; r=$(rid)
    curl -sf -X POST "$URL/v1/recall/$r/outcome" -H 'Content-Type: application/json' \
        -d "{\"signal\":\"reuse\",\"utility_score\":0,\"hits\":[{\"id\":\"$1\",\"utility_score\":0}]}" >/dev/null
}

echo "[ranking] (A) zero-data baseline is stable"
BASE=$(order); BASE2=$(order)
[ -n "$BASE" ] || { echo "  ✗ empty recall"; exit 1; }
[ "$BASE" = "$BASE2" ] || { echo "  ✗ baseline not stable: '$BASE' vs '$BASE2'"; exit 1; }
TOP=${BASE%% *}
SECOND=$(echo "$BASE" | awk '{print $2}')
[ -n "$SECOND" ] || { echo "  ✗ need >=2 hits, got: '$BASE'"; exit 1; }
echo "  baseline order: $BASE (top=$TOP)"

echo "[ranking] (C) one observation (below threshold=2) must NOT change order"
low_outcome_on "$TOP"
AFTER1=$(order)
[ "$AFTER1" = "$BASE" ] || { echo "  ✗ order changed below threshold: '$AFTER1' vs '$BASE'"; exit 1; }
# Confirm exactly one observation landed.
node -e "const D=require('$BSQ');const db=new D('$DB',{readonly:true});const r=db.prepare('SELECT observations FROM memory_utility WHERE ref_id=?').get('$TOP');db.close();if(!r||r.observations!==1)throw new Error('expected 1 obs, got '+JSON.stringify(r))"
echo "  unchanged after 1 obs: $AFTER1"

echo "[ranking] (B) second low observation reaches threshold -> top hit sinks"
low_outcome_on "$TOP"
AFTER2=$(order)
[ "$AFTER2" != "$BASE" ] || { echo "  ✗ order did NOT flip after threshold reached: still '$AFTER2'"; exit 1; }
NEWTOP=${AFTER2%% *}
[ "$NEWTOP" = "$SECOND" ] || { echo "  ✗ expected '$SECOND' to rise to top, got '$NEWTOP' ($AFTER2)"; exit 1; }
echo "  flipped after 2 low obs: $AFTER2 (down-weighted '$TOP' sank)"

echo "[ranking] (D) a single EXPLICIT 'useful' overrides accumulated low reuse (Phase 3(a) high-fidelity)"
# $TOP now carries 2 low reuse obs (mean 0) -> down-weighted. One explicit useful should fully
# override the proxy (effective utility -> 1.0, factor -> 1.0) and restore it to the top.
R=$(rid)
curl -sf -X POST "$URL/v1/recall/$R/outcome" -H 'Content-Type: application/json' \
    -d "{\"signal\":\"explicit\",\"used\":true,\"hits\":[{\"id\":\"$TOP\",\"utility_score\":1}]}" >/dev/null
AFTER3=$(order)
[ "$AFTER3" = "$BASE" ] || { echo "  ✗ explicit useful did not override reuse: '$AFTER3' vs baseline '$BASE'"; exit 1; }
# Confirm explicit accrued in its own column, reuse untouched.
node -e "const D=require('$BSQ');const db=new D('$DB',{readonly:true});const r=db.prepare('SELECT observations, explicit_observations FROM memory_utility WHERE ref_id=?').get('$TOP');db.close();if(!r||r.explicit_observations!==1||r.observations!==2)throw new Error('explicit/reuse columns wrong: '+JSON.stringify(r))"
echo "  explicit overrode reuse; order restored: $AFTER3"

echo "[ranking] ok"
