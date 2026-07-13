// Commit-range planner + trivial filter (spec §15/§16, docs/issues/issue-1 Phase 4).
//
// Fully deterministic — no model involvement (decision U3): grouping uses the commit time window
// and top-level-directory "domains"; triviality uses line counts, file-kind patterns, and the
// important-files exception list. Same inputs always produce the same ranges.

import { matchesAnyGlob } from './secret-filter.js'
import type { FileChange } from './scanner.js'
import type { MemoriaGitConfig } from '../config.js'

export type PlannerCommit = {
    sha: string
    parents: string[]
    committedAt: string
    message: string
    files: FileChange[]
}

export type RangeGroup = {
    commits: PlannerCommit[]
    baseSha: string | null
    headSha: string
    domains: string[]
    totalChangedLines: number
    importantFiles: string[]
}

export type TrivialityVerdict = {
    keep: boolean
    reasons: string[]
}

// §16 important-file exception: these matter even when the line count is tiny.
const IMPORTANT_FILE_PATTERNS: RegExp[] = [
    /migration/i,
    /schema/i,
    /\bauth/i,
    /security/i,
    /permission/i,
    /deploy/i,
    /\.github\/workflows\//,
    /dockerfile/i,
    /openapi|swagger|api[-_.]?contract/i
]

// Files whose changes carry no engineering semantics on their own.
const TRIVIAL_FILE_PATTERNS = [
    '*.lock', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock',
    '*.snap', '*.min.js', '*.map', '*.generated.*'
]

export function fileDomain(path: string): string {
    const idx = path.indexOf('/')
    return idx === -1 ? '(root)' : path.slice(0, idx)
}

function domainsOf(files: FileChange[]): Set<string> {
    return new Set(files.map((f) => fileDomain(f.path)))
}

function intersects(a: Set<string>, b: Set<string>): boolean {
    for (const item of a) if (b.has(item)) return true
    return false
}

/**
 * Group commits (oldest→newest) into candidate ranges. A new group starts on a time gap larger
 * than branchIdleHours or when the commit's domains share nothing with the running group's.
 * Merge commits and tag boundaries never reach this planner — merges get their own summary type
 * and tags trigger release summaries (§15 切割點).
 */
export function planCommitRanges(commits: PlannerCommit[], gitConfig: MemoriaGitConfig): RangeGroup[] {
    const sorted = [...commits].sort((a, b) => a.committedAt.localeCompare(b.committedAt))
    const gapMs = gitConfig.summarization.branchIdleHours * 3600 * 1000
    const groups: PlannerCommit[][] = []
    let current: PlannerCommit[] = []
    let currentDomains = new Set<string>()
    let lastAt = 0

    for (const commit of sorted) {
        const at = Date.parse(commit.committedAt) || 0
        const commitDomains = domainsOf(commit.files)
        const splitOnGap = current.length > 0 && lastAt > 0 && at - lastAt > gapMs
        const splitOnDomain = current.length > 0 && commitDomains.size > 0 && currentDomains.size > 0 &&
            !intersects(commitDomains, currentDomains)
        if (splitOnGap || splitOnDomain) {
            groups.push(current)
            current = []
            currentDomains = new Set()
        }
        current.push(commit)
        for (const d of commitDomains) currentDomains.add(d)
        lastAt = at
    }
    if (current.length > 0) groups.push(current)

    return groups.map((group) => {
        const files = group.flatMap((c) => c.files)
        return {
            commits: group,
            baseSha: group[0].parents[0] ?? null,
            headSha: group[group.length - 1].sha,
            domains: [...new Set(files.map((f) => fileDomain(f.path)))].sort(),
            totalChangedLines: files.reduce((sum, f) => sum + f.additions + f.deletions, 0),
            importantFiles: [...new Set(files.map((f) => f.path).filter(isImportantFile))]
        }
    })
}

export function isImportantFile(path: string): boolean {
    return IMPORTANT_FILE_PATTERNS.some((p) => p.test(path))
}

/** §16: skip noise; the important-file exception overrides every size gate. */
export function classifyTriviality(group: RangeGroup, gitConfig: MemoriaGitConfig): TrivialityVerdict {
    if (group.importantFiles.length > 0) {
        return { keep: true, reasons: [`important files touched: ${group.importantFiles.slice(0, 3).join(', ')}`] }
    }
    const meaningfulFiles = group.commits
        .flatMap((c) => c.files)
        .filter((f) => !matchesAnyGlob(f.path, TRIVIAL_FILE_PATTERNS))
    if (meaningfulFiles.length === 0) {
        return { keep: false, reasons: ['only lockfiles/generated/snapshot files changed'] }
    }
    if (group.totalChangedLines < gitConfig.summarization.minimumChangedLines) {
        return { keep: false, reasons: [`changed lines ${group.totalChangedLines} < minimum ${gitConfig.summarization.minimumChangedLines}`] }
    }
    if (group.commits.length < gitConfig.summarization.minimumCommits) {
        return { keep: false, reasons: [`commits ${group.commits.length} < minimum ${gitConfig.summarization.minimumCommits}`] }
    }
    return { keep: true, reasons: [] }
}
