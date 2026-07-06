#!/usr/bin/env bash
# Destructive prune path coverage. Every other test only walks prune's dry-run branch,
# so the actual DELETE paths (consolidate / stale / dedupe-skills) were never verified.
# Here we seed data straddling the age thresholds and assert BOTH that dry-run deletes
# nothing and that a real prune removes exactly the rows it should — and nothing else.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
BSQ="$ROOT_DIR/node_modules/better-sqlite3"

# fresh_home <name> -> prints the db path for an initialized, empty MEMORIA_HOME
fresh_home() {
    local home="$TMP_DIR/$1"
    MEMORIA_HOME="$home" "$ROOT_DIR/cli" init >/dev/null
    echo "$home/.memory/sessions.db"
}

# ── Scenario A: consolidate (--consolidate-days 90) ────────────────────────────
echo "[prune] consolidate: old topic collapses to newest child, fresh topic untouched"
DB="$(fresh_home consolidate)"
node -e "
const D = require('$BSQ'); const db = new D('$DB');
const OLD = new Date(Date.now() - 200*864e5).toISOString();
const NEW = new Date(Date.now() - 10*864e5).toISOString();
const node = (id, parent, level, ts) => db.prepare(
  'INSERT INTO memory_nodes (id,parent_id,project,scope,title,summary,level,path_key,created_at,updated_at,last_synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
).run(id, parent, 'proj', null, id, id+' summary', level, id, ts, ts, null);
node('P_old', null, 1, OLD);
for (const c of ['C1','C2','C3']) node(c, 'P_old', 2, OLD);
node('P_fresh', null, 1, NEW);
for (const c of ['F1','F2','F3']) node(c, 'P_fresh', 2, NEW);
db.close();
"
MEMORIA_HOME="$TMP_DIR/consolidate" "$ROOT_DIR/cli" prune --consolidate-days 90 --dry-run --json > "$TMP_DIR/a-dry.json"
MEMORIA_HOME="$TMP_DIR/consolidate" "$ROOT_DIR/cli" prune --consolidate-days 90 --json > "$TMP_DIR/a-real.json"
node -e "
const D = require('$BSQ'); const db = new D('$DB', { readonly: true });
const fail = (m) => { console.error('  ✗ ' + m); process.exit(1); };
const dry = JSON.parse(require('fs').readFileSync('$TMP_DIR/a-dry.json','utf8'));
const real = JSON.parse(require('fs').readFileSync('$TMP_DIR/a-real.json','utf8'));
if (dry.consolidate.nodesRemoved !== 2) fail('dry-run should report 2 would-remove, got ' + dry.consolidate.nodesRemoved);
if (real.consolidate.groupsFound !== 1 || real.consolidate.nodesRemoved !== 2) fail('real consolidate counts wrong: ' + JSON.stringify(real.consolidate));
const kids = (p) => db.prepare('SELECT count(*) c FROM memory_nodes WHERE parent_id=? AND level=2').get(p).c;
if (kids('P_old') !== 1) fail('old topic should keep 1 child, has ' + kids('P_old'));
if (kids('P_fresh') !== 3) fail('fresh topic must be untouched, has ' + kids('P_fresh'));
db.close();
console.log('  dry-run kept all 6 children; real prune removed 2 stale, kept fresh 3');
"

