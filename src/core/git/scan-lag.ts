// How far each repository has moved past its last `repo sync`.
//
// A repository that stops being synced looks exactly like a repository with nothing new: the brief
// keeps showing its last summary and every count stays put. Measured live rather than stored, so
// the number cannot go stale between syncs. Read-only, and it counts the same commits a sync would
// discover (`--branches --tags HEAD` past the observed tips — see listNewCommits).

import { runGit } from './git-exec.js'
import { readHostId } from './host.js'
import { resolveRepositoryIdentity } from './identity.js'
import { listRepositories } from '../db/git-repo.js'
import { getCurrentRefObservations } from '../db/git-scan.js'

export type RepoScanLag = {
    repository: string
    /** null = not measurable here: no local checkout, never scanned, or the path no longer holds it. */
    unscanned_commits: number | null
}

async function countUnscanned(root: string, fingerprint: string, tips: string[]): Promise<number | null> {
    if (tips.length === 0) return null
    try {
        // A different repository at the registered path would report its whole history as "new".
        const identity = await resolveRepositoryIdentity(root)
        if (identity.fingerprint !== fingerprint) return null
        const out = await runGit(root, [
            'rev-list', '--count', '--ignore-missing', '--branches', '--tags', 'HEAD', '--not', ...tips
        ])
        const count = Number(out.stdout.trim())
        return Number.isInteger(count) ? count : null
    } catch {
        return null
    }
}

/** Disabled repositories are skipped: they were taken out of scanning on purpose. */
export async function measureScanLag(dbPath: string, memoryDir: string): Promise<RepoScanLag[]> {
    // Reading, not creating: a diagnostic must not write the identity file `repo add` owns.
    const hostId = await readHostId(memoryDir)
    if (!hostId) return []

    const repositories = listRepositories(dbPath, hostId).filter((item) => item.repository.status !== 'disabled')
    return Promise.all(repositories.map(async ({ repository, instance }) => {
        const tips = [...new Set(getCurrentRefObservations(dbPath, repository.id).map((ref) => ref.commit_sha))]
        return {
            repository: repository.name,
            unscanned_commits: instance ? await countUnscanned(instance.local_path, repository.fingerprint, tips) : null
        }
    }))
}
