// Deterministic fallback summary generator (spec §7.5/§17, docs/issues/issue-1 Phase 4).
//
// Builds the structured §7.5 skeleton from commit messages + diffstat WITHOUT any model call —
// this is the floor every summary starts from (decision D1). The host agent enriches the same
// row in place via the write-back interface; until then the skeleton is honest about itself:
// low confidence, empty decisions/limitations/risks.

import type { GitSummaryContent } from '../types.js'
import type { SummaryContext } from './summary-context.js'
import { isImportantFile } from './range-planner.js'

export const DETERMINISTIC_GENERATOR_VERSION = 'deterministic/1'
export const DEFAULT_PROMPT_VERSION = 'v1'

export type GenerateSummaryInput = {
    summaryType: 'commit_range' | 'branch' | 'merge' | 'release'
    context: SummaryContext
    sourceRef?: string | null
    targetRef?: string | null
    tagName?: string | null
}

function baseImportance(summaryType: GenerateSummaryInput['summaryType']): number {
    switch (summaryType) {
        case 'release': return 0.7
        case 'merge': return 0.5
        case 'branch': return 0.45
        default: return 0.3
    }
}

export function generateDeterministicSummary(input: GenerateSummaryInput): GitSummaryContent {
    const { context, summaryType } = input
    const domains = [...new Set(context.changed_files.map((f) => {
        const idx = f.path.indexOf('/')
        return idx === -1 ? '(root)' : f.path.slice(0, idx)
    }))].sort()
    const importantTouched = context.changed_files.some((f) => isImportantFile(f.path))

    const subjects = context.commits.map((c) => c.subject).filter(Boolean)
    const label = summaryType === 'release'
        ? `Release ${input.tagName ?? ''}`.trim()
        : summaryType === 'merge'
            ? `Merge${input.targetRef ? ` into ${input.targetRef}` : ''}`
            : summaryType === 'branch'
                ? `Branch ${input.sourceRef ?? ''}`.trim()
                : subjects[subjects.length - 1] ?? 'Commit range'

    const summaryText = [
        `${context.commits.length} commit(s), ${context.diffstat.files} file(s) changed ` +
        `(+${context.diffstat.additions}/-${context.diffstat.deletions})`,
        domains.length > 0 ? `across ${domains.join(', ')}` : '',
        importantTouched ? '— touches schema/auth/deploy-class files' : ''
    ].filter(Boolean).join(' ')

    // log-scaled size signal, boosted for important files, clamped to leave headroom for agents.
    let importance = baseImportance(summaryType) +
        Math.min(0.2, Math.log10(1 + context.diffstat.additions + context.diffstat.deletions) * 0.05)
    if (importantTouched) importance += 0.15
    importance = Math.min(0.85, Math.max(0.05, importance))

    return {
        title: label.slice(0, 120),
        summary: summaryText.slice(0, 500),
        key_changes: subjects.slice(0, 10),
        decisions: [],
        known_limitations: [],
        risks: [],
        affected_domains: domains,
        importance: Number(importance.toFixed(2)),
        confidence: 0.4 // heuristic skeleton — agent enrichment raises this
    }
}
