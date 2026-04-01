// Memoria CLI – thin shell
// All business logic lives in src/core/*.ts
// This file only handles: commander definitions, argument parsing, console output formatting

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { Command } from 'commander'
import {
  MemoriaCore,
  resolveMemoriaPaths,
  initDatabase,
  runVerify,
  runPrune,
  exportMemory,
  buildMemoryIndex,
  existsSync,
  safeDate,
  slugify,
  stableStringify,
  shortHash,
  resolveSessionId,
  resolveEventId,
  getEventType,
  getEventContentObject,
  maybeParseJson,
  normalizeSkillKey,
  parseDaysOption,
  parseBoundaryDate,
  parseCreatedAt
} from './core/index.js'
import type {
  SessionData,
  SessionEvent,
  MemoriaPaths,
  PruneOptions,
  ExportOptions,
  ExportType,
  ExportFormat,
  MemoryIndexBuildOptions
} from './core/index.js'

// ─── Session schema (Zod validation) ─────────────────────────────────────────

const sessionEventSchema = z
  .object({
    id: z.string().optional(),
    timestamp: z.string().optional(),
    type: z.string().optional(),
    event_type: z.string().optional(),
    content: z.unknown().optional(),
    metadata: z.unknown().optional()
  })
  .passthrough()

const sessionSchema = z
  .object({
    id: z.string().optional(),
    timestamp: z.string().optional(),
    project: z.string().optional(),
    scope: z.string().optional(),
    summary: z.string().optional(),
    events: z.array(sessionEventSchema).default([])
  })
  .passthrough()

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function readSession(sessionFile: string): Promise<SessionData> {
  const raw = await fs.readFile(sessionFile, 'utf8')
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`Session file is not valid JSON: ${sessionFile}`)
  }

  const validated = sessionSchema.safeParse(parsed)
  if (!validated.success) {
    const details = validated.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    throw new Error(`Session schema validation failed: ${details}`)
  }

  const data = validated.data
  return {
    id: typeof data.id === 'string' ? data.id : undefined,
    timestamp: typeof data.timestamp === 'string' ? data.timestamp : undefined,
    project: typeof data.project === 'string' ? data.project : undefined,
    scope: typeof data.scope === 'string' ? data.scope : undefined,
    summary: typeof data.summary === 'string' ? data.summary : undefined,
    events: Array.isArray(data.events) ? (data.events as SessionEvent[]) : []
  }
}

function previewSync(paths: MemoriaPaths, sessionFile: string, sessionData: SessionData): void {
  const sessionId = resolveSessionId(sessionData)
  const timestamp = safeDate(sessionData.timestamp).toISOString()
  const events = sessionData.events ?? []
  const date = safeDate(timestamp).toISOString().slice(0, 10)
  const dailyPath = path.join(paths.knowledgeDir, 'Daily', `${date}.md`)

  const decisionPaths = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => getEventType(event) === 'DecisionMade')
    .map(({ event, index }) => {
      const content = getEventContentObject(event)
      const decisionTitle =
        typeof content.decision === 'string' && content.decision.trim()
          ? content.decision.trim()
          : 'Untitled Decision'
      const eventId = resolveEventId(event, sessionId, index)
      const filename = `${date}_${slugify(decisionTitle).slice(0, 40)}_${slugify(eventId).slice(0, 8)}.md`
      return path.join(paths.knowledgeDir, 'Decisions', filename)
    })

  const skillPaths = events
    .filter((e) => getEventType(e) === 'SkillLearned')
    .map((event) => {
      const content = getEventContentObject(event)
      const skillName =
        typeof content.skill_name === 'string' && content.skill_name.trim()
          ? content.skill_name.trim()
          : 'Untitled Skill'
      return path.join(paths.knowledgeDir, 'Skills', `${slugify(skillName)}.md`)
    })

  console.log('🧪 Dry run (no files written)')
  console.log(`- session file: ${sessionFile}`)
  console.log(`- session id: ${sessionId}`)
  console.log(`- project: ${sessionData.project ?? 'default'}`)
  console.log(`- scope: ${sessionData.scope ?? (sessionData.project ? `project:${sessionData.project}` : 'global')}`)
  console.log(`- events: ${events.length}`)
  console.log(`- database upsert: ${paths.dbPath}`)
  console.log(`- daily note append: ${dailyPath}`)
  console.log(`- decisions to write: ${decisionPaths.length}`)
  for (const p of decisionPaths.slice(0, 5)) console.log(`  - ${p}`)
  console.log(`- skills to write: ${skillPaths.length}`)
  for (const p of skillPaths.slice(0, 5)) console.log(`  - ${p}`)
}

