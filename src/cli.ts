import fs from 'node:fs/promises'
import { existsSync as fsExistsSync, constants as fsConstants } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import Database from 'better-sqlite3'
import { z } from 'zod'

type Json = Record<string, unknown>

type SessionEvent = {
  id?: string
  timestamp?: string
  type?: string
  event_type?: string
  content?: unknown
  metadata?: unknown
}

type SessionData = {
  id?: string
  timestamp?: string
  project?: string
  summary?: string
  events?: SessionEvent[]
}

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
    summary: z.string().optional(),
    events: z.array(sessionEventSchema).default([])
  })
  .passthrough()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

type MemoriaPaths = {
  memoriaHome: string
  memoryDir: string
  knowledgeDir: string
  dbPath: string
  sessionsPath: string
  configPath: string
}

type VerifyStatus = 'pass' | 'fail'

type VerifyCheck = {
  id: string
  status: VerifyStatus
  detail: string
}

type ExportType = 'all' | 'decisions' | 'skills'
type ExportFormat = 'json' | 'markdown'

function getMemoriaHome(): string {
  const envHome = process.env.MEMORIA_HOME
  if (envHome) return path.resolve(envHome)

  const cwd = process.cwd()
  const cwdHasMemory = path.join(cwd, '.memory')
  const cwdHasKnowledge = path.join(cwd, 'knowledge')
  if (existsSync(cwdHasMemory) || existsSync(cwdHasKnowledge)) return cwd

  return path.resolve(__dirname, '..')
}

function resolvePathFromEnv(raw: string | undefined): string | undefined {
  if (!raw || !raw.trim()) return undefined
  return path.resolve(raw)
}

function resolveMemoriaPaths(): MemoriaPaths {
  const memoriaHome = getMemoriaHome()

  const dbPathFromEnv = resolvePathFromEnv(process.env.MEMORIA_DB_PATH)
  const dbPath = dbPathFromEnv ?? path.join(memoriaHome, '.memory', 'sessions.db')
  const memoryDir = path.dirname(dbPath)

  const sessionsPath =
    resolvePathFromEnv(process.env.MEMORIA_SESSIONS_PATH) ?? path.join(memoryDir, 'sessions')

  const configPath =
    resolvePathFromEnv(process.env.MEMORIA_CONFIG_PATH) ?? path.join(memoriaHome, 'configs')

  return {
    memoriaHome,
    memoryDir,
    knowledgeDir: path.join(memoriaHome, 'knowledge'),
    dbPath,
    sessionsPath,
    configPath
  }
}

function existsSync(targetPath: string): boolean {
  return fsExistsSync(targetPath)
}

function safeDate(raw?: string): Date {
  const d = raw ? new Date(raw) : new Date()
  return Number.isNaN(d.getTime()) ? new Date() : d
}

function slugify(input: string): string {
  const cleaned = input
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  return cleaned || 'untitled'
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  const entries = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
  return `{${entries.join(',')}}`
}

function shortHash(input: string, length = 16): string {
  return createHash('sha256').update(input).digest('hex').slice(0, length)
}

function resolveSessionId(sessionData: SessionData): string {
  const explicit = sessionData.id?.trim()
  if (explicit) return explicit

  const events = (sessionData.events ?? []).map((event) => ({
    timestamp: event.timestamp ?? '',
    event_type: event.type ?? event.event_type ?? 'UnknownEvent',
    content: event.content ?? '',
    metadata: event.metadata ?? {}
  }))

  const fingerprint = stableStringify({
    timestamp: sessionData.timestamp ?? '',
    project: sessionData.project ?? 'default',
    summary: sessionData.summary ?? '',
    events
  })

  return `session_${shortHash(fingerprint)}`
}

function resolveEventId(event: SessionEvent, sessionId: string, index: number): string {
  const explicit = event.id?.trim()
  if (explicit) return explicit

  const fingerprint = stableStringify({
    session_id: sessionId,
    index,
    timestamp: event.timestamp ?? '',
    event_type: event.type ?? event.event_type ?? 'UnknownEvent',
    content: event.content ?? '',
    metadata: event.metadata ?? {}
  })

  return `evt_${shortHash(fingerprint)}`
}

async function ensureBaseDirs(paths: MemoriaPaths): Promise<void> {
  const dirs = [
    paths.memoryDir,
    paths.sessionsPath,
    path.join(paths.memoryDir, 'checkpoints'),
    path.join(paths.memoryDir, 'exports'),
    paths.knowledgeDir,
    path.join(paths.knowledgeDir, 'Daily'),
    path.join(paths.knowledgeDir, 'Skills'),
    path.join(paths.knowledgeDir, 'Decisions'),
    paths.configPath
  ]

  await Promise.all(dirs.map((d) => fs.mkdir(d, { recursive: true })))
}

