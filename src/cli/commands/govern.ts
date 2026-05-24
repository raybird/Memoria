import type { Command } from 'commander'
import type { MemoriaCore } from '../../core/index.js'

export function registerGovernCommand(program: Command, core: MemoriaCore): void {
    const governCommand = program
        .command('govern')
        .description('Review higher-signal governance candidates from memory')

    governCommand
        .command('review')
        .description('Review repeated decisions and skills worth extracting')
        .option('--project <name>', 'Filter candidates by project')
        .option('--scope <name>', 'Filter candidates by scope')
        .option('--limit <n>', 'Maximum number of candidates to return', '20')
        .option('--json', 'Machine-readable JSON output')
        .action(async (options: { project?: string; scope?: string; limit?: string; json?: boolean }) => {
            const limit = Number(options.limit ?? '20')
            if (!Number.isFinite(limit) || limit <= 0) {
                throw new Error(`Invalid --limit '${options.limit}'. Use a positive number`)
            }
            const result = await core.governanceReview({
                project: options.project,
                scope: options.scope,
                limit
            })
            if (!result.ok) throw new Error(result.error)

            if (options.json) {
                console.log(JSON.stringify(result))
            } else {
                console.log('🧭 Governance Review')
                console.log(`- candidates: ${result.data?.total ?? 0}`)
                for (const item of result.data?.items ?? []) {
                    console.log(`- ${item.kind}: ${item.title} | sessions=${item.source_count} | rationale=${item.rationale} | latest=${item.latest_session_id}`)
                }
            }
        })
}