type RuntimeLayout = {
  mode: 'repo' | 'installed'
  runtimeRoot: string
  canSelfInstallDeps: boolean
}

function hasRepoMarkers(candidateRoot: string): boolean {
  return existsSync(path.join(candidateRoot, 'package.json')) && existsSync(path.join(candidateRoot, 'src', 'cli.ts'))
}

function getRuntimeLayout(): RuntimeLayout {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  const candidateRoots = [moduleDir, path.resolve(moduleDir, '..')]

  for (const candidateRoot of candidateRoots) {
    if (hasRepoMarkers(candidateRoot)) {
      return {
        mode: 'repo',
        runtimeRoot: candidateRoot,
        canSelfInstallDeps: true
      }
    }
  }

  return {
    mode: 'installed',
    runtimeRoot: path.resolve(moduleDir, '..'),
    canSelfInstallDeps: false
  }
}

// ─── Preflight checks ────────────────────────────────────────────────────────

type PreflightCheck = { id: string; status: 'pass' | 'fail'; detail: string; fix?: string }

async function runPreflight(
  memoriaHome: string,
  layout: RuntimeLayout
): Promise<{ ok: boolean; checks: PreflightCheck[] }> {
  const checks: PreflightCheck[] = []

  // Node.js version
  const nodeVer = process.versions.node
  const [major] = nodeVer.split('.').map(Number)
  checks.push({
    id: 'node_version',
    status: major >= 18 ? 'pass' : 'fail',
    detail: `v${nodeVer}`,
    fix: major < 18 ? 'Install Node.js >= 18 via nvm/fnm: https://github.com/nvm-sh/nvm' : undefined
  })

  if (layout.canSelfInstallDeps) {
    try {
      const { execSync } = await import('node:child_process')
      const pnpmVer = execSync('pnpm --version', { stdio: 'pipe' }).toString().trim()
      checks.push({ id: 'pnpm', status: 'pass', detail: pnpmVer })
    } catch {
      checks.push({
        id: 'pnpm',
        status: 'fail',
        detail: 'not found',
        fix: 'Install pnpm: npm install -g pnpm'
      })
    }
  } else {
    checks.push({ id: 'pnpm', status: 'pass', detail: 'not required in installed mode' })
  }

  // Disk space (>= 100 MB)
  try {
    const { statfs } = await import('node:fs/promises')
    const st = await statfs(memoriaHome)
    const availMB = Math.floor((st.bavail * st.bsize) / (1024 * 1024))
    checks.push({
      id: 'disk_space',
      status: availMB >= 100 ? 'pass' : 'fail',
      detail: `${availMB}MB available`,
      fix: availMB < 100 ? 'Free up disk space.' : undefined
    })
  } catch {
    checks.push({ id: 'disk_space', status: 'pass', detail: 'unknown (skipping check)' })
  }

  // Write permission on memoriaHome
  try {
    const testPath = path.join(memoriaHome, `.memoria_preflight_${Date.now()}`)
    await fs.writeFile(testPath, '')
    await fs.unlink(testPath)
    checks.push({ id: 'write_permission', status: 'pass', detail: memoriaHome })
  } catch {
    checks.push({
      id: 'write_permission',
      status: 'fail',
      detail: `Cannot write to ${memoriaHome}`,
      fix: `Fix permissions: chmod u+w "${memoriaHome}"`
    })
  }

  return { ok: checks.every((c) => c.status === 'pass'), checks }
}

// ─── Main run() ───────────────────────────────────────────────────────────────

