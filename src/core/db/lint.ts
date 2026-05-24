import Database from 'better-sqlite3'
import { existsSync } from '../paths.js'
import { initDatabase } from './schema.js'
import { mapWikiLintFinding, mapWikiLintRun } from './mappers.js'
import type { WikiLintFinding, WikiLintRun, UpsertWikiLintRunInput, UpsertWikiLintFindingInput } from '../types.js'

export function upsertWikiLintRun(dbPath: string, input: UpsertWikiLintRunInput): void {
    initDatabase(dbPath)
    const db = new Database(dbPath)
    try {
        db.prepare(`
          INSERT OR REPLACE INTO wiki_lint_runs (id, status, summary, created_at)
          VALUES (?, ?, ?, ?)
        `).run(input.id, input.status ?? 'completed', input.summary ?? null, input.created_at ?? new Date().toISOString())
    } finally {
        db.close()
    }
}

export function getWikiLintRun(dbPath: string, id: string): WikiLintRun | undefined {
    if (!existsSync(dbPath)) return undefined
    initDatabase(dbPath)
    const db = new Database(dbPath, { readonly: true })
    try {
        const row = db.prepare(`
          SELECT id, status, summary, created_at
          FROM wiki_lint_runs
          WHERE id = ?
        `).get(id) as { id: string; status: string; summary: string | null; created_at: string } | undefined
        return row ? mapWikiLintRun(row) : undefined
    } finally {
        db.close()
    }
}

export function upsertWikiLintFinding(dbPath: string, input: UpsertWikiLintFindingInput): WikiLintFinding {
    initDatabase(dbPath)
    const db = new Database(dbPath)
    try {
        db.prepare(`
          INSERT OR REPLACE INTO wiki_lint_findings
          (id, run_id, finding_type, severity, page_id, related_page_id, source_id, status, summary, details, created_at, resolved_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            input.id,
            input.run_id ?? null,
            input.finding_type,
            input.severity,
            input.page_id ?? null,
            input.related_page_id ?? null,
            input.source_id ?? null,
            input.status ?? 'open',
            input.summary,
            input.details ?? null,
            input.created_at ?? new Date().toISOString(),
            input.resolved_at ?? null
        )

        const row = db.prepare(`
          SELECT id, run_id, finding_type, severity, page_id, related_page_id, source_id, status, summary, details, created_at, resolved_at
          FROM wiki_lint_findings
          WHERE id = ?
        `).get(input.id) as {
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
        }
        return mapWikiLintFinding(row)
    } finally {
        db.close()
    }
}

export function listWikiLintFindings(dbPath: string, options?: { status?: string; limit?: number }): WikiLintFinding[] {
    if (!existsSync(dbPath)) return []
    initDatabase(dbPath)
    const db = new Database(dbPath, { readonly: true })
    try {
        const limit = Math.min(500, Math.max(1, Math.floor(options?.limit ?? 100)))
        const rows = db.prepare(`
          SELECT id, run_id, finding_type, severity, page_id, related_page_id, source_id, status, summary, details, created_at, resolved_at
          FROM wiki_lint_findings
          WHERE 1 = 1
          ${options?.status ? 'AND status = ?' : ''}
          ORDER BY created_at DESC
          LIMIT ?
        `).all(...[...(options?.status ? [options.status] : []), limit]) as Array<{
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
        }>
        return rows.map(mapWikiLintFinding)
    } finally {
        db.close()
    }
}
