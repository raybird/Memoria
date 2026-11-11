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
db.prepare('DELETE FROM schema_migrations WHERE id IN (4,5,6,7,8,16)').run();
db.close();
console.log('  downgraded: dropped recall_fts + telemetry columns + explicit memory_utility cols, removed migrations 4,5,6,7,8,16 (data kept)');
"

echo "[migrations] run verify (triggers initDatabase -> re-applies migrations with backfill)"
"$ROOT_DIR/cli" verify >/dev/null 2>&1 || true

echo "[migrations] assert the upgrade restored schema + backfill + data"
node -e "
const D = require('$BSQ'); const db = new D('$DB', { readonly: true });
const base = JSON.parse(require('fs').readFileSync('$TMP_DIR/base.json', 'utf8'));
const fail = (m) => { console.error('  ✗ ' + m); process.exit(1); };
const migs = db.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id);
if (![4, 5, 6, 7, 8, 16].every((id) => migs.includes(id))) fail('migrations 4/5/6/7/8/16 not re-applied: ' + migs);
const fts = db.prepare('SELECT count(*) c FROM recall_fts').get().c;
if (fts !== base.fts) fail('recall_fts not backfilled (' + fts + ' vs ' + base.fts + ')');
const cols = new Set(db.prepare('PRAGMA table_info(recall_telemetry)').all().map((c) => c.name));
for (const c of ['query_hash','token_count','top_confidence','utility_score','outcome_kind','observed_at','query_text']) if (!cols.has(c)) fail('telemetry missing column ' + c);
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