function initDatabase(dbPath: string): void {
  const db = new Database(dbPath)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        timestamp DATETIME,
        project TEXT,
        event_count INTEGER,
        summary TEXT
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        timestamp DATETIME,
        event_type TEXT,
        content TEXT,
        metadata TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        name TEXT,
        category TEXT,
        created_date DATETIME,
        success_rate REAL,
        use_count INTEGER,
        filepath TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_timestamp
      ON sessions(timestamp);

      CREATE INDEX IF NOT EXISTS idx_sessions_project_timestamp
      ON sessions(project, timestamp);

      CREATE INDEX IF NOT EXISTS idx_events_event_type
      ON events(event_type);

      CREATE INDEX IF NOT EXISTS idx_events_session_event_time
      ON events(session_id, event_type, timestamp);

      CREATE INDEX IF NOT EXISTS idx_skills_category_created
      ON skills(category, created_date);
    `)
  } finally {
    db.close()
  }
}

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
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ')
    throw new Error(`Session schema validation failed: ${details}`)
  }

  const data = validated.data
  return {
    id: typeof data.id === 'string' ? data.id : undefined,
    timestamp: typeof data.timestamp === 'string' ? data.timestamp : undefined,
    project: typeof data.project === 'string' ? data.project : undefined,
    summary: typeof data.summary === 'string' ? data.summary : undefined,
    events: Array.isArray(data.events) ? (data.events as SessionEvent[]) : []
  }
}

function importSession(dbPath: string, sessionData: SessionData): string {
  const db = new Database(dbPath)
  const nowIso = new Date().toISOString()
  const sessionId = resolveSessionId(sessionData)
  const timestamp = safeDate(sessionData.timestamp).toISOString()
  const events = sessionData.events ?? []

  try {
    const upsertSession = db.prepare(`
      INSERT OR REPLACE INTO sessions (id, timestamp, project, event_count, summary)
      VALUES (?, ?, ?, ?, ?)
    `)

    upsertSession.run(
      sessionId,
      timestamp,
      sessionData.project ?? 'default',
      events.length,
      sessionData.summary ?? ''
    )

    const upsertEvent = db.prepare(`
      INSERT OR REPLACE INTO events (id, session_id, timestamp, event_type, content, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    for (const [index, event] of events.entries()) {
      const eventId = resolveEventId(event, sessionId, index)
      const eventTime = safeDate(event.timestamp ?? nowIso).toISOString()
      const eventType = event.type ?? event.event_type ?? 'UnknownEvent'
      const content = JSON.stringify(event.content ?? '')
      const metadata = JSON.stringify(event.metadata ?? {})
      upsertEvent.run(eventId, sessionId, eventTime, eventType, content, metadata)
    }
  } finally {
    db.close()
  }

  return sessionId
}

function getEventType(event: SessionEvent): string {
  return event.type ?? event.event_type ?? 'UnknownEvent'
}

function getEventContentObject(event: SessionEvent): Json {
  if (event.content && typeof event.content === 'object' && !Array.isArray(event.content)) {
    return event.content as Json
  }
  return {}
}

function previewSync(paths: MemoriaPaths, sessionFile: string, sessionData: SessionData): void {
  const sessionId = resolveSessionId(sessionData)
  const timestamp = safeDate(sessionData.timestamp).toISOString()
  const events = sessionData.events ?? []
  const date = safeDate(timestamp).toISOString().slice(0, 10)
  const dailyPath = path.join(paths.knowledgeDir, 'Daily', `${date}.md`)
  const dbPath = paths.dbPath

  const decisionPaths = events
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => getEventType(event) === 'DecisionMade')
    .map(({ event, index }) => {
      const content = getEventContentObject(event)
      const decisionTitle =
        typeof content.decision === 'string' && content.decision.trim() ? content.decision.trim() : 'Untitled Decision'
      const eventId = resolveEventId(event, sessionId, index)
      const filename = `${date}_${slugify(decisionTitle).slice(0, 40)}_${slugify(eventId).slice(0, 8)}.md`
      return path.join(paths.knowledgeDir, 'Decisions', filename)
    })

  const skillPaths = events
    .filter((e) => getEventType(e) === 'SkillLearned')
    .map((event) => {
      const content = getEventContentObject(event)
      const skillName =
        typeof content.skill_name === 'string' && content.skill_name.trim() ? content.skill_name.trim() : 'Untitled Skill'
      return path.join(paths.knowledgeDir, 'Skills', `${slugify(skillName)}.md`)
    })

  console.log('🧪 Dry run (no files written)')
  console.log(`- session file: ${sessionFile}`)
  console.log(`- session id: ${sessionId}`)
  console.log(`- project: ${sessionData.project ?? 'default'}`)
  console.log(`- events: ${events.length}`)
  console.log(`- database upsert: ${dbPath}`)
  console.log(`- daily note append: ${dailyPath}`)
  console.log(`- decisions to write: ${decisionPaths.length}`)
  for (const p of decisionPaths.slice(0, 5)) console.log(`  - ${p}`)
  console.log(`- skills to write: ${skillPaths.length}`)
  for (const p of skillPaths.slice(0, 5)) console.log(`  - ${p}`)
}

