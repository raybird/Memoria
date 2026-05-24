import path from 'node:path'
import Database from 'better-sqlite3'
import { existsSync } from '../paths.js'
import { initDatabase } from './schema.js'
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

    let db: Database.Database | null = null
    try {
        db = new Database(paths.dbPath, { readonly: true, fileMustExist: true })
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

        const quickCheck = db.prepare('PRAGMA quick_check').get() as { quick_check?: string }
        const integrityOk = quickCheck?.quick_check === 'ok'
        add('db_integrity', integrityOk ? 'pass' : 'fail', integrityOk ? 'PRAGMA quick_check=ok' : 'PRAGMA quick_check failed')
    } catch (error) {
        add('db_connect', 'fail', `connect error: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
        db?.close()
    }

    return { ok: checks.every((c) => c.status === 'pass'), checks }
}
