#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import Database from 'better-sqlite3'

function parseArgs(argv) {
  const args = { memoriaHome: process.cwd(), outDir: null, sessionId: null }
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i]
    const next = argv[i + 1]
    if (token === '--memoria-home' && next) {
      args.memoriaHome = path.resolve(next)
      i += 1
      continue
    }
    if (token === '--out' && next) {
      args.outDir = path.resolve(next)
      i += 1
      continue
    }
    if (token === '--session-id' && next) {
      args.sessionId = next
      i += 1
      continue
    }
    throw new Error(`Unknown or incomplete argument: ${token}`)
  }
  return args
}

function maybeParseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function uniquePush(map, key, value) {
  if (!map.has(key)) map.set(key, value)
}

async function main() {
  const args = parseArgs(process.argv)
  const dbPath = path.join(args.memoriaHome, '.memory', 'sessions.db')
  const outDir = args.outDir ?? path.join(args.memoriaHome, '.memory', 'exports', 'mcp-bridge')

  const db = new Database(dbPath, { readonly: true })

  try {
    const latestSession = db
      .prepare('SELECT id FROM sessions ORDER BY timestamp DESC LIMIT 1')
      .get()

    const sessionId = args.sessionId ?? latestSession?.id
    if (!sessionId) {
      throw new Error('No session found to bridge. Run sync first or provide --session-id.')
    }

    const session = db
      .prepare('SELECT id, timestamp, project, summary, event_count FROM sessions WHERE id = ?')
      .get(sessionId)

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const events = db
      .prepare('SELECT id, timestamp, event_type, content, metadata FROM events WHERE session_id = ? ORDER BY timestamp ASC')
      .all(sessionId)

    const skillRows = db
      .prepare('SELECT id, name, category, created_date, success_rate, use_count, filepath FROM skills ORDER BY created_date DESC LIMIT 200')
      .all()

    const entities = new Map()
    const relations = []

    const sessionEntityId = `session:${session.id}`
    const projectEntityId = `project:${String(session.project ?? 'default').trim() || 'default'}`

    uniquePush(entities, sessionEntityId, {
      id: sessionEntityId,
      type: 'session',
      name: session.id,
      text: String(session.summary ?? ''),
      metadata: {
        timestamp: session.timestamp,
        project: session.project,
        event_count: session.event_count
      }
    })

    uniquePush(entities, projectEntityId, {
      id: projectEntityId,
      type: 'project',
      name: String(session.project ?? 'default'),
      text: `Project memory container for ${String(session.project ?? 'default')}`,
      metadata: {}
    })

    relations.push({ from: sessionEntityId, to: projectEntityId, type: 'belongs_to_project' })

    for (const row of events) {
      const eventEntityId = `event:${row.id}`
      const content = maybeParseJson(String(row.content ?? ''))
      const metadata = maybeParseJson(String(row.metadata ?? ''))

      uniquePush(entities, eventEntityId, {
        id: eventEntityId,
        type: 'event',
        name: String(row.event_type ?? 'UnknownEvent'),
        text: typeof content === 'string' ? content : JSON.stringify(content),
        metadata: {
          timestamp: row.timestamp,
          event_type: row.event_type,
          metadata
        }
      })

      relations.push({ from: sessionEntityId, to: eventEntityId, type: 'has_event' })

      if (row.event_type === 'DecisionMade' && content && typeof content === 'object' && !Array.isArray(content)) {
        const decisionTitle = String(content.decision ?? '').trim() || 'Untitled Decision'
        const decisionEntityId = `decision:${row.id}`
        uniquePush(entities, decisionEntityId, {
          id: decisionEntityId,
          type: 'decision',
          name: decisionTitle,
          text: JSON.stringify(content),
          metadata: { timestamp: row.timestamp }
        })
        relations.push({ from: eventEntityId, to: decisionEntityId, type: 'captures_decision' })
      }

      if (row.event_type === 'SkillLearned' && content && typeof content === 'object' && !Array.isArray(content)) {
        const skillName = String(content.skill_name ?? '').trim() || 'Untitled Skill'
        const skillEntityId = `skill:${skillName.toLowerCase().replace(/\s+/g, '_')}`
        uniquePush(entities, skillEntityId, {
          id: skillEntityId,
          type: 'skill',
          name: skillName,
          text: JSON.stringify(content),
          metadata: { timestamp: row.timestamp }
        })
        relations.push({ from: eventEntityId, to: skillEntityId, type: 'learns_skill' })
      }
    }

    for (const skill of skillRows) {
      const skillEntityId = `skill:${String(skill.id)}`
      uniquePush(entities, skillEntityId, {
        id: skillEntityId,
        type: 'skill_profile',
        name: String(skill.name),
        text: `success_rate=${skill.success_rate}, use_count=${skill.use_count}`,
        metadata: {
          category: skill.category,
          created_date: skill.created_date,
          filepath: skill.filepath
        }
      })
    }

    await fs.mkdir(outDir, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const payloadPath = path.join(outDir, `mcp-bridge-${session.id}-${timestamp}.json`)

    const payload = {
      version: '1',
      source: 'memoria',
      session_id: session.id,
      generated_at: new Date().toISOString(),
      entities: Array.from(entities.values()),
      relations
    }

    await fs.writeFile(payloadPath, JSON.stringify(payload, null, 2), 'utf8')
    console.log(payloadPath)
  } finally {
    db.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
