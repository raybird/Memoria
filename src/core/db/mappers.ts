import { maybeParseJson, stableStringify } from '../utils.js'
import type { Json, SourceRecord, WikiPage, WikiLintFinding, WikiLintRun, WikiQueryArtifact } from '../types.js'

export function stringifyJson(value: Json | undefined): string {
    return stableStringify(value ?? {})
}

export function parseJsonRecord(value: string | null): Json | undefined {
    if (!value) return undefined
    const parsed = maybeParseJson(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Json : undefined
}

export function truncateText(input: string, max = 180): string {
    const clean = input.replace(/\s+/g, ' ').trim()
    if (clean.length <= max) return clean
    return `${clean.slice(0, Math.max(0, max - 1))}…`
}

export function mapSourceRecord(row: {
    id: string
    type: string
    scope: string
    title: string
    origin_path: string | null
    origin_url: string | null
    checksum: string | null
    created_at: string
    imported_at: string
    status: string
    metadata: string | null
}): SourceRecord {
    return {
        id: row.id,
        type: row.type as SourceRecord['type'],
        scope: row.scope,
        title: row.title,
        origin_path: row.origin_path ?? undefined,
        origin_url: row.origin_url ?? undefined,
        checksum: row.checksum ?? undefined,
        created_at: row.created_at,
        imported_at: row.imported_at,
        status: row.status as SourceRecord['status'],
        metadata: parseJsonRecord(row.metadata)
    }
}

export function mapWikiPage(row: {
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
}): WikiPage {
    return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        page_type: row.page_type as WikiPage['page_type'],
        scope: row.scope,
        summary: row.summary,
        filepath: row.filepath ?? undefined,
        status: row.status as WikiPage['status'],
        confidence: typeof row.confidence === 'number' ? row.confidence : undefined,
        last_built_at: row.last_built_at ?? undefined,
        last_reviewed_at: row.last_reviewed_at ?? undefined,
        metadata: parseJsonRecord(row.metadata)
    }
}

export function mapWikiLintFinding(row: {
    id: string
    run_id: string | null
    finding_type: string
    severity: string
    page_id: string | null
    related_page_id: string | null
    source_id: string | null
    status: string
    summary: string
    details: string | null
    created_at: string
    resolved_at: string | null
}): WikiLintFinding {
    return {
        id: row.id,
        run_id: row.run_id ?? undefined,
        finding_type: row.finding_type as WikiLintFinding['finding_type'],
        severity: row.severity as WikiLintFinding['severity'],
        page_id: row.page_id ?? undefined,
        related_page_id: row.related_page_id ?? undefined,
        source_id: row.source_id ?? undefined,
        status: row.status as WikiLintFinding['status'],
        summary: row.summary,
        details: row.details ?? undefined,
        created_at: row.created_at,
        resolved_at: row.resolved_at ?? undefined
    }
}

export function mapWikiLintRun(row: {
    id: string
    status: string
    summary: string | null
    created_at: string
}): WikiLintRun {
    return {
        id: row.id,
        status: row.status as WikiLintRun['status'],
        summary: row.summary ?? undefined,
        created_at: row.created_at
    }
}

export function mapWikiQueryArtifact(row: {
    id: string
    query: string
    kind: string
    page_id: string
    created_at: string
    metadata: string | null
}): WikiQueryArtifact {
    return {
        id: row.id,
        query: row.query,
        kind: row.kind as WikiQueryArtifact['kind'],
        page_id: row.page_id,
        created_at: row.created_at,
        metadata: parseJsonRecord(row.metadata)
    }
}
