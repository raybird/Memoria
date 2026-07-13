// Read-only repository scanner (spec §7.2, docs/issues/issue-1 Phase 2).
//
// Two responsibilities: snapshot the ref state (branches/tags/HEAD + working tree), and list
// commits that are NEW relative to the previously observed ref tips. Incremental by construction:
// the caller passes the last known tips and git's own graph walk (`--not <tips>`) prunes
// everything already seen — no per-commit re-analysis (spec §26).

import { runGit } from './git-exec.js'

export type GitRefType = 'local_branch' | 'remote_branch' | 'tag' | 'head'

export type GitRefSnapshot = {
    refName: string
    refType: GitRefType
    commitSha: string
}

export type RepoSnapshot = {
    headSha: string | null
    currentBranch: string | null
    workingTreeDirty: boolean
    refs: GitRefSnapshot[]
}

export type CommitInfo = {
    sha: string
    treeSha: string
    parents: string[]
    authorName: string
    authorEmail: string
    authorAt: string
    committerName: string
    committerEmail: string
    committedAt: string
    message: string
    isMerge: boolean
}

const FIELD_SEP = '\x1f'
const RECORD_SEP = '\x1e'

function classifyRef(refName: string): GitRefType | null {
    if (refName.startsWith('refs/heads/')) return 'local_branch'
    if (refName.startsWith('refs/remotes/')) return 'remote_branch'
    if (refName.startsWith('refs/tags/')) return 'tag'
    return null
}

/** Snapshot all refs + HEAD + working-tree state in two read-only git calls. */
export async function scanSnapshot(repositoryRoot: string): Promise<RepoSnapshot> {
    // %(*objectname) peels annotated tags to the tagged commit; empty for lightweight tags.
    const refsOut = await runGit(repositoryRoot, [
        'for-each-ref', `--format=%(refname)${FIELD_SEP}%(objectname)${FIELD_SEP}%(*objectname)`
    ])
    const refs: GitRefSnapshot[] = []
    for (const line of refsOut.stdout.split('\n')) {
        if (!line.trim()) continue
        const [refName, objectName, peeled] = line.split(FIELD_SEP)
        const refType = classifyRef(refName)
        if (!refType) continue
        refs.push({ refName, refType, commitSha: peeled || objectName })
    }

    const statusOut = await runGit(repositoryRoot, ['status', '--porcelain=v2', '--branch'])
    let headSha: string | null = null
    let currentBranch: string | null = null
    let workingTreeDirty = false
    for (const line of statusOut.stdout.split('\n')) {
        if (line.startsWith('# branch.oid ')) {
            const oid = line.slice('# branch.oid '.length).trim()
            headSha = oid === '(initial)' ? null : oid
        } else if (line.startsWith('# branch.head ')) {
            const head = line.slice('# branch.head '.length).trim()
            currentBranch = head === '(detached)' ? null : head
        } else if (line.trim() && !line.startsWith('#')) {
            workingTreeDirty = true
        }
    }
    if (headSha) refs.push({ refName: 'HEAD', refType: 'head', commitSha: headSha })

    return { headSha, currentBranch, workingTreeDirty, refs }
}

/**
 * List commits reachable from any branch/tag/HEAD but NOT from `excludeShas` (the previous scan's
 * tips). `--ignore-missing` tolerates tips deleted by history rewrites. `limit` caps the very
 * first scan so registering a huge repo stays fast (spec §28).
 */
export async function listNewCommits(
    repositoryRoot: string,
    excludeShas: string[],
    limit?: number
): Promise<CommitInfo[]> {
    const args = [
        'log', '--branches', '--tags', 'HEAD',
        '--ignore-missing',
        `--format=${['%H', '%T', '%P', '%an', '%ae', '%aI', '%cn', '%ce', '%cI', '%B'].join(FIELD_SEP)}${RECORD_SEP}`
    ]
    if (limit && limit > 0) args.splice(1, 0, `--max-count=${limit}`)
    if (excludeShas.length > 0) args.push('--not', ...excludeShas)

    const out = await runGit(repositoryRoot, args)
    const commits: CommitInfo[] = []
    for (const record of out.stdout.split(RECORD_SEP)) {
        const trimmed = record.replace(/^\n/, '')
        if (!trimmed.trim()) continue
        const fields = trimmed.split(FIELD_SEP)
        if (fields.length < 10) continue
        const parents = fields[2].split(' ').filter(Boolean)
        commits.push({
            sha: fields[0],
            treeSha: fields[1],
            parents,
            authorName: fields[3],
            authorEmail: fields[4],
            authorAt: fields[5],
            committerName: fields[6],
            committerEmail: fields[7],
            committedAt: fields[8],
            message: fields.slice(9).join(FIELD_SEP).replace(/\n$/, ''),
            isMerge: parents.length >= 2
        })
    }
    return commits
}
