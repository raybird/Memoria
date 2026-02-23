// Database operations for Memoria
// Extracted from cli.ts – all SQLite interactions via better-sqlite3

import fs from 'node:fs/promises'
import path from 'node:path'
import Database from 'better-sqlite3'
import { existsSync } from './paths.js'
import {
    safeDate,
    slugify,
    resolveSessionId,
    resolveEventId,
    getEventType,
    getEventContentObject,
    maybeParseJson,
    normalizeSkillKey,
    parseDaysOption,
    parseBoundaryDate,
    inDateRange,
    parseCreatedAt
} from './utils.js'
import type {
    Json,
    MemoriaPaths,
    SessionData,
    SessionEvent,
    VerifyStatus,
    VerifyCheck,
    ExportDecision,
    ExportSkill,
    ExportOptions,
    ExportType,
    ExportFormat,
    PruneOptions,
    StatsData
} from './types.js'

// ─── Init ────────────────────────────────────────────────────────────────────

export function initDatabase(dbPath: string): void {
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

// ─── Session import ──────────────────────────────────────────────────────────

export function importSession(dbPath: string, sessionData: SessionData): string {
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

// ─── Markdown sync ───────────────────────────────────────────────────────────

export async function syncDailyNote(memoriaHome: string, dbPath: string, sessionId: string): Promise<void> {
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

export async function extractDecisions(memoriaHome: string, dbPath: string, sessionId: string): Promise<void> {
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

export async function extractSkills(memoriaHome: string, dbPath: string, sessionId: string): Promise<void> {
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

// ─── Stats ───────────────────────────────────────────────────────────────────

export function queryStats(dbPath: string): StatsData {
    const db = new Database(dbPath, { readonly: true })
    try {
        const sessions = Number((db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number }).c)
        const events = Number((db.prepare('SELECT COUNT(*) AS c FROM events').get() as { c: number }).c)
        const skills = Number((db.prepare('SELECT COUNT(*) AS c FROM skills').get() as { c: number }).c)

        const lastSession = db
            .prepare('SELECT id, timestamp, project FROM sessions ORDER BY timestamp DESC LIMIT 1')
            .get() as { id: string; timestamp: string; project: string } | undefined

        const topSkills = db
            .prepare('SELECT name, use_count, success_rate FROM skills ORDER BY use_count DESC, name ASC LIMIT 5')
            .all() as { name: string; use_count: number; success_rate: number }[]

        return { sessions, events, skills, lastSession, topSkills }
    } finally {
        db.close()
    }
}

// ─── Verify ──────────────────────────────────────────────────────────────────

async function canWrite(targetPath: string): Promise<boolean> {
    try {
        const { constants: fsConstants, access } = await import('node:fs/promises')
        await access(targetPath, fsConstants.W_OK)
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

export async function runVerify(paths: MemoriaPaths): Promise<{ ok: boolean; checks: VerifyCheck[] }> {
    const checks: VerifyCheck[] = []
    const add = (id: string, status: VerifyStatus, detail: string) => {
        checks.push({ id, status, detail })
    }

    const pathChecks = [
        { id: 'memory_dir_exists', p: paths.memoryDir, label: 'memory dir' },
        { id: 'knowledge_dir_exists', p: paths.knowledgeDir, label: 'knowledge dir' },
        { id: 'sessions_path_exists', p: paths.sessionsPath, label: 'sessions path' },
        { id: 'config_path_exists', p: paths.configPath, label: 'config path' }
    ]

    for (const item of pathChecks) {
        add(item.id, existsSync(item.p) ? 'pass' : 'fail', `${item.label}: ${item.p}`)
    }

    for (const item of pathChecks) {
        const id = item.id.replace('_exists', '_writable')
        const ok = (await canWrite(item.p)) || (existsSync(item.p) ? false : await canWrite(path.dirname(item.p)))
        add(id, ok ? 'pass' : 'fail', `${item.label} writable: ${item.p}`)
    }

    if (!existsSync(paths.dbPath)) {
        add('db_exists', 'fail', `sessions.db missing: ${paths.dbPath}`)
        return { ok: false, checks }
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

    return { ok: checks.every((c) => c.status === 'pass'), checks }
}

// ─── Prune ───────────────────────────────────────────────────────────────────

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
    let matched = 0, removed = 0, bytes = 0

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

export function pruneSkillsDuplicates(dbPath: string, dryRun: boolean): { duplicateGroups: number; removed: number } {
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
            for (const row of list.slice(1)) deleteIds.push(row.id)
        }

        if (!dryRun && deleteIds.length > 0) {
            const del = db.prepare('DELETE FROM skills WHERE id = ?')
            const tx = db.transaction((ids: string[]) => { for (const id of ids) del.run(id) })
            tx(deleteIds)
        }

        return { duplicateGroups, removed: dryRun ? 0 : deleteIds.length }
    } finally {
        db.close()
    }
}

export async function runPrune(
    paths: MemoriaPaths,
    options: PruneOptions
): Promise<{
    exports?: { matched: number; removed: number; bytes: number }
    checkpoints?: { matched: number; removed: number; bytes: number }
    dedupe?: { duplicateGroups: number; removed: number }
}> {
    const dryRun = Boolean(options.dryRun)
    const all = Boolean(options.all)

    const exportsDays = parseDaysOption(options.exportsDays, '--exports-days') ?? (all ? 30 : undefined)
    const checkpointsDays = parseDaysOption(options.checkpointsDays, '--checkpoints-days') ?? (all ? 30 : undefined)
    const dedupeSkills = Boolean(options.dedupeSkills) || all

    if (exportsDays === undefined && checkpointsDays === undefined && !dedupeSkills) {
        throw new Error('No prune target specified. Use --all or one of: --exports-days, --checkpoints-days, --dedupe-skills')
    }

    const result: ReturnType<typeof runPrune> extends Promise<infer R> ? R : never = {}

    if (exportsDays !== undefined) {
        const r = await pruneFilesByAge('exports', path.join(paths.memoryDir, 'exports'), exportsDays, dryRun)
        result.exports = { matched: r.matched, removed: r.removed, bytes: r.bytes }
    }
    if (checkpointsDays !== undefined) {
        const r = await pruneFilesByAge('checkpoints', path.join(paths.memoryDir, 'checkpoints'), checkpointsDays, dryRun)
        result.checkpoints = { matched: r.matched, removed: r.removed, bytes: r.bytes }
    }
    if (dedupeSkills) {
        result.dedupe = pruneSkillsDuplicates(paths.dbPath, dryRun)
    }

    return result
}

// ─── Export ──────────────────────────────────────────────────────────────────

export async function exportMemory(paths: MemoriaPaths, options: ExportOptions): Promise<{
    filePath: string
    decisions: ExportDecision[]
    skills: ExportSkill[]
}> {
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
                ? (db.prepare(`
            SELECT e.id, e.session_id, e.timestamp, e.content, s.project
            FROM events e JOIN sessions s ON s.id = e.session_id
            WHERE e.event_type = 'DecisionMade'
          `).all() as { id: string; session_id: string; timestamp: string; content: string; project: string }[])
                : []

        const skillsRows =
            type === 'all' || type === 'skills'
                ? (db.prepare(`
            SELECT e.id, e.session_id, e.timestamp, e.content, s.project
            FROM events e JOIN sessions s ON s.id = e.session_id
            WHERE e.event_type = 'SkillLearned'
          `).all() as { id: string; session_id: string; timestamp: string; content: string; project: string }[])
                : []

        const decisions: ExportDecision[] = decisionsRows
            .filter((r) => (!projectFilter || r.project === projectFilter) && inDateRange(r.timestamp, from, to))
            .map((r) => {
                const content = maybeParseJson(r.content)
                const c = content && typeof content === 'object' && !Array.isArray(content) ? (content as Json) : {}
                return {
                    id: r.id, session_id: r.session_id, timestamp: r.timestamp, project: r.project,
                    decision: String(c.decision ?? ''), rationale: String(c.rationale ?? ''),
                    impact_level: String(c.impact_level ?? 'medium')
                }
            })

        const skills: ExportSkill[] = skillsRows
            .filter((r) => (!projectFilter || r.project === projectFilter) && inDateRange(r.timestamp, from, to))
            .map((r) => {
                const content = maybeParseJson(r.content)
                const c = content && typeof content === 'object' && !Array.isArray(content) ? (content as Json) : {}
                return {
                    id: r.id, session_id: r.session_id, timestamp: r.timestamp, project: r.project,
                    skill_name: String(c.skill_name ?? ''), category: String(c.category ?? 'general'),
                    pattern: String(c.pattern ?? '')
                }
            })

        await fs.mkdir(outDir, { recursive: true })
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        const projectPart = projectFilter ? `_${slugify(projectFilter).slice(0, 30)}` : ''
        const ext = format === 'json' ? 'json' : 'md'
        const filePath = path.join(outDir, `memoria-export_${type}${projectPart}_${stamp}.${ext}`)

        const payload = {
            generated_at: new Date().toISOString(),
            filters: { from: options.from ?? null, to: options.to ?? null, project: projectFilter ?? null, type, format },
            counts: { decisions: decisions.length, skills: skills.length },
            decisions, skills
        }

        if (format === 'json') {
            await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8')
        } else {
            const decisionBlock = decisions
                .map((d) => `- [${d.timestamp}] (${d.project}) ${d.decision || '(untitled)'} | impact=${d.impact_level} | session=${d.session_id}`)
                .join('\n')
            const skillBlock = skills
                .map((s) => `- [${s.timestamp}] (${s.project}) ${s.skill_name || '(untitled)'} | category=${s.category}`)
                .join('\n')
            const md = `# Memoria Export\n\nGenerated: ${payload.generated_at}\n\n## Filters\n- from: ${payload.filters.from ?? '(none)'}\n- to: ${payload.filters.to ?? '(none)'}\n- project: ${payload.filters.project ?? '(none)'}\n- type: ${type}\n\n## Counts\n- decisions: ${decisions.length}\n- skills: ${skills.length}\n\n## Decisions\n${decisionBlock || '- (none)'}\n\n## Skills\n${skillBlock || '- (none)'}\n`
            await fs.writeFile(filePath, md, 'utf8')
        }

        return { filePath, decisions, skills }
    } finally {
        db.close()
    }
}

// ─── Recall (keyword search) ─────────────────────────────────────────────────

export function recallKeyword(
    dbPath: string,
    query: string,
    projectFilter?: string,
    topK = 5,
    afterDate?: Date
): Array<{ type: string; id: string; session_id: string; timestamp: string; project: string; snippet: string }> {
    const db = new Database(dbPath, { readonly: true })
    const q = `%${query.toLowerCase()}%`
    try {
        const decisionRows = db.prepare(`
      SELECT e.id, e.session_id, e.timestamp, e.content, s.project
      FROM events e JOIN sessions s ON s.id = e.session_id
      WHERE e.event_type = 'DecisionMade'
        AND LOWER(e.content) LIKE ?
        ${projectFilter ? 'AND s.project = ?' : ''}
        ${afterDate ? 'AND e.timestamp >= ?' : ''}
      ORDER BY e.timestamp DESC
      LIMIT ?
    `).all(...[q, ...(projectFilter ? [projectFilter] : []), ...(afterDate ? [afterDate.toISOString()] : []), topK]) as
            { id: string; session_id: string; timestamp: string; content: string; project: string }[]

        const skillRows = db.prepare(`
      SELECT e.id, e.session_id, e.timestamp, e.content, s.project
      FROM events e JOIN sessions s ON s.id = e.session_id
      WHERE e.event_type = 'SkillLearned'
        AND LOWER(e.content) LIKE ?
        ${projectFilter ? 'AND s.project = ?' : ''}
        ${afterDate ? 'AND e.timestamp >= ?' : ''}
      ORDER BY e.timestamp DESC
      LIMIT ?
    `).all(...[q, ...(projectFilter ? [projectFilter] : []), ...(afterDate ? [afterDate.toISOString()] : []), topK]) as
            { id: string; session_id: string; timestamp: string; content: string; project: string }[]

        const sessionRows = db.prepare(`
      SELECT id, id AS session_id, timestamp, COALESCE(summary, '') AS content, project
      FROM sessions
      WHERE (LOWER(summary) LIKE ? OR LOWER(project) LIKE ?)
        ${projectFilter ? 'AND project = ?' : ''}
        ${afterDate ? 'AND timestamp >= ?' : ''}
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(...[q, q, ...(projectFilter ? [projectFilter] : []), ...(afterDate ? [afterDate.toISOString()] : []), topK]) as
            { id: string; session_id: string; timestamp: string; content: string; project: string }[]

        const all = [
            ...decisionRows.map((r) => ({ type: 'decision' as const, ...r })),
            ...skillRows.map((r) => ({ type: 'skill' as const, ...r })),
            ...sessionRows.map((r) => ({ type: 'session' as const, ...r }))
        ]

        return all
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, topK)
            .map((r) => {
                const parsed = maybeParseJson(r.content)
                const snippet =
                    typeof parsed === 'object' && parsed !== null
                        ? JSON.stringify(parsed).slice(0, 200)
                        : String(r.content).slice(0, 200)
                return { type: r.type, id: r.id, session_id: r.session_id, timestamp: r.timestamp, project: r.project, snippet }
            })
    } finally {
        db.close()
    }
}

// ─── Session summary query ───────────────────────────────────────────────────

export function querySessionSummary(
    dbPath: string,
    sessionId: string
): {
    session: { id: string; timestamp: string; project: string; event_count: number; summary: string }
    decisions: Array<{ id: string; decision: string; impact_level: string }>
    skills: Array<{ id: string; skill_name: string; category: string }>
} | null {
    const db = new Database(dbPath, { readonly: true })
    try {
        const session = db
            .prepare('SELECT id, timestamp, project, event_count, summary FROM sessions WHERE id = ?')
            .get(sessionId) as { id: string; timestamp: string; project: string; event_count: number; summary: string } | undefined

        if (!session) return null

        const decisionEvents = db
            .prepare(`SELECT id, content FROM events WHERE session_id = ? AND event_type = 'DecisionMade'`)
            .all(sessionId) as { id: string; content: string }[]

        const skillEvents = db
            .prepare(`SELECT id, content FROM events WHERE session_id = ? AND event_type = 'SkillLearned'`)
            .all(sessionId) as { id: string; content: string }[]

        const decisions = decisionEvents.map((row) => {
            const c = maybeParseJson(row.content)
            const obj = c && typeof c === 'object' && !Array.isArray(c) ? (c as Json) : {}
            return {
                id: row.id,
                decision: String(obj.decision ?? ''),
                impact_level: String(obj.impact_level ?? 'medium')
            }
        })

        const skills = skillEvents.map((row) => {
            const c = maybeParseJson(row.content)
            const obj = c && typeof c === 'object' && !Array.isArray(c) ? (c as Json) : {}
            return {
                id: row.id,
                skill_name: String(obj.skill_name ?? ''),
                category: String(obj.category ?? 'general')
            }
        })

        return { session, decisions, skills }
    } finally {
        db.close()
    }
}