async function syncDailyNote(memoriaHome: string, dbPath: string, sessionId: string): Promise<void> {
  const db = new Database(dbPath, { readonly: true })
  try {
    const row = db
      .prepare('SELECT timestamp, project, event_count, summary FROM sessions WHERE id = ?')
      .get(sessionId) as { timestamp: string; project: string; event_count: number; summary: string } | undefined

    if (!row) return

    const d = safeDate(row.timestamp)
    const date = d.toISOString().slice(0, 10)
    const time = d.toISOString().slice(11, 16)
    const notePath = path.join(memoriaHome, 'knowledge', 'Daily', `${date}.md`)

    const newEntry = `\n## ${time} - ${row.project}\n\n${row.summary ?? ''}\n\n事件數: ${row.event_count} | Session ID: \`${sessionId}\`\n`

    let content = `# ${date}\n\n${newEntry}`
    if (existsSync(notePath)) {
      const oldContent = await fs.readFile(notePath, 'utf8')
      content = `${oldContent}${newEntry}`
    }

    await fs.writeFile(notePath, content, 'utf8')
  } finally {
    db.close()
  }
}

async function extractDecisions(memoriaHome: string, dbPath: string, sessionId: string): Promise<void> {
  const db = new Database(dbPath, { readonly: true })
  try {
    const rows = db
      .prepare(`
        SELECT id, timestamp, content
        FROM events
        WHERE session_id = ? AND event_type = 'DecisionMade'
      `)
      .all(sessionId) as { id: string; timestamp: string; content: string }[]

    for (const row of rows) {
      let contentData: Json = {}
      try {
        contentData = JSON.parse(row.content) as Json
      } catch {
        contentData = {}
      }

      const decisionTitle =
        typeof contentData.decision === 'string' && contentData.decision.trim()
          ? contentData.decision.trim()
          : 'Untitled Decision'

      const date = safeDate(row.timestamp).toISOString().slice(0, 10)
      const filename = `${date}_${slugify(decisionTitle).slice(0, 40)}_${slugify(row.id).slice(0, 8)}.md`
      const filePath = path.join(memoriaHome, 'knowledge', 'Decisions', filename)

      const alternatives = Array.isArray(contentData.alternatives_considered)
        ? (contentData.alternatives_considered as unknown[])
            .map((a) => `- ${String(a)}`)
            .join('\n')
        : '- (none)'

      const decisionDoc = `# ${decisionTitle}

## 元數據
- **日期**: ${row.timestamp}
- **Session ID**: \`${sessionId}\`

## 決策內容
${typeof contentData.decision === 'string' ? contentData.decision : ''}

## 理由
${typeof contentData.rationale === 'string' ? contentData.rationale : ''}

## 考慮的替代方案
${alternatives}

## 影響等級
${typeof contentData.impact_level === 'string' ? contentData.impact_level : 'medium'}

## 相關連結
[[${date}]]
`

      await fs.writeFile(filePath, decisionDoc, 'utf8')
    }
  } finally {
    db.close()
  }
}

