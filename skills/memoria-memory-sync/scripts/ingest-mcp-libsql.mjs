#!/usr/bin/env node

import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'

function parseArgs(argv) {
  const args = {
    requests: '',
    serverCommand: process.env.MEMORIA_MCP_SERVER_COMMAND || 'npx',
    serverArgs: process.env.MEMORIA_MCP_SERVER_ARGS || '-y mcp-memory-libsql',
    timeoutMs: Number(process.env.MEMORIA_MCP_TIMEOUT_MS || '45000')
  }

  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i]
    const next = argv[i + 1]
    if (token === '--requests' && next) {
      args.requests = next
      i += 1
      continue
    }
    if (token === '--server-command' && next) {
      args.serverCommand = next
      i += 1
      continue
    }
    if (token === '--server-args' && next) {
      args.serverArgs = next
      i += 1
      continue
    }
    if (token === '--timeout-ms' && next) {
      args.timeoutMs = Number(next)
      i += 1
      continue
    }
    throw new Error(`Unknown or incomplete argument: ${token}`)
  }

  if (!args.requests) {
    throw new Error('Missing required --requests <file>')
  }

  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 1000) {
    throw new Error('Invalid timeout; use --timeout-ms >= 1000')
  }

  return args
}

function parseArgsString(input) {
  const out = []
  let current = ''
  let quote = ''
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    if (quote) {
      if (ch === quote) {
        quote = ''
      } else {
        current += ch
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      if (current) {
        out.push(current)
        current = ''
      }
      continue
    }
    current += ch
  }
  if (current) out.push(current)
  return out
}

function parseJsonLine(line) {
  const text = line.trim()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function main() {
  const args = parseArgs(process.argv)
  const raw = await fs.readFile(args.requests, 'utf8')
  const requests = JSON.parse(raw)

  if (!process.env.LIBSQL_URL) {
    throw new Error('LIBSQL_URL is required to ingest into mcp-memory-libsql')
  }

  const child = spawn(args.serverCommand, parseArgsString(args.serverArgs), {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env
  })

  const pending = new Map()
  let nextId = 1

  const timeoutAt = Date.now() + args.timeoutMs
  const failAll = (error) => {
    for (const [, entry] of pending) {
      entry.reject(error)
    }
    pending.clear()
  }

  child.on('error', (error) => failAll(error))
  child.on('exit', (code) => {
    if (pending.size > 0) {
      failAll(new Error(`MCP server exited before response (code=${code ?? 'null'})`))
    }
  })

  let stdoutBuffer = ''
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString('utf8')
    while (true) {
      const idx = stdoutBuffer.indexOf('\n')
      if (idx < 0) break
      const line = stdoutBuffer.slice(0, idx)
      stdoutBuffer = stdoutBuffer.slice(idx + 1)
      const message = parseJsonLine(line)
      if (!message || typeof message !== 'object') continue
      if (Object.prototype.hasOwnProperty.call(message, 'id') && pending.has(message.id)) {
        const entry = pending.get(message.id)
        pending.delete(message.id)
        if (message.error) {
          entry.reject(new Error(typeof message.error?.message === 'string' ? message.error.message : 'MCP error'))
        } else {
          entry.resolve(message.result)
        }
      }
    }
  })

  child.stderr.on('data', (chunk) => {
    const msg = chunk.toString('utf8').trim()
    if (msg) process.stderr.write(`[mcp-memory-libsql] ${msg}\n`)
  })

  const send = (payload) => {
    child.stdin.write(`${JSON.stringify(payload)}\n`)
  }

  const request = (method, params) => {
    const id = nextId
    nextId += 1
    const p = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
    })
    send({ jsonrpc: '2.0', id, method, params })
    return p
  }

  const ensureNotTimedOut = () => {
    if (Date.now() > timeoutAt) throw new Error('Timed out while ingesting MCP requests')
  }

  try {
    ensureNotTimedOut()
    await request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'memoria-mcp-bridge', version: '1.0.0' }
    })
    send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })

    ensureNotTimedOut()
    const entitiesPayload = requests.create_entities ?? { entities: [] }
    const relationsPayload = requests.create_relations ?? { relations: [] }

    const entityCount = Array.isArray(entitiesPayload.entities) ? entitiesPayload.entities.length : 0
    const relationCount = Array.isArray(relationsPayload.relations) ? relationsPayload.relations.length : 0

    await request('tools/call', {
      name: 'create_entities',
      arguments: entitiesPayload
    })

    await request('tools/call', {
      name: 'create_relations',
      arguments: relationsPayload
    })

    const verifyQuery = requests.verify?.search_nodes?.query
    if (typeof verifyQuery === 'string' && verifyQuery.trim()) {
      await request('tools/call', {
        name: 'search_nodes',
        arguments: { query: verifyQuery }
      })
    }

    console.log(`Ingested into mcp-memory-libsql: entities=${entityCount}, relations=${relationCount}`)
  } finally {
    child.kill('SIGTERM')
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
