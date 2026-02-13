import fs from 'node:fs/promises'
import { existsSync as fsExistsSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { Command } from 'commander'
import Database from 'better-sqlite3'

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

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function getMemoriaHome(): string {
  const envHome = process.env.MEMORIA_HOME
  if (envHome) return path.resolve(envHome)

  const cwd = process.cwd()
  const cwdHasMemory = path.join(cwd, '.memory')
  const cwdHasKnowledge = path.join(cwd, 'knowledge')
  if (existsSync(cwdHasMemory) || existsSync(cwdHasKnowledge)) return cwd

  return path.resolve(__dirname, '..')
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

async function ensureBaseDirs(memoriaHome: string): Promise<void> {
  const dirs = [
    '.memory',
    '.memory/sessions',
    '.memory/checkpoints',
    '.memory/exports',
    'knowledge',
    'knowledge/Daily',
    'knowledge/Skills',
    'knowledge/Decisions'
  ]

  await Promise.all(dirs.map((d) => fs.mkdir(path.join(memoriaHome, d), { recursive: true })))
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
    `)
  } finally {
    db.close()
  }
}

async function readSession(sessionFile: string): Promise<SessionData> {
  const raw = await fs.readFile(sessionFile, 'utf8')
  const data = JSON.parse(raw) as Json
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
  const sessionId = sessionData.id?.trim() || `session_${Date.now()}`
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

    for (const event of events) {
      const eventId = event.id?.trim() || randomUUID()
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

async function doctor(memoriaHome: string): Promise<void> {
  const memoryDir = path.join(memoriaHome, '.memory')
  const knowledgeDir = path.join(memoriaHome, 'knowledge')
  const dbPath = path.join(memoryDir, 'sessions.db')

  const checks = [
    { name: 'MEMORIA_HOME', ok: Boolean(process.env.MEMORIA_HOME), value: process.env.MEMORIA_HOME ?? '(fallback)' },
    { name: '.memory dir', ok: existsSync(memoryDir), value: memoryDir },
    { name: 'knowledge dir', ok: existsSync(knowledgeDir), value: knowledgeDir },
    { name: 'sessions.db', ok: existsSync(dbPath), value: dbPath }
  ]

  for (const c of checks) {
    console.log(`${c.ok ? '✓' : '✗'} ${c.name}: ${c.value}`)
  }
}

async function run(): Promise<void> {
  const memoriaHome = getMemoriaHome()
  const memoryPath = path.join(memoriaHome, '.memory')
  const dbPath = path.join(memoryPath, 'sessions.db')

  const program = new Command()
    .name('memoria')
    .description('Memoria TypeScript CLI')
    .version('1.1.0')

  program
    .command('init')
    .description('Initialize memory database and directories')
    .action(async () => {
      await ensureBaseDirs(memoriaHome)
      initDatabase(dbPath)
      console.log(`✓ 初始化完成: ${memoriaHome}`)
    })

  program
    .command('sync')
    .description('Import session JSON and sync notes')
    .argument('<sessionFile>', 'Path to session JSON file')
    .action(async (sessionFile: string) => {
      await ensureBaseDirs(memoriaHome)
      initDatabase(dbPath)

      const absSessionPath = path.resolve(sessionFile)
      const sessionData = await readSession(absSessionPath)
      const sessionId = importSession(dbPath, sessionData)

      await syncDailyNote(memoriaHome, dbPath, sessionId)
      await extractDecisions(memoriaHome, dbPath, sessionId)
      await extractSkills(memoriaHome, dbPath, sessionId)

      console.log(`✓ 已導入會話: ${sessionId}`)
      console.log('✅ 同步完成!')
    })

  program
    .command('doctor')
    .description('Check local runtime and directory health')
    .action(async () => {
      await doctor(memoriaHome)
    })

  await program.parseAsync(process.argv)
}

run().catch((error) => {
  console.error('❌ 執行失敗:', error instanceof Error ? error.message : error)
  process.exit(1)
})
