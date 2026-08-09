// CLI-authored atomic notes (docs/issues/issue-4 Phase 1).
//
// A note is an ORDINARY row in the existing corpus — same shape promoteSummary() writes for git
// summaries: one session (summary text → recall_fts via the session trigger) plus one
// DecisionMade/SkillLearned event, so extract/recall/export/governance all pick it up unchanged.
// Q2 decided one session per note: the deterministic id makes re-runs idempotent, and each note
// keeps its own ref_id — which is what issue-5's per-memory attributes will hang off.
//
// memory_sources carries the provenance (source_type 'cli_note'). lookupGitSources() INNER JOINs
// git_summaries, so these rows never leak into a recall hit's git source.

import { createHash } from 'node:crypto'
import { withDb } from './connection.js'

export const CLI_NOTE_SOURCE_TYPE = 'cli_note'

/** Content fingerprint shared by the session and event ids — identical notes collapse onto one row. */
export function noteFingerprint(input: {
    text: string
    type: 'decision' | 'skill'
    project?: string
    scope?: string
}): string {
    return createHash('sha256')
        .update([input.type, input.project ?? '', input.scope ?? '', input.text.trim()].join('|'))
        .digest('hex')
        .slice(0, 16)
}

export function noteExists(dbPath: string, sessionId: string): boolean {
    return withDb(dbPath, { readonly: true }, (db) =>
        Boolean(db.prepare('SELECT id FROM sessions WHERE id = ? LIMIT 1').get(sessionId)))
}

/** Record provenance for a note's session + event ids. Idempotent via UNIQUE(memory_id, source_type, source_id). */
export function recordNoteProvenance(dbPath: string, memoryIds: string[], noteId: string): void {
    if (memoryIds.length === 0) return
    withDb(dbPath, (db) => {
        const now = new Date().toISOString()
        const insert = db.prepare(`
          INSERT OR IGNORE INTO memory_sources
            (id, memory_id, source_type, source_id, repository_id, base_sha, head_sha, created_at)
          VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?)
        `)
        const run = db.transaction(() => {
            for (const memoryId of memoryIds) {
                const id = `ms_${createHash('sha256').update(`${memoryId}|${CLI_NOTE_SOURCE_TYPE}|${noteId}`).digest('hex').slice(0, 16)}`
                insert.run(id, memoryId, CLI_NOTE_SOURCE_TYPE, noteId, now)
            }
        })
        run()
    })
}
