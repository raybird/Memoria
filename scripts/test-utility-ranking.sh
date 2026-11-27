#!/usr/bin/env bash
# UFL Phase 3 — utility-weighted recall ranking (docs/RFC-utility-feedback.md §10).
#
# Proves the behaviour end-to-end through the HTTP API:
#   (A) zero-data: recall ordering is stable / byte-identical when no outcomes exist;
#   (C) below the observation threshold (1 obs): ordering is UNCHANGED;
#   (B) at the threshold (2 low-utility obs on the top hit): its score is down-weighted
#       and it sinks below the other hit — the ranking flips.
#   (E) issue-40: a CLI note's utility counts whichever half was reported — the half recall keeps
#       is down-weighted by utility recorded on the other half.
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

echo "[ranking] (E/issue-40) 筆記的效用記在另一半時，recall 留下的那一半照樣被加權"
# remember 把一則筆記存成 note-<指紋> 與 noteev-<指紋>，issue-34 起 recall 只留其中一半。
# 效用記在沒留下的那一半時，以前完全不影響排序；合併後要乘上效用的係數（效用 0 為 0.5）。
H40="$TMP_DIR/home-40"
c40() { MEMORIA_HOME="$H40" "$ROOT_DIR/cli" "$@"; }
top40() { c40 recall "$1" --project demo40 --json | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8"));const h=d.data[0];console.log(d.meta.recall_id+" "+h.id+" "+h.score)'; }
other40() { case "$1" in noteev-*) echo "note-${1#noteev-}" ;; note-*) echo "noteev-${1#note-}" ;; esac; }
c40 init >/dev/null
c40 remember "資料庫備份改到每天凌晨三點執行" --project demo40 >/dev/null
c40 remember "前端建置改用 vite 取代 webpack" --project demo40 >/dev/null
read -r R0 KEPT S0 <<<"$(top40 "資料庫備份 凌晨")"
case "$KEPT" in note-*|noteev-*) ;; *) echo "  ✗ 前提：首筆應是 CLI 筆記，實得 $KEPT"; exit 1 ;; esac
OTHER=$(other40 "$KEPT")
c40 feedback "$R0" --score 0 --hits "$OTHER" >/dev/null
read -r _ KEPT1 S1 <<<"$(top40 "資料庫備份 凌晨")"
[ "$KEPT1" = "$KEPT" ] || { echo "  ✗ 前提：留下的那一半應不變（$KEPT → $KEPT1）"; exit 1; }
node -e 'const [s0,s1]=process.argv.slice(1).map(Number);if(!(s0>0)||Math.abs(s1/s0-0.5)>1e-6)throw new Error("留下的 "+process.argv[3]+" 分數應乘 0.5："+s0+" → "+s1)' "$S0" "$S1" "$KEPT" \
    || { echo "  ✗ AC-1：效用記在 $OTHER 時，留下的 $KEPT 沒有被加權"; exit 1; }
# 對稱的一側：效用記在留下的那一半（既有行為），結果與記在另一半相同。
read -r R2 KEPT2 S2 <<<"$(top40 "前端建置 vite")"
c40 feedback "$R2" --score 0 --hits "$KEPT2" >/dev/null
read -r _ _ S3 <<<"$(top40 "前端建置 vite")"
node -e 'const [s2,s3]=process.argv.slice(1).map(Number);if(!(s2>0)||Math.abs(s3/s2-0.5)>1e-6)throw new Error(s2+" → "+s3)' "$S2" "$S3" \
    || { echo "  ✗ AC-4：效用記在留下的那一半時應照舊乘 0.5"; exit 1; }
echo "  效用記在 $OTHER：留下的 $KEPT 分數 $S0 → $S1；記在留下的那一半時同樣乘 0.5"

echo "[ranking] ok"
