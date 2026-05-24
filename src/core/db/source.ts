import Database from 'better-sqlite3'
import { existsSync } from '../paths.js'
import { initDatabase } from './schema.js'
import { mapSourceRecord, stringifyJson } from './mappers.js'
import type { SourceRecord, UpsertSourceInput } from '../types.js'

export function upsertSourceRecord(dbPath: string, input: UpsertSourceInput): SourceRecord {
    initDatabase(dbPath)
    const db = new Database(dbPath)
    try {
        const importedAt = input.imported_at ?? new Date().toISOString()
        db.prepare(`
          INSERT INTO sources
          (id, type, scope, title, origin_path, origin_url, checksum, created_at, imported_at, status, metadata)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            type = excluded.type,
            scope = excluded.scope,
            title = excluded.title,
            origin_path = excluded.origin_path,
            origin_url = excluded.origin_url,
            checksum = excluded.checksum,
            created_at = excluded.created_at,
            imported_at = excluded.imported_at,
            status = excluded.status,
            metadata = excluded.metadata
        `).run(
            input.id,
            input.type,
            input.scope,
            input.title,
            input.origin_path ?? null,
            input.origin_url ?? null,
            input.checksum ?? null,
            input.created_at,
            importedAt,
            input.status ?? 'active',
            stringifyJson(input.metadata)
        )

        const row = db.prepare(`
          SELECT id, type, scope, title, origin_path, origin_url, checksum, created_at, imported_at, status, metadata
          FROM sources
          WHERE id = ?
        `).get(input.id) as {
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
        }
        return mapSourceRecord(row)
    } finally {
        db.close()
    }
}

export function listSourceRecords(
    dbPath: string,
    options?: { type?: string; scope?: string; limit?: number }
): SourceRecord[] {
    if (!existsSync(dbPath)) return []
    initDatabase(dbPath)
    const db = new Database(dbPath, { readonly: true })
    try {
        const limit = Math.min(500, Math.max(1, Math.floor(options?.limit ?? 100)))
        const rows = db.prepare(`
          SELECT id, type, scope, title, origin_path, origin_url, checksum, created_at, imported_at, status, metadata
          FROM sources
          WHERE 1 = 1
          ${options?.type ? 'AND type = ?' : ''}
          ${options?.scope ? 'AND scope = ?' : ''}
          ORDER BY imported_at DESC
          LIMIT ?
        `).all(
            ...[
                ...(options?.type ? [options.type] : []),
                ...(options?.scope ? [options.scope] : []),
                limit
            ]
        ) as Array<{
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
        }>
        return rows.map(mapSourceRecord)
    } finally {
        db.close()
    }
}
