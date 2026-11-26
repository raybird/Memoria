#!/usr/bin/env bash
# Builds a fixed seed data root for issue-35 before/after comparison.
# Usage: bash seed.sh <work dir>; then node run.mjs <bundle inside the repo> <work dir>/seed <out.jsonl>
# for the old and the new bundle, and compare after deleting meta.vector_hits and meta.project_known.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"; S="$1"; H="$S/seed"
unset LIBSQL_URL MEMORIA_EMBED_PROVIDER MEMORIA_VECTOR_TIMEOUT_MS
export MEMORIA_HOME="$H"
"$ROOT/cli" init >/dev/null
r() { "$ROOT/cli" remember "$@" >/dev/null; }
r "alpha 改用 pnpm 作為套件管理器" --project alpha --rationale "lockfile 是權威"
r "alpha 的部署流程改走 Cloudflare Pages" --project alpha --rationale "推 main 就部署"
r "alpha 的資料庫遷移要先備份" --project alpha --rationale "曾經掉過資料"
r "gamma 的 pnpm workspace 設定" --project gamma --rationale "monorepo"
r "gamma 的測試要清掉環境變數" --project gamma --rationale "本機與 CI 不同"
"$ROOT/cli" sync "$ROOT/examples/session.sample.json" >/dev/null
# vectors: only gamma notes are indexed, under text that matches "wombat"
node -e "
const D=require('$ROOT/node_modules/better-sqlite3');const db=new D('$H/.memory/sessions.db',{readonly:true});
const rows=db.prepare(\"SELECT id FROM sessions WHERE project='gamma' AND id LIKE 'note-%'\").all();
const W=['northern ridge','southern lowland valley','eastern'];const ents=[];rows.forEach((r,i)=>{ents.push({id:'session:'+r.id,type:'session',name:'n'+i,text:'wombat burrow survey '+W[i]+' session'});ents.push({id:'decision:noteev-'+r.id.slice(5),type:'decision',name:'n'+i,text:'wombat burrow survey decision record '+W[i]+' '+W[i]})});
require('fs').writeFileSync('$S/payload.json',JSON.stringify({entities:ents}))"
LIBSQL_URL="file:$H/.memory/vectors.db" MEMORIA_EMBED_PROVIDER=stub node "$ROOT/skills/memoria-vector/vector-ingest.mjs" "$S/payload.json" >/dev/null
echo seeded
