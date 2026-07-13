// Repository identity resolution (spec §8, docs/issues/issue-1).
//
// Fingerprint strategy (decision D4): root_commit_sha is the PRIMARY identity component — it
// survives path moves, remote renames, and remote addition/removal. The remote URL is metadata
// only. The single exception is a shallow clone, where the true root commit is unreachable: those
// fall back to remote + earliest-available-commit and are marked limited_history until full
// history arrives (§25), at which point the fingerprint upgrades in place (same row, no new
// logical repository).

import path from 'node:path'
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { runGit } from './git-exec.js'

export type FingerprintBasis = 'root_commit' | 'shallow_remote'

export type RepositoryIdentity = {
    repositoryRoot: string
    gitCommonDir: string
    isMainWorktree: boolean
    isShallow: boolean
    headSha: string | null          // null = unborn branch (no commits yet)
    currentBranch: string | null    // null = detached HEAD
    workingTreeDirty: boolean
    rootCommitSha: string | null
    normalizedRemoteUrl: string | null
    defaultBranch: string | null
    fingerprint: string
    fingerprintBasis: FingerprintBasis
}

/** Strip credentials/protocol, unify scp-like and URL forms: host + path, no trailing .git. */
export function normalizeRemoteUrl(raw: string): string | null {
    const url = raw.trim()
    if (!url) return null
    // scp-like: git@github.com:user/repo.git
    const scpMatch = /^(?:[^@/]+@)?([^:/]+):(?!\/)(.+)$/.exec(url)
    if (scpMatch) {
        return `${scpMatch[1].toLowerCase()}/${scpMatch[2].replace(/\.git$/, '').replace(/\/+$/, '')}`
    }
    // URL form: https://user:pass@host/path.git, ssh://git@host/path.git, file:///path
    const urlMatch = /^[a-z+]+:\/\/(?:[^@/]+@)?([^/]+)(\/.*)$/i.exec(url)
    if (urlMatch) {
        const host = urlMatch[1].replace(/:\d+$/, '').toLowerCase()
        const p = urlMatch[2].replace(/\.git$/, '').replace(/\/+$/, '')
        return `${host}${p}`
    }
    return url.replace(/\.git$/, '').replace(/\/+$/, '') || null
}

// The spec's read allowlist (§5) bans `git config` outright, so the remote URL is read from the
// config FILE as plain text — a pure read, no git invocation. Best effort: origin first, else the
// first remote section in the file.
async function readRemoteUrl(gitCommonDir: string): Promise<string | null> {
    let text: string
    try {
        text = await fs.readFile(path.join(gitCommonDir, 'config'), 'utf8')
    } catch {
        return null
    }
    const sections = [...text.matchAll(/\[remote "([^"]+)"\]([^[]*)/g)]
    const pick = sections.find((s) => s[1] === 'origin') ?? sections[0]
    if (!pick) return null
    const urlMatch = /^\s*url\s*=\s*(.+)$/m.exec(pick[2])
    return urlMatch ? normalizeRemoteUrl(urlMatch[1]) : null
}

async function readDefaultBranch(repositoryRoot: string): Promise<string | null> {
    try {
        const out = await runGit(repositoryRoot, [
            'for-each-ref', '--format=%(symref:short)', 'refs/remotes/origin/HEAD'
        ])
        const symref = out.stdout.trim()
        if (symref.startsWith('origin/')) return symref.slice('origin/'.length)
        return symref || null
    } catch {
        return null
    }
}

// `status --porcelain=v2 --branch` yields branch name, head oid, AND dirty state in one
// read-only call — and it works on unborn branches where `rev-parse HEAD` fails.
async function readHeadState(repositoryRoot: string): Promise<{
    headSha: string | null
    currentBranch: string | null
    workingTreeDirty: boolean
}> {
    const out = await runGit(repositoryRoot, ['status', '--porcelain=v2', '--branch'])
    let headSha: string | null = null
    let currentBranch: string | null = null
    let workingTreeDirty = false
    for (const line of out.stdout.split('\n')) {
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
    return { headSha, currentBranch, workingTreeDirty }
}

function computeFingerprint(basis: FingerprintBasis, seed: string): string {
    return createHash('sha256').update(`${basis}:${seed}`).digest('hex')
}

/**
 * Resolve the stable identity of the git repository containing `targetPath`.
 * Throws GitExecError('not_a_git_repository') for non-git paths and a plain Error
 * ('unborn_branch') for repositories with no commits — identity needs at least one commit.
 */
export async function resolveRepositoryIdentity(targetPath: string): Promise<RepositoryIdentity> {
    const repositoryRoot = (await runGit(targetPath, ['rev-parse', '--show-toplevel'])).stdout.trim()
    const gitDir = path.resolve(repositoryRoot, (await runGit(repositoryRoot, ['rev-parse', '--git-dir'])).stdout.trim())
    const gitCommonDir = path.resolve(repositoryRoot, (await runGit(repositoryRoot, ['rev-parse', '--git-common-dir'])).stdout.trim())
    const isMainWorktree = gitDir === gitCommonDir
    const isShallow = (await runGit(repositoryRoot, ['rev-parse', '--is-shallow-repository'])).stdout.trim() === 'true'

    const { headSha, currentBranch, workingTreeDirty } = await readHeadState(repositoryRoot)
    const normalizedRemoteUrl = await readRemoteUrl(gitCommonDir)
    const defaultBranch = await readDefaultBranch(repositoryRoot)

    if (!headSha) {
        throw new Error('unborn_branch: repository has no commits yet; add at least one commit before registering')
    }

    // Multi-root histories (e.g. merged subtrees) list several parentless commits; sort for a
    // deterministic pick. On shallow clones this returns the graft boundary, not the true root.
    const rootsOut = await runGit(repositoryRoot, ['rev-list', '--max-parents=0', 'HEAD'])
    const roots = rootsOut.stdout.trim().split('\n').filter(Boolean).sort()
    const earliestSha = roots[0] ?? headSha

    let fingerprintBasis: FingerprintBasis
    let fingerprint: string
    let rootCommitSha: string | null
    if (isShallow) {
        fingerprintBasis = 'shallow_remote'
        rootCommitSha = null // the visible boundary is NOT the true root (§25)
        fingerprint = computeFingerprint(fingerprintBasis, `${normalizedRemoteUrl ?? 'no-remote'}:${earliestSha}`)
    } else {
        fingerprintBasis = 'root_commit'
        rootCommitSha = earliestSha
        fingerprint = computeFingerprint(fingerprintBasis, rootCommitSha)
    }

    return {
        repositoryRoot,
        gitCommonDir,
        isMainWorktree,
        isShallow,
        headSha,
        currentBranch,
        workingTreeDirty,
        rootCommitSha,
        normalizedRemoteUrl,
        defaultBranch,
        fingerprint,
        fingerprintBasis
    }
}