echo "[migrations] (issue-32 SCN-008) memory_attributes 升級到 migration 17，既有標記與其行為不變"
# 同一份資料做成兩個 home：一份降回 migration 17 之前的形狀再升級，另一份不動。兩份跑完全相同的
# 命令序列（recall 會寫命中紀錄，序列不同就會影響 prune 判定），輸出必須相同。
ATTR_HOME="$TMP_DIR/attrs"
ATTR_TWIN="$TMP_DIR/attrs-twin"
mkdir -p "$ATTR_HOME"
acli() { MEMORIA_HOME="$ATTR_HOME" "$ROOT_DIR/cli" "$@"; }
acli init >/dev/null
acli remember "停 server 一律用 PID 精準停" --project demo --durable >/dev/null
acli remember "內部部署主機的細節" --project demo --sensitivity private >/dev/null
OLD_REF=$(acli remember "資料庫用 MySQL" --project demo --json | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).data.sessionId')
acli remember "資料庫改用 SQLite" --project demo --supersedes "$OLD_REF" --supersede-note "單機部署" >/dev/null
acli remember "沒有任何標記的一般決策" --project demo >/dev/null
# 推到 stale 門檻之外、拿掉命中來源，讓 prune 的 durable 豁免有實際可比的結果（同 test-memory-attributes (B)）
node -e "
const D = require('$BSQ'); const db = new D('$ATTR_HOME/.memory/sessions.db');
db.exec(\"UPDATE sessions SET timestamp='2025-01-01T00:00:00.000Z'; UPDATE events SET timestamp='2025-01-01T00:00:00.000Z'; DELETE FROM memory_node_sources\");
db.close();
"
attr_rows() {
    node -e "
const D = require('$BSQ'); const db = new D(process.argv[1] + '/.memory/sessions.db', { readonly: true });
for (const r of db.prepare('SELECT ref_id, retention, sensitivity, superseded_by, note FROM memory_attributes ORDER BY ref_id').all()) console.log(JSON.stringify(r));
db.close();
" "$1"
}
attr_rows "$ATTR_HOME" > "$TMP_DIR/attr-rows-before.txt"
[ "$(wc -l < "$TMP_DIR/attr-rows-before.txt")" -ge 6 ] || { echo "  ✗ fixture 標記太少"; cat "$TMP_DIR/attr-rows-before.txt"; exit 1; }
cp -r "$ATTR_HOME" "$ATTR_TWIN"

# 降回 migration 17 之前：memory_attributes 回到 migration 14 的欄位，列原樣保留
node -e "
const D = require('$BSQ'); const db = new D('$ATTR_HOME/.memory/sessions.db');
db.exec(\`
  CREATE TABLE ma_keep AS SELECT ref_id, retention, sensitivity, superseded_by, note, created_at, updated_at FROM memory_attributes;
  DROP TABLE memory_attributes;
  CREATE TABLE memory_attributes (ref_id TEXT PRIMARY KEY, retention TEXT, sensitivity TEXT, superseded_by TEXT, note TEXT, created_at DATETIME, updated_at DATETIME);
  INSERT INTO memory_attributes SELECT * FROM ma_keep;
  DROP TABLE ma_keep;
  CREATE INDEX IF NOT EXISTS idx_memory_attributes_superseded ON memory_attributes(superseded_by);
  CREATE INDEX IF NOT EXISTS idx_memory_attributes_retention ON memory_attributes(retention);
\`);
db.prepare('DELETE FROM schema_migrations WHERE id = 17').run();
db.close();
"
acli verify >/dev/null 2>&1 || true

node -e "
const D = require('$BSQ'); const db = new D('$ATTR_HOME/.memory/sessions.db', { readonly: true });
const cols = db.prepare('PRAGMA table_info(memory_attributes)').all().map((c) => c.name);
const applied = db.prepare('SELECT count(*) c FROM schema_migrations WHERE id = 17').get().c;
db.close();
if (!cols.includes('verify_cmd')) { console.error('  ✗ 升級後 memory_attributes 沒有 verify_cmd 欄位: ' + cols); process.exit(1); }
if (applied !== 1) { console.error('  ✗ migration 17 沒有記錄'); process.exit(1); }
"
attr_rows "$ATTR_HOME" > "$TMP_DIR/attr-rows-after.txt"
diff -u "$TMP_DIR/attr-rows-before.txt" "$TMP_DIR/attr-rows-after.txt" || { echo "  ✗ 升級改動了既有標記列"; exit 1; }

attr_behaviour() {
    local home="$1"
    MEMORIA_HOME="$home" "$ROOT_DIR/cli" recall "資料庫 改用 停 server 部署 決策" --project demo --top-k 10 --json \
        | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).data.map((h)=>[h.id,h.retention??"",h.superseded_by??""].join("|")).join("\n")'
    MEMORIA_HOME="$home" "$ROOT_DIR/cli" recall "資料庫 改用 停 server 部署 決策" --project demo --top-k 10 --include-superseded --json \
        | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).data.map((h)=>[h.id,h.retention??"",h.superseded_by??""].join("|")).join("\n")'
    MEMORIA_HOME="$home" "$ROOT_DIR/cli" brief --project demo --stdout | sed -E 's/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z/<TS>/g'
    # dry-run 不會算豁免（removed 一律回 0），所以真的刪，再列出留下來的 session
    MEMORIA_HOME="$home" "$ROOT_DIR/cli" prune --stale-days 180
    node -e "
const D = require('$BSQ'); const db = new D(process.argv[1] + '/.memory/sessions.db', { readonly: true });
for (const r of db.prepare('SELECT summary FROM sessions ORDER BY summary').all()) console.log('survivor: ' + r.summary);
db.close();
" "$home"
}
attr_behaviour "$ATTR_HOME" > "$TMP_DIR/attr-upgraded.txt"
attr_behaviour "$ATTR_TWIN" > "$TMP_DIR/attr-twin.txt"
diff -u "$TMP_DIR/attr-twin.txt" "$TMP_DIR/attr-upgraded.txt" || { echo "  ✗ 升級後的 recall／brief／prune 與未降級的同一份資料不同"; exit 1; }
grep -q "常駐約束" "$TMP_DIR/attr-upgraded.txt" || { echo "  ✗ 升級後 durable 不在常駐約束區"; exit 1; }
grep -Eq "removed_sessions=[1-9]" "$TMP_DIR/attr-upgraded.txt" || { echo "  ✗ prune 對照沒有可比的刪除數，豁免比對無意義"; grep stale "$TMP_DIR/attr-upgraded.txt"; exit 1; }
grep -q "^survivor: 停 server 一律用 PID 精準停$" "$TMP_DIR/attr-upgraded.txt" || { echo "  ✗ 升級後 durable 沒有被 stale prune 豁免"; grep survivor "$TMP_DIR/attr-upgraded.txt"; exit 1; }
echo "  migration 17 已套用、標記列逐列相同，recall／brief 常駐約束／stale prune 與未降級的副本一致"

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
