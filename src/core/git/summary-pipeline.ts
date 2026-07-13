// Summary pipeline orchestrator (spec §7.4/§12–§15, docs/issues/issue-1 Phase 4).
//
// Consumes PENDING git_events (so backlogs from --no-summary syncs are picked up later), plans
// deterministic ranges, filters trivia, builds trimmed context, and writes deterministic
// skeleton summaries. Summary failures never roll back scan observations (§24) — the caller
// converts throws into warnings. Branch summaries are triggered manually (repo summarize
// --branch); fast-forward inference is deferred to v1.1 by decision.

import { runGit } from './git-exec.js'
import { getCommitStats } from './scanner.js'
import { planCommitRanges, classifyTriviality, type PlannerCommit } from './range-planner.js'
import { buildRangeContext } from './summary-context.js'
import {
    generateDeterministicSummary,
    DETERMINISTIC_GENERATOR_VERSION,
    DEFAULT_PROMPT_VERSION
} from './summary-generator.js'
import {
    listPendingEvents,
    markEvents,
    loadCommitFacts,
    listCurrentTags,
    upsertSummaryRange,
    insertSummaryIfMissing
} from '../db/git-summary.js'
import type { MemoriaGitConfig } from '../config.js'
import type { GitSummaryRecord, GitSummaryType } from '../types.js'

export const RELEASE_TAG_PATTERN = /^(?:v|release-)?\d+\.\d+\.\d+$/

export type SummaryPipelineInput = {
    dbPath: string
    repositoryRoot: string
    repositoryId: string
    defaultBranch: string | null
    gitConfig: MemoriaGitConfig
    force?: boolean
}

export type SummaryPipelineResult = {
    summariesCreated: number
    summaries: GitSummaryRecord[]
    warnings: string[]
}

async function mergeBase(root: string, a: string, b: string): Promise<string | null> {
    try {
        const out = await runGit(root, ['merge-base', a, b])
        return out.stdout.trim() || null
    } catch {
        return null
    }
}

type CreateSummaryArgs = {
    input: SummaryPipelineInput
    summaryType: GitSummaryType
    baseSha: string | null
    headSha: string
    sourceRef?: string | null
    targetRef?: string | null
    tagName?: string | null
    explicitCommits?: Array<{ sha: string; subject: string }>
    plannerNotes?: string[]
}

async function createRangeSummary(args: CreateSummaryArgs): Promise<{ summary: GitSummaryRecord; created: boolean }> {
    const { input } = args
    const { range } = upsertSummaryRange(input.dbPath, {
        repositoryId: input.repositoryId,
        summaryType: args.summaryType,
        baseSha: args.baseSha,
        headSha: args.headSha,
        sourceRef: args.sourceRef,
        targetRef: args.targetRef,
        tagName: args.tagName
    })
    const context = await buildRangeContext(
        input.repositoryRoot, args.baseSha, args.headSha, input.gitConfig, args.explicitCommits
    )
    const content = generateDeterministicSummary({
        summaryType: args.summaryType,
        context,
        sourceRef: args.sourceRef,
        targetRef: args.targetRef,
        tagName: args.tagName
    })
    return insertSummaryIfMissing(input.dbPath, {
        repositoryId: input.repositoryId,
        rangeId: range.id,
        summaryType: args.summaryType,
        content,
        generator: 'deterministic',
        generatorVersion: DETERMINISTIC_GENERATOR_VERSION,
        promptVersion: DEFAULT_PROMPT_VERSION,
        metadata: {
            context_warnings: context.warnings,
            planner_notes: args.plannerNotes ?? [],
            diffstat: context.diffstat
        }
    })
}

/** Compare release versions numerically; returns the newest tag older than `current`, if any. */
function previousReleaseTag(tags: Array<{ name: string; commitSha: string }>, current: string): { name: string; commitSha: string } | null {
    const parse = (name: string): number[] | null => {
        const match = /^(?:v|release-)?(\d+)\.(\d+)\.(\d+)$/.exec(name)
        return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
    }
    const currentVersion = parse(current)
    if (!currentVersion) return null
    const older = tags
        .map((t) => ({ tag: t, version: parse(t.name) }))
        .filter((t): t is { tag: { name: string; commitSha: string }; version: number[] } =>
            t.version !== null && t.tag.name !== current)
        .filter((t) =>
            t.version[0] < currentVersion[0] ||
            (t.version[0] === currentVersion[0] && t.version[1] < currentVersion[1]) ||
            (t.version[0] === currentVersion[0] && t.version[1] === currentVersion[1] && t.version[2] < currentVersion[2]))
        .sort((a, b) =>
            (a.version[0] - b.version[0]) || (a.version[1] - b.version[1]) || (a.version[2] - b.version[2]))
    return older.length > 0 ? older[older.length - 1].tag : null
}

