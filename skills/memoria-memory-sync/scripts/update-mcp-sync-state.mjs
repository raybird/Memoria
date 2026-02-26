#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'
import Database from 'better-sqlite3'

function parseArgs(argv) {
  const args = {
    payload: '',
    target: process.env.MEMORIA_MCP_SYNC_TARGET || ''
  }

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i]
    const next = argv[i + 1]
    if (token === '--payload' && next) {
      args.payload = path.resolve(next)
      i += 1
      continue
    }
    if (token === '--target' && next) {
      args.target = next
      i += 1
      continue
    }
    throw new Error(`Unknown or incomplete argument: ${token}`)
  }

  if (!args.payload) throw new Error('Missing required --payload <file>')
  return args
}

function normalizeIso(raw) {
  if (!raw || typeof raw !== 'string') return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

async function main() {
  const args = parseArgs(process.argv)
  const raw = await fs.readFile(args.payload, 'utf8')
  const payload = JSON.parse(raw)

  const target = String(args.target || payload?.sync?.target || 'mcp-memory-libsql')
  const cursorAfter = normalizeIso(payload?.sync?.cursor_after)
  const dbPath = typeof payload?.db_path === 'string' && payload.db_path.trim()
    ? payload.db_path
    : path.join(String(payload?.memoria_home ?? process.cwd()), '.memory', 'sessions.db')

  if (!cursorAfter) {
    console.log('No cursor update needed (cursor_after missing).')
    return
  }

  const changedNodeIds = Array.isArray(payload?.sync?.changed_node_ids)
    ? payload.sync.changed_node_ids.map((id) => String(id)).filter(Boolean)
    : []

  const db = new Database(dbPath)
  try {
    const upsertSync = db.prepare(`
      INSERT OR REPLACE INTO memory_sync_state (target, cursor_updated_at, updated_at)
      VALUES (?, ?, ?)
    `)

    const markNode = db.prepare('UPDATE memory_nodes SET last_synced_at = ? WHERE id = ?')

    const nowIso = new Date().toISOString()
    const tx = db.transaction(() => {
      upsertSync.run(target, cursorAfter, nowIso)
      for (const id of changedNodeIds) {
        markNode.run(nowIso, id)
      }
    })

    tx()
    console.log(`Updated sync cursor for ${target}: ${cursorAfter}; nodes=${changedNodeIds.length}`)
  } finally {
    db.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
