#!/usr/bin/env bash
# Regression test: schema migrations must upgrade a POPULATED pre-migration database
# in place — (re)applying DDL, backfilling derived data, and preserving existing rows.
#
# Every other test only ever inits a fresh empty DB, so the real upgrade path (an
# existing user DB gaining new migrations) was never exercised. Here we sync data,
# strip the artifacts of the most recent migrations (4 = recall_fts, 5 = recall
# telemetry query metrics), then let initDatabase re-run them and assert the result.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
export MEMORIA_HOME="$TMP_DIR"
DB="$TMP_DIR/.memory/sessions.db"
BSQ="$ROOT_DIR/node_modules/better-sqlite3"

echo "[migrations] init + sync (populate data, apply all migrations)"
"$ROOT_DIR/cli" init >/dev/null
"$ROOT_DIR/cli" sync "$ROOT_DIR/examples/session.sample.json" >/dev/null

echo "[migrations] downgrade to a pre-migration-4/5 state with data present"
node -e "
const D = require('$BSQ'); const db = new D('$DB');
const base = {
  sessions: db.prepare('SELECT count(*) c FROM sessions').get().c,
  events: db.prepare('SELECT count(*) c FROM events').get().c,
  fts: db.prepare('SELECT count(*) c FROM recall_fts').get().c,
};
if (base.sessions < 1 || base.fts < 1) { console.error('  ✗ fixture not populated: ' + JSON.stringify(base)); process.exit(1); }
require('fs').writeFileSync('$TMP_DIR/base.json', JSON.stringify(base));
// migration 4 artifacts
db.exec('DROP TABLE IF EXISTS recall_fts');
for (const t of ['trg_recall_fts_sessions_ai','trg_recall_fts_sessions_au','trg_recall_fts_sessions_ad','trg_recall_fts_events_ai','trg_recall_fts_events_au','trg_recall_fts_events_ad']) db.exec('DROP TRIGGER IF EXISTS ' + t);
// migration 5 artifacts: recreate recall_telemetry without the new columns, keep a legacy row
db.exec('DROP TABLE IF EXISTS recall_telemetry');
db.exec('CREATE TABLE recall_telemetry (id TEXT PRIMARY KEY, route_mode TEXT, fallback_used INTEGER, hit_count INTEGER, latency_ms INTEGER, created_at DATETIME)');
db.prepare('INSERT INTO recall_telemetry VALUES (?,?,?,?,?,?)').run('rt_legacy','keyword',0,3,12,new Date().toISOString());
// migration 6 artifacts: the recreated recall_telemetry above already lacks the utility columns,
// so removing migration 6 lets initDatabase re-add utility_score/outcome_kind/observed_at.
db.prepare('DELETE FROM schema_migrations WHERE id IN (4,5,6)').run();
db.close();
console.log('  downgraded: dropped recall_fts + telemetry columns, removed migrations 4,5,6 (data kept)');
"

echo "[migrations] run verify (triggers initDatabase -> re-applies migrations with backfill)"
"$ROOT_DIR/cli" verify >/dev/null 2>&1 || true

echo "[migrations] assert the upgrade restored schema + backfill + data"
node -e "
const D = require('$BSQ'); const db = new D('$DB', { readonly: true });
const base = JSON.parse(require('fs').readFileSync('$TMP_DIR/base.json', 'utf8'));
const fail = (m) => { console.error('  ✗ ' + m); process.exit(1); };
const migs = db.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id);
if (!migs.includes(4) || !migs.includes(5) || !migs.includes(6)) fail('migrations 4/5/6 not re-applied: ' + migs);
const fts = db.prepare('SELECT count(*) c FROM recall_fts').get().c;
if (fts !== base.fts) fail('recall_fts not backfilled (' + fts + ' vs ' + base.fts + ')');
const cols = new Set(db.prepare('PRAGMA table_info(recall_telemetry)').all().map((c) => c.name));
for (const c of ['query_hash','token_count','top_confidence','utility_score','outcome_kind','observed_at']) if (!cols.has(c)) fail('telemetry missing column ' + c);
const legacy = db.prepare(\"SELECT hit_count FROM recall_telemetry WHERE id='rt_legacy'\").get();
if (!legacy || legacy.hit_count !== 3) fail('legacy telemetry row lost');
const s = db.prepare('SELECT count(*) c FROM sessions').get().c;
const e = db.prepare('SELECT count(*) c FROM events').get().c;
if (s !== base.sessions || e !== base.events) fail('session/event data changed (' + s + '/' + e + ')');
db.close();
console.log('  migrations 4,5 re-applied; recall_fts backfilled (' + fts + '); telemetry columns added; data intact');
"

echo "[migrations] idempotency: initDatabase again is a no-op"
"$ROOT_DIR/cli" verify >/dev/null 2>&1 || true
node -e "
const D = require('$BSQ'); const db = new D('$DB', { readonly: true });
const n = db.prepare('SELECT count(*) c FROM schema_migrations').get().c;
db.close();
if (n < 6) { console.error('  ✗ schema_migrations regressed: ' + n); process.exit(1); }
console.log('  idempotent (schema_migrations=' + n + ')');
"

echo "[migrations] ok"
