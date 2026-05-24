import type { Command } from 'commander'
import type { MemoriaCore } from '../../core/index.js'

export function registerWikiCommand(program: Command, core: MemoriaCore): void {
    const wikiCommand = program
        .command('wiki')
        .description('Build and inspect compiled wiki artifacts')

    wikiCommand
        .command('build')
        .description('Build compiled wiki special pages from current memory state')
        .option('--json', 'Machine-readable JSON output')
        .action(async (options: { json?: boolean }) => {
            const result = await core.buildWiki()
            if (!result.ok) throw new Error(result.error)
            if (options.json) {
                console.log(JSON.stringify(result))
            } else {
                console.log('🧱 Wiki build complete')
                console.log(`- pages synced: ${result.data?.pagesSynced}`)
                console.log(`- sources: ${result.data?.sourceCount}`)
                console.log(`- wiki pages: ${result.data?.pageCount}`)
                console.log(`- index: ${result.data?.specialPages.index}`)
                console.log(`- log: ${result.data?.specialPages.log}`)
                console.log(`- overview: ${result.data?.specialPages.overview}`)
            }
        })

    wikiCommand
        .command('file-query')
        .description('File a high-value recall query into a synthesis or comparison page')
        .requiredOption('--query <text>', 'Query text to recall against memory')
        .requiredOption('--title <title>', 'Title for the filed page')
        .option('--kind <kind>', 'Page kind: synthesis|comparison', 'synthesis')
        .option('--scope <scope>', 'Scope for recall and filed page')
        .option('--top-k <n>', 'Maximum recall hits to file', '5')
        .option('--time-window <window>', 'Recall time window, e.g. P30D')
        .option('--mode <mode>', 'Recall mode: keyword|tree|hybrid')
        .option('--json', 'Machine-readable JSON output')
        .action(async (options: { query: string; title: string; kind?: 'synthesis' | 'comparison'; scope?: string; topK?: string; timeWindow?: string; mode?: 'keyword' | 'tree' | 'hybrid'; json?: boolean; ['top-k']?: string; ['time-window']?: string }) => {
            const topKRaw = options.topK ?? options['top-k'] ?? '5'
            const topK = Number(topKRaw)
            if (!Number.isFinite(topK) || topK <= 0) throw new Error(`Invalid --top-k '${topKRaw}'. Use a positive number`)
            const result = await core.fileQuery({
                query: options.query,
                title: options.title,
                kind: options.kind ?? 'synthesis',
                scope: options.scope,
                top_k: topK,
                time_window: options.timeWindow ?? options['time-window'],
                mode: options.mode
            })
            if (!result.ok) throw new Error(result.error)
            if (options.json) {
                console.log(JSON.stringify(result))
            } else {
                console.log(`📝 Filed query: ${result.data?.artifact.id}`)
                console.log(`- page: ${result.data?.page.filepath}`)
                console.log(`- hits: ${result.data?.hits.length}`)
            }
        })

    wikiCommand
        .command('lint')
        .description('Run wiki governance lint checks and persist findings')
        .option('--stale-days <n>', 'Flag active pages older than N days', '30')
        .option('--limit <n>', 'Maximum findings to return', '100')
        .option('--json', 'Machine-readable JSON output')
        .action(async (options: { staleDays?: string; limit?: string; json?: boolean; ['stale-days']?: string }) => {
            const staleDaysRaw = options.staleDays ?? options['stale-days'] ?? '30'
            const staleDays = Number(staleDaysRaw)
            const limit = Number(options.limit ?? '100')
            if (!Number.isFinite(staleDays) || staleDays < 0) throw new Error(`Invalid --stale-days '${staleDaysRaw}'. Use a non-negative number`)
            if (!Number.isFinite(limit) || limit <= 0) throw new Error(`Invalid --limit '${options.limit}'. Use a positive number`)
            const result = await core.wikiLint({ stale_days: staleDays, limit })
            if (!result.ok) throw new Error(result.error)
            if (options.json) {
                console.log(JSON.stringify(result))
            } else {
                console.log('🧭 Wiki lint complete')
                console.log(`- run: ${result.data?.run.id}`)
                console.log(`- findings: ${result.data?.findings.length}`)
                for (const finding of result.data?.findings ?? []) {
                    console.log(`- ${finding.finding_type} [${finding.severity}] ${finding.summary}`)
                }
            }
        })
}
