// How far each repository has moved past its last `repo sync`.
//
// A repository that stops being synced looks exactly like a repository with nothing new: the brief
// keeps showing its last summary and every count stays put. Measured live rather than stored, so
// the number cannot go stale between syncs. Read-only.
//
// The count is deliberately narrower than what a sync discovers (issue-38). A sync scans every
// branch (`--branches --tags HEAD` past the observed tips — see listNewCommits), but the skill
// syncs after a merge or a release, so the hint only counts what those add: commits on the
// registered default branch, and tags. Work on an unmerged branch is not a reason to sync yet.
// With no registered default branch, or none by that name here, it falls back to the sync's range.

import { runGit } from './git-exec.js'
import { readHostId } from './host.js'
import { resolveRepositoryIdentity } from './identity.js'
import { listRepositories } from '../db/git-repo.js'
import { getCurrentRefObservations } from '../db/git-scan.js'

export type RepoScanLag = {
    repository: string
    /** null = not measurable here: no local checkout, never scanned, or the path no longer holds it. */
    unscanned_commits: number | null
    /** Local tags no sync has observed, newest first (issue-38); null when not measurable, as above. */
    unscanned_tags: string[] | null
}

type Lag = Pick<RepoScanLag, 'unscanned_commits' | 'unscanned_tags'>
const UNMEASURED: Lag = { unscanned_commits: null, unscanned_tags: null }

async function hasLocalBranch(root: string, branch: string): Promise<boolean> {
    const out = await runGit(root, ['for-each-ref', '--format=%(refname)', `refs/heads/${branch}`])
    return out.stdout.split('\n').includes(`refs/heads/${branch}`)
}

async function measureLag(
    root: string,
    fingerprint: string,
    defaultBranch: string | null,
    tips: string[],
    observedTags: Set<string>
): Promise<Lag> {
    if (tips.length === 0) return UNMEASURED
    try {
        // A different repository at the registered path would report its whole history as "new".
        const identity = await resolveRepositoryIdentity(root)
        if (identity.fingerprint !== fingerprint) return UNMEASURED
        const range = defaultBranch && await hasLocalBranch(root, defaultBranch)
            ? [`refs/heads/${defaultBranch}`, '--tags']
            : ['--branches', '--tags', 'HEAD']
        const out = await runGit(root, ['rev-list', '--count', '--ignore-missing', ...range, '--not', ...tips])
        const count = Number(out.stdout.trim())
        const tagsOut = await runGit(root, ['for-each-ref', '--sort=-creatordate', '--format=%(refname)', 'refs/tags'])
        const tags = tagsOut.stdout.split('\n').filter((ref) => ref && !observedTags.has(ref))
            .map((ref) => ref.slice('refs/tags/'.length))
        return { unscanned_commits: Number.isInteger(count) ? count : null, unscanned_tags: tags }
    } catch {
        return UNMEASURED
    }
}

/** Disabled repositories are skipped: they were taken out of scanning on purpose. */
export async function measureScanLag(dbPath: string, memoryDir: string): Promise<RepoScanLag[]> {
    // Reading, not creating: a diagnostic must not write the identity file `repo add` owns.
    const hostId = await readHostId(memoryDir)
    if (!hostId) return []

    const repositories = listRepositories(dbPath, hostId).filter((item) => item.repository.status !== 'disabled')
    return Promise.all(repositories.map(async ({ repository, instance }) => {
        const refs = getCurrentRefObservations(dbPath, repository.id)
        const tips = [...new Set(refs.map((ref) => ref.commit_sha))]
        const observedTags = new Set(refs.filter((ref) => ref.ref_type === 'tag').map((ref) => ref.ref_name))
        const lag = instance
            ? await measureLag(instance.local_path, repository.fingerprint, repository.default_branch ?? null, tips, observedTags)
            : UNMEASURED
        return { repository: repository.name, ...lag }
    }))
}
