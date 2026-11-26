// node run.mjs <bundle> <seedDir> <out>  — runs the recall matrix on a fresh copy of the seed.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
const [bundle, seed, out] = process.argv.slice(2)
const home = mkdtempSync(join(seed, '..', 'run-')); cpSync(seed, home, { recursive: true })
const env = { ...process.env }; for (const k of ['LIBSQL_URL','MEMORIA_EMBED_PROVIDER','MEMORIA_VECTOR_TIMEOUT_MS']) delete env[k]
const vecEnv = { ...env, LIBSQL_URL: `file:${home}/.memory/vectors.db`, MEMORIA_EMBED_PROVIDER: 'stub' }
const cases = []
for (const mode of ['keyword','hybrid','vector']) for (const [q, extra] of [
  ['pnpm 套件管理器', []], ['pnpm 套件管理器', ['--project','alpha']], ['完全無關的量子糾纏', ['--project','alpha']],
  ['pnpm 套件管理器', ['--project','beta']], ['wombat burrow survey', []], ['wombat burrow survey', ['--project','alpha']],
  ['alpha 部署', ['--top-k','8']], ['TS migration', []]]) cases.push([mode, q, extra])
const lines = []
const norm = (v) => typeof v === 'number' && !Number.isInteger(v) ? Number(v.toPrecision(9)) : v
for (const [mode, q, extra] of cases) {
  const raw = execFileSync('node', [bundle, 'recall', q, '--mode', mode, ...extra, '--json'], { env: { ...(mode === 'vector' ? vecEnv : env), MEMORIA_HOME: home }, encoding: 'utf8' })
  const j = JSON.parse(raw, (k, v) => norm(v))
  delete j.meta.recall_id; delete j.meta.latency_ms; delete j.meta.timestamp
  for (const h of j.data ?? []) delete h.score  // time-decayed; order is kept by the array
  lines.push(JSON.stringify({ case: [mode, q, ...extra], result: j }))
}
writeFileSync(out, lines.join('\n') + '\n'); console.log(`${lines.length} cases -> ${out}`)