async function run(): Promise<void> {
  const paths = resolveMemoriaPaths()
  const runtimeLayout = getRuntimeLayout()
  const core = new MemoriaCore(paths)

  const program = new Command()
    .name('memoria')
    .description('Memoria TypeScript CLI')
    .version('1.5.1')

  // ── init ──────────────────────────────────────────────────────────────────

  program
    .command('init')
    .description('Initialize memory database and directories')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { json?: boolean }) => {
      await core.init()
      if (opts.json) {
        console.log(JSON.stringify({ ok: true, step: 'init', paths: { memoriaHome: paths.memoriaHome, db: paths.dbPath } }))
      } else {
        console.log(`✓ 初始化完成: ${paths.memoriaHome}`)
        console.log(`- db path: ${paths.dbPath}`)
        console.log(`- sessions path: ${paths.sessionsPath}`)
        console.log(`- config path: ${paths.configPath}`)
      }
    })

  // ── sync ──────────────────────────────────────────────────────────────────

  program
    .command('sync')
    .description('Import session JSON and sync notes')
    .argument('<sessionFile>', 'Path to session JSON file')
    .option('--dry-run', 'Validate and preview without writing files')
    .option('--json', 'Machine-readable JSON output')
    .action(async (sessionFile: string, options: { dryRun?: boolean; json?: boolean }) => {
      const absSessionPath = path.resolve(sessionFile)
      const sessionData = await readSession(absSessionPath)

      if (options.dryRun) {
        previewSync(paths, absSessionPath, sessionData)
        return
      }

      const result = await core.remember(sessionData)
      if (!result.ok) throw new Error(result.error)

      if (options.json) {
        console.log(JSON.stringify({ ok: true, step: 'sync', sessionId: result.data?.sessionId, meta: result.meta }))
      } else {
        console.log(`✓ 已導入會話: ${result.data?.sessionId}`)
        console.log('✅ 同步完成!')
      }
    })

  // ── stats ─────────────────────────────────────────────────────────────────

  program
    .command('stats')
    .description('Show session, event, and skill statistics')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { json?: boolean }) => {
      const result = await core.stats()
      if (!result.ok) throw new Error(result.error)
      const s = result.data!

      if (opts.json) {
        console.log(JSON.stringify(result))
      } else {
        console.log('📊 Memoria Stats')
        console.log(`- db path: ${paths.dbPath}`)
        console.log(`- sessions: ${s.sessions}`)
        console.log(`- events: ${s.events}`)
        console.log(`- skills: ${s.skills}`)
        if (s.lastSession) {
          console.log(`- last session: ${s.lastSession.id} (${s.lastSession.project}, ${s.lastSession.timestamp})`)
        }
        if (s.topSkills.length > 0) {
          console.log('- top skills:')
          for (const skill of s.topSkills) {
            console.log(`  - ${skill.name}: uses=${skill.use_count}, success=${(skill.success_rate * 100).toFixed(1)}%`)
          }
        }
        if (s.recallRouting) {
          const rr = s.recallRouting
          console.log(`- recall routing (${rr.window}):`)
          console.log(`  - queries=${rr.totalQueries}, fallback_rate=${(rr.fallbackRate * 100).toFixed(1)}%`)
          console.log(`  - route_counts: skipped=${rr.routeCounts.skipped}, keyword=${rr.routeCounts.keyword}, tree=${rr.routeCounts.tree}, hybrid_tree=${rr.routeCounts.hybrid_tree}, hybrid_fallback=${rr.routeCounts.hybrid_fallback}`)
          console.log(`  - latency_ms: avg=${rr.avgLatencyMs}, p95=${rr.p95LatencyMs}`)
          console.log(`  - avg_hit_count=${rr.avgHitCount}`)
        }
      }
    })

  // ── index ─────────────────────────────────────────────────────────────────

  const indexCommand = program
    .command('index')
    .description('Build and inspect lightweight tree memory index')

  indexCommand
    .command('build')
    .description('Build incremental tree index from unindexed sessions')
    .option('--project <name>', 'Scope build to one project')
    .option('--scope <name>', 'Scope build to one memory scope (e.g. global, agent:main)')
    .option('--since <isoDate>', 'Only include sessions at/after this ISO date')
    .option('--session-id <id>', 'Build index for one specific session id')
    .option('--dry-run', 'Show what would be indexed without writing nodes')
    .option('--json', 'Machine-readable JSON output')
    .action(async (options: MemoryIndexBuildOptions & { json?: boolean }) => {
      const result = buildMemoryIndex(paths.dbPath, options)
      if (options.json) {
        console.log(JSON.stringify({ ok: true, ...result }))
      } else {
        console.log(`🌲 Memory index build${options.dryRun ? ' (dry-run)' : ''}`)
        console.log(`- sessions considered: ${result.sessionsConsidered}`)
        console.log(`- sessions indexed: ${result.sessionsIndexed}`)
        console.log(`- nodes upserted: ${result.nodesUpserted}`)
        console.log(`- source links upserted: ${result.linksUpserted}`)
      }
    })

  // ── doctor ────────────────────────────────────────────────────────────────

  const governCommand = program
    .command('govern')
    .description('Review higher-signal governance candidates from memory')

  governCommand
    .command('review')
    .description('Review repeated decisions and skills worth extracting')
    .option('--project <name>', 'Filter candidates by project')
    .option('--scope <name>', 'Filter candidates by scope')
    .option('--limit <n>', 'Maximum number of candidates to return', '20')
    .option('--json', 'Machine-readable JSON output')
    .action(async (options: { project?: string; scope?: string; limit?: string; json?: boolean }) => {
      const limit = Number(options.limit ?? '20')
      if (!Number.isFinite(limit) || limit <= 0) {
        throw new Error(`Invalid --limit '${options.limit}'. Use a positive number`)
      }
      const result = await core.governanceReview({
        project: options.project,
        scope: options.scope,
        limit
      })
      if (!result.ok) throw new Error(result.error)

      if (options.json) {
        console.log(JSON.stringify(result))
      } else {
        console.log('🧭 Governance Review')
        console.log(`- candidates: ${result.data?.total ?? 0}`)
        for (const item of result.data?.items ?? []) {
          console.log(`- ${item.kind}: ${item.title} | sessions=${item.source_count} | rationale=${item.rationale} | latest=${item.latest_session_id}`)
        }
      }
    })

  program
    .command('doctor')
    .description('Check local runtime and directory health')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { json?: boolean }) => {
      const envDetails = [
        `- MEMORIA_DB_PATH=${process.env.MEMORIA_DB_PATH ?? '(not set)'}`,
        `- MEMORIA_SESSIONS_PATH=${process.env.MEMORIA_SESSIONS_PATH ?? '(not set)'}`,
        `- MEMORIA_CONFIG_PATH=${process.env.MEMORIA_CONFIG_PATH ?? '(not set)'}`
      ]
      const checks = [
        { name: 'MEMORIA_HOME', ok: true, value: paths.memoriaHome },
        { name: 'memory dir', ok: existsSync(paths.memoryDir), value: paths.memoryDir },
        { name: 'knowledge dir', ok: existsSync(paths.knowledgeDir), value: paths.knowledgeDir },
        { name: 'sessions path', ok: existsSync(paths.sessionsPath), value: paths.sessionsPath },
        { name: 'config path', ok: existsSync(paths.configPath), value: paths.configPath },
        { name: 'sessions.db', ok: existsSync(paths.dbPath), value: paths.dbPath }
      ]

      if (opts.json) {
        console.log(JSON.stringify({ ok: checks.every((c) => c.ok), paths, checks }))
      } else {
        console.log('Resolved path envs:')
        for (const line of envDetails) console.log(line)
        for (const c of checks) {
          console.log(`${c.ok ? '✓' : '✗'} ${c.name}: ${c.value}`)
        }
      }
    })

  // ── verify ────────────────────────────────────────────────────────────────

  program
    .command('verify')
    .description('Run runtime, schema, and writeability verification checks')
    .option('--json', 'Output machine-readable JSON report')
    .action(async (options: { json?: boolean }) => {
      const { ok, checks } = await runVerify(paths)

      if (options.json) {
        console.log(JSON.stringify({ ok, paths, checks }, null, 2))
      } else {
        console.log('🔎 Memoria Verify')
        console.log(`- ok: ${ok ? 'yes' : 'no'}`)
        console.log(`- db path: ${paths.dbPath}`)
        for (const check of checks) {
          console.log(`${check.status === 'pass' ? '✓' : '✗'} ${check.id}: ${check.detail}`)
        }
      }

      if (!ok) process.exitCode = 1
    })

  // ── prune ─────────────────────────────────────────────────────────────────

  program
    .command('prune')
    .description('Prune old runtime artifacts and optional duplicate skills')
    .option('--exports-days <days>', 'Remove export files older than N days')
    .option('--checkpoints-days <days>', 'Remove checkpoints older than N days')
    .option('--dedupe-skills', 'Delete duplicate skills by normalized skill name')
    .option('--consolidate-days <days>', 'Consolidate old session nodes under same topic older than N days')
    .option('--stale-days <days>', 'Remove memory nodes and sessions never recalled and older than N days')
    .option('--all', 'Apply default pruning targets (30 days + dedupe + consolidate 90d + stale 180d)')
    .option('--dry-run', 'Preview prune actions without deleting')
    .option('--json', 'Machine-readable JSON output')
    .action(async (options: PruneOptions & { json?: boolean }) => {
      const dryRun = Boolean(options.dryRun)
      const result = await runPrune(paths, options)

      if (options.json) {
        console.log(JSON.stringify({ ok: true, dryRun, ...result }))
      } else {
        console.log(`🧹 Memoria Prune${dryRun ? ' (dry-run)' : ''}`)
        if (result.exports) {
          const r = result.exports
          console.log(`- exports: matched=${r.matched}, ${dryRun ? 'would_remove' : 'removed'}=${dryRun ? r.matched : r.removed}, bytes=${r.bytes}`)
        }
        if (result.checkpoints) {
          const r = result.checkpoints
          console.log(`- checkpoints: matched=${r.matched}, ${dryRun ? 'would_remove' : 'removed'}=${dryRun ? r.matched : r.removed}, bytes=${r.bytes}`)
        }
        if (result.dedupe) {
          const r = result.dedupe
          console.log(`- dedupe-skills: groups=${r.duplicateGroups}, ${dryRun ? 'would_remove' : 'removed'}=${r.removed}`)
        }
        if (result.consolidate) {
          const r = result.consolidate
          console.log(`- consolidate: groups=${r.groupsFound}, consolidated=${r.sessionsConsolidated}, nodes_removed=${r.nodesRemoved}`)
        }
        if (result.stale) {
          const r = result.stale
          console.log(`- stale: nodes=${r.staleNodes}, sessions=${r.staleSessions}, removed_nodes=${r.removedNodes}, removed_sessions=${r.removedSessions}`)
        }
      }
    })

  // ── export ────────────────────────────────────────────────────────────────

  program
    .command('export')
    .description('Export decisions/skills by time range and project')
    .option('--from <isoDate>', 'Include records at/after this ISO date')
    .option('--to <isoDate>', 'Include records at/before this ISO date')
    .option('--project <name>', 'Filter by project name')
    .option('--scope <name>', 'Filter by memory scope')
    .option('--type <type>', 'Export type: all|decisions|skills', 'all')
    .option('--format <fmt>', 'Output format: json|markdown', 'json')
    .option('--out <path>', 'Output directory (default: .memory/exports)')
    .option('--json', 'Machine-readable summary output')
    .action(async (options: ExportOptions & { json?: boolean }) => {
      const type = (options.type ?? 'all') as ExportType
      const format = (options.format ?? 'json') as ExportFormat
      if (!['all', 'decisions', 'skills'].includes(type)) {
        throw new Error(`Invalid --type '${options.type}'. Use: all|decisions|skills`)
      }
      if (!['json', 'markdown'].includes(format)) {
        throw new Error(`Invalid --format '${options.format}'. Use: json|markdown`)
      }
      const result = await exportMemory(paths, { ...options, type, format })

      if (options.json) {
        console.log(JSON.stringify({ ok: true, filePath: result.filePath, decisions: result.decisions.length, skills: result.skills.length }))
      } else {
        console.log('📦 Memoria Export complete')
        console.log(`- file: ${result.filePath}`)
        console.log(`- decisions: ${result.decisions.length}`)
        console.log(`- skills: ${result.skills.length}`)
      }
    })

  // ── serve ─────────────────────────────────────────────────────────────────

  program
    .command('serve')
    .description('Start Memoria HTTP API server')
    .option('--port <port>', 'Port to listen on (default: 3917 or MEMORIA_PORT)')
    .option('--json', 'Emit JSON status line on startup')
    .action(async (opts: { port?: string; json?: boolean }) => {
      const { startServer } = await import('./server.js')
      const port = opts.port ? Number(opts.port) : undefined
      const { server, port: actualPort } = await startServer(port)

      if (opts.json) {
        console.log(JSON.stringify({ ok: true, step: 'serve', port: actualPort }))
      } else {
        console.log(`🚀 Memoria server listening on http://localhost:${actualPort}`)
        console.log('   GET  /v1/health')
        console.log('   GET  /v1/stats')
        console.log('   GET  /v1/telemetry/recall?window=P7D&limit=100')
        console.log('   POST /v1/remember')
        console.log('   POST /v1/recall')
        console.log('   GET  /v1/sessions/:id/summary')
        console.log('   Ctrl+C to stop')
      }

      // Keep alive until signal
      const shutdown = () => {
        server.close()
        process.exit(0)
      }
      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)
    })

  // ── preflight ─────────────────────────────────────────────────────────────

  program
    .command('preflight')
    .description('Check prerequisites (Node.js, pnpm, disk space, write permission)')
    .option('--json', 'Machine-readable JSON output')
    .action(async (opts: { json?: boolean }) => {
      const { ok, checks } = await runPreflight(paths.memoriaHome, runtimeLayout)

      if (opts.json) {
        console.log(JSON.stringify({ ok, checks, mode: runtimeLayout.mode }))
      } else {
        console.log(`Runtime mode: ${runtimeLayout.mode}`)
        for (const c of checks) {
          const icon = c.status === 'pass' ? '✓' : '✗'
          console.log(`${icon} ${c.id}: ${c.detail}`)
          if (c.status === 'fail' && c.fix) console.log(`  → Fix: ${c.fix}`)
        }
        if (ok) {
          console.log('✅ Preflight passed.')
        } else {
          console.log('❌ Preflight failed. Fix the issues above and retry.')
        }
      }

      if (!ok) process.exitCode = 1
    })

  // ── setup ─────────────────────────────────────────────────────────────────

  program
    .command('setup')
    .description('One-shot setup: preflight → install deps → init → (optional serve)')
    .option('--serve', 'Start HTTP server after setup')
    .option('--port <port>', 'Port for serve (default: 3917)')
    .option('--json', 'Emit JSON step logs for machine consumption')
    .action(async (opts: { serve?: boolean; port?: string; json?: boolean }) => {
      const jsonOut = Boolean(opts.json)

      function stepLog(step: string, ok: boolean, extra: Record<string, unknown> = {}): void {
        const ms = Date.now() - stepStart
        if (jsonOut) {
          console.log(JSON.stringify({ step, ok, ms, ...extra }))
        } else {
          const icon = ok ? '✓' : '✗'
          console.log(`${icon} [${step}] ${JSON.stringify(extra)}`)
        }
      }

      let stepStart = Date.now()

      // Step 1: preflight
      stepStart = Date.now()
      const { ok: preflightOk, checks } = await runPreflight(paths.memoriaHome, runtimeLayout)
      if (!preflightOk) {
        stepLog('preflight', false, { mode: runtimeLayout.mode, checks })
        process.exitCode = 1
        return
      }
      stepLog('preflight', true, { mode: runtimeLayout.mode })

      // Step 2: pnpm install (if node_modules missing)
      const pkgDir = runtimeLayout.runtimeRoot
      if (runtimeLayout.canSelfInstallDeps && !existsSync(path.join(pkgDir, 'node_modules'))) {
        stepStart = Date.now()
        try {
          const { execSync } = await import('node:child_process')
          execSync('pnpm install', { cwd: pkgDir, stdio: 'pipe' })
          stepLog('install', true)
        } catch (error) {
          stepLog('install', false, { error: error instanceof Error ? error.message : String(error) })
          process.exitCode = 1
          return
        }
      } else if (!runtimeLayout.canSelfInstallDeps) {
        stepStart = Date.now()
        stepLog('install', true, { skipped: true, reason: 'installed runtime already packaged' })
      }

      // Step 3: init
      stepStart = Date.now()
      try {
        await core.init()
        stepLog('init', true)
      } catch (error) {
        stepLog('init', false, { error: error instanceof Error ? error.message : String(error) })
        process.exitCode = 1
        return
      }

      // Step 4: verify
      stepStart = Date.now()
      const { ok: verifyOk, checks: verifyChecks } = await runVerify(paths)
      stepLog('verify', verifyOk, verifyOk ? {} : { checks: verifyChecks.filter((c) => c.status === 'fail') })
      if (!verifyOk) {
        process.exitCode = 1
        return
      }

      // Step 5 (optional): serve
      if (opts.serve) {
        stepStart = Date.now()
        const { startServer } = await import('./server.js')
        const port = opts.port ? Number(opts.port) : undefined
        const { server, port: actualPort } = await startServer(port)
        stepLog('serve', true, { port: actualPort })

        const shutdown = () => { server.close(); process.exit(0) }
        process.on('SIGINT', shutdown)
        process.on('SIGTERM', shutdown)
      } else if (!jsonOut) {
        console.log('\n✅ Memoria setup complete!')
        console.log(`   Run: MEMORIA_HOME="${paths.memoriaHome}" ./cli serve`)
      }
    })

  await program.parseAsync(process.argv)
}

run().catch((error) => {
  console.error('❌ 執行失敗:', error instanceof Error ? error.message : error)
  process.exit(1)
})