export async function runSummaryPipeline(input: SummaryPipelineInput): Promise<SummaryPipelineResult> {
    const warnings: string[] = []
    const summaries: GitSummaryRecord[] = []
    let created = 0

    const events = listPendingEvents(input.dbPath, input.repositoryId,
        ['commit_discovered', 'merge_commit_discovered', 'tag_discovered'])

    // ── commit ranges (§15) ──────────────────────────────────────────────────
    const commitEvents = events.filter((e) => e.event_type === 'commit_discovered' && e.after_sha)
    if (commitEvents.length > 0) {
        const shas = [...new Set(commitEvents.map((e) => e.after_sha!))]
        const facts = loadCommitFacts(input.dbPath, input.repositoryId, shas).filter((f) => !f.isMerge)
        const stats = await getCommitStats(input.repositoryRoot, facts.map((f) => f.sha))
        const plannerCommits: PlannerCommit[] = facts.map((f) => ({
            sha: f.sha,
            parents: f.parents,
            committedAt: f.committedAt,
            message: f.message,
            files: stats.get(f.sha) ?? []
        }))
        const groups = planCommitRanges(plannerCommits, input.gitConfig)
        const keptShas = new Set<string>()
        for (const group of groups) {
            const verdict = input.force ? { keep: true, reasons: ['forced'] } : classifyTriviality(group, input.gitConfig)
            if (!verdict.keep) continue
            for (const c of group.commits) keptShas.add(c.sha)
            const result = await createRangeSummary({
                input,
                summaryType: 'commit_range',
                baseSha: group.baseSha,
                headSha: group.headSha,
                explicitCommits: group.commits.map((c) => ({ sha: c.sha, subject: c.message.split('\n')[0].slice(0, 200) })),
                plannerNotes: verdict.reasons
            })
            if (result.created) {
                created += 1
                summaries.push(result.summary)
            }
        }
        const processedIds = commitEvents.filter((e) => keptShas.has(e.after_sha!)).map((e) => e.id)
        const ignoredIds = commitEvents.filter((e) => !keptShas.has(e.after_sha!)).map((e) => e.id)
        markEvents(input.dbPath, processedIds, 'processed')
        markEvents(input.dbPath, ignoredIds, 'ignored')
    }

    // ── merge summaries (§12.1) ──────────────────────────────────────────────
    for (const event of events.filter((e) => e.event_type === 'merge_commit_discovered' && e.after_sha)) {
        try {
            const mergeSha = event.after_sha!
            const [fact] = loadCommitFacts(input.dbPath, input.repositoryId, [mergeSha])
            const parents = fact?.parents ?? []
            const base = parents.length >= 2 ? await mergeBase(input.repositoryRoot, parents[0], parents[1]) : null
            const branchMatch = fact ? /Merge branch '([^']+)'/.exec(fact.message) : null
            const result = await createRangeSummary({
                input,
                summaryType: 'merge',
                baseSha: base ?? parents[0] ?? null,
                headSha: mergeSha,
                sourceRef: branchMatch?.[1] ?? null,
                targetRef: input.defaultBranch,
                plannerNotes: [`merge parents: ${parents.join(', ')}`]
            })
            if (result.created) {
                created += 1
                summaries.push(result.summary)
            }
            markEvents(input.dbPath, [event.id], 'processed')
        } catch (error) {
            markEvents(input.dbPath, [event.id], 'failed', error instanceof Error ? error.message : String(error))
            warnings.push(`merge summary failed for ${event.after_sha}: ${error instanceof Error ? error.message : String(error)}`)
        }
    }

    // ── release summaries (§14) ──────────────────────────────────────────────
    for (const event of events.filter((e) => e.event_type === 'tag_discovered')) {
        try {
            const tagName = (event.target_ref ?? '').replace(/^refs\/tags\//, '')
            if (!RELEASE_TAG_PATTERN.test(tagName)) {
                markEvents(input.dbPath, [event.id], 'ignored')
                continue
            }
            const tags = listCurrentTags(input.dbPath, input.repositoryId)
            const previous = previousReleaseTag(tags, tagName)
            const result = await createRangeSummary({
                input,
                summaryType: 'release',
                baseSha: previous?.commitSha ?? null, // null → root..tag (§14)
                headSha: event.after_sha!,
                tagName,
                plannerNotes: previous ? [`previous release: ${previous.name}`] : ['first release (from root)']
            })
            if (result.created) {
                created += 1
                summaries.push(result.summary)
            }
            markEvents(input.dbPath, [event.id], 'processed')
        } catch (error) {
            markEvents(input.dbPath, [event.id], 'failed', error instanceof Error ? error.message : String(error))
            warnings.push(`release summary failed for ${event.target_ref}: ${error instanceof Error ? error.message : String(error)}`)
        }
    }

    return { summariesCreated: created, summaries, warnings }
}

