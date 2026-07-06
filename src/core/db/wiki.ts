import { existsSync } from '../paths.js'
import { initDatabase } from './schema.js'
import { withDb } from './connection.js'
import { mapWikiPage, mapWikiQueryArtifact, stringifyJson } from './mappers.js'
import type {
    WikiPage,
    WikiBuildResult,
    WikiPageLink,
    WikiPageSourceLink,
    WikiQueryArtifact,
    UpsertWikiPageInput,
    UpsertWikiPageSourceLinkInput,
    UpsertWikiPageLinkInput,
    UpsertWikiQueryArtifactInput
} from '../types.js'

export function upsertWikiPage(dbPath: string, input: UpsertWikiPageInput): WikiPage {
    initDatabase(dbPath)
    return withDb(dbPath, (db) => {
        db.prepare(`
          INSERT INTO wiki_pages
          (id, slug, title, page_type, scope, summary, filepath, status, confidence, last_built_at, last_reviewed_at, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            slug = excluded.slug,
            title = excluded.title,
            page_type = excluded.page_type,
            scope = excluded.scope,
            summary = excluded.summary,
            filepath = excluded.filepath,
            status = excluded.status,
            confidence = excluded.confidence,
            last_built_at = excluded.last_built_at,
            last_reviewed_at = excluded.last_reviewed_at,
            metadata = excluded.metadata
        `).run(
            input.id,
            input.slug,
            input.title,
            input.page_type,
            input.scope,
            input.summary,
            input.filepath ?? null,
            input.status ?? 'draft',
            typeof input.confidence === 'number' ? input.confidence : null,
            input.last_built_at ?? null,
            input.last_reviewed_at ?? null,
            stringifyJson(input.metadata)
        )

        const row = db.prepare(`
          SELECT id, slug, title, page_type, scope, summary, filepath, status, confidence, last_built_at, last_reviewed_at, metadata
          FROM wiki_pages
          WHERE id = ?
        `).get(input.id) as {
            id: string
            slug: string
            title: string
            page_type: string
            scope: string
            summary: string
            filepath: string | null
            status: string
            confidence: number | null
            last_built_at: string | null
            last_reviewed_at: string | null
            metadata: string | null
        }
        return mapWikiPage(row)
    })
}

export function getWikiPageBySlug(dbPath: string, slug: string): WikiPage | undefined {
    if (!existsSync(dbPath)) return undefined
    initDatabase(dbPath)
    return withDb(dbPath, { readonly: true }, (db) => {
        const row = db.prepare(`
          SELECT id, slug, title, page_type, scope, summary, filepath, status, confidence, last_built_at, last_reviewed_at, metadata
          FROM wiki_pages
          WHERE slug = ?
        `).get(slug) as {
            id: string
            slug: string
            title: string
            page_type: string
            scope: string
            summary: string
            filepath: string | null
            status: string
            confidence: number | null
            last_built_at: string | null
            last_reviewed_at: string | null
            metadata: string | null
        } | undefined
        return row ? mapWikiPage(row) : undefined
    })
}

export function listWikiPages(
    dbPath: string,
    options?: { pageType?: string; scope?: string; limit?: number }
): WikiPage[] {
    if (!existsSync(dbPath)) return []
    initDatabase(dbPath)
    return withDb(dbPath, { readonly: true }, (db) => {
        const limit = Math.min(500, Math.max(1, Math.floor(options?.limit ?? 100)))
        const rows = db.prepare(`
          SELECT id, slug, title, page_type, scope, summary, filepath, status, confidence, last_built_at, last_reviewed_at, metadata
          FROM wiki_pages
          WHERE 1 = 1
          ${options?.pageType ? 'AND page_type = ?' : ''}
          ${options?.scope ? 'AND scope = ?' : ''}
          ORDER BY COALESCE(last_built_at, last_reviewed_at, slug) DESC
          LIMIT ?
        `).all(
            ...[
                ...(options?.pageType ? [options.pageType] : []),
                ...(options?.scope ? [options.scope] : []),
                limit
            ]
        ) as Array<{
            id: string
            slug: string
            title: string
            page_type: string
            scope: string
            summary: string
            filepath: string | null
            status: string
            confidence: number | null
            last_built_at: string | null
            last_reviewed_at: string | null
            metadata: string | null
        }>
        return rows.map(mapWikiPage)
    })
}

