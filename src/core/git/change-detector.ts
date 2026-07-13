// Git change detector (spec §7.3/§11.2, docs/issues/issue-1 Phase 3).
//
// Events are INFERRED from snapshot differences — they say "Memoria observed this transition",
// never "this operation ran locally" (a pull, a GUI client, or another machine may be the cause).
// Transitions that happen entirely between two scans (branch created then deleted) are invisible
// by design; that collapse is a documented limitation.
//
// History rewrites: a moved branch whose old tip is NOT an ancestor of its new tip was rebased,
// amended, or reset. Only then are patch-ids computed (lazily, capped) so equivalent old/new
// commits can be paired without re-summarizing them — the normal path never runs `git patch-id`
// (spec §26). scan_completed is deliberately NOT emitted as an event: it is already recorded in
// git_scan_runs and would only add per-sync noise for the summary planner.

import { runGit } from './git-exec.js'
import type { CommitInfo, RepoSnapshot } from './scanner.js'
import type { GitRefObservation } from '../db/git-scan.js'

export type NewGitEvent = {
    eventType: string
    sourceRef?: string | null
    targetRef?: string | null
    beforeSha?: string | null
    afterSha?: string | null
    metadata?: Record<string, unknown>
}

export type RewritePatch = {
    commitSha: string
    patchId: string
    unreachable: boolean
}

export type DetectedChanges = {
    events: NewGitEvent[]
    rewritePatches: RewritePatch[]
}

// Rewrites can touch long histories; patch-id needs one `git show` per commit, so cap the
// equivalence scan and record the truncation in the event metadata instead of stalling sync.
const MAX_PATCH_ID_COMMITS = 50

async function isAncestor(root: string, ancestor: string, descendant: string): Promise<boolean> {
    const result = await runGit(root, ['merge-base', '--is-ancestor', ancestor, descendant], { allowExitCodes: [1, 128] })
    return result.exitCode === 0
}

async function computePatchId(root: string, commitSha: string): Promise<string | null> {
    try {
        const diff = await runGit(root, ['show', '--format=', commitSha])
        if (!diff.stdout.trim()) return null // empty commits have no patch-id
        const out = await runGit(root, ['patch-id', '--stable'], { stdin: diff.stdout })
        return out.stdout.trim().split(/\s+/)[0] || null
    } catch {
        return null // object already gc'd or unparseable — best effort
    }
}

async function listShas(root: string, args: string[]): Promise<string[]> {
    try {
        const out = await runGit(root, ['rev-list', '--ignore-missing', ...args])
        return out.stdout.trim().split('\n').filter(Boolean)
    } catch {
        return []
    }
}

export type DetectChangesInput = {
    repositoryRoot: string
    prevRefs: GitRefObservation[]
    snapshot: RepoSnapshot
    previousHeadSha: string | null
    previousDirty: boolean | null
    firstScan: boolean
    newCommits: CommitInfo[]
}

