// Repository registry DB layer (spec §9.1–9.3, docs/issues/issue-1 Phase 1).
//
// Deterministic ids (hash-derived from identity components) make every write here an idempotent
// upsert: re-running `repo add` on the same state changes nothing but freshness timestamps.

import path from 'node:path'
import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { withDb } from './connection.js'
import type {
    GitWorktreeRecord,
    RepoListItem,
    RepoRegistrationData,
    RepoRemoveData,
    RepoRemoveOptions,
    RepositoryInstanceRecord,
    RepositoryRecord,
    RepositoryStatus
} from '../types.js'

function shortId(prefix: string, seed: string): string {
    return `${prefix}_${createHash('sha256').update(seed).digest('hex').slice(0, 12)}`
}

function nowIso(): string {
    return new Date().toISOString()
}

type RepositoryRow = {
    id: string
    name: string
    fingerprint: string
    normalized_remote_url: string | null
    root_commit_sha: string | null
    default_branch: string | null
    status: string
    created_at: string
    updated_at: string
}

type InstanceRow = {
    id: string
    repository_id: string
    local_path: string
    git_common_dir: string | null
    host_id: string
    is_available: number
    last_seen_at: string | null
    created_at: string
    updated_at: string
}

type WorktreeRow = {
    id: string
    repository_id: string
    repository_instance_id: string
    worktree_path: string
    current_branch: string | null
    current_head_sha: string | null
    is_main_worktree: number
    last_scanned_at: string | null
    working_tree_dirty: number | null
    created_at: string
    updated_at: string
}

function mapRepository(row: RepositoryRow): RepositoryRecord {
    return {
        id: row.id,
        name: row.name,
        fingerprint: row.fingerprint,
        normalized_remote_url: row.normalized_remote_url ?? undefined,
        root_commit_sha: row.root_commit_sha ?? undefined,
        default_branch: row.default_branch ?? undefined,
        status: row.status as RepositoryStatus,
        created_at: row.created_at,
        updated_at: row.updated_at
    }
}

function mapInstance(row: InstanceRow): RepositoryInstanceRecord {
    return {
        id: row.id,
        repository_id: row.repository_id,
        local_path: row.local_path,
        git_common_dir: row.git_common_dir ?? undefined,
        host_id: row.host_id,
        is_available: row.is_available === 1,
        last_seen_at: row.last_seen_at ?? undefined,
        created_at: row.created_at,
        updated_at: row.updated_at
    }
}

function mapWorktree(row: WorktreeRow): GitWorktreeRecord {
    return {
        id: row.id,
        repository_id: row.repository_id,
        repository_instance_id: row.repository_instance_id,
        worktree_path: row.worktree_path,
        current_branch: row.current_branch ?? undefined,
        current_head_sha: row.current_head_sha ?? undefined,
        is_main_worktree: row.is_main_worktree === 1,
        last_scanned_at: row.last_scanned_at ?? undefined,
        working_tree_dirty: row.working_tree_dirty === null ? undefined : row.working_tree_dirty === 1,
        created_at: row.created_at,
        updated_at: row.updated_at
    }
}

function latestInstanceForHost(db: Database.Database, repositoryId: string, hostId: string): InstanceRow | undefined {
    return db.prepare(`
      SELECT * FROM repository_instances
      WHERE repository_id = ? AND host_id = ?
      ORDER BY is_available DESC, last_seen_at DESC
      LIMIT 1
    `).get(repositoryId, hostId) as InstanceRow | undefined
}

function primaryWorktree(db: Database.Database, instanceId: string): WorktreeRow | undefined {
    return db.prepare(`
      SELECT * FROM git_worktrees
      WHERE repository_instance_id = ?
      ORDER BY is_main_worktree DESC, updated_at DESC
      LIMIT 1
    `).get(instanceId) as WorktreeRow | undefined
}

export type RegisterRepositoryInput = {
    name: string
    nameExplicit: boolean
    fingerprint: string
    normalizedRemoteUrl: string | null
    rootCommitSha: string | null
    defaultBranch: string | null
    status: RepositoryStatus
    hostId: string
    localPath: string
    gitCommonDir: string
    worktreePath: string
    currentBranch: string | null
    currentHeadSha: string | null
    isMainWorktree: boolean
}

