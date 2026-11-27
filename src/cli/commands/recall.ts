import type { Command } from 'commander'
import { parseTopKOption } from '../../core/index.js'
import type { MemoriaCore, RecallFilter } from '../../core/index.js'

const RECALL_MODES = ['keyword', 'tree', 'hybrid', 'vector'] as const
type RecallMode = (typeof RECALL_MODES)[number]

// issue-35: below this relevance a hit shares only a token or two with the query. Such hits are still
// returned (filtering is the caller's call); the listing marks them so a page of them is not read
// as "these are the relevant memories".
const WEAK_RELEVANCE = 0.3

type RecallCommandOptions = {
    project?: string
    scope?: string
    topK?: string
    timeWindow?: string
    mode?: string
    includeSuperseded?: boolean
    json?: boolean
}

export function registerRecallCommand(program: Command, core: MemoriaCore): void {
    program
        .command('recall')
        .description('Search memory and print ranked hits')
        .argument('<query>', 'Query text')
        .option('--project <name>', 'Filter by project name')
        .option('--scope <scope>', 'Filter by memory scope')
        .option('--top-k <n>', 'Maximum hits to return', '5')
        .option('--time-window <duration>', 'ISO duration window, e.g. P7D')
        .option(`--mode <mode>`, `Recall mode: ${RECALL_MODES.join('|')}`)
        .option('--include-superseded', 'Also return memories that were replaced by a newer one')
        .option('--json', 'Machine-readable JSON output')
        .action(async (query: string, options: RecallCommandOptions) => {
            const topK = parseTopKOption(options.topK ?? '5')
            if (options.mode && !RECALL_MODES.includes(options.mode as RecallMode)) {
                throw new Error(`Invalid --mode '${options.mode}'. Use: ${RECALL_MODES.join('|')}`)
            }

            const filter: RecallFilter = {
                query,
                project: options.project,
                scope: options.scope,
                top_k: topK,
                time_window: options.timeWindow,
                mode: options.mode as RecallMode | undefined,
                include_superseded: options.includeSuperseded
            }
            const result = await core.recall(filter)
            if (!result.ok) throw new Error(result.error)

            if (options.json) {
                console.log(JSON.stringify(result))
                return
            }

            const hits = result.data ?? []
            const route = result.meta.route_mode ? `, mode=${result.meta.route_mode}` : ''
            console.log(`🔎 Recall: ${hits.length} hits (${result.meta.latency_ms}ms${route})`)
            // issue-35: say why a recall found little, next to the count it explains. route_mode
            // stays `keyword` when the semantic route ran and matched nothing, which read as "vector
            // mode did not run"; and an empty project looked the same as an unrelated query.
            if (result.meta.vector_hits === 0) console.log('- 語意查詢有執行，沒有命中；列出的是字面查詢的結果')
            // Only on an empty result: tree routes filter memory_nodes.project, so a legacy row can
            // still surface under a name that sessions does not hold (issue-35 review N2).
            if (result.meta.project_known === false && hits.length === 0) {
                console.log(`- 這個 project 沒有任何記憶：${options.project}；已登記的名稱見 \`memoria repo list\``)
            }
            for (const hit of hits) {
                // relevance is the decay-free 0–1 match quality (and the basis for meta.confidence);
                // the raw bm25-derived `score` that drives ordering is orders of magnitude smaller
                // and unreadable rounded. Ordering still follows score — only the display differs.
                // A semantic-only hit has no relevance at all (issue-9), and printing its RRF score
                // here would put an unrelated scale (~0.016) in the same column as a 0–1 quality —
                // so it prints as unmeasured instead. Ordering is unaffected either way.
                const quality = hit.relevance === undefined ? ' n/a '
                    : `${hit.relevance.toFixed(3)}${hit.relevance < WEAK_RELEVANCE ? ' 弱命中' : ''}`
                const marks = [
                    hit.retention === 'durable' ? 'durable' : null,
                    hit.superseded_by ? `superseded by ${hit.superseded_by}` : null
                ].filter(Boolean).join(', ')
                console.log(`- [${quality}] ${hit.type} | ${hit.project} | ${hit.timestamp}${marks ? ` | ${marks}` : ''}`)
                console.log(`  ${hit.snippet}`)
                // issue-32: a state memory is a snapshot — say as of when, and how to re-check it.
                // Printed verbatim and never run here; the reader decides whether to run it.
                if (hit.verify) console.log(`  ⟳ 截至 ${hit.timestamp.slice(0, 10)}；據以行動前先跑：${hit.verify}`)
                if (hit.source) {
                    const ref = hit.source.tag ?? hit.source.branch ?? hit.source.head_sha?.slice(0, 8) ?? hit.source.type
                    console.log(`  ↳ git: ${hit.source.repository}@${ref}`)
                }
                console.log(`  id: ${hit.id}`)
            }
            // Printed so the next step can report utility: `memoria feedback <recall_id>`.
            if (result.meta.recall_id) console.log(`- recall_id: ${result.meta.recall_id}`)
        })
}
