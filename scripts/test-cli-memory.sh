#!/usr/bin/env bash
# issue-4 Phase 1 — CLI read/write/feedback path (docs/issues/issue-4).
#
# Proves the three new commands close the loop WITHOUT an HTTP server, which is the whole point:
# under skill-style deployment the agent only has bash.
#   (A) remember writes an atomic note that recall finds immediately (FTS trigger fired)
#   (B) re-running remember with identical text is idempotent — one session, and crucially
#       ONE recall_fts row per ref (a rewrite would leave a duplicate and double the hits)
#   (C) provenance is recorded as source_type='cli_note'
#   (D) feedback writes explicit utility back into memory_utility, kept apart from the reuse proxy
#   (E) an unknown recall_id is a graceful no-op, not an error

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
export MEMORIA_HOME="$TMP_DIR/home"
DB="$MEMORIA_HOME/.memory/sessions.db"
BSQ="$ROOT_DIR/node_modules/better-sqlite3"
CLI="$ROOT_DIR/cli"

cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

# Query the DB with a one-liner; $1 = SQL returning a single scalar column.
q() {
    node -e "
      const D=require('$BSQ');
      const db=new D('$DB',{readonly:true});
      const r=db.prepare(process.argv[1]).get();
      console.log(r ? Object.values(r)[0] : '');
    " "$1"
}
jq_field() { node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(eval("j"+process.argv[1]))})' "$1"; }

echo "[cli-memory] init"
"$CLI" init >/dev/null

echo "[cli-memory] (A) remember writes a note that recall finds"
"$CLI" remember "改用 pnpm 作為套件管理器" --project demo --rationale "lockfile 是權威" >/dev/null
"$CLI" remember "recall 排序改用 relevance 顯示" --type skill --project demo --category cli >/dev/null

HITS=$("$CLI" recall "pnpm 套件管理器" --project demo --json | jq_field '.data.length')
[ "$HITS" -ge 1 ] || { echo "  ✗ recall found nothing right after remember"; exit 1; }
echo "  recall hits: $HITS"

SKILL_HITS=$("$CLI" recall "relevance 顯示" --project demo --json | jq_field '.data.length')
[ "$SKILL_HITS" -ge 1 ] || { echo "  ✗ skill note not recallable"; exit 1; }

echo "[cli-memory] (B) identical remember is idempotent (session count AND fts rows)"
SESSIONS_BEFORE=$(q "SELECT COUNT(*) c FROM sessions")
"$CLI" remember "改用 pnpm 作為套件管理器" --project demo --rationale "lockfile 是權威" >/dev/null
SESSIONS_AFTER=$(q "SELECT COUNT(*) c FROM sessions")
[ "$SESSIONS_BEFORE" = "$SESSIONS_AFTER" ] || {
    echo "  ✗ session count changed on re-run: $SESSIONS_BEFORE -> $SESSIONS_AFTER"; exit 1; }

DUPES=$(q "SELECT COUNT(*) c FROM (SELECT kind, ref_id FROM recall_fts GROUP BY kind, ref_id HAVING COUNT(*) > 1)")
[ "$DUPES" = "0" ] || { echo "  ✗ duplicate recall_fts rows after re-run: $DUPES"; exit 1; }

HITS_AFTER=$("$CLI" recall "pnpm 套件管理器" --project demo --json | jq_field '.data.length')
[ "$HITS" = "$HITS_AFTER" ] || { echo "  ✗ hit count changed after idempotent re-run: $HITS -> $HITS_AFTER"; exit 1; }
echo "  sessions=$SESSIONS_AFTER, no duplicate fts rows, hits stable"

echo "[cli-memory] (C) provenance recorded as cli_note"
PROV=$(q "SELECT COUNT(*) c FROM memory_sources WHERE source_type='cli_note'")
[ "$PROV" -ge 2 ] || { echo "  ✗ expected >=2 cli_note provenance rows, got $PROV"; exit 1; }
echo "  provenance rows: $PROV"

echo "[cli-memory] (D) feedback writes explicit utility back"
RID=$("$CLI" recall "pnpm 套件管理器" --project demo --json | jq_field '.meta.recall_id')
[ -n "$RID" ] || { echo "  ✗ recall did not return a recall_id"; exit 1; }
HIT_IDS=$("$CLI" recall "pnpm 套件管理器" --project demo --json | jq_field '.data.map(h=>h.id).join(",")')
"$CLI" feedback "$RID" --signal explicit --score 0.9 --hits "$HIT_IDS" >/dev/null

EXPLICIT=$(q "SELECT COUNT(*) c FROM memory_utility WHERE explicit_observations > 0")
[ "$EXPLICIT" -ge 1 ] || { echo "  ✗ no explicit observation recorded"; exit 1; }
# RFC §2.4: explicit and reuse accumulate separately and are never summed.
REUSE_LEAK=$(q "SELECT COUNT(*) c FROM memory_utility WHERE explicit_observations > 0 AND observations > 0")
[ "$REUSE_LEAK" = "0" ] || { echo "  ✗ explicit signal leaked into the reuse accumulator"; exit 1; }
echo "  explicit rows: $EXPLICIT (reuse accumulator untouched)"

echo "[cli-memory] (E) unknown recall_id is a graceful no-op"
"$CLI" feedback rt_does_not_exist --score 0.5 >/dev/null || {
    echo "  ✗ unknown recall_id should exit 0"; exit 1; }
UPDATED=$("$CLI" feedback rt_does_not_exist --score 0.5 --json | jq_field '.data.updated')
[ "$UPDATED" = "false" ] || { echo "  ✗ expected updated=false, got '$UPDATED'"; exit 1; }

echo "[cli-memory] ✓ all checks passed"
