// Long-term memory semantics (docs/issues/issue-5): retention class, supersession, sensitivity.
//
// All three markers live in one side table keyed by ref_id — the RecallHit.id (session or event id),
// the same id space memory_utility uses. Marking is sparse and every reader probes the table first,
// so a database where nothing has been marked behaves exactly as it did before issue-5. This mirrors
// the discipline UFL Phase 3 set with applyUtilityWeighting: new capability, zero-data no-op.

import type Database from 'better-sqlite3'
import { withDb } from './connection.js'
import { computeDecayFactor } from './recall.js'
import type { MemoryAttributes, MemoryRetention, MemorySensitivity, RecallHit } from '../types.js'

function nowIso(): string {
    return new Date().toISOString()
}

export function attributesTableExists(db: Database.Database): boolean {
    return Boolean(db
        .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'memory_attributes' LIMIT 1`)
        .get())
}

export type MemoryAttributePatch = {
    retention?: MemoryRetention
    sensitivity?: MemorySensitivity
    superseded_by?: string
    note?: string
}

/** Upsert the marker(s) on one memory. Only the fields present in `patch` are written — the rest of
 *  the row is preserved, so marking sensitivity later never clears an earlier retention class. */
export function upsertMemoryAttributes(dbPath: string, refId: string, patch: MemoryAttributePatch): void {
    if (Object.keys(patch).length === 0) return
    withDb(dbPath, (db) => {
        const now = nowIso()
        db.prepare(`
          INSERT INTO memory_attributes (ref_id, retention, sensitivity, superseded_by, note, created_at, updated_at)
          VALUES (@ref_id, @retention, @sensitivity, @superseded_by, @note, @now, @now)
          ON CONFLICT(ref_id) DO UPDATE SET
            retention     = COALESCE(excluded.retention, memory_attributes.retention),
            sensitivity   = COALESCE(excluded.sensitivity, memory_attributes.sensitivity),
            superseded_by = COALESCE(excluded.superseded_by, memory_attributes.superseded_by),
            note          = COALESCE(excluded.note, memory_attributes.note),
            updated_at    = @now
        `).run({
            ref_id: refId,
            retention: patch.retention ?? null,
            sensitivity: patch.sensitivity ?? null,
            superseded_by: patch.superseded_by ?? null,
            note: patch.note ?? null,
            now
        })
    })
}

export function getMemoryAttributes(dbPath: string, refIds: string[]): Map<string, MemoryAttributes> {
    const map = new Map<string, MemoryAttributes>()
    if (refIds.length === 0) return map
    return withDb(dbPath, { readonly: true }, (db) => {
        if (!attributesTableExists(db)) return map
        return loadAttributes(db, refIds)
    })
}

export function loadAttributes(db: Database.Database, refIds: string[]): Map<string, MemoryAttributes> {
    const map = new Map<string, MemoryAttributes>()
    if (refIds.length === 0 || !attributesTableExists(db)) return map
    const placeholders = refIds.map(() => '?').join(',')
    const rows = db.prepare(`
      SELECT ref_id, retention, sensitivity, superseded_by, note
      FROM memory_attributes WHERE ref_id IN (${placeholders})
    `).all(...refIds) as Array<{
        ref_id: string; retention: string | null; sensitivity: string | null
        superseded_by: string | null; note: string | null
    }>
    for (const row of rows) {
        map.set(row.ref_id, {
            ref_id: row.ref_id,
            retention: (row.retention as MemoryRetention | null) ?? null,
            sensitivity: (row.sensitivity as MemorySensitivity | null) ?? null,
            superseded_by: row.superseded_by,
            note: row.note
        })
    }
    return map
}

/** Does this ref actually name a memory (a session or an event)? Used to reject `--supersedes`
 *  pointing at nothing rather than silently recording a dangling marker. */
export function memoryRefExists(dbPath: string, refId: string): boolean {
    return withDb(dbPath, { readonly: true }, (db) =>
        Boolean(db.prepare('SELECT id FROM sessions WHERE id = ? LIMIT 1').get(refId))
        || Boolean(db.prepare('SELECT id FROM events WHERE id = ? LIMIT 1').get(refId)))
}

/** Ref ids that must survive stale pruning because they are marked durable. */
export function loadDurableRefs(db: Database.Database, refIds: string[]): Set<string> {
    const durable = new Set<string>()
    for (const [refId, attributes] of loadAttributes(db, refIds)) {
        if (attributes.retention === 'durable') durable.add(refId)
    }
    return durable
}

/** Recall post-processing, applied at the same layer as applyUtilityWeighting so all four modes
 *  (keyword/tree/hybrid/vector) are covered by one implementation:
 *
 *    - superseded memories drop out unless the caller opts in (Q2). Only the row's own
 *      superseded_by is consulted — no recursive resolution, so a cyclic chain cannot hang.
 *    - durable memories get their time-decay undone: score was computed as relevance × decay,
 *      so dividing by the same factor restores the decay-free ranking value (Q1). Utility
 *      down-weighting still applies afterwards, which is what keeps a mis-marked memory correctable.
 *
 *  Fail-open: no table, no rows, or any error → hits are returned untouched. */
export function applyMemoryAttributes(
    dbPath: string,
    hits: RecallHit[],
    options: { includeSuperseded?: boolean } = {}
): RecallHit[] {
    if (hits.length === 0) return hits
    try {
        return withDb(dbPath, { readonly: true }, (db) => {
            if (!attributesTableExists(db)) return hits
            const attributes = loadAttributes(db, [...new Set(hits.map((hit) => hit.id))])
            if (attributes.size === 0) return hits

            const kept = options.includeSuperseded
                ? hits
                : hits.filter((hit) => !attributes.get(hit.id)?.superseded_by)

            const adjusted = kept.map((hit) => {
                const attribute = attributes.get(hit.id)
                if (!attribute) return hit
                const superseded_by = attribute.superseded_by ?? undefined
                if (attribute.retention !== 'durable') {
                    return superseded_by ? { ...hit, superseded_by } : hit
                }
                const decay = computeDecayFactor(hit.timestamp)
                const score = decay > 0 ? hit.score / decay : hit.score
                return { ...hit, score, retention: 'durable' as const, ...(superseded_by ? { superseded_by } : {}) }
            })

            // Restoring decay can reorder; keep ties on the original order for determinism.
            return adjusted
                .map((hit, index) => ({ hit, index }))
                .sort((a, b) => (b.hit.score - a.hit.score) || (a.index - b.index))
                .map((entry) => entry.hit)
        })
    } catch {
        return hits
    }
}
