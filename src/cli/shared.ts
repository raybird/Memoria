import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import {
    safeDate,
    slugify,
    resolveSessionId,
    resolveEventId,
    getEventType,
    getEventContentObject,
    existsSync
} from '../core/index.js'
import type { SessionData, SessionEvent, MemoriaPaths } from '../core/index.js'

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

export async function readSession(sessionFile: string): Promise<SessionData> {
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

export function previewSync(paths: MemoriaPaths, sessionFile: string, sessionData: SessionData): void {
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