export async function detectChanges(input: DetectChangesInput): Promise<DetectedChanges> {
    const { repositoryRoot, prevRefs, snapshot, previousHeadSha, previousDirty, firstScan, newCommits } = input
    const events: NewGitEvent[] = []
    const rewritePatches: RewritePatch[] = []

    if (firstScan) {
        events.push({
            eventType: 'repository_added',
            afterSha: snapshot.headSha,
            targetRef: snapshot.currentBranch,
            metadata: { commits_scanned: newCommits.length }
        })
        return { events, rewritePatches } // per-commit/ref events would just replay history
    }

    // Commit discovery (merge commits get their own type — the planner treats them differently).
    for (const commit of newCommits) {
        events.push({
            eventType: commit.isMerge ? 'merge_commit_discovered' : 'commit_discovered',
            afterSha: commit.sha,
            metadata: {
                parents: commit.parents,
                subject: commit.message.split('\n')[0].slice(0, 200)
            }
        })
    }

    // Ref movement: compare previous is_current observations against the fresh snapshot.
    const branchTypes = new Set(['local_branch', 'remote_branch'])
    const prevByKey = new Map(prevRefs.map((r) => [`${r.ref_type}:${r.ref_name}`, r]))
    const seen = new Set<string>()
    for (const ref of snapshot.refs) {
        const key = `${ref.refType}:${ref.refName}`
        seen.add(key)
        if (ref.refType === 'head') continue // covered by head_changed below
        const prev = prevByKey.get(key)
        if (!prev) {
            events.push({
                eventType: ref.refType === 'tag' ? 'tag_discovered' : 'branch_discovered',
                targetRef: ref.refName,
                afterSha: ref.commitSha,
                metadata: { ref_type: ref.refType }
            })
            continue
        }
        if (prev.commit_sha === ref.commitSha || !branchTypes.has(ref.refType)) continue

        events.push({
            eventType: 'branch_head_moved',
            targetRef: ref.refName,
            beforeSha: prev.commit_sha,
            afterSha: ref.commitSha,
            metadata: { ref_type: ref.refType }
        })
        // Non-fast-forward movement = rewritten history on that branch (§11.2).
        if (!(await isAncestor(repositoryRoot, prev.commit_sha, ref.commitSha))) {
            const abandoned = await listShas(repositoryRoot, [prev.commit_sha, '--not', ref.commitSha])
            const replacements = await listShas(repositoryRoot, [ref.commitSha, '--not', prev.commit_sha])
            const truncated = abandoned.length > MAX_PATCH_ID_COMMITS || replacements.length > MAX_PATCH_ID_COMMITS

            const oldPatch = new Map<string, string>()
            for (const sha of abandoned.slice(0, MAX_PATCH_ID_COMMITS)) {
                const pid = await computePatchId(repositoryRoot, sha)
                if (pid) oldPatch.set(sha, pid)
                rewritePatches.push({ commitSha: sha, patchId: pid ?? '', unreachable: true })
            }
            const newPatch = new Map<string, string>()
            for (const sha of replacements.slice(0, MAX_PATCH_ID_COMMITS)) {
                const pid = await computePatchId(repositoryRoot, sha)
                if (pid) newPatch.set(sha, pid)
                rewritePatches.push({ commitSha: sha, patchId: pid ?? '', unreachable: false })
            }
            const pairs: Array<{ old: string; new: string }> = []
            for (const [oldSha, pid] of oldPatch) {
                for (const [newSha, newPid] of newPatch) {
                    if (pid === newPid) pairs.push({ old: oldSha, new: newSha })
                }
            }
            events.push({
                eventType: 'history_rewritten',
                targetRef: ref.refName,
                beforeSha: prev.commit_sha,
                afterSha: ref.commitSha,
                metadata: {
                    abandoned_commits: abandoned.length,
                    replacement_commits: replacements.length,
                    equivalent_pairs: pairs,
                    truncated
                }
            })
        }
    }
    for (const prev of prevRefs) {
        if (prev.ref_type === 'head' || seen.has(`${prev.ref_type}:${prev.ref_name}`)) continue
        events.push({
            eventType: 'branch_disappeared',
            sourceRef: prev.ref_name,
            beforeSha: prev.commit_sha,
            metadata: { ref_type: prev.ref_type }
        })
    }

    if (previousHeadSha && snapshot.headSha && previousHeadSha !== snapshot.headSha) {
        events.push({
            eventType: 'head_changed',
            beforeSha: previousHeadSha,
            afterSha: snapshot.headSha,
            targetRef: snapshot.currentBranch
        })
    }

    // Edge-triggered working-tree transitions (null previous state = unknown → only report dirty).
    if (snapshot.workingTreeDirty && previousDirty !== true) {
        events.push({ eventType: 'working_tree_dirty' })
    } else if (!snapshot.workingTreeDirty && previousDirty === true) {
        events.push({ eventType: 'working_tree_clean' })
    }

    return { events, rewritePatches }
}
