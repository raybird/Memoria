// Cross-process repo sync lease (docs/issues/issue-33).
//
// The in-process withRepoSyncLock (memoria.ts) cannot see a sync running in another process — and
// a skill-style deployment runs one CLI process per worktree. This lease lives in the DB both
// processes share: taking it is a check-and-write inside one BEGIN IMMEDIATE transaction, so two
// processes can never both hold it. Expiry is the only way a holder that died loses it; timestamps
// are ISO-8601 UTC strings, which compare correctly as text.

import { randomUUID } from 'node:crypto'
import os from 'node:os'
import { withDb } from './connection.js'

export type SyncLease = { repositoryId: string; token: string }

export type SyncLeaseHolder = {
    pid: number | null
    host: string | null
    acquiredAt: string
    expiresAt: string
}

type LeaseRow = {
    token: string
    holder_pid: number | null
    holder_host: string | null
    acquired_at: string
    expires_at: string
}

function toHolder(row: LeaseRow): SyncLeaseHolder {
    return { pid: row.holder_pid, host: row.holder_host, acquiredAt: row.acquired_at, expiresAt: row.expires_at }
}

/** Takes the lease when it is free or expired; otherwise reports who holds it. */
export function tryAcquireSyncLease(
    dbPath: string,
    repositoryId: string,
    ttlMs: number
): { lease: SyncLease } | { holder: SyncLeaseHolder } {
    return withDb(dbPath, (db) => db.transaction(() => {
        const now = new Date()
        const nowIso = now.toISOString()
        const row = db.prepare(`
          SELECT token, holder_pid, holder_host, acquired_at, expires_at
          FROM git_sync_leases WHERE repository_id = ?
        `).get(repositoryId) as LeaseRow | undefined
        if (row && row.expires_at > nowIso) return { holder: toHolder(row) }

        const token = randomUUID()
        db.prepare(`
          INSERT OR REPLACE INTO git_sync_leases
            (repository_id, token, holder_pid, holder_host, acquired_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(repositoryId, token, process.pid, os.hostname(), nowIso,
            new Date(now.getTime() + ttlMs).toISOString())
        return { lease: { repositoryId, token } }
    }).immediate())
}

/** Extends a held lease. False when it is no longer ours (expired and taken over). */
export function renewSyncLease(dbPath: string, lease: SyncLease, ttlMs: number): boolean {
    return withDb(dbPath, (db) => db.prepare(`
      UPDATE git_sync_leases SET expires_at = ? WHERE repository_id = ? AND token = ?
    `).run(new Date(Date.now() + ttlMs).toISOString(), lease.repositoryId, lease.token).changes === 1)
}

/** Releases a held lease; a lease someone else took over after ours expired is left alone. */
export function releaseSyncLease(dbPath: string, lease: SyncLease): void {
    withDb(dbPath, (db) => db.prepare(`
      DELETE FROM git_sync_leases WHERE repository_id = ? AND token = ?
    `).run(lease.repositoryId, lease.token))
}

/** Read-only: the live holder, or null when the lease is free or expired. */
export function peekSyncLease(dbPath: string, repositoryId: string): SyncLeaseHolder | null {
    return withDb(dbPath, (db) => {
        const row = db.prepare(`
          SELECT token, holder_pid, holder_host, acquired_at, expires_at
          FROM git_sync_leases WHERE repository_id = ? AND expires_at > ?
        `).get(repositoryId, new Date().toISOString()) as LeaseRow | undefined
        return row ? toHolder(row) : null
    })
}
