#!/usr/bin/env node
// Embed a Memoria MCP-bridge payload's entities and upsert them into libSQL native vectors.
//
// Usage: node vector-ingest.mjs <bridge-payload.json>
// Env:   LIBSQL_URL (required), LIBSQL_AUTH_TOKEN, MEMORIA_EMBED_PROVIDER
//
// Reads the SAME payload emitted by build-mcp-bridge-payload.mjs — entity ids are the prefixed
// Memoria ids (session:<id> / decision:<event_id> / skill:<slug> / mem_node:<node_id>), which is
// exactly what the recall side parses back. Only content-bearing entity types are embedded;
// project: and skill_profile entities carry no recallable prose and are skipped.
//
// This is the OFFLINE path (sync time) — latency here never touches the recall hot path.

import fs from 'node:fs'
import { createClient } from '@libsql/client'
import { embedTexts, DIM } from './embed.mjs'

const EMBEDDABLE_TYPES = new Set(['session', 'decision', 'skill', 'memory_node'])

const payloadPath = process.argv[2]
if (!payloadPath || !fs.existsSync(payloadPath)) {
  console.error('Usage: node vector-ingest.mjs <bridge-payload.json>')
  process.exit(1)
}
const url = process.env.LIBSQL_URL?.trim()
if (!url) {
  console.error('LIBSQL_URL is required')
  process.exit(1)
}

const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'))
const entities = (Array.isArray(payload.entities) ? payload.entities : []).filter(
  (e) => e && typeof e.id === 'string' && EMBEDDABLE_TYPES.has(String(e.type ?? ''))
)

if (entities.length === 0) {
  console.log(JSON.stringify({ ok: true, embedded: 0, skipped: 0 }))
  process.exit(0)
}

const texts = entities.map((e) => [e.name, e.text].filter(Boolean).join('\n').slice(0, 2000) || String(e.id))
const vectors = await embedTexts(texts, 'passage')

const db = createClient({ url, authToken: process.env.LIBSQL_AUTH_TOKEN })
try {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS memoria_vectors (name TEXT PRIMARY KEY, kind TEXT, text TEXT, updated_at TEXT, v F32_BLOB(${DIM}))`
  )
  await db.execute(`CREATE INDEX IF NOT EXISTS memoria_vectors_idx ON memoria_vectors (libsql_vector_idx(v))`)
  const now = new Date().toISOString()
  for (let i = 0; i < entities.length; i++) {
    await db.execute({
      sql: `INSERT INTO memoria_vectors (name, kind, text, updated_at, v) VALUES (?, ?, ?, ?, vector32(?))
            ON CONFLICT(name) DO UPDATE SET kind = excluded.kind, text = excluded.text, updated_at = excluded.updated_at, v = excluded.v`,
      args: [entities[i].id, String(entities[i].type), texts[i], now, JSON.stringify(vectors[i])]
    })
  }
  console.log(JSON.stringify({ ok: true, embedded: entities.length, skipped: (payload.entities?.length ?? 0) - entities.length }))
} finally {
  db.close()
}
