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
// migration 7/8 artifacts: recreate memory_utility as the legacy 4-column shape (no explicit_*),
// with a row present, so the base DDL's CREATE IF NOT EXISTS is skipped and migration 8's ALTER is
// the path that re-adds explicit_observations/explicit_sum — and we assert the row survives it.
db.exec('DROP TABLE IF EXISTS memory_utility');
db.exec('CREATE TABLE memory_utility (ref_id TEXT PRIMARY KEY, observations INTEGER NOT NULL DEFAULT 0, utility_sum REAL NOT NULL DEFAULT 0, last_outcome_at DATETIME)');
db.prepare('INSERT INTO memory_utility (ref_id, observations, utility_sum, last_outcome_at) VALUES (?,?,?,?)').run('mu_legacy', 2, 1.4, new Date().toISOString());
db.prepare('DELETE FROM schema_migrations WHERE id IN (4,5,6,7,8)').run();
db.close();
console.log('  downgraded: dropped recall_fts + telemetry columns + explicit memory_utility cols, removed migrations 4,5,6,7,8 (data kept)');
"

echo "[migrations] run verify (triggers initDatabase -> re-applies migrations with backfill)"
"$ROOT_DIR/cli" verify >/dev/null 2>&1 || true

echo "[migrations] assert the upgrade restored schema + backfill + data"
node -e "
const D = require('$BSQ'); const db = new D('$DB', { readonly: true });
const base = JSON.parse(require('fs').readFileSync('$TMP_DIR/base.json', 'utf8'));
const fail = (m) => { console.error('  ✗ ' + m); process.exit(1); };
const migs = db.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id);
if (!migs.includes(4) || !migs.includes(5) || !migs.includes(6) || !migs.includes(7) || !migs.includes(8)) fail('migrations 4/5/6/7/8 not re-applied: ' + migs);
const fts = db.prepare('SELECT count(*) c FROM recall_fts').get().c;
if (fts !== base.fts) fail('recall_fts not backfilled (' + fts + ' vs ' + base.fts + ')');
const cols = new Set(db.prepare('PRAGMA table_info(recall_telemetry)').all().map((c) => c.name));
for (const c of ['query_hash','token_count','top_confidence','utility_score','outcome_kind','observed_at']) if (!cols.has(c)) fail('telemetry missing column ' + c);
const muCols = new Set(db.prepare('PRAGMA table_info(memory_utility)').all().map((c) => c.name));
for (const c of ['ref_id','observations','utility_sum','explicit_observations','explicit_sum','last_outcome_at']) if (!muCols.has(c)) fail('memory_utility missing column ' + c);
const muLegacy = db.prepare(\"SELECT observations, utility_sum, explicit_observations, explicit_sum FROM memory_utility WHERE ref_id='mu_legacy'\").get();
if (!muLegacy || muLegacy.observations !== 2 || muLegacy.explicit_observations !== 0) fail('memory_utility legacy row lost / explicit not backfilled to 0: ' + JSON.stringify(muLegacy));
const legacy = db.prepare(\"SELECT hit_count FROM recall_telemetry WHERE id='rt_legacy'\").get();
if (!legacy || legacy.hit_count !== 3) fail('legacy telemetry row lost');
const s = db.prepare('SELECT count(*) c FROM sessions').get().c;
const e = db.prepare('SELECT count(*) c FROM events').get().c;
if (s !== base.sessions || e !== base.events) fail('session/event data changed (' + s + '/' + e + ')');
db.close();
console.log('  migrations 4,5,6,7,8 re-applied; recall_fts backfilled (' + fts + '); telemetry + memory_utility (incl. explicit cols) restored; data intact');
"

echo "[migrations] idempotency: initDatabase again is a no-op"
"$ROOT_DIR/cli" verify >/dev/null 2>&1 || true
node -e "
const D = require('$BSQ'); const db = new D('$DB', { readonly: true });
const n = db.prepare('SELECT count(*) c FROM schema_migrations').get().c;
db.close();
if (n < 8) { console.error('  ✗ schema_migrations regressed: ' + n); process.exit(1); }
console.log('  idempotent (schema_migrations=' + n + ')');
"

echo "[migrations] recall_fts rebuild removes duplicates left by the old REPLACE path (issue-6)"
# Simulate a database polluted before the fix: duplicate every FTS row, then roll back migration 15
# so reopening the database re-applies it.
node -e "
const D = require('$BSQ'); const db = new D('$DB');
const rows = db.prepare('SELECT kind, ref_id, session_id, body FROM recall_fts').all();
if (rows.length === 0) { console.error('  ✗ fixture has no fts rows'); process.exit(1); }
const ins = db.prepare('INSERT INTO recall_fts(kind, ref_id, session_id, body) VALUES (?,?,?,?)');
for (const r of rows) ins.run(r.kind, r.ref_id, r.session_id, r.body);
db.prepare('DELETE FROM schema_migrations WHERE id = 15').run();
const dupes = db.prepare('SELECT count(*) c FROM (SELECT kind, ref_id FROM recall_fts GROUP BY kind, ref_id HAVING count(*) > 1)').get().c;
db.close();
if (dupes === 0) { console.error('  ✗ fixture did not create duplicates'); process.exit(1); }
console.log('  polluted fixture: ' + rows.length * 2 + ' rows, ' + dupes + ' duplicated refs');
"
"$ROOT_DIR/cli" verify >/dev/null 2>&1 || true
node -e "
const D = require('$BSQ'); const db = new D('$DB', { readonly: true });
const dupes = db.prepare('SELECT count(*) c FROM (SELECT kind, ref_id FROM recall_fts GROUP BY kind, ref_id HAVING count(*) > 1)').get().c;
const fts = db.prepare('SELECT count(*) c FROM recall_fts').get().c;
const src = db.prepare('SELECT count(*) c FROM sessions').get().c
          + db.prepare(\"SELECT count(*) c FROM events WHERE event_type IN ('DecisionMade','SkillLearned')\").get().c;
const applied = db.prepare('SELECT count(*) c FROM schema_migrations WHERE id = 15').get().c;
db.close();
if (applied !== 1) { console.error('  ✗ migration 15 was not re-applied'); process.exit(1); }
if (dupes !== 0) { console.error('  ✗ duplicates survived the rebuild: ' + dupes); process.exit(1); }
if (fts !== src) { console.error('  ✗ index out of sync with source: fts=' + fts + ' src=' + src); process.exit(1); }
console.log('  rebuilt: fts=' + fts + ' matches source rows, no duplicates');
"

echo "[migrations] verify reports a damaged DB instead of dying on it (issue-14)"
# A diagnostic that crashes on the thing it was asked to diagnose gives the operator one opaque line
# and no way to tell which part is broken. `initDatabase` runs migrations, so a damaged file threw
# straight out of runVerify before this was wrapped. Corrupt a throwaway copy hard enough that SQLite
# genuinely rejects it, then require that verify still ENUMERATES its checks.
CORRUPT_HOME="$TMP_DIR/corrupt"
mkdir -p "$CORRUPT_HOME"
MEMORIA_HOME="$CORRUPT_HOME" "$ROOT_DIR/cli" init >/dev/null 2>&1
MEMORIA_HOME="$CORRUPT_HOME" "$ROOT_DIR/cli" remember "會被弄壞的記憶" --project corrupt >/dev/null 2>&1
node -e "
const fs = require('node:fs')
const fd = fs.openSync('$CORRUPT_HOME/.memory/sessions.db', 'r+')
const size = fs.fstatSync(fd).size
for (let off = 4096 + 24; off < size; off += 4096) fs.writeSync(fd, Buffer.alloc(300, 0x5A), 0, 300, off)
fs.closeSync(fd)
"
set +e
CORRUPT_OUT=$(MEMORIA_HOME="$CORRUPT_HOME" "$ROOT_DIR/cli" verify --json 2>&1)
CORRUPT_CODE=$?
set -e
[ "$CORRUPT_CODE" = "1" ] || { echo "  ✗ expected exit 1 on a damaged DB, got $CORRUPT_CODE"; exit 1; }
node -e "
const d = JSON.parse(process.argv[1])
if (d.ok !== false) throw new Error('a damaged DB must not verify ok')
const byId = (id) => d.checks.filter((c) => c.id === id)
for (const id of ['db_migrate', 'db_connect', 'db_integrity']) {
  const found = byId(id)
  if (found.length === 0) throw new Error(id + ' missing — verify died before reporting it')
  if (found.length > 1) throw new Error(id + ' reported ' + found.length + ' times; health() resolves it with find() and would read the wrong one')
  if (found[0].status !== 'fail') throw new Error(id + ' should have failed on a damaged DB')
  if (!/malformed|corrupt|disk image/i.test(found[0].detail)) throw new Error(id + ' does not name the cause: ' + found[0].detail)
}
" "$CORRUPT_OUT"
echo "  enumerated its checks, each naming the actual cause, exit 1"

echo "[migrations] ok"