async function extractSkills(memoriaHome: string, dbPath: string, sessionId: string): Promise<void> {
  const db = new Database(dbPath)
  try {
    const rows = db
      .prepare(`
        SELECT id, timestamp, content
        FROM events
        WHERE session_id = ? AND event_type = 'SkillLearned'
      `)
      .all(sessionId) as { id: string; timestamp: string; content: string }[]

    const upsertSkill = db.prepare(`
      INSERT OR REPLACE INTO skills
      (id, name, category, created_date, success_rate, use_count, filepath)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    for (const row of rows) {
      let contentData: Json = {}
      try {
        contentData = JSON.parse(row.content) as Json
      } catch {
        contentData = {}
      }

      const skillName =
        typeof contentData.skill_name === 'string' && contentData.skill_name.trim()
          ? contentData.skill_name.trim()
          : 'Untitled Skill'
      const successRateRaw =
        typeof contentData.success_rate === 'number' ? contentData.success_rate : Number(contentData.success_rate ?? 0)
      const successRate = Number.isFinite(successRateRaw) ? successRateRaw : 0
      const category = typeof contentData.category === 'string' ? contentData.category : 'general'
      const date = safeDate(row.timestamp).toISOString().slice(0, 10)

      const filename = `${slugify(skillName)}.md`
      const filePath = path.join(memoriaHome, 'knowledge', 'Skills', filename)

      const examples = Array.isArray(contentData.examples)
        ? (contentData.examples as unknown[]).map((e) => `- ${String(e)}`).join('\n')
        : '- (none)'

      const skillDoc = `# ${skillName}

## 元數據
- **創建日期**: ${row.timestamp}
- **類別**: ${category}
- **成功率**: ${(successRate * 100).toFixed(1)}%
- **使用次數**: 1

## 模式描述
${typeof contentData.pattern === 'string' ? contentData.pattern : ''}

## 實際案例
${examples}

## 版本歷史
- v1.0 (${date}): 初始版本
`

      await fs.writeFile(filePath, skillDoc, 'utf8')

      upsertSkill.run(
        slugify(skillName).toLowerCase(),
        skillName,
        category,
        row.timestamp,
        successRate,
        1,
        filePath
      )
    }
  } finally {
    db.close()
  }
}

async function doctor(paths: MemoriaPaths): Promise<void> {
  const checks = [
    { name: 'MEMORIA_HOME', ok: true, value: paths.memoriaHome },
    { name: 'memory dir', ok: existsSync(paths.memoryDir), value: paths.memoryDir },
    { name: 'knowledge dir', ok: existsSync(paths.knowledgeDir), value: paths.knowledgeDir },
    { name: 'sessions path', ok: existsSync(paths.sessionsPath), value: paths.sessionsPath },
    { name: 'config path', ok: existsSync(paths.configPath), value: paths.configPath },
    { name: 'sessions.db', ok: existsSync(paths.dbPath), value: paths.dbPath }
  ]

  const envDetails = [
    `- MEMORIA_DB_PATH=${process.env.MEMORIA_DB_PATH ?? '(not set)'}`,
    `- MEMORIA_SESSIONS_PATH=${process.env.MEMORIA_SESSIONS_PATH ?? '(not set)'}`,
    `- MEMORIA_CONFIG_PATH=${process.env.MEMORIA_CONFIG_PATH ?? '(not set)'}`
  ]

  console.log('Resolved path envs:')
  for (const line of envDetails) console.log(line)

  for (const c of checks) {
    console.log(`${c.ok ? '✓' : '✗'} ${c.name}: ${c.value}`)
  }
}

function stats(paths: MemoriaPaths): void {
  const dbPath = paths.dbPath
  if (!existsSync(paths.dbPath)) {
    console.log(`✗ sessions.db not found: ${paths.dbPath}`)
    console.log('Run `memoria init` first.')
    return
  }

  const db = new Database(dbPath, { readonly: true })
  try {
    const totalSessions = Number((db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number }).c)
    const totalEvents = Number((db.prepare('SELECT COUNT(*) AS c FROM events').get() as { c: number }).c)
    const totalSkills = Number((db.prepare('SELECT COUNT(*) AS c FROM skills').get() as { c: number }).c)
    const lastSession = db
      .prepare('SELECT id, timestamp, project FROM sessions ORDER BY timestamp DESC LIMIT 1')
      .get() as { id: string; timestamp: string; project: string } | undefined

    const topSkills = db
      .prepare('SELECT name, use_count, success_rate FROM skills ORDER BY use_count DESC, name ASC LIMIT 5')
      .all() as { name: string; use_count: number; success_rate: number }[]

    console.log('📊 Memoria Stats')
    console.log(`- db path: ${dbPath}`)
    console.log(`- sessions: ${totalSessions}`)
    console.log(`- events: ${totalEvents}`)
    console.log(`- skills: ${totalSkills}`)
    if (lastSession) {
      console.log(`- last session: ${lastSession.id} (${lastSession.project}, ${lastSession.timestamp})`)
    }
    if (topSkills.length > 0) {
      console.log('- top skills:')
      for (const skill of topSkills) {
        console.log(`  - ${skill.name}: uses=${skill.use_count}, success=${(skill.success_rate * 100).toFixed(1)}%`)
      }
    }
  } finally {
    db.close()
  }
}

function parseDaysOption(raw: string | undefined, optionName: string): number | undefined {
  if (raw === undefined) return undefined
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid ${optionName}: expected non-negative number, got '${raw}'`)
  }
  return value
}

