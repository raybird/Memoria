import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
    getWikiPageBySlug,
    listSourceRecords,
    upsertSourceRecord,
    upsertWikiPage,
    upsertWikiPageSourceLink
} from './db.js'
import type { ImportSourceInput, ImportedSourceData, MemoriaPaths, SourceType } from './types.js'
import { shortHash, slugify } from './utils.js'

function inferSourceType(filePath: string): Extract<SourceType, 'note' | 'article' | 'document'> {
    const ext = path.extname(filePath).toLowerCase()
    if (ext === '.md' || ext === '.markdown') return 'article'
    if (ext === '.txt') return 'note'
    return 'document'
}

function summarizeText(content: string): string {
    const normalized = content.replace(/\r\n/g, '\n').trim()
    if (!normalized) return 'Imported source with no textual content.'
    return normalized.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 3).join(' ').slice(0, 220)
}

function inferSourceTitle(raw: string, absolutePath: string, explicitTitle?: string): string {
    const trimmedTitle = explicitTitle?.trim()
    if (trimmedTitle) return trimmedTitle

    const heading = raw.match(/^#\s+(.+)$/m)?.[1]?.trim()
    if (heading) return heading

    return path.basename(absolutePath, path.extname(absolutePath))
}

function renderSourceSummaryPage(input: {
    title: string
    sourceId: string
    type: string
    scope: string
    importedAt: string
    checksum: string
    originPath: string
    summary: string
}): string {
    return `# ${input.title}

## Metadata
- Source ID: \`${input.sourceId}\`
- Type: ${input.type}
- Scope: ${input.scope}
- Imported At: ${input.importedAt}
- Checksum: \`${input.checksum}\`
- Origin Path: \`${input.originPath}\`

## Summary
${input.summary}
`
}

export async function importSourceFile(paths: MemoriaPaths, input: ImportSourceInput): Promise<ImportedSourceData> {
    const absolutePath = path.resolve(input.filePath)
    const raw = await fs.readFile(absolutePath, 'utf8')
    const checksum = crypto.createHash('sha256').update(raw).digest('hex')
    const importedAt = new Date().toISOString()
    const createdAt = importedAt
    const sourceType = input.type ?? inferSourceType(absolutePath)
    const sourceTitle = inferSourceTitle(raw, absolutePath, input.title)
    const scope = input.scope?.trim() || 'global'
    const dedupedExisting = listSourceRecords(paths.dbPath, { limit: 500 }).find((record) => record.checksum === checksum)

    if (dedupedExisting) {
      const existingSlug = `source-${slugify(dedupedExisting.title).toLowerCase()}-${shortHash(dedupedExisting.id, 8)}`
      const existingPage = getWikiPageBySlug(paths.dbPath, existingSlug)
      if (!existingPage) {
        throw new Error(`Source record exists without source-summary page: ${dedupedExisting.id}`)
      }
      return { source: dedupedExisting, page: existingPage, deduped: true }
    }

    const sourceId = `src_${shortHash(`${absolutePath}:${checksum}`, 24)}`
    const slugStem = slugify(sourceTitle).toLowerCase() || 'source'
    const sourceSlug = `source-${slugStem}-${shortHash(sourceId, 8)}`
    const sourceDir = path.join(paths.memoryDir, 'sources')
    const sourceExt = path.extname(absolutePath).toLowerCase() || '.txt'
    const storedSourcePath = path.join(sourceDir, `${sourceId}${sourceExt}`)
    const pageDir = path.join(paths.knowledgeDir, 'Sources')
    const pagePath = path.join(pageDir, `${sourceSlug}.md`)

    await fs.mkdir(sourceDir, { recursive: true })
    await fs.mkdir(pageDir, { recursive: true })
    await fs.writeFile(storedSourcePath, raw, 'utf8')

    const source = upsertSourceRecord(paths.dbPath, {
      id: sourceId,
      type: sourceType,
      scope,
      title: sourceTitle,
      origin_path: storedSourcePath,
      checksum,
      created_at: createdAt,
      imported_at: importedAt,
      status: 'active',
      metadata: {
        original_path: absolutePath,
        byte_length: Buffer.byteLength(raw, 'utf8'),
        file_extension: sourceExt
      }
    })

    const page = upsertWikiPage(paths.dbPath, {
      id: `page_${shortHash(sourceId, 24)}`,
      slug: sourceSlug,
      title: sourceTitle,
      page_type: 'source-summary',
      scope,
      summary: summarizeText(raw),
      filepath: pagePath,
      status: 'active',
      confidence: 1,
      last_built_at: importedAt,
      metadata: {
        source_id: sourceId,
        generated_by: 'importSourceFile'
      }
    })

    upsertWikiPageSourceLink(paths.dbPath, {
      page_id: page.id,
      source_id: source.id,
      relation_type: 'summarizes',
      created_at: importedAt
    })

    await fs.writeFile(pagePath, renderSourceSummaryPage({
      title: sourceTitle,
      sourceId: source.id,
      type: source.type,
      scope: source.scope,
      importedAt,
      checksum,
      originPath: source.origin_path ?? absolutePath,
      summary: page.summary
    }), 'utf8')

    return { source, page, deduped: false }
}