# ── Scenario B: stale (--stale-days 180) ───────────────────────────────────────
echo "[prune] stale: unsynced old node + orphan old session removed; the rest survive"
DB="$(fresh_home stale)"
node -e "
const D = require('$BSQ'); const db = new D('$DB');
const OLD = new Date(Date.now() - 200*864e5).toISOString();
const NEW = new Date(Date.now() - 10*864e5).toISOString();
const node = (id, ts, synced) => db.prepare(
  'INSERT INTO memory_nodes (id,parent_id,project,scope,title,summary,level,path_key,created_at,updated_at,last_synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
).run(id, null, 'proj', null, id, id, 2, id, ts, ts, synced);
node('N_stale', OLD, null);     // unsynced + old  -> removed
node('N_synced', OLD, OLD);     // synced          -> survives
node('N_recent', NEW, null);    // recent          -> survives
const sess = (id, ts) => db.prepare('INSERT INTO sessions (id,timestamp,project,scope,event_count,summary) VALUES (?,?,?,?,?,?)').run(id, ts, 'proj', null, 1, id);
sess('S_orphan_old', OLD);      // old + unreferenced -> removed (with events)
sess('S_ref_old', OLD);         // old but referenced -> survives
sess('S_orphan_recent', NEW);   // recent unreferenced -> survives
db.prepare('INSERT INTO events (id,session_id,timestamp,event_type,content,metadata) VALUES (?,?,?,?,?,?)').run('E_old','S_orphan_old',OLD,'ConversationTurn','{}',null);
db.prepare('INSERT INTO memory_node_sources (node_id,session_id,created_at) VALUES (?,?,?)').run('N_recent','S_ref_old',NEW);
db.close();
"
MEMORIA_HOME="$TMP_DIR/stale" "$ROOT_DIR/cli" prune --stale-days 180 --dry-run --json > "$TMP_DIR/b-dry.json"
MEMORIA_HOME="$TMP_DIR/stale" "$ROOT_DIR/cli" prune --stale-days 180 --json > "$TMP_DIR/b-real.json"
node -e "
const D = require('$BSQ'); const db = new D('$DB', { readonly: true });
const fail = (m) => { console.error('  ✗ ' + m); process.exit(1); };
const dry = JSON.parse(require('fs').readFileSync('$TMP_DIR/b-dry.json','utf8'));
const real = JSON.parse(require('fs').readFileSync('$TMP_DIR/b-real.json','utf8'));
if (dry.stale.staleNodes !== 1 || dry.stale.removedNodes !== 0) fail('dry-run stale nodes wrong: ' + JSON.stringify(dry.stale));
if (dry.stale.staleSessions !== 1 || dry.stale.removedSessions !== 0) fail('dry-run stale sessions wrong: ' + JSON.stringify(dry.stale));
if (real.stale.removedNodes !== 1 || real.stale.removedSessions !== 1) fail('real stale counts wrong: ' + JSON.stringify(real.stale));
const has = (t, id) => db.prepare('SELECT count(*) c FROM ' + t + ' WHERE id=?').get(id).c === 1;
if (has('memory_nodes','N_stale')) fail('N_stale should be deleted');
if (!has('memory_nodes','N_synced') || !has('memory_nodes','N_recent')) fail('synced/recent nodes must survive');
if (has('sessions','S_orphan_old')) fail('S_orphan_old should be deleted');
if (db.prepare(\"SELECT count(*) c FROM events WHERE session_id='S_orphan_old'\").get().c !== 0) fail('orphan session events must be deleted');
if (!has('sessions','S_ref_old') || !has('sessions','S_orphan_recent')) fail('referenced/recent sessions must survive');
db.close();
console.log('  dry-run deleted nothing; real prune removed 1 node + 1 session (+events), kept 5 rows');
"

# ── Scenario C: dedupe-skills ──────────────────────────────────────────────────
echo "[prune] dedupe-skills: duplicate name collapses to newest, unique skill survives"
DB="$(fresh_home dedupe)"
node -e "
const D = require('$BSQ'); const db = new D('$DB');
const OLD = new Date(Date.now() - 30*864e5).toISOString();
const NEW = new Date(Date.now() - 1*864e5).toISOString();
const skill = (id,name,date,uc) => db.prepare('INSERT INTO skills (id,name,category,created_date,success_rate,use_count,filepath) VALUES (?,?,?,?,?,?,?)').run(id,name,'general',date,1.0,uc,null);
skill('K1','Deploy Flow',OLD,1);   // older duplicate -> removed
skill('K2','deploy flow',NEW,5);   // newer duplicate -> kept
skill('K3','Unique Skill',NEW,1);  // unique          -> kept
db.close();
"
MEMORIA_HOME="$TMP_DIR/dedupe" "$ROOT_DIR/cli" prune --dedupe-skills --dry-run --json > "$TMP_DIR/c-dry.json"
MEMORIA_HOME="$TMP_DIR/dedupe" "$ROOT_DIR/cli" prune --dedupe-skills --json > "$TMP_DIR/c-real.json"
node -e "
const D = require('$BSQ'); const db = new D('$DB', { readonly: true });
const fail = (m) => { console.error('  ✗ ' + m); process.exit(1); };
const dry = JSON.parse(require('fs').readFileSync('$TMP_DIR/c-dry.json','utf8'));
const real = JSON.parse(require('fs').readFileSync('$TMP_DIR/c-real.json','utf8'));
if (dry.dedupe.duplicateGroups !== 1 || dry.dedupe.removed !== 0) fail('dry-run dedupe wrong: ' + JSON.stringify(dry.dedupe));
if (real.dedupe.duplicateGroups !== 1 || real.dedupe.removed !== 1) fail('real dedupe wrong: ' + JSON.stringify(real.dedupe));
const ids = db.prepare('SELECT id FROM skills ORDER BY id').all().map(r => r.id);
if (JSON.stringify(ids) !== JSON.stringify(['K2','K3'])) fail('survivors should be K2,K3; got ' + ids);
db.close();
console.log('  dry-run kept all 3; real prune removed older duplicate K1, kept K2 (newest) + K3');
"

# ── Scenario D: --all applies every default target in one pass ──────────────────
echo "[prune] --all: dedupe + consolidate(90) + stale(180) together"
DB="$(fresh_home all)"
node -e "
const D = require('$BSQ'); const db = new D('$DB');
const OLD = new Date(Date.now() - 200*864e5).toISOString();
db.prepare('INSERT INTO memory_nodes (id,parent_id,project,scope,title,summary,level,path_key,created_at,updated_at,last_synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
  .run('AN_stale', null, 'proj', null, 'AN_stale', 'x', 2, 'AN_stale', OLD, OLD, null);
db.prepare('INSERT INTO sessions (id,timestamp,project,scope,event_count,summary) VALUES (?,?,?,?,?,?)').run('AS_old', OLD, 'proj', null, 0, 'x');
const skill = (id,name,uc) => db.prepare('INSERT INTO skills (id,name,category,created_date,success_rate,use_count,filepath) VALUES (?,?,?,?,?,?,?)').run(id,name,'general',OLD,1.0,uc,null);
skill('AK1','Same Skill',1); skill('AK2','same skill',2);
db.close();
"
MEMORIA_HOME="$TMP_DIR/all" "$ROOT_DIR/cli" prune --all --dry-run --json > "$TMP_DIR/d-dry.json"
node -e "
const D = require('$BSQ'); const db = new D('$DB', { readonly: true });
const fail = (m) => { console.error('  ✗ ' + m); process.exit(1); };
const dry = JSON.parse(require('fs').readFileSync('$TMP_DIR/d-dry.json','utf8'));
for (const k of ['exports','checkpoints','dedupe','consolidate','stale']) if (!(k in dry)) fail('--all --dry-run missing section: ' + k);
if (db.prepare('SELECT count(*) c FROM skills').get().c !== 2) fail('dry-run must not delete skills');
if (db.prepare(\"SELECT count(*) c FROM memory_nodes WHERE id='AN_stale'\").get().c !== 1) fail('dry-run must not delete stale node');
if (db.prepare(\"SELECT count(*) c FROM sessions WHERE id='AS_old'\").get().c !== 1) fail('dry-run must not delete orphan session');
db.close();
"
MEMORIA_HOME="$TMP_DIR/all" "$ROOT_DIR/cli" prune --all --json > "$TMP_DIR/d-real.json"
node -e "
const D = require('$BSQ'); const db = new D('$DB', { readonly: true });
const fail = (m) => { console.error('  ✗ ' + m); process.exit(1); };
const real = JSON.parse(require('fs').readFileSync('$TMP_DIR/d-real.json','utf8'));
for (const k of ['exports','checkpoints','dedupe','consolidate','stale']) if (!(k in real)) fail('--all missing section: ' + k);
if (db.prepare('SELECT count(*) c FROM skills').get().c !== 1) fail('exactly 1 skill should remain');
if (db.prepare(\"SELECT count(*) c FROM memory_nodes WHERE id='AN_stale'\").get().c !== 0) fail('stale node should be gone');
if (db.prepare(\"SELECT count(*) c FROM sessions WHERE id='AS_old'\").get().c !== 0) fail('orphan old session should be gone');
if (real.dedupe.removed !== 1 || real.stale.removedNodes !== 1 || real.stale.removedSessions !== 1) fail('--all counts wrong: ' + JSON.stringify(real));
db.close();
console.log('  --all: dry-run deleted nothing; real removed 1 dup skill + 1 stale node + 1 orphan session');
"

echo "[prune] ok"
