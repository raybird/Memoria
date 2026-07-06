import { existsSync } from '../paths.js'
import { safeDate, deriveScope, resolveSessionId, resolveEventId, maybeParseJson, sanitizeSessionDataForImport } from '../utils.js'
import { initDatabase } from './schema.js'
import { withDb } from './connection.js'
import type { Json, SessionData, RecentSessionRecord } from '../types.js'

export function importSession(dbPath: string, sessionData: SessionData): string {
    const nowIso = new Date().toISOString()
    const sanitized = sanitizeSessionDataForImport(sessionData)
    const sessionId = resolveSessionId(sanitized)
    const timestamp = safeDate(sanitized.timestamp).toISOString()
    const scope = deriveScope(sanitized)
    const events = sanitized.events ?? []

    withDb(dbPath, (db) => {
        const upsertSession = db.prepare(`
      INSERT OR REPLACE INTO sessions (id, timestamp, project, scope, event_count, summary)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

        upsertSession.run(
            sessionId,
            timestamp,
            sanitized.project ?? 'default',
            scope,
            events.length,
            sanitized.summary ?? ''
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
    })

    return sessionId
}

export function listRecentSessions(dbPath: string, limitRaw = 10): RecentSessionRecord[] {
    if (!existsSync(dbPath)) return []
    initDatabase(dbPath)
    return withDb(dbPath, { readonly: true }, (db) => {
        const limit = Math.min(100, Math.max(1, Math.floor(limitRaw)))
        return db.prepare(`
          SELECT id, timestamp, project, scope, summary
          FROM sessions
          ORDER BY timestamp DESC
          LIMIT ?
        `).all(limit) as RecentSessionRecord[]
    })
}

export function querySessionSummary(
    dbPath: string,
    sessionId: string
): {
    session: { id: string; timestamp: string; project: string; scope: string; event_count: number; summary: string }
    decisions: Array<{ id: string; decision: string; impact_level: string }>
    skills: Array<{ id: string; skill_name: string; category: string }>
} | null {
    return withDb(dbPath, { readonly: true }, (db) => {
        const session = db
            .prepare('SELECT id, timestamp, project, scope, event_count, summary FROM sessions WHERE id = ?')
            .get(sessionId) as { id: string; timestamp: string; project: string; scope: string; event_count: number; summary: string } | undefined

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
    })
}
