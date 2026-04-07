import fs from 'node:fs/promises'
import path from 'node:path'
import { upsertWikiPage, upsertWikiQueryArtifact } from './db.js'
import type { FileQueryInput, FiledQueryData, MemoriaPaths, RecallHit, WikiPageType } from './types.js'
import { shortHash, slugify } from './utils.js'

function renderFiledQueryPage(input: {
    title: string
    query: string
    kind: WikiPageType
    scope: string
    hits: RecallHit[]
}): string {
    const evidence = input.hits
        .map((hit) => `- ${hit.type} \`${hit.id}\` (${hit.project}, ${hit.timestamp})\n  - ${hit.snippet}`)
        .join('\n')

    return `# ${input.title}

## Metadata
- Query: ${input.query}
- Kind: ${input.kind}
- Scope: ${input.scope}

## Synthesis
${input.hits.length > 0
        ? `This page was filed from a query over ${input.hits.length} supporting recall hit(s).`
        : 'No supporting hits were available.'}

## Evidence
${evidence || '- (none)'}
`
}

export async function fileQueryResult(paths: MemoriaPaths, input: FileQueryInput, hits: RecallHit[]): Promise<FiledQueryData> {
    const createdAt = new Date().toISOString()
    const scope = input.scope?.trim() || 'global'
    const pageType: WikiPageType = input.kind
    const slug = `${input.kind}-${slugify(input.title).toLowerCase() || shortHash(input.query, 8)}-${shortHash(`${input.query}:${createdAt}`, 8)}`
    const subdir = input.kind === 'comparison' ? 'Comparisons' : 'Syntheses'
    const dirPath = path.join(paths.knowledgeDir, subdir)
    const pagePath = path.join(dirPath, `${slug}.md`)
    const pageId = `page_${shortHash(pagePath, 24)}`

    await fs.mkdir(dirPath, { recursive: true })

    const page = upsertWikiPage(paths.dbPath, {
        id: pageId,
        slug,
        title: input.title,
        page_type: pageType,
        scope,
        summary: `Filed query for ${input.query}`.slice(0, 220),
        filepath: pagePath,
        status: 'active',
        confidence: hits.length > 0 ? hits[0].score : 0,
        last_built_at: createdAt,
        metadata: {
            filed_from_query: true,
            hit_count: hits.length
        }
    })

    await fs.writeFile(pagePath, renderFiledQueryPage({ title: input.title, query: input.query, kind: pageType, scope, hits }), 'utf8')

    const artifact = upsertWikiQueryArtifact(paths.dbPath, {
        id: `qa_${shortHash(`${input.query}:${page.id}:${createdAt}`, 24)}`,
        query: input.query,
        kind: input.kind,
        page_id: page.id,
        created_at: createdAt,
        metadata: {
            title: input.title,
            scope,
            hit_ids: hits.map((hit) => hit.id)
        }
    })

    return { artifact, page, hits }
}
