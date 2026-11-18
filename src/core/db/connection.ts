import Database from 'better-sqlite3'

// Cached SQLite connections keyed by "<mode>:<dbPath>" so read-write and read-only
// handles for the same file are pooled separately (a readonly caller keeps SQLite's
// write protection instead of silently borrowing a read-write handle).
const pool = new Map<string, Database.Database>()

// How long a statement waits for another process's lock before failing with SQLITE_BUSY
// ("database is locked"). Equal to better-sqlite3's default — spelled out so every connection
// in core uses the same value on purpose, and changing it is one edit (issue-33). Writes are
// synchronous millisecond transactions; 16 processes writing at once never hit it.
export const SQLITE_BUSY_TIMEOUT_MS = 5000

export interface WithDbOptions {
    readonly?: boolean
    fileMustExist?: boolean
}

function poolKey(dbPath: string, readonly: boolean): string {
    return `${readonly ? 'ro' : 'rw'}:${dbPath}`
}

export function withDb<T>(dbPath: string, fn: (db: Database.Database) => T): T
export function withDb<T>(dbPath: string, opts: WithDbOptions, fn: (db: Database.Database) => T): T
export function withDb<T>(
    dbPath: string,
    optsOrFn: WithDbOptions | ((db: Database.Database) => T),
    maybeFn?: (db: Database.Database) => T
): T {
    const opts = typeof optsOrFn === 'function' ? {} : optsOrFn
    const fn = typeof optsOrFn === 'function' ? optsOrFn : maybeFn as (db: Database.Database) => T
    const readonly = Boolean(opts.readonly)

    const key = poolKey(dbPath, readonly)
    let db = pool.get(key)
    if (!db || !db.open) {
        // better-sqlite3 rejects `undefined` for these flags — coerce to boolean.
        db = new Database(dbPath, { readonly, fileMustExist: Boolean(opts.fileMustExist), timeout: SQLITE_BUSY_TIMEOUT_MS })
        pool.set(key, db)
    }
    return fn(db)
}

export function closeAllConnections(): void {
    for (const db of pool.values()) {
        try { db.close() } catch { /* ignore */ }
    }
    pool.clear()
}
