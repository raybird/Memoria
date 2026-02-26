#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import Database from 'better-sqlite3'

function parseArgs(argv) {
  const args = {
    memoriaHome: process.cwd(),
    outDir: null,
    sessionId: null,
    syncTarget: process.env.MEMORIA_MCP_SYNC_TARGET || 'mcp-memory-libsql',
    payloadMode: process.env.MEMORIA_MCP_PAYLOAD_MODE || 'incremental'
  }
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
    if (token === '--sync-target' && next) {
      args.syncTarget = next
      i += 1
      continue
    }
    if (token === '--payload-mode' && next) {
      args.payloadMode = next
      i += 1
      continue
    }
    throw new Error(`Unknown or incomplete argument: ${token}`)
  }

  if (args.payloadMode !== 'incremental' && args.payloadMode !== 'full') {
    throw new Error(`Invalid --payload-mode '${args.payloadMode}'. Use incremental|full`)
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

function normalizeSyncCursor(raw) {
  if (!raw || typeof raw !== 'string') return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function maxIsoDate(a, b) {
  if (!a) return b
  if (!b) return a
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b
}

function pushSessionGraph({ db, sessionId, entities, relations }) {
  const session = db
    .prepare('SELECT id, timestamp, project, summary, event_count FROM sessions WHERE id = ?')
    .get(sessionId)
  if (!session) return

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

  const events = db
    .prepare('SELECT id, timestamp, event_type, content, metadata FROM events WHERE session_id = ? ORDER BY timestamp ASC')
    .all(sessionId)

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
      .prepare('SELECT id FROM sessions WHERE id = ?')
      .get(sessionId)

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    const syncState = db
      .prepare('SELECT cursor_updated_at FROM memory_sync_state WHERE target = ?')
      .get(args.syncTarget)
    const cursorBefore = normalizeSyncCursor(syncState?.cursor_updated_at)

    const changedNodes = db.prepare(`
      SELECT id, parent_id, project, title, summary, level, path_key, updated_at
      FROM memory_nodes
      WHERE updated_at IS NOT NULL
      ${cursorBefore ? 'AND updated_at > ?' : ''}
      ORDER BY updated_at ASC
    `).all(...[...(cursorBefore ? [cursorBefore] : [])])

    const changedNodeIds = changedNodes.map((row) => String(row.id))
    const nodeSources = changedNodeIds.length > 0
      ? db.prepare(`
        SELECT node_id, session_id
        FROM memory_node_sources
        WHERE node_id IN (${changedNodeIds.map(() => '?').join(', ')})
      `).all(...changedNodeIds)
      : []

    const entities = new Map()
    const relations = []
    let cursorAfter = cursorBefore

    const affectedSessionIds = Array.from(new Set(nodeSources.map((edge) => String(edge.session_id)).filter(Boolean)))
    if (args.payloadMode === 'full' && !affectedSessionIds.includes(sessionId)) {
      affectedSessionIds.push(sessionId)
    }

    for (const sid of affectedSessionIds) {
      pushSessionGraph({ db, sessionId: sid, entities, relations })
    }

    if (args.payloadMode === 'full') {
      const skillRows = db
        .prepare('SELECT id, name, category, created_date, success_rate, use_count, filepath FROM skills ORDER BY created_date DESC LIMIT 200')
        .all()

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
    }

    for (const node of changedNodes) {
      const nodeId = String(node.id)
      const entityId = `mem_node:${nodeId}`
      uniquePush(entities, entityId, {
        id: entityId,
        type: 'memory_node',
        name: String(node.title ?? node.id),
        text: String(node.summary ?? ''),
        metadata: {
          node_id: nodeId,
          parent_id: node.parent_id,
          project: node.project,
          level: node.level,
          path_key: node.path_key,
          updated_at: node.updated_at
        }
      })

      const nodeUpdatedAt = normalizeSyncCursor(node.updated_at)
      cursorAfter = maxIsoDate(cursorAfter, nodeUpdatedAt)

      if (node.parent_id) {
        relations.push({
          from: `mem_node:${String(node.parent_id)}`,
          to: entityId,
          type: 'contains_node'
        })
      }
    }

    for (const edge of nodeSources) {
      relations.push({
        from: `mem_node:${String(edge.node_id)}`,
        to: `session:${String(edge.session_id)}`,
        type: 'references_session'
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
      payload_mode: args.payloadMode,
      memoria_home: args.memoriaHome,
      db_path: dbPath,
      sync: {
        target: args.syncTarget,
        cursor_before: cursorBefore,
        cursor_after: cursorAfter,
        changed_node_count: changedNodeIds.length,
        changed_node_ids: changedNodeIds,
        affected_session_ids: affectedSessionIds
      },
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
