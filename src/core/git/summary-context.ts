// Summary input assembly (spec §17/§23, docs/issues/issue-1 Phase 4).
//
// Priority order per §17: commit messages → changed file list → diff statistics → selected diff.
// Sensitive paths are dropped from every layer; the diff is filtered per file section, secret-
// masked, and capped at maxDiffBytes. The raw diff is never persisted — only this trimmed
// context reaches the generator (deterministic or agent).

import { runGit } from './git-exec.js'
import { matchesAnyGlob, maskSecrets } from './secret-filter.js'
import type { FileChange } from './scanner.js'
import type { MemoriaGitConfig } from '../config.js'

// git's well-known empty tree — lets `diff` express "everything up to <head>" for root ranges.
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

export type SummaryContextCommit = {
    sha: string
    subject: string
}

export type SummaryContext = {
    commits: SummaryContextCommit[]
    changed_files: FileChange[]
    diffstat: { files: number; additions: number; deletions: number }
    diff?: string
    warnings: string[]
}

function splitDiffSections(diff: string): string[] {
    // Every file section starts with "diff --git "; keep the leading chunk with its section.
    const sections: string[] = []
    let current = ''
    for (const line of diff.split('\n')) {
        if (line.startsWith('diff --git ') && current) {
            sections.push(current)
            current = ''
        }
        current += `${line}\n`
    }
    if (current.trim()) sections.push(current)
    return sections
}

function sectionPath(section: string): string {
    const match = /^diff --git a\/(.+?) b\//.exec(section)
    return match ? match[1] : ''
}

export async function buildRangeContext(
    repositoryRoot: string,
    baseSha: string | null,
    headSha: string,
    gitConfig: MemoriaGitConfig,
    explicitCommits?: SummaryContextCommit[]
): Promise<SummaryContext> {
    const warnings: string[] = []
    const base = baseSha ?? EMPTY_TREE_SHA
    const sensitive = gitConfig.filters.sensitivePaths
    const excluded = gitConfig.filters.excludePaths

    const commits = explicitCommits ?? await (async () => {
        const out = await runGit(repositoryRoot, ['log', '--format=%H%x1f%s', `${base}..${headSha}`])
        return out.stdout.split('\n').filter(Boolean).map((line) => {
            const [sha, subject] = line.split('\x1f')
            return { sha, subject: (subject ?? '').slice(0, 200) }
        })
    })()

    const numstatOut = await runGit(repositoryRoot, ['diff', '--numstat', base, headSha])
    const changedFiles: FileChange[] = []
    let sensitiveDropped = 0
    for (const line of numstatOut.stdout.split('\n')) {
        if (!line.trim()) continue
        const [adds, dels, ...pathParts] = line.split('\t')
        const path = pathParts.join('\t')
        if (!path) continue
        if (matchesAnyGlob(path, sensitive)) {
            sensitiveDropped += 1
            continue
        }
        if (matchesAnyGlob(path, excluded)) continue
        changedFiles.push({
            path,
            additions: adds === '-' ? 0 : Number(adds) || 0,
            deletions: dels === '-' ? 0 : Number(dels) || 0
        })
    }
    if (sensitiveDropped > 0) {
        warnings.push(`sensitive_content_detected: ${sensitiveDropped} file(s) excluded from summary context`)
    }

    const diffstat = {
        files: changedFiles.length,
        additions: changedFiles.reduce((sum, f) => sum + f.additions, 0),
        deletions: changedFiles.reduce((sum, f) => sum + f.deletions, 0)
    }

    let diff: string | undefined
    if (gitConfig.summarization.includeDiff && changedFiles.length > 0) {
        const diffOut = await runGit(repositoryRoot, ['diff', base, headSha], {
            maxOutputBytes: Math.max(gitConfig.summarization.maxDiffBytes * 4, 1024 * 1024)
        }).catch(() => null)
        if (diffOut) {
            const kept = splitDiffSections(diffOut.stdout).filter((section) => {
                const path = sectionPath(section)
                return path && !matchesAnyGlob(path, sensitive) && !matchesAnyGlob(path, excluded)
            })
            let assembled = ''
            let truncated = false
            for (const section of kept) {
                if (assembled.length + section.length > gitConfig.summarization.maxDiffBytes) {
                    truncated = true
                    break
                }
                assembled += section
            }
            if (truncated) warnings.push(`diff truncated at ${gitConfig.summarization.maxDiffBytes} bytes (whole-file sections only)`)
            const masked = maskSecrets(assembled)
            if (masked.maskedCount > 0) {
                warnings.push(`sensitive_content_detected: masked ${masked.maskedCount} secret-like value(s) in diff`)
            }
            diff = masked.text || undefined
        } else {
            warnings.push('diff unavailable (objects missing or too large); context reduced to messages + stats')
        }
    }

    return { commits, changed_files: changedFiles, diffstat, diff, warnings }
}
