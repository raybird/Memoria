// Memory promotion (spec §7.6/§9.10/§9.11, docs/issues/issue-1 Phase 5).
//
// Promoted memories are ORDINARY rows in the existing recall corpus: one synthetic session per
// promoted summary (summary text → recall_fts via the session trigger) plus one DecisionMade
// event per decision (→ decision hits, export, governance — the whole existing machinery).
// memory_sources carries the provenance back to the git summary; memory_checkpoints marks the
// milestone. Deterministic ids + INSERT OR IGNORE make the whole promotion idempotent.

import { createHash } from 'node:crypto'
import { withDb } from './connection.js'
import type { GitSummaryRecord, GitSummaryType, RecallHitSource } from '../types.js'

function nowIso(): string {
    return new Date().toISOString()
}

const SOURCE_TYPE_BY_SUMMARY: Record<GitSummaryType, string> = {
    commit_range: 'git_commit_range',
    branch: 'git_branch_summary',
    merge: 'git_merge_summary',
    release: 'git_release_summary'
}

const CHECKPOINT_TYPE_BY_SUMMARY: Record<GitSummaryType, string> = {
    commit_range: 'commit_range_completed',
    branch: 'branch_progress',
    merge: 'branch_merged',
    release: 'release_created'
}

/** §7.6 eligibility: merge/release milestones, threshold importance, or substantive content. */
export function isPromotable(summary: GitSummaryRecord, threshold: number): boolean {
    if (summary.summary_type === 'merge' || summary.summary_type === 'release') return true
    if (summary.importance >= threshold) return true
    return summary.decisions.length > 0 || summary.known_limitations.length > 0 || summary.risks.length > 0
}

export function promotionExists(dbPath: string, summaryId: string): boolean {
    return withDb(dbPath, (db) =>
        Boolean(db.prepare('SELECT id FROM memory_sources WHERE source_id = ? LIMIT 1').get(summaryId)))
}

function buildMemoryText(summary: GitSummaryRecord): string {
    const parts = [`${summary.title}。${summary.summary}`]
    if (summary.key_changes.length > 0) parts.push(`關鍵變更: ${summary.key_changes.join('；')}`)
    if (summary.known_limitations.length > 0) parts.push(`已知限制: ${summary.known_limitations.join('；')}`)
    if (summary.risks.length > 0) parts.push(`風險: ${summary.risks.join('；')}`)
    return parts.join(' ')
}

export type PromotionOutcome = {
    promoted: boolean
    memoryIds: string[]
}

export function promoteSummary(dbPath: string, summary: GitSummaryRecord, repositoryName: string): PromotionOutcome {
    if (!summary.range) throw new Error(`summary ${summary.id} has no range; cannot promote`)
    const range = summary.range
    return withDb(dbPath, (db) => db.transaction(() => {
        const now = nowIso()
        const sessionId = `gitsum-${summary.id}`
        const memoryIds: string[] = []

        const sessionInsert = db.prepare(`
          INSERT OR IGNORE INTO sessions (id, timestamp, project, scope, event_count, summary)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(sessionId, now, repositoryName, `project:${repositoryName}`, summary.decisions.length, buildMemoryText(summary))
        if (sessionInsert.changes === 0) {
            return { promoted: false, memoryIds: [] } // already promoted — §18 idempotency
        }
        memoryIds.push(sessionId)

        const eventInsert = db.prepare(`
          INSERT OR IGNORE INTO events (id, session_id, timestamp, event_type, content, metadata)
          VALUES (?, ?, ?, 'DecisionMade', ?, ?)
        `)
        summary.decisions.forEach((decision, index) => {
            const eventId = `gitdec-${summary.id}-${index}`
            eventInsert.run(eventId, sessionId, now, JSON.stringify({
                decision: decision.decision,
                rationale: decision.reason ?? '',
                impact_level: 'high'
            }), JSON.stringify({ source: 'git_summary', summary_id: summary.id }))
            memoryIds.push(eventId)
        })

        const sourceType = SOURCE_TYPE_BY_SUMMARY[summary.summary_type]
        const sourceInsert = db.prepare(`
          INSERT OR IGNORE INTO memory_sources
            (id, memory_id, source_type, source_id, repository_id, base_sha, head_sha, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `)
        for (const memoryId of memoryIds) {
            const id = `ms_${createHash('sha256').update(`${memoryId}|${sourceType}|${summary.id}`).digest('hex').slice(0, 16)}`
            sourceInsert.run(id, memoryId, sourceType, summary.id, summary.repository_id,
                range.base_sha ?? null, range.head_sha, now)
        }

        const checkpointType = CHECKPOINT_TYPE_BY_SUMMARY[summary.summary_type]
        const checkpointId = `cp_${createHash('sha256')
            .update(`${summary.repository_id}|${checkpointType}|${range.base_sha ?? ''}|${range.head_sha}`)
            .digest('hex').slice(0, 16)}`
        db.prepare(`
          INSERT OR IGNORE INTO memory_checkpoints
            (id, repository_id, checkpoint_type, summary_id, base_sha, head_sha, source_ref, target_ref, tag_name, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(checkpointId, summary.repository_id, checkpointType, summary.id,
            range.base_sha ?? null, range.head_sha, range.source_ref ?? null,
            range.target_ref ?? null, range.tag_name ?? null, now)

        return { promoted: true, memoryIds }
    })())
}

/** Recall enrichment (§21): map hit ids (session/event) back to their git provenance. */
export function lookupGitSources(dbPath: string, memoryIds: string[]): Map<string, RecallHitSource> {
    const map = new Map<string, RecallHitSource>()
    if (memoryIds.length === 0) return map
    return withDb(dbPath, (db) => {
        const placeholders = memoryIds.map(() => '?').join(', ')
        const rows = db.prepare(`
          SELECT ms.memory_id, ms.source_type, ms.source_id, ms.base_sha, ms.head_sha,
                 r.source_ref, r.tag_name, repo.name AS repository_name
          FROM memory_sources ms
          JOIN git_summaries s ON s.id = ms.source_id
          JOIN git_summary_ranges r ON r.id = s.summary_range_id
          JOIN repositories repo ON repo.id = ms.repository_id
          WHERE ms.memory_id IN (${placeholders})
        `).all(...memoryIds) as Array<{
            memory_id: string; source_type: string; source_id: string; base_sha: string | null
            head_sha: string; source_ref: string | null; tag_name: string | null; repository_name: string
        }>
        for (const row of rows) {
            map.set(row.memory_id, {
                type: row.source_type,
                repository: row.repository_name,
                branch: row.source_ref ?? undefined,
                tag: row.tag_name ?? undefined,
                base_sha: row.base_sha ?? undefined,
                head_sha: row.head_sha,
                summary_id: row.source_id
            })
        }
        return map
    })
}
