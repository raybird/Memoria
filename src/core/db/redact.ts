// Export redaction (docs/issues/issue-5 Phase 3).
//
// Turns the "version-controlled documents use code names" convention from a rule people have to
// remember into something the tool does. Scope is deliberately narrow and explainable:
//
//   - Only memories explicitly marked `sensitivity='private'` are touched (Q3). Unmarked memories
//     are exported verbatim and counted as `unclassified` so the caller sees what was NOT covered.
//   - Only entities Memoria already knows — repository names and project tags — are replaced. This
//     is a lookup, not proper-noun detection: no guessing, no false positives, and the caller can
//     predict exactly what changes. Anything else inside a private memory survives, which is why
//     this is documented as an aid, never a guarantee.
//
// Code names are deterministic (`repo-a1b2`), so the same entity reads the same across exports and
// stays diffable. The salt is the database's own creation stamp, so two databases produce different
// code names for the same name — enough to stop a casual reverse lookup, not a cryptographic claim.

import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'

const FALLBACK_SALT = 'memoria-redact-v1'

export type RedactionMap = Map<string, string>

function resolveSalt(db: Database.Database): string {
    try {
        const row = db.prepare('SELECT applied_at FROM schema_migrations ORDER BY id ASC LIMIT 1').get() as
            { applied_at: string } | undefined
        return row?.applied_at ? `${FALLBACK_SALT}|${row.applied_at}` : FALLBACK_SALT
    } catch {
        return FALLBACK_SALT
    }
}

function codeName(prefix: string, value: string, salt: string): string {
    const digest = createHash('sha256').update(`${salt}|${value}`).digest('hex').slice(0, 4)
    return `${prefix}-${digest}`
}

/** Build the entity → code-name map from what the database already knows. Longest names first, so
 *  replacing "acme-web-api" never leaves a dangling "acme-web" behind. */
export function buildRedactionMap(db: Database.Database): RedactionMap {
    const salt = resolveSalt(db)
    const map: RedactionMap = new Map()

    const add = (raw: unknown, prefix: string): void => {
        const value = typeof raw === 'string' ? raw.trim() : ''
        if (!value || value === 'default' || map.has(value)) return
        map.set(value, codeName(prefix, value, salt))
    }

    try {
        for (const row of db.prepare('SELECT name FROM repositories').all() as Array<{ name: string }>) {
            add(row.name, 'repo')
        }
    } catch { /* pre-Git-Aware database: no repositories table */ }

    for (const row of db.prepare('SELECT DISTINCT project FROM sessions').all() as Array<{ project: string }>) {
        add(row.project, 'proj')
    }

    return new Map([...map.entries()].sort((a, b) => b[0].length - a[0].length))
}

export function redactText(text: string, map: RedactionMap): string {
    if (!text) return text
    let output = text
    for (const [entity, replacement] of map) {
        if (!output.includes(entity)) continue
        output = output.split(entity).join(replacement)
    }
    return output
}

/** Ref ids marked private. Both a note's session and its event carry the marker, so either id
 *  surfacing in an export resolves to the same decision. */
export function loadPrivateRefs(db: Database.Database): Set<string> {
    try {
        const rows = db.prepare(`SELECT ref_id FROM memory_attributes WHERE sensitivity = 'private'`)
            .all() as Array<{ ref_id: string }>
        return new Set(rows.map((row) => row.ref_id))
    } catch {
        return new Set()  // table predates issue-5
    }
}
