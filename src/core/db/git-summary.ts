// Summary range + summary persistence (spec §9.8/§9.9/§18, docs/issues/issue-1 Phase 4).
//
// Idempotency keys: range_fingerprint (UNIQUE) for ranges, (repository_id, summary_range_id,
// prompt_version) for summaries. Re-planning the same git state is a no-op; agent write-back
// UPDATES the deterministic row in place instead of inserting a second summary.

import { createHash, randomUUID } from 'node:crypto'
import { withDb } from './connection.js'
import { parseJsonRecord } from './mappers.js'
import type {
    GitSummaryContent,
    GitSummaryRangeRecord,
    GitSummaryRecord,
    GitSummaryStatus,
    GitSummaryType,
    Json
} from '../types.js'

function nowIso(): string {
    return new Date().toISOString()
}

// ─── git_events consumption ──────────────────────────────────────────────────

export type GitEventRow = {
    id: string
    event_type: string
    source_ref: string | null
    target_ref: string | null
    before_sha: string | null
    after_sha: string | null
    metadata_json: string | null
    detected_at: string
}

export function listPendingEvents(dbPath: string, repositoryId: string, eventTypes?: string[]): GitEventRow[] {
    return withDb(dbPath, (db) => {
        if (eventTypes && eventTypes.length > 0) {
            const placeholders = eventTypes.map(() => '?').join(', ')
            return db.prepare(`
              SELECT id, event_type, source_ref, target_ref, before_sha, after_sha, metadata_json, detected_at
              FROM git_events
              WHERE repository_id = ? AND status = 'pending' AND event_type IN (${placeholders})
              ORDER BY detected_at
            `).all(repositoryId, ...eventTypes) as GitEventRow[]
        }
        return db.prepare(`
          SELECT id, event_type, source_ref, target_ref, before_sha, after_sha, metadata_json, detected_at
          FROM git_events WHERE repository_id = ? AND status = 'pending' ORDER BY detected_at
        `).all(repositoryId) as GitEventRow[]
    })
}

export function markEvents(dbPath: string, eventIds: string[], status: 'processed' | 'ignored' | 'failed', errorMessage?: string): void {
    if (eventIds.length === 0) return
    withDb(dbPath, (db) => db.transaction(() => {
        const stmt = db.prepare('UPDATE git_events SET status = ?, processed_at = ?, error_message = ? WHERE id = ?')
        const now = nowIso()
        for (const id of eventIds) stmt.run(status, now, errorMessage ?? null, id)
    })())
}

/** Planner input: previously ingested commit facts for a set of shas. */
export function loadCommitFacts(dbPath: string, repositoryId: string, shas: string[]): Array<{
    sha: string
    parents: string[]
    committedAt: string
    message: string
    isMerge: boolean
}> {
    if (shas.length === 0) return []
    return withDb(dbPath, (db) => {
        const stmt = db.prepare(`
          SELECT commit_sha, parent_shas_json, committed_at, message, is_merge
          FROM git_commits WHERE repository_id = ? AND commit_sha = ?
        `)
        const rows: Array<{ sha: string; parents: string[]; committedAt: string; message: string; isMerge: boolean }> = []
        for (const sha of shas) {
            const row = stmt.get(repositoryId, sha) as {
                commit_sha: string; parent_shas_json: string | null; committed_at: string; message: string; is_merge: number
            } | undefined
            if (!row) continue
            rows.push({
                sha: row.commit_sha,
                parents: row.parent_shas_json ? JSON.parse(row.parent_shas_json) as string[] : [],
                committedAt: row.committed_at,
                message: row.message ?? '',
                isMerge: row.is_merge === 1
            })
        }
        return rows
    })
}

