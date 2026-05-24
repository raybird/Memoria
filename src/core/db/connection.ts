import Database from 'better-sqlite3'

const pool = new Map<string, Database.Database>()

export function withDb<T>(dbPath: string, fn: (db: Database.Database) => T): T {
    let db = pool.get(dbPath)
    if (!db || !db.open) {
        db = new Database(dbPath)
        pool.set(dbPath, db)
    }
    return fn(db)
}

export function closeAllConnections(): void {
    for (const db of pool.values()) {
        try { db.close() } catch { /* ignore */ }
    }
    pool.clear()
}
