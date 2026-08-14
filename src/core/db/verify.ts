import path from 'node:path'
import Database from 'better-sqlite3'
import { existsSync } from '../paths.js'
import { initDatabase } from './schema.js'
import { withDb } from './connection.js'
import type { MemoriaPaths, VerifyStatus, VerifyCheck } from '../types.js'

async function canWrite(targetPath: string): Promise<boolean> {
    try {
        const { constants: fsConstants, access } = await import('node:fs/promises')
        await access(targetPath, fsConstants.W_OK)
        return true
    } catch {
        return false
    }
}

function collectMissingColumns(db: Database.Database, table: string, expected: string[]): string[] {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    const actual = new Set(rows.map((r) => r.name))
    return expected.filter((c) => !actual.has(c))
}

/** Integrity check, on a connection of its own (issue-14).
 *
 * ⚠ DO NOT POOL THIS CONNECTION, and do not fold it back into the `withDb` block below.
 *
 * better-sqlite3 caches connection-level state that a cross-process write ought to invalidate and
 * does not. The consequence, measured: a long-lived handle starts reporting
 * `malformed inverted index for FTS5 table main.recall_fts` for a database that is perfectly
 * healthy, and never recovers until the process restarts. Any other process writing the file is
 * enough — a single `memoria remember` run inside the same container will do it — so on a
 * long-running server, *having performed routine maintenance* is what makes `/v1/health` claim
 * corruption forever. The same stale handle happily queries the very index it calls malformed, and
 * a freshly opened connection always reports `ok`; the data is never actually damaged.
 *
 * Re-preparing the statement on the stale handle does **not** clear it — only closing and reopening
 * does. That is why this must stay an open-use-close connection: pooling it would move the identical
 * bug one level down, where the next occurrence is harder to trace. The cost is one extra open per
 * verify, which is nothing beside a check that scans the whole database. This looks like a spot that
 * was never optimised; it is not, and optimising it reintroduces a silent false alarm.
 *
 * (Root cause lives in the driver, so it cannot be fixed from here. Not reproducible through
 * Rust/sqlx against the same schema, the same file, and the same cross-process writer.)
 */
function checkIntegrity(dbPath: string, add: (id: string, status: VerifyStatus, detail: string) => void): void {
    let db: Database.Database | null = null
    try {
        db = new Database(dbPath, { readonly: true, fileMustExist: true })
        const rows = db.prepare('PRAGMA quick_check').all() as Array<{ quick_check?: string }>

        if (rows.length === 0) {
            // Distinct from a genuine failure: the check could not speak, which is not the same as
            // it reporting damage. The previous code collapsed both into one constant string.
            add('db_integrity', 'fail', 'PRAGMA quick_check returned no rows')
            return
        }
        if (rows.length === 1 && rows[0]?.quick_check === 'ok') {
            add('db_integrity', 'pass', 'PRAGMA quick_check=ok')
            return
        }
        // Report what it actually said, and how many it said it about. quick_check emits up to 100
        // rows; a message that hides them is what cost two sessions a day of guessing.
        const detail = rows.map((r) => r.quick_check ?? JSON.stringify(r)).join('; ')
        add('db_integrity', 'fail', `PRAGMA quick_check returned ${rows.length} row(s): ${detail}`)
    } catch (error) {
        add('db_integrity', 'fail', `PRAGMA quick_check threw: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
        try { db?.close() } catch { /* closing a failed open is not a verify failure */ }
    }
}

export async function runVerify(paths: MemoriaPaths): Promise<{ ok: boolean; checks: VerifyCheck[] }> {
    const checks: VerifyCheck[] = []
    const add = (id: string, status: VerifyStatus, detail: string) => {
        checks.push({ id, status, detail })
    }

    const pathChecks = [
        { id: 'memory_dir_exists', p: paths.memoryDir, label: 'memory dir' },
        { id: 'knowledge_dir_exists', p: paths.knowledgeDir, label: 'knowledge dir' },
        { id: 'sessions_path_exists', p: paths.sessionsPath, label: 'sessions path' },
        { id: 'config_path_exists', p: paths.configPath, label: 'config path' }
    ]

    for (const item of pathChecks) {
        add(item.id, existsSync(item.p) ? 'pass' : 'fail', `${item.label}: ${item.p}`)
    }

    for (const item of pathChecks) {
        const id = item.id.replace('_exists', '_writable')
        const ok = (await canWrite(item.p)) || (existsSync(item.p) ? false : await canWrite(path.dirname(item.p)))
        add(id, ok ? 'pass' : 'fail', `${item.label} writable: ${item.p}`)
    }

    if (!existsSync(paths.dbPath)) {
        add('db_exists', 'fail', `sessions.db missing: ${paths.dbPath}`)
        return { ok: false, checks }
    }

    initDatabase(paths.dbPath)

    try {
        withDb(paths.dbPath, { readonly: true, fileMustExist: true }, (db) => {
            add('db_connect', 'pass', `connected: ${paths.dbPath}`)

            const tableRows = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]
            const tableSet = new Set(tableRows.map((r) => r.name))

            const requiredTables = ['sessions', 'events', 'skills']
            for (const table of requiredTables) {
                add(`table_${table}`, tableSet.has(table) ? 'pass' : 'fail', `table ${table}`)
            }

            const requiredColumns: Record<string, string[]> = {
                sessions: ['id', 'timestamp', 'project', 'scope', 'event_count', 'summary'],
                events: ['id', 'session_id', 'timestamp', 'event_type', 'content', 'metadata'],
                skills: ['id', 'name', 'category', 'created_date', 'success_rate', 'use_count', 'filepath']
            }

            for (const [table, columns] of Object.entries(requiredColumns)) {
                if (!tableSet.has(table)) continue
                const missing = collectMissingColumns(db, table, columns)
                add(
                    `columns_${table}`,
                    missing.length === 0 ? 'pass' : 'fail',
                    missing.length === 0 ? `columns ${table} ok` : `columns ${table} missing: ${missing.join(', ')}`
                )
            }

        })
    } catch (error) {
        add('db_connect', 'fail', `connect error: ${error instanceof Error ? error.message : String(error)}`)
    }

    // Runs outside the pooled block on purpose — see checkIntegrity's comment.
    checkIntegrity(paths.dbPath, add)

    return { ok: checks.every((c) => c.status === 'pass'), checks }
}