export function queryWikiBuildResult(dbPath: string): Pick<WikiBuildResult, 'sourceCount' | 'pageCount'> & { pageTypeCounts: Record<string, number> } {
    if (!existsSync(dbPath)) {
        return { sourceCount: 0, pageCount: 0, pageTypeCounts: {} }
    }
    initDatabase(dbPath)
    return withDb(dbPath, { readonly: true }, (db) => {
        const sourceCount = Number((db.prepare('SELECT COUNT(*) AS c FROM sources').get() as { c: number }).c)
        const pageCount = Number((db.prepare('SELECT COUNT(*) AS c FROM wiki_pages').get() as { c: number }).c)
        const rows = db.prepare(`
          SELECT page_type, COUNT(*) AS c
          FROM wiki_pages
          GROUP BY page_type
          ORDER BY page_type ASC
        `).all() as Array<{ page_type: string; c: number }>
        const pageTypeCounts = Object.fromEntries(rows.map((row) => [row.page_type, Number(row.c)]))
        return { sourceCount, pageCount, pageTypeCounts }
    })
}

export function upsertWikiPageSourceLink(dbPath: string, input: UpsertWikiPageSourceLinkInput): void {
    initDatabase(dbPath)
    return withDb(dbPath, (db) => {
        db.prepare(`
          INSERT OR REPLACE INTO wiki_page_sources (page_id, source_id, relation_type, created_at)
          VALUES (?, ?, ?, ?)
        `).run(input.page_id, input.source_id, input.relation_type ?? 'supports', input.created_at ?? new Date().toISOString())
    })
}

export function listWikiPageSourceLinks(dbPath: string): WikiPageSourceLink[] {
    if (!existsSync(dbPath)) return []
    initDatabase(dbPath)
    return withDb(dbPath, { readonly: true }, (db) => {
        return db.prepare(`
          SELECT page_id, source_id, relation_type, created_at
          FROM wiki_page_sources
          ORDER BY created_at DESC
        `).all() as WikiPageSourceLink[]
    })
}

export function upsertWikiPageLink(dbPath: string, input: UpsertWikiPageLinkInput): void {
    initDatabase(dbPath)
    return withDb(dbPath, (db) => {
        db.prepare(`
          INSERT OR REPLACE INTO wiki_page_links (from_page_id, to_page_id, link_type, created_at)
          VALUES (?, ?, ?, ?)
        `).run(input.from_page_id, input.to_page_id, input.link_type ?? 'references', input.created_at ?? new Date().toISOString())
    })
}

export function listWikiPageLinks(dbPath: string): WikiPageLink[] {
    if (!existsSync(dbPath)) return []
    initDatabase(dbPath)
    return withDb(dbPath, { readonly: true }, (db) => {
        return db.prepare(`
          SELECT from_page_id, to_page_id, link_type, created_at
          FROM wiki_page_links
          ORDER BY created_at DESC
        `).all() as WikiPageLink[]
    })
}

export function upsertWikiQueryArtifact(dbPath: string, input: UpsertWikiQueryArtifactInput): WikiQueryArtifact {
    initDatabase(dbPath)
    return withDb(dbPath, (db) => {
        db.prepare(`
          INSERT INTO wiki_query_artifacts (id, query, kind, page_id, created_at, metadata)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            query = excluded.query,
            kind = excluded.kind,
            page_id = excluded.page_id,
            created_at = excluded.created_at,
            metadata = excluded.metadata
        `).run(
            input.id,
            input.query,
            input.kind,
            input.page_id,
            input.created_at ?? new Date().toISOString(),
            stringifyJson(input.metadata)
        )

        const row = db.prepare(`
          SELECT id, query, kind, page_id, created_at, metadata
          FROM wiki_query_artifacts
          WHERE id = ?
        `).get(input.id) as {
            id: string
            query: string
            kind: string
            page_id: string
            created_at: string
            metadata: string | null
        }
        return mapWikiQueryArtifact(row)
    })
}
