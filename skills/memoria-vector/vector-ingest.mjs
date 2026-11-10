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
import { importDep } from './deps.mjs'
import { embedTexts, DIM } from './embed.mjs'

const { createClient } = await importDep('@libsql/client')

const EMBEDDABLE_TYPES = new Set(['session', 'decision', 'skill', 'memory_node'])

// Without this a local store fails with SQLITE_BUSY the moment another process holds the lock.
// One row can wait out most of a competing ingest, because that writer commits row after row with
// almost no gap: at 1577 rows, 44s alone, a single statement waited 53s among four ingests. So this
// is sized for whole ingests rather than one row, and stays under setup's 10-minute child limit.
// Remote clients ignore it.
const BUSY_TIMEOUT_MS = 300_000

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
  console.log(JSON.stringify({ ok: true, embedded: 0, unchanged: 0, skipped: 0 }))
  process.exit(0)
}

const texts = entities.map((e) => [e.name, e.text].filter(Boolean).join('\n').slice(0, 2000) || String(e.id))

// issue-31: the doctor repair has no cursor and hands over the whole corpus, so embedding every row
// cost ~3.5 min and 2.6GB to fill 2 gaps — per agent, and several agents wrap up at once. A row whose
// kind and text match what is stored already holds that text's vector; only the rest are embedded.
// Switching MEMORIA_EMBED_MODEL or MEMORIA_EMBED_PROVIDER leaves the text unchanged, so either
// needs a fresh store (README).
const LOOKUP_CHUNK = 500

const db = createClient({ url, authToken: process.env.LIBSQL_AUTH_TOKEN, timeout: BUSY_TIMEOUT_MS })
try {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS memoria_vectors (name TEXT PRIMARY KEY, kind TEXT, text TEXT, updated_at TEXT, v F32_BLOB(${DIM}))`
  )
  await db.execute(`CREATE INDEX IF NOT EXISTS memoria_vectors_idx ON memoria_vectors (libsql_vector_idx(v))`)

  const stored = new Map()
  for (let start = 0; start < entities.length; start += LOOKUP_CHUNK) {
    const names = entities.slice(start, start + LOOKUP_CHUNK).map((e) => e.id)
    const rows = await db.execute({
      sql: `SELECT name, kind, text FROM memoria_vectors WHERE name IN (${names.map(() => '?').join(', ')})`,
      args: names
    })
    for (const row of rows.rows) stored.set(String(row.name), row)
  }
  const pending = []
  for (let i = 0; i < entities.length; i++) {
    const row = stored.get(entities[i].id)
    if (!row || row.kind !== String(entities[i].type) || row.text !== texts[i]) pending.push(i)
  }

  if (pending.length > 0) {
    const vectors = await embedTexts(pending.map((i) => texts[i]), 'passage')
    const now = new Date().toISOString()
    // One commit per row, never one transaction around them all: a local store uses a rollback
    // journal, so readers are locked out for a whole write transaction. Wrapping 2500 rows kept
    // semantic recall waiting past its 1.5s timeout, and 7 of 9 recalls fell back to lexical
    // (issue-31 review M-1). The gaps between row commits are what a recall gets through.
    for (let k = 0; k < pending.length; k++) {
      const i = pending[k]
      await db.execute({
        sql: `INSERT INTO memoria_vectors (name, kind, text, updated_at, v) VALUES (?, ?, ?, ?, vector32(?))
              ON CONFLICT(name) DO UPDATE SET kind = excluded.kind, text = excluded.text, updated_at = excluded.updated_at, v = excluded.v`,
        args: [entities[i].id, String(entities[i].type), texts[i], now, JSON.stringify(vectors[k])]
      })
    }
  }
  console.log(JSON.stringify({
    ok: true,
    embedded: pending.length,
    unchanged: entities.length - pending.length,
    skipped: (payload.entities?.length ?? 0) - entities.length
  }))
} finally {
  db.close()
}