export function listCurrentTags(dbPath: string, repositoryId: string): Array<{ name: string; commitSha: string }> {
    return withDb(dbPath, (db) =>
        (db.prepare(`
          SELECT ref_name, commit_sha FROM git_refs
          WHERE repository_id = ? AND ref_type = 'tag' AND is_current = 1
        `).all(repositoryId) as Array<{ ref_name: string; commit_sha: string }>)
            .map((r) => ({ name: r.ref_name.replace(/^refs\/tags\//, ''), commitSha: r.commit_sha }))
    )
}

// ─── ranges + summaries ──────────────────────────────────────────────────────

type RangeRow = {
    id: string
    repository_id: string
    summary_type: string
    base_sha: string | null
    head_sha: string
    source_ref: string | null
    target_ref: string | null
    tag_name: string | null
    range_fingerprint: string
    created_at: string
}

type SummaryRow = {
    id: string
    repository_id: string
    summary_range_id: string
    summary_type: string
    title: string | null
    summary: string | null
    key_changes_json: string | null
    decisions_json: string | null
    known_limitations_json: string | null
    risks_json: string | null
    affected_domains_json: string | null
    importance: number | null
    confidence: number | null
    generator: string | null
    generator_version: string | null
    prompt_version: string
    status: string
    metadata_json: string | null
    created_at: string
    updated_at: string
}

function parseArray<T>(json: string | null): T[] {
    if (!json) return []
    try {
        const parsed = JSON.parse(json)
        return Array.isArray(parsed) ? parsed as T[] : []
    } catch {
        return []
    }
}

function mapRange(row: RangeRow): GitSummaryRangeRecord {
    return {
        id: row.id,
        repository_id: row.repository_id,
        summary_type: row.summary_type as GitSummaryType,
        base_sha: row.base_sha ?? undefined,
        head_sha: row.head_sha,
        source_ref: row.source_ref ?? undefined,
        target_ref: row.target_ref ?? undefined,
        tag_name: row.tag_name ?? undefined,
        range_fingerprint: row.range_fingerprint,
        created_at: row.created_at
    }
}

function mapSummary(row: SummaryRow, range?: RangeRow): GitSummaryRecord {
    return {
        id: row.id,
        repository_id: row.repository_id,
        summary_range_id: row.summary_range_id,
        summary_type: row.summary_type as GitSummaryType,
        title: row.title ?? '',
        summary: row.summary ?? '',
        key_changes: parseArray<string>(row.key_changes_json),
        decisions: parseArray<{ decision: string; reason?: string }>(row.decisions_json),
        known_limitations: parseArray<string>(row.known_limitations_json),
        risks: parseArray<string>(row.risks_json),
        affected_domains: parseArray<string>(row.affected_domains_json),
        importance: row.importance ?? 0,
        confidence: row.confidence ?? 0,
        generator: row.generator ?? 'unknown',
        generator_version: row.generator_version ?? undefined,
        prompt_version: row.prompt_version,
        status: row.status as GitSummaryStatus,
        metadata: parseJsonRecord(row.metadata_json),
        created_at: row.created_at,
        updated_at: row.updated_at,
        range: range ? mapRange(range) : undefined
    }
}

export type UpsertRangeInput = {
    repositoryId: string
    summaryType: GitSummaryType
    baseSha: string | null
    headSha: string
    sourceRef?: string | null
    targetRef?: string | null
    tagName?: string | null
}

export function upsertSummaryRange(dbPath: string, input: UpsertRangeInput): { range: GitSummaryRangeRecord; created: boolean } {
    return withDb(dbPath, (db) => db.transaction(() => {
        // §9.8 fingerprint: identical git ranges always collapse to one row.
        const fingerprint = createHash('sha256').update([
            input.repositoryId, input.summaryType, input.baseSha ?? '', input.headSha,
            input.sourceRef ?? '', input.targetRef ?? ''
        ].join('|')).digest('hex')
        const existing = db.prepare('SELECT * FROM git_summary_ranges WHERE range_fingerprint = ?').get(fingerprint) as RangeRow | undefined
        if (existing) return { range: mapRange(existing), created: false }
        const id = `range_${fingerprint.slice(0, 12)}`
        db.prepare(`
          INSERT INTO git_summary_ranges
            (id, repository_id, summary_type, base_sha, head_sha, source_ref, target_ref, tag_name, range_fingerprint, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id, input.repositoryId, input.summaryType, input.baseSha, input.headSha,
            input.sourceRef ?? null, input.targetRef ?? null, input.tagName ?? null, fingerprint, nowIso()
        )
        const row = db.prepare('SELECT * FROM git_summary_ranges WHERE id = ?').get(id) as RangeRow
        return { range: mapRange(row), created: true }
    })())
}

export type InsertSummaryInput = {
    repositoryId: string
    rangeId: string
    summaryType: GitSummaryType
    content: GitSummaryContent
    generator: string
    generatorVersion: string
    promptVersion: string
    metadata?: Json
}

/** Insert the deterministic skeleton; no-op if a summary for (range, prompt_version) exists. */
export function insertSummaryIfMissing(dbPath: string, input: InsertSummaryInput): { summary: GitSummaryRecord; created: boolean } {
    return withDb(dbPath, (db) => db.transaction(() => {
        const existing = db.prepare(`
          SELECT * FROM git_summaries WHERE repository_id = ? AND summary_range_id = ? AND prompt_version = ?
        `).get(input.repositoryId, input.rangeId, input.promptVersion) as SummaryRow | undefined
        if (existing) {
            const range = db.prepare('SELECT * FROM git_summary_ranges WHERE id = ?').get(existing.summary_range_id) as RangeRow
            return { summary: mapSummary(existing, range), created: false }
        }
        const id = `sum_${randomUUID().replace(/-/g, '').slice(0, 16)}`
        const now = nowIso()
        const c = input.content
        db.prepare(`
          INSERT INTO git_summaries
            (id, repository_id, summary_range_id, summary_type, title, summary,
             key_changes_json, decisions_json, known_limitations_json, risks_json, affected_domains_json,
             importance, confidence, generator, generator_version, prompt_version, status, metadata_json,
             created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
        `).run(
            id, input.repositoryId, input.rangeId, input.summaryType, c.title, c.summary,
            JSON.stringify(c.key_changes), JSON.stringify(c.decisions), JSON.stringify(c.known_limitations),
            JSON.stringify(c.risks), JSON.stringify(c.affected_domains),
            c.importance, c.confidence, input.generator, input.generatorVersion, input.promptVersion,
            input.metadata ? JSON.stringify(input.metadata) : null, now, now
        )
        const row = db.prepare('SELECT * FROM git_summaries WHERE id = ?').get(id) as SummaryRow
        const range = db.prepare('SELECT * FROM git_summary_ranges WHERE id = ?').get(input.rangeId) as RangeRow
        return { summary: mapSummary(row, range), created: true }
    })())
}

export function listSummaries(
    dbPath: string,
    repositoryId: string,
    options: { status?: GitSummaryStatus; limit?: number } = {}
): GitSummaryRecord[] {
    return withDb(dbPath, (db) => {
        const rows = db.prepare(`
          SELECT s.*, r.id AS r_id, r.repository_id AS r_repository_id, r.summary_type AS r_summary_type,
                 r.base_sha AS r_base_sha, r.head_sha AS r_head_sha, r.source_ref AS r_source_ref,
                 r.target_ref AS r_target_ref, r.tag_name AS r_tag_name,
                 r.range_fingerprint AS r_range_fingerprint, r.created_at AS r_created_at
          FROM git_summaries s
          JOIN git_summary_ranges r ON r.id = s.summary_range_id
          WHERE s.repository_id = ? ${options.status ? "AND s.status = ?" : ''}
          ORDER BY s.created_at DESC
          LIMIT ?
        `).all(...(options.status
            ? [repositoryId, options.status, options.limit ?? 100]
            : [repositoryId, options.limit ?? 100])) as Array<SummaryRow & Record<string, unknown>>
        return rows.map((row) => mapSummary(row, {
            id: row.r_id as string,
            repository_id: row.r_repository_id as string,
            summary_type: row.r_summary_type as string,
            base_sha: row.r_base_sha as string | null,
            head_sha: row.r_head_sha as string,
            source_ref: row.r_source_ref as string | null,
            target_ref: row.r_target_ref as string | null,
            tag_name: row.r_tag_name as string | null,
            range_fingerprint: row.r_range_fingerprint as string,
            created_at: row.r_created_at as string
        }))
    })
}

export function getSummaryById(dbPath: string, summaryId: string): GitSummaryRecord | null {
    return withDb(dbPath, (db) => {
        const row = db.prepare('SELECT * FROM git_summaries WHERE id = ?').get(summaryId) as SummaryRow | undefined
        if (!row) return null
        const range = db.prepare('SELECT * FROM git_summary_ranges WHERE id = ?').get(row.summary_range_id) as RangeRow
        return mapSummary(row, range)
    })
}

export type AgentSummarySubmission = {
    content: GitSummaryContent
    generatorVersion?: string
}

/** Agent write-back (D1): enrich the deterministic row in place — same idempotency key. */
export function submitAgentSummary(dbPath: string, summaryId: string, submission: AgentSummarySubmission): GitSummaryRecord {
    return withDb(dbPath, (db) => db.transaction(() => {
        const existing = db.prepare('SELECT * FROM git_summaries WHERE id = ?').get(summaryId) as SummaryRow | undefined
        if (!existing) throw new Error(`summary_not_found: ${summaryId}`)
        const c = submission.content
        db.prepare(`
          UPDATE git_summaries SET
            title = ?, summary = ?, key_changes_json = ?, decisions_json = ?, known_limitations_json = ?,
            risks_json = ?, affected_domains_json = ?, importance = ?, confidence = ?,
            generator = 'agent', generator_version = ?, status = 'enriched', updated_at = ?
          WHERE id = ?
        `).run(
            c.title, c.summary, JSON.stringify(c.key_changes), JSON.stringify(c.decisions),
            JSON.stringify(c.known_limitations), JSON.stringify(c.risks), JSON.stringify(c.affected_domains),
            c.importance, c.confidence, submission.generatorVersion ?? 'agent/1', nowIso(), summaryId
        )
        const row = db.prepare('SELECT * FROM git_summaries WHERE id = ?').get(summaryId) as SummaryRow
        const range = db.prepare('SELECT * FROM git_summary_ranges WHERE id = ?').get(row.summary_range_id) as RangeRow
        return mapSummary(row, range)
    })())
}
