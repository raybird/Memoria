#!/usr/bin/env node

import fs from 'node:fs/promises'
import path from 'node:path'

function parseArgs(argv) {
  const args = { payload: '', outDir: '' }
  for (let i = 2; i < argv.length; i += 1) {
    const token = argv[i]
    const next = argv[i + 1]
    if (token === '--payload' && next) {
      args.payload = path.resolve(next)
      i += 1
      continue
    }
    if (token === '--out' && next) {
      args.outDir = path.resolve(next)
      i += 1
      continue
    }
    throw new Error(`Unknown or incomplete argument: ${token}`)
  }

  if (!args.payload) throw new Error('Missing required --payload <file>')
  return args
}

function toObservationList(entity) {
  const observations = []
  if (typeof entity.text === 'string' && entity.text.trim()) observations.push(entity.text)
  if (entity.metadata && typeof entity.metadata === 'object') {
    observations.push(`metadata=${JSON.stringify(entity.metadata)}`)
  }
  return observations.length > 0 ? observations : ['(empty)']
}

async function main() {
  const args = parseArgs(process.argv)
  const raw = await fs.readFile(args.payload, 'utf8')
  const payload = JSON.parse(raw)

  const entityNameById = new Map()
  const entities = (payload.entities ?? []).map((entity) => {
    const name = String(entity.id ?? entity.name ?? '').trim()
    if (!name) throw new Error('Entity missing id/name in payload')
    entityNameById.set(String(entity.id ?? name), name)

    return {
      name,
      entityType: String(entity.type ?? 'memory_node'),
      observations: toObservationList(entity)
    }
  })

  const relations = (payload.relations ?? [])
    .map((relation) => {
      const source = entityNameById.get(String(relation.from ?? ''))
      const target = entityNameById.get(String(relation.to ?? ''))
      if (!source || !target) return null
      return {
        source,
        target,
        type: String(relation.type ?? 'related_to')
      }
    })
    .filter(Boolean)

  const requestBundle = {
    create_entities: { entities },
    create_relations: { relations },
    verify: {
      read_graph: {},
      search_nodes: { query: String(payload.session_id ?? 'session') }
    },
    _meta: {
      sync: payload.sync ?? null,
      generated_at: payload.generated_at ?? null,
      source: payload.source ?? 'memoria'
    }
  }

  const outDir = args.outDir || path.dirname(args.payload)
  await fs.mkdir(outDir, { recursive: true })

  const base = path.basename(args.payload, path.extname(args.payload))
  const outPath = path.join(outDir, `${base}.mcp-requests.json`)
  await fs.writeFile(outPath, JSON.stringify(requestBundle, null, 2), 'utf8')
  console.log(outPath)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