// ─── explicit targets (repo summarize / sync --from/--to, §13/§19.5) ─────────

export async function summarizeBranch(input: SummaryPipelineInput, branch: string): Promise<{ summary: GitSummaryRecord; created: boolean }> {
    const head = (await runGit(input.repositoryRoot, ['rev-parse', `refs/heads/${branch}`])).stdout.trim()
    const defaultBranch = input.defaultBranch ?? 'main'
    const base = branch === defaultBranch ? null : await mergeBase(input.repositoryRoot, defaultBranch, head)
    return createRangeSummary({
        input,
        summaryType: 'branch',
        baseSha: base,
        headSha: head,
        sourceRef: branch,
        targetRef: defaultBranch,
        plannerNotes: [`range: merge-base(${defaultBranch}, ${branch})..${branch}`]
    })
}

export async function summarizeExplicitRange(
    input: SummaryPipelineInput,
    baseSha: string,
    headSha: string,
    summaryType: GitSummaryType = 'commit_range'
): Promise<{ summary: GitSummaryRecord; created: boolean }> {
    const base = (await runGit(input.repositoryRoot, ['rev-parse', `${baseSha}^{commit}`])).stdout.trim()
    const head = (await runGit(input.repositoryRoot, ['rev-parse', `${headSha}^{commit}`])).stdout.trim()
    return createRangeSummary({ input, summaryType, baseSha: base, headSha: head, plannerNotes: ['explicit range'] })
}

export async function summarizeMergeCommit(input: SummaryPipelineInput, mergeRef: string): Promise<{ summary: GitSummaryRecord; created: boolean }> {
    const mergeSha = (await runGit(input.repositoryRoot, ['rev-parse', `${mergeRef}^{commit}`])).stdout.trim()
    const parentsOut = await runGit(input.repositoryRoot, ['rev-list', '--parents', '-n', '1', mergeSha])
    const parents = parentsOut.stdout.trim().split(/\s+/).slice(1)
    if (parents.length < 2) throw new Error(`not a merge commit: ${mergeRef}`)
    const base = await mergeBase(input.repositoryRoot, parents[0], parents[1])
    return createRangeSummary({
        input,
        summaryType: 'merge',
        baseSha: base ?? parents[0],
        headSha: mergeSha,
        targetRef: input.defaultBranch,
        plannerNotes: [`merge parents: ${parents.join(', ')}`]
    })
}

export async function summarizeTag(input: SummaryPipelineInput, tagName: string): Promise<{ summary: GitSummaryRecord; created: boolean }> {
    const tagSha = (await runGit(input.repositoryRoot, ['rev-parse', `refs/tags/${tagName}^{commit}`])).stdout.trim()
    const tags = listCurrentTags(input.dbPath, input.repositoryId)
    const previous = previousReleaseTag(tags, tagName)
    return createRangeSummary({
        input,
        summaryType: 'release',
        baseSha: previous?.commitSha ?? null,
        headSha: tagSha,
        tagName,
        plannerNotes: previous ? [`previous release: ${previous.name}`] : ['first release (from root)']
    })
}