function parseBoundaryDate(raw: string | undefined, optionName: string): Date | undefined {
  if (!raw) return undefined
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid ${optionName}: expected ISO date/time, got '${raw}'`)
  }
  return d
}

async function collectFilesRecursively(dirPath: string): Promise<string[]> {
  if (!existsSync(dirPath)) return []
  const entries = await fs.readdir(dirPath, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectFilesRecursively(fullPath)))
    } else if (entry.isFile()) {
      files.push(fullPath)
    }
  }

  return files
}

async function pruneFilesByAge(
  label: string,
  dirPath: string,
  olderThanDays: number,
  dryRun: boolean
): Promise<{ label: string; matched: number; removed: number; bytes: number }> {
  const cutoffMs = Date.now() - olderThanDays * 24 * 60 * 60 * 1000
  const files = await collectFilesRecursively(dirPath)

  let matched = 0
  let removed = 0
  let bytes = 0

  for (const filePath of files) {
    const stat = await fs.stat(filePath)
    if (stat.mtimeMs >= cutoffMs) continue
    matched += 1
    bytes += stat.size
    if (!dryRun) {
      await fs.unlink(filePath)
      removed += 1
    }
  }

  return { label, matched, removed: dryRun ? 0 : removed, bytes }
}

type PruneOptions = {
  exportsDays?: string
  checkpointsDays?: string
  dedupeSkills?: boolean
  all?: boolean
  dryRun?: boolean
}

function normalizeSkillKey(name: string): string {
  return slugify(name).toLowerCase()
}

function parseCreatedAt(raw: string | undefined): number {
  if (!raw) return 0
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? 0 : d.getTime()
}

function pruneSkillsDuplicates(dbPath: string, dryRun: boolean): { duplicateGroups: number; removed: number } {
  if (!existsSync(dbPath)) return { duplicateGroups: 0, removed: 0 }

  const db = new Database(dbPath)
  try {
    const rows = db
      .prepare('SELECT id, name, created_date, use_count FROM skills')
      .all() as { id: string; name: string; created_date: string; use_count: number }[]

    const groups = new Map<string, { id: string; name: string; created_date: string; use_count: number }[]>()
    for (const row of rows) {
      const key = normalizeSkillKey(row.name)
      const list = groups.get(key) ?? []
      list.push(row)
      groups.set(key, list)
    }

    const deleteIds: string[] = []
    let duplicateGroups = 0

    for (const [, list] of groups) {
      if (list.length <= 1) continue
      duplicateGroups += 1
      list.sort((a, b) => {
        const tDiff = parseCreatedAt(b.created_date) - parseCreatedAt(a.created_date)
        if (tDiff !== 0) return tDiff
        const uDiff = (b.use_count ?? 0) - (a.use_count ?? 0)
        if (uDiff !== 0) return uDiff
        return a.id.localeCompare(b.id)
      })
      for (const row of list.slice(1)) {
        deleteIds.push(row.id)
      }
    }

    if (!dryRun && deleteIds.length > 0) {
      const del = db.prepare('DELETE FROM skills WHERE id = ?')
      const tx = db.transaction((ids: string[]) => {
        for (const id of ids) del.run(id)
      })
      tx(deleteIds)
    }

    return { duplicateGroups, removed: dryRun ? 0 : deleteIds.length }
  } finally {
    db.close()
  }
}

async function prune(paths: MemoriaPaths, options: PruneOptions): Promise<void> {
  const dryRun = Boolean(options.dryRun)
  const all = Boolean(options.all)

  const exportsDays = parseDaysOption(options.exportsDays, '--exports-days') ?? (all ? 30 : undefined)
  const checkpointsDays = parseDaysOption(options.checkpointsDays, '--checkpoints-days') ?? (all ? 30 : undefined)
  const dedupeSkills = Boolean(options.dedupeSkills) || all

  if (exportsDays === undefined && checkpointsDays === undefined && !dedupeSkills) {
    throw new Error('No prune target specified. Use --all or one of: --exports-days, --checkpoints-days, --dedupe-skills')
  }

  const results: Array<{ label: string; matched: number; removed: number; bytes: number }> = []

  if (exportsDays !== undefined) {
    results.push(await pruneFilesByAge('exports', path.join(paths.memoryDir, 'exports'), exportsDays, dryRun))
  }

  if (checkpointsDays !== undefined) {
    results.push(await pruneFilesByAge('checkpoints', path.join(paths.memoryDir, 'checkpoints'), checkpointsDays, dryRun))
  }

  const dedupe = dedupeSkills ? pruneSkillsDuplicates(paths.dbPath, dryRun) : null

  console.log(`🧹 Memoria Prune${dryRun ? ' (dry-run)' : ''}`)
  for (const result of results) {
    console.log(
      `- ${result.label}: matched=${result.matched}, ${dryRun ? 'would_remove' : 'removed'}=${
        dryRun ? result.matched : result.removed
      }, bytes=${result.bytes}`
    )
  }

  if (dedupe) {
    console.log(
      `- dedupe-skills: groups=${dedupe.duplicateGroups}, ${dryRun ? 'would_remove' : 'removed'}=${
        dryRun ? dedupe.removed : dedupe.removed
      }`
    )
  }
}

type ExportOptions = {
  from?: string
  to?: string
  project?: string
  type?: ExportType
  format?: ExportFormat
  out?: string
}

type ExportDecision = {
  id: string
  session_id: string
  timestamp: string
  project: string
  decision: string
  rationale: string
  impact_level: string
}

type ExportSkill = {
  id: string
  session_id: string
  timestamp: string
  project: string
  skill_name: string
  category: string
  pattern: string
}

function inDateRange(ts: string, from?: Date, to?: Date): boolean {
  const t = new Date(ts)
  if (Number.isNaN(t.getTime())) return false
  if (from && t < from) return false
  if (to && t > to) return false
  return true
}

async function exportMemory(paths: MemoriaPaths, options: ExportOptions): Promise<void> {
  if (!existsSync(paths.dbPath)) {
    throw new Error(`sessions.db not found: ${paths.dbPath}. Run 'memoria init' first.`)
  }

  const from = parseBoundaryDate(options.from, '--from')
  const to = parseBoundaryDate(options.to, '--to')
  const projectFilter = options.project?.trim()
  const type = (options.type ?? 'all') as ExportType
  const format = (options.format ?? 'json') as ExportFormat
  const outDir = options.out ? path.resolve(options.out) : path.join(paths.memoryDir, 'exports')

  const db = new Database(paths.dbPath, { readonly: true })
  try {
    const decisionsRows =
      type === 'all' || type === 'decisions'
        ? (db
            .prepare(
              `
          SELECT e.id, e.session_id, e.timestamp, e.content, s.project
          FROM events e
          JOIN sessions s ON s.id = e.session_id
          WHERE e.event_type = 'DecisionMade'
        `
            )
            .all() as { id: string; session_id: string; timestamp: string; content: string; project: string }[])
        : []

    const skillsRows =
      type === 'all' || type === 'skills'
        ? (db
            .prepare(
              `
          SELECT e.id, e.session_id, e.timestamp, e.content, s.project
          FROM events e
          JOIN sessions s ON s.id = e.session_id
          WHERE e.event_type = 'SkillLearned'
        `
            )
            .all() as { id: string; session_id: string; timestamp: string; content: string; project: string }[])
        : []

    const decisions: ExportDecision[] = decisionsRows
      .filter((r) => (!projectFilter || r.project === projectFilter) && inDateRange(r.timestamp, from, to))
      .map((r) => {
        const content = maybeParseJson(r.content)
        const contentObj = content && typeof content === 'object' && !Array.isArray(content) ? (content as Json) : {}
        return {
          id: r.id,
          session_id: r.session_id,
          timestamp: r.timestamp,
          project: r.project,
          decision: String(contentObj.decision ?? ''),
          rationale: String(contentObj.rationale ?? ''),
          impact_level: String(contentObj.impact_level ?? 'medium')
        }
      })

    const skills: ExportSkill[] = skillsRows
      .filter((r) => (!projectFilter || r.project === projectFilter) && inDateRange(r.timestamp, from, to))
      .map((r) => {
        const content = maybeParseJson(r.content)
        const contentObj = content && typeof content === 'object' && !Array.isArray(content) ? (content as Json) : {}
        return {
          id: r.id,
          session_id: r.session_id,
          timestamp: r.timestamp,
          project: r.project,
          skill_name: String(contentObj.skill_name ?? ''),
          category: String(contentObj.category ?? 'general'),
          pattern: String(contentObj.pattern ?? '')
        }
      })

    const payload = {
      generated_at: new Date().toISOString(),
      filters: {
        from: options.from ?? null,
        to: options.to ?? null,
        project: projectFilter ?? null,
        type,
        format
      },
      counts: {
        decisions: decisions.length,
        skills: skills.length
      },
      decisions,
      skills
    }

    await fs.mkdir(outDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const projectPart = projectFilter ? `_${slugify(projectFilter).slice(0, 30)}` : ''
    const ext = format === 'json' ? 'json' : 'md'
    const filePath = path.join(outDir, `memoria-export_${type}${projectPart}_${stamp}.${ext}`)

    if (format === 'json') {
      await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8')
    } else {
      const decisionBlock = decisions
        .map(
          (d) =>
            `- [${d.timestamp}] (${d.project}) ${d.decision || '(untitled)'} | impact=${d.impact_level} | session=${d.session_id}`
        )
        .join('\n')

      const skillBlock = skills
        .map((s) => `- [${s.timestamp}] (${s.project}) ${s.skill_name || '(untitled)'} | category=${s.category}`)
        .join('\n')

      const md = `# Memoria Export\n\nGenerated: ${payload.generated_at}\n\n## Filters\n- from: ${payload.filters.from ?? '(none)'}\n- to: ${
        payload.filters.to ?? '(none)'
      }\n- project: ${payload.filters.project ?? '(none)'}\n- type: ${type}\n\n## Counts\n- decisions: ${decisions.length}\n- skills: ${
        skills.length
      }\n\n## Decisions\n${decisionBlock || '- (none)'}\n\n## Skills\n${skillBlock || '- (none)'}\n`

      await fs.writeFile(filePath, md, 'utf8')
    }

    console.log('📦 Memoria Export complete')
    console.log(`- file: ${filePath}`)
    console.log(`- decisions: ${decisions.length}`)
    console.log(`- skills: ${skills.length}`)
  } finally {
    db.close()
  }
}

function maybeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

async function canWrite(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath, fsConstants.W_OK)
    return true
  } catch {
    return false
  }
}

function collectMissingColumns(db: Database.Database, table: string, expected: string[]): string[] {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  const actual = new Set(rows.map((r) => r.name))
  return expected.filter((c) => !actual.has(c))
}

async function verify(paths: MemoriaPaths, asJson: boolean): Promise<boolean> {
  const checks: VerifyCheck[] = []
  const add = (id: string, status: VerifyStatus, detail: string) => {
    checks.push({ id, status, detail })
  }

  const pathChecks: Array<{ id: string; p: string; label: string }> = [
    { id: 'memory_dir_exists', p: paths.memoryDir, label: 'memory dir' },
    { id: 'knowledge_dir_exists', p: paths.knowledgeDir, label: 'knowledge dir' },
    { id: 'sessions_path_exists', p: paths.sessionsPath, label: 'sessions path' },
    { id: 'config_path_exists', p: paths.configPath, label: 'config path' }
  ]

  for (const item of pathChecks) {
    add(item.id, existsSync(item.p) ? 'pass' : 'fail', `${item.label}: ${item.p}`)
  }

  const writableChecks: Array<{ id: string; p: string; label: string }> = [
    { id: 'memory_dir_writable', p: paths.memoryDir, label: 'memory dir writable' },
    { id: 'knowledge_dir_writable', p: paths.knowledgeDir, label: 'knowledge dir writable' },
    { id: 'sessions_path_writable', p: paths.sessionsPath, label: 'sessions path writable' },
    { id: 'config_path_writable', p: paths.configPath, label: 'config path writable' }
  ]

  for (const item of writableChecks) {
    const ok = (await canWrite(item.p)) || (existsSync(item.p) ? false : await canWrite(path.dirname(item.p)))
    add(item.id, ok ? 'pass' : 'fail', `${item.label}: ${item.p}`)
  }

  if (!existsSync(paths.dbPath)) {
    add('db_exists', 'fail', `sessions.db missing: ${paths.dbPath}`)
  }

  let db: Database.Database | null = null
  try {
    db = new Database(paths.dbPath, { readonly: true, fileMustExist: true })
    add('db_connect', 'pass', `connected: ${paths.dbPath}`)

    const tableRows = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]
    const tableSet = new Set(tableRows.map((r) => r.name))

    const requiredTables = ['sessions', 'events', 'skills']
    for (const table of requiredTables) {
      add(`table_${table}`, tableSet.has(table) ? 'pass' : 'fail', `table ${table}`)
    }

    const requiredColumns: Record<string, string[]> = {
      sessions: ['id', 'timestamp', 'project', 'event_count', 'summary'],
      events: ['id', 'session_id', 'timestamp', 'event_type', 'content', 'metadata'],
      skills: ['id', 'name', 'category', 'created_date', 'success_rate', 'use_count', 'filepath']
    }

    for (const [table, columns] of Object.entries(requiredColumns)) {
      if (!tableSet.has(table)) continue
      const missing = collectMissingColumns(db, table, columns)
      add(
        `columns_${table}`,
        missing.length === 0 ? 'pass' : 'fail',
        missing.length === 0 ? `columns ${table} ok` : `columns ${table} missing: ${missing.join(', ')}`
      )
    }

    const quickCheck = db.prepare('PRAGMA quick_check').get() as { quick_check?: string }
    const integrityOk = quickCheck?.quick_check === 'ok'
    add('db_integrity', integrityOk ? 'pass' : 'fail', integrityOk ? 'PRAGMA quick_check=ok' : 'PRAGMA quick_check failed')
  } catch (error) {
    add('db_connect', 'fail', `connect error: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    db?.close()
  }

  const ok = checks.every((c) => c.status === 'pass')

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          ok,
          paths,
          checks
        },
        null,
        2
      )
    )
  } else {
    console.log('🔎 Memoria Verify')
    console.log(`- ok: ${ok ? 'yes' : 'no'}`)
    console.log(`- db path: ${paths.dbPath}`)
    for (const check of checks) {
      console.log(`${check.status === 'pass' ? '✓' : '✗'} ${check.id}: ${check.detail}`)
    }
  }

  return ok
}

async function run(): Promise<void> {
  const paths = resolveMemoriaPaths()

  const program = new Command()
    .name('memoria')
    .description('Memoria TypeScript CLI')
    .version('1.2.0')

  program
    .command('init')
    .description('Initialize memory database and directories')
    .action(async () => {
      await ensureBaseDirs(paths)
      initDatabase(paths.dbPath)
      console.log(`✓ 初始化完成: ${paths.memoriaHome}`)
      console.log(`- db path: ${paths.dbPath}`)
      console.log(`- sessions path: ${paths.sessionsPath}`)
      console.log(`- config path: ${paths.configPath}`)
    })

  program
    .command('sync')
    .description('Import session JSON and sync notes')
    .argument('<sessionFile>', 'Path to session JSON file')
    .option('--dry-run', 'Validate and preview without writing files')
    .action(async (sessionFile: string, options: { dryRun?: boolean }) => {
      const absSessionPath = path.resolve(sessionFile)
      const sessionData = await readSession(absSessionPath)

      if (options.dryRun) {
        previewSync(paths, absSessionPath, sessionData)
        return
      }

      await ensureBaseDirs(paths)
      initDatabase(paths.dbPath)

      const sessionId = importSession(paths.dbPath, sessionData)

      await syncDailyNote(paths.memoriaHome, paths.dbPath, sessionId)
      await extractDecisions(paths.memoriaHome, paths.dbPath, sessionId)
      await extractSkills(paths.memoriaHome, paths.dbPath, sessionId)

      console.log(`✓ 已導入會話: ${sessionId}`)
      console.log('✅ 同步完成!')
    })

  program
    .command('stats')
    .description('Show session, event, and skill statistics')
    .action(() => {
      stats(paths)
    })

  program
    .command('doctor')
    .description('Check local runtime and directory health')
    .action(async () => {
      await doctor(paths)
    })

  program
    .command('verify')
    .description('Run runtime, schema, and writeability verification checks')
    .option('--json', 'Output machine-readable JSON report')
    .action(async (options: { json?: boolean }) => {
      const ok = await verify(paths, Boolean(options.json))
      if (!ok) process.exitCode = 1
    })

  program
    .command('prune')
    .description('Prune old runtime artifacts and optional duplicate skills')
    .option('--exports-days <days>', 'Remove export files older than N days')
    .option('--checkpoints-days <days>', 'Remove checkpoints older than N days')
    .option('--dedupe-skills', 'Delete duplicate skills by normalized skill name')
    .option('--all', 'Apply default pruning targets (30 days + dedupe skills)')
    .option('--dry-run', 'Preview prune actions without deleting')
    .action(async (options: PruneOptions) => {
      await prune(paths, options)
    })

  program
    .command('export')
    .description('Export decisions/skills by time range and project')
    .option('--from <isoDate>', 'Include records at/after this ISO date')
    .option('--to <isoDate>', 'Include records at/before this ISO date')
    .option('--project <name>', 'Filter by project name')
    .option('--type <type>', 'Export type: all|decisions|skills', 'all')
    .option('--format <fmt>', 'Output format: json|markdown', 'json')
    .option('--out <path>', 'Output directory (default: .memory/exports)')
    .action(async (options: ExportOptions) => {
      const type = (options.type ?? 'all') as ExportType
      const format = (options.format ?? 'json') as ExportFormat
      if (!['all', 'decisions', 'skills'].includes(type)) {
        throw new Error(`Invalid --type '${options.type}'. Use: all|decisions|skills`)
      }
      if (!['json', 'markdown'].includes(format)) {
        throw new Error(`Invalid --format '${options.format}'. Use: json|markdown`)
      }
      await exportMemory(paths, { ...options, type, format })
    })

  await program.parseAsync(process.argv)
}

run().catch((error) => {
  console.error('❌ 執行失敗:', error instanceof Error ? error.message : error)
  process.exit(1)
})
