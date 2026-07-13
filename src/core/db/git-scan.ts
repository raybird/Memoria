// Incremental scan persistence (spec §9.4/§9.5/§9.7, docs/issues/issue-1 Phase 2).
//
// git_commits: INSERT OR IGNORE keyed on (repository_id, commit_sha) — re-scans are no-ops.
// git_refs: one is_current=1 row per ref; a moved ref demotes the old row (is_current=0) and
// inserts a fresh observation, so history is kept without per-scan duplication.
// git_scan_runs: one row per sync; failures record the reason and never roll back observations
// (spec §24 — each stage retries independently).

import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { withDb } from './connection.js'
import type { CommitInfo, GitRefSnapshot } from '../git/scanner.js'

function nowIso(): string {
    return new Date().toISOString()
}

export type GitRefObservation = {
    id: string
    ref_name: string
    ref_type: string
    commit_sha: string
    observed_at: string
}

export type RefSnapshotDelta = {
    newBranchCount: number
    newTagCount: number
    movedRefCount: number
    disappearedRefs: GitRefObservation[]
    previous: GitRefObservation[]
}

export function getCurrentRefObservations(dbPath: string, repositoryId: string): GitRefObservation[] {
    return withDb(dbPath, (db) =>
        db.prepare(`
          SELECT id, ref_name, ref_type, commit_sha, observed_at
          FROM git_refs WHERE repository_id = ? AND is_current = 1
        `).all(repositoryId) as GitRefObservation[]
    )
}

export function insertCommits(dbPath: string, repositoryId: string, commits: CommitInfo[]): number {
    if (commits.length === 0) return 0
    return withDb(dbPath, (db) => db.transaction(() => {
        const now = nowIso()
        const insert = db.prepare(`
          INSERT OR IGNORE INTO git_commits
            (repository_id, commit_sha, tree_sha, parent_shas_json, author_name, author_email, author_at,
             committer_name, committer_email, committed_at, message, is_merge, patch_id, unreachable,
             first_seen_at, last_seen_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?, ?)
        `)
        const touch = db.prepare(`
          UPDATE git_commits SET last_seen_at = ?, unreachable = 0
          WHERE repository_id = ? AND commit_sha = ?
        `)
        let inserted = 0
        for (const c of commits) {
            const result = insert.run(
                repositoryId, c.sha, c.treeSha, JSON.stringify(c.parents),
                c.authorName, c.authorEmail, c.authorAt,
                c.committerName, c.committerEmail, c.committedAt,
                c.message, c.isMerge ? 1 : 0, now, now
            )
            if (result.changes === 1) inserted += 1
            else touch.run(now, repositoryId, c.sha)
        }
        return inserted
    })())
}

/** Reconcile the stored is_current ref rows with a fresh snapshot; returns what changed. */
export function applyRefSnapshot(
    dbPath: string,
    repositoryId: string,
    worktreeId: string | null,
    refs: GitRefSnapshot[],
    previous?: GitRefObservation[]
): RefSnapshotDelta {
    return withDb(dbPath, (db) => db.transaction(() => {
        const now = nowIso()
        const prev = previous ?? db.prepare(`
          SELECT id, ref_name, ref_type, commit_sha, observed_at
          FROM git_refs WHERE repository_id = ? AND is_current = 1
        `).all(repositoryId) as GitRefObservation[]
        const prevByName = new Map(prev.map((r) => [`${r.ref_type}:${r.ref_name}`, r]))

        const demote = db.prepare('UPDATE git_refs SET is_current = 0 WHERE id = ?')
        const refresh = db.prepare('UPDATE git_refs SET observed_at = ?, worktree_id = ? WHERE id = ?')
        const insert = db.prepare(`
          INSERT INTO git_refs (id, repository_id, worktree_id, ref_name, ref_type, commit_sha, observed_at, is_current)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        `)

        let newBranchCount = 0
        let newTagCount = 0
        let movedRefCount = 0
        const seen = new Set<string>()

        for (const ref of refs) {
            const key = `${ref.refType}:${ref.refName}`
            seen.add(key)
            const existing = prevByName.get(key)
            if (existing && existing.commit_sha === ref.commitSha) {
                refresh.run(now, worktreeId, existing.id)
                continue
            }
            if (existing) {
                demote.run(existing.id)
                movedRefCount += 1
            } else if (ref.refType === 'tag') {
                newTagCount += 1
            } else if (ref.refType !== 'head') {
                newBranchCount += 1
            }
            const id = `ref_${createHash('sha256').update(`${repositoryId}|${key}|${ref.commitSha}|${now}|${randomUUID()}`).digest('hex').slice(0, 16)}`
            insert.run(id, repositoryId, worktreeId, ref.refName, ref.refType, ref.commitSha, now)
        }

        const disappearedRefs = prev.filter((r) => !seen.has(`${r.ref_type}:${r.ref_name}`))
        for (const gone of disappearedRefs) demote.run(gone.id)

        return { newBranchCount, newTagCount, movedRefCount, disappearedRefs, previous: prev }
    })())
}

export function beginScanRun(
    dbPath: string,
    repositoryId: string,
    worktreeId: string | null,
    previousHeadSha: string | null,
    currentHeadSha: string | null
): string {
    const id = `scan_${randomUUID().replace(/-/g, '').slice(0, 16)}`
    withDb(dbPath, (db) => {
        db.prepare(`
          INSERT INTO git_scan_runs
            (id, repository_id, worktree_id, started_at, previous_head_sha, current_head_sha, status)
          VALUES (?, ?, ?, ?, ?, ?, 'running')
        `).run(id, repositoryId, worktreeId, nowIso(), previousHeadSha, currentHeadSha)
    })
    return id
}

export function completeScanRun(
    dbPath: string,
    scanRunId: string,
    counts: { newCommitCount: number; newRefCount: number; newTagCount: number; eventCount: number }
): void {
    withDb(dbPath, (db) => {
        db.prepare(`
          UPDATE git_scan_runs
          SET completed_at = ?, status = 'completed',
              new_commit_count = ?, new_ref_count = ?, new_tag_count = ?, event_count = ?
          WHERE id = ?
        `).run(nowIso(), counts.newCommitCount, counts.newRefCount, counts.newTagCount, counts.eventCount, scanRunId)
    })
}

export function failScanRun(dbPath: string, scanRunId: string, errorMessage: string): void {
    withDb(dbPath, (db) => {
        db.prepare(`
          UPDATE git_scan_runs SET completed_at = ?, status = 'failed', error_message = ? WHERE id = ?
        `).run(nowIso(), errorMessage.slice(0, 1000), scanRunId)
    })
}

/** Persist the freshly observed worktree state after a successful scan. */
export function updateWorktreeScanState(
    dbPath: string,
    worktreeId: string,
    currentBranch: string | null,
    currentHeadSha: string | null
): void {
    withDb(dbPath, (db) => {
        const now = nowIso()
        db.prepare(`
          UPDATE git_worktrees
          SET current_branch = ?, current_head_sha = ?, last_scanned_at = ?, updated_at = ?
          WHERE id = ?
        `).run(currentBranch, currentHeadSha, now, now, worktreeId)
    })
}

/** Count scan runs by status for a repository (used by status/telemetry surfaces). */
export function countPendingWork(db: Database.Database, repositoryId: string): { failed_scans: number } {
    const row = db.prepare(`
      SELECT COUNT(*) AS failed FROM git_scan_runs WHERE repository_id = ? AND status = 'failed'
    `).get(repositoryId) as { failed: number }
    return { failed_scans: row.failed }
}
