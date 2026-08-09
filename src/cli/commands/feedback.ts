import type { Command } from 'commander'
import type { MemoriaCore, RecallOutcomeInput } from '../../core/index.js'

const SIGNALS = ['explicit', 'reuse'] as const

type FeedbackCommandOptions = {
    signal?: string
    score?: string
    used?: boolean
    hits?: string
    json?: boolean
}

/** UFL utility write-back (docs/issues/issue-4 Q4): the CLI counterpart of
 *  `POST /v1/recall/:id/outcome`. Under skill-style deployment this is the only
 *  path an explicit host signal can reach memory_utility. */
export function registerFeedbackCommand(program: Command, core: MemoriaCore): void {
    program
        .command('feedback')
        .description('Report whether a recall was useful (UFL utility write-back)')
        .argument('<recallId>', 'recall_id returned by `memoria recall`')
        .option(`--signal <signal>`, `Outcome source: ${SIGNALS.join('|')}`, 'explicit')
        .option('--score <n>', 'Observed utility 0–1', '1')
        .option('--used', 'Mark the recall as used')
        .option('--hits <ids>', 'Comma-separated hit ids the utility is attributed to')
        .option('--json', 'Machine-readable JSON output')
        .action(async (recallId: string, options: FeedbackCommandOptions) => {
            const signal = options.signal ?? 'explicit'
            if (!SIGNALS.includes(signal as (typeof SIGNALS)[number])) {
                throw new Error(`Invalid --signal '${options.signal}'. Use: ${SIGNALS.join('|')}`)
            }
            const score = Number(options.score ?? '1')
            if (!Number.isFinite(score) || score < 0 || score > 1) {
                throw new Error(`Invalid --score '${options.score}'. Use a number between 0 and 1`)
            }

            const hitIds = (options.hits ?? '').split(',').map((id) => id.trim()).filter(Boolean)
            const outcome: RecallOutcomeInput = {
                signal,
                utility_score: score,
                used: options.used ?? true,
                hits: hitIds.length > 0 ? hitIds.map((id) => ({ id, utility_score: score })) : undefined
            }

            const result = await core.recordRecallOutcome(recallId, outcome)
            if (!result.ok) throw new Error(result.error)

            if (options.json) {
                console.log(JSON.stringify(result))
            } else if (result.data?.updated) {
                console.log(`✓ 已回報效用: ${recallId}`)
                console.log(`- signal: ${signal} | score: ${score}`)
                if (hitIds.length > 0) console.log(`- hits: ${hitIds.length}`)
            } else {
                // Not-found is a valid no-op (pruned/unknown id) — core returns ok:true, updated:false.
                console.log(`⚠ 找不到 recall_id（可能已被 prune）: ${recallId}`)
            }
        })
}
