#!/usr/bin/env node
// Semantic recall query helper: embed the query, run libSQL vector_top_k, print ranked names.
//
// stdin:  {"query": "...", "topK": 15}
// stdout: {"hits": [{"name": "session:abc", "kind": "session", "distance": 0.12}, ...]}
// Env:    LIBSQL_URL (required), LIBSQL_AUTH_TOKEN, MEMORIA_EMBED_PROVIDER
//
// Order matters, distances are cosine (lower = closer). The caller (src/core/recall-vector.ts)
// treats any non-zero exit / malformed output as a fail-open condition, so errors here just exit 1
// with the reason on stderr — never a partial JSON on stdout.

import { createClient } from '@libsql/client'
import { embedTexts } from './embed.mjs'

const raw = await new Promise((resolve) => {
  let buf = ''
  process.stdin.on('data', (c) => { buf += c })
  process.stdin.on('end', () => resolve(buf))
})
const input = JSON.parse(raw || '{}')
const query = String(input.query ?? '').trim()
const topK = Math.min(100, Math.max(1, Math.floor(Number(input.topK) || 15)))
if (!query) {
  console.log(JSON.stringify({ hits: [] }))
  process.exit(0)
}
const url = process.env.LIBSQL_URL?.trim()
if (!url) {
  console.error('LIBSQL_URL is required')
  process.exit(1)
}

const [qvec] = await embedTexts([query], 'query')
const db = createClient({ url, authToken: process.env.LIBSQL_AUTH_TOKEN })
try {
  const table = await db.execute(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memoria_vectors' LIMIT 1`)
  if (table.rows.length === 0) {
    console.log(JSON.stringify({ hits: [] }))
    process.exit(0)
  }
  let rows
  try {
    // ANN path via the DiskANN index.
    const r = await db.execute({
      sql: `SELECT mv.name, mv.kind, vector_distance_cos(mv.v, vector32(?)) AS distance
            FROM vector_top_k('memoria_vectors_idx', vector32(?), ?) AS tk
            JOIN memoria_vectors mv ON mv.rowid = tk.id
            ORDER BY distance`,
      args: [JSON.stringify(qvec), JSON.stringify(qvec), topK]
    })
    rows = r.rows
  } catch {
    // Index missing/stale → exact scan (corpora are small; correctness over speed).
    const r = await db.execute({
      sql: `SELECT name, kind, vector_distance_cos(v, vector32(?)) AS distance
            FROM memoria_vectors ORDER BY distance LIMIT ?`,
      args: [JSON.stringify(qvec), topK]
    })
    rows = r.rows
  }
  console.log(JSON.stringify({
    hits: rows.map((r) => ({ name: String(r.name), kind: String(r.kind ?? ''), distance: Number(r.distance) }))
  }))
} finally {
  db.close()
}