export function registerRepository(dbPath: string, input: RegisterRepositoryInput): RepoRegistrationData {
    return withDb(dbPath, (db) => db.transaction(() => {
        const now = nowIso()
        const existing = db.prepare('SELECT * FROM repositories WHERE fingerprint = ?')
            .get(input.fingerprint) as RepositoryRow | undefined
        const repositoryId = existing?.id ?? shortId('repo', input.fingerprint)

        if (existing) {
            db.prepare(`
              UPDATE repositories SET
                name = ?,
                normalized_remote_url = COALESCE(?, normalized_remote_url),
                root_commit_sha = COALESCE(?, root_commit_sha),
                default_branch = COALESCE(?, default_branch),
                status = ?,
                updated_at = ?
              WHERE id = ?
            `).run(
                input.nameExplicit ? input.name : existing.name,
                input.normalizedRemoteUrl,
                input.rootCommitSha,
                input.defaultBranch,
                input.status,
                now,
                repositoryId
            )
        } else {
            db.prepare(`
              INSERT INTO repositories
                (id, name, fingerprint, normalized_remote_url, root_commit_sha, default_branch, status, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                repositoryId,
                input.name,
                input.fingerprint,
                input.normalizedRemoteUrl,
                input.rootCommitSha,
                input.defaultBranch,
                input.status,
                now,
                now
            )
        }

        db.prepare(`
          INSERT INTO repository_instances
            (id, repository_id, local_path, git_common_dir, host_id, is_available, last_seen_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)
          ON CONFLICT(host_id, local_path) DO UPDATE SET
            repository_id = excluded.repository_id,
            git_common_dir = excluded.git_common_dir,
            is_available = 1,
            last_seen_at = excluded.last_seen_at,
            updated_at = excluded.updated_at
        `).run(
            shortId('inst', `${input.hostId}|${input.localPath}`),
            repositoryId,
            input.localPath,
            input.gitCommonDir,
            input.hostId,
            now,
            now,
            now
        )
        const instanceRow = db.prepare('SELECT * FROM repository_instances WHERE host_id = ? AND local_path = ?')
            .get(input.hostId, input.localPath) as InstanceRow

        db.prepare(`
          INSERT INTO git_worktrees
            (id, repository_id, repository_instance_id, worktree_path, current_branch, current_head_sha,
             is_main_worktree, last_scanned_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
          ON CONFLICT(repository_instance_id, worktree_path) DO UPDATE SET
            repository_id = excluded.repository_id,
            current_branch = excluded.current_branch,
            current_head_sha = excluded.current_head_sha,
            is_main_worktree = excluded.is_main_worktree,
            updated_at = excluded.updated_at
        `).run(
            shortId('wt', `${instanceRow.id}|${input.worktreePath}`),
            repositoryId,
            instanceRow.id,
            input.worktreePath,
            input.currentBranch,
            input.currentHeadSha,
            input.isMainWorktree ? 1 : 0,
            now,
            now
        )
        const worktreeRow = db.prepare('SELECT * FROM git_worktrees WHERE repository_instance_id = ? AND worktree_path = ?')
            .get(instanceRow.id, input.worktreePath) as WorktreeRow

        const repositoryRow = db.prepare('SELECT * FROM repositories WHERE id = ?').get(repositoryId) as RepositoryRow
        return {
            repository: mapRepository(repositoryRow),
            instance: mapInstance(instanceRow),
            worktree: mapWorktree(worktreeRow),
            created: !existing
        }
    })())
}

export function listRepositories(dbPath: string, hostId: string): RepoListItem[] {
    return withDb(dbPath, (db) => {
        const repositories = db.prepare('SELECT * FROM repositories ORDER BY created_at').all() as RepositoryRow[]
        return repositories.map((repo) => {
            const instance = latestInstanceForHost(db, repo.id, hostId)
            const worktree = instance ? primaryWorktree(db, instance.id) : undefined
            return {
                repository: mapRepository(repo),
                instance: instance ? mapInstance(instance) : undefined,
                worktree: worktree ? mapWorktree(worktree) : undefined
            }
        })
    })
}

/** Resolve a repository reference: id, name, or a local path on this host. */
export function findRepository(dbPath: string, ref: string, hostId: string): RepoListItem | null {
    return withDb(dbPath, (db) => {
        let repo = db.prepare('SELECT * FROM repositories WHERE id = ?').get(ref) as RepositoryRow | undefined
        if (!repo) {
            repo = db.prepare('SELECT * FROM repositories WHERE name = ? ORDER BY created_at LIMIT 1')
                .get(ref) as RepositoryRow | undefined
        }
        if (!repo) {
            const resolved = path.resolve(ref)
            const instance = db.prepare('SELECT * FROM repository_instances WHERE host_id = ? AND local_path = ?')
                .get(hostId, resolved) as InstanceRow | undefined
            if (instance) {
                repo = db.prepare('SELECT * FROM repositories WHERE id = ?').get(instance.repository_id) as RepositoryRow
                const worktree = primaryWorktree(db, instance.id)
                return {
                    repository: mapRepository(repo),
                    instance: mapInstance(instance),
                    worktree: worktree ? mapWorktree(worktree) : undefined
                }
            }
            return null
        }
        const instance = latestInstanceForHost(db, repo.id, hostId)
        const worktree = instance ? primaryWorktree(db, instance.id) : undefined
        return {
            repository: mapRepository(repo),
            instance: instance ? mapInstance(instance) : undefined,
            worktree: worktree ? mapWorktree(worktree) : undefined
        }
    })
}

export function relocateRepositoryInstance(
    dbPath: string,
    repositoryId: string,
    hostId: string,
    newPath: string,
    newGitCommonDir: string
): { instance: RepositoryInstanceRecord; worktree?: GitWorktreeRecord } {
    return withDb(dbPath, (db) => db.transaction(() => {
        const now = nowIso()
        const instance = latestInstanceForHost(db, repositoryId, hostId)
        if (!instance) throw new Error('repository_not_found: no instance of this repository on this host')

        // A stale row already occupying the new path (e.g. the pre-move registration of the same
        // clone) would violate UNIQUE(host_id, local_path) — retire it and its worktrees first.
        const occupant = db.prepare('SELECT * FROM repository_instances WHERE host_id = ? AND local_path = ? AND id <> ?')
            .get(hostId, newPath, instance.id) as InstanceRow | undefined
        if (occupant) {
            db.prepare('DELETE FROM git_worktrees WHERE repository_instance_id = ?').run(occupant.id)
            db.prepare('DELETE FROM repository_instances WHERE id = ?').run(occupant.id)
        }

        const oldPath = instance.local_path
        db.prepare(`
          UPDATE repository_instances
          SET local_path = ?, git_common_dir = ?, is_available = 1, last_seen_at = ?, updated_at = ?
          WHERE id = ?
        `).run(newPath, newGitCommonDir, now, now, instance.id)

        // Worktree paths under the moved clone follow it; the main worktree IS the clone root.
        db.prepare(`
          UPDATE git_worktrees
          SET worktree_path = ? || SUBSTR(worktree_path, ?), updated_at = ?
          WHERE repository_instance_id = ? AND SUBSTR(worktree_path, 1, ?) = ?
        `).run(newPath, oldPath.length + 1, now, instance.id, oldPath.length, oldPath)

        const updated = db.prepare('SELECT * FROM repository_instances WHERE id = ?').get(instance.id) as InstanceRow
        const worktree = primaryWorktree(db, instance.id)
        return {
            instance: mapInstance(updated),
            worktree: worktree ? mapWorktree(worktree) : undefined
        }
    })())
}

function tableExists(db: Database.Database, name: string): boolean {
    return Boolean(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name))
}

// Later-phase tables, deleted defensively only if they exist so `repo remove` stays correct as
// the schema grows (spec §19.7: memories are only deleted when explicitly requested).
const OBSERVATION_TABLES = ['git_refs', 'git_events', 'git_scan_runs', 'git_commits']
const SUMMARY_TABLES = ['git_summaries', 'git_summary_ranges', 'memory_checkpoints']

export function removeRepository(dbPath: string, repositoryId: string, options: RepoRemoveOptions = {}): RepoRemoveData {
    return withDb(dbPath, (db) => db.transaction(() => {
        const now = nowIso()
        db.prepare(`UPDATE repositories SET status = 'disabled', updated_at = ? WHERE id = ?`).run(now, repositoryId)

        const deleted = { observations: 0, summaries: 0, memories: 0 }
        if (options.deleteObservations) {
            for (const table of OBSERVATION_TABLES) {
                if (!tableExists(db, table)) continue
                deleted.observations += db.prepare(`DELETE FROM ${table} WHERE repository_id = ?`).run(repositoryId).changes
            }
        }
        if (options.deleteSummaries) {
            for (const table of SUMMARY_TABLES) {
                if (!tableExists(db, table)) continue
                deleted.summaries += db.prepare(`DELETE FROM ${table} WHERE repository_id = ?`).run(repositoryId).changes
            }
        }
        if (options.deleteMemories && tableExists(db, 'memory_sources')) {
            // Promoted memories live in `events`; the link rows know which ones came from this repo.
            deleted.memories += db.prepare(`
              DELETE FROM events WHERE id IN (SELECT memory_id FROM memory_sources WHERE repository_id = ?)
            `).run(repositoryId).changes
            db.prepare('DELETE FROM memory_sources WHERE repository_id = ?').run(repositoryId)
        }

        return { repository_id: repositoryId, status: 'disabled' as RepositoryStatus, deleted }
    })())
}
