import fs from 'node:fs/promises'
import path from 'node:path'
import type { Command } from 'commander'
import { renderBrief } from '../../core/index.js'
import type { MemoriaCore, MemoriaPaths } from '../../core/index.js'

type BriefCommandOptions = {
    project?: string
    days?: string
    topK?: string
    out?: string
    stdout?: boolean
    json?: boolean
}

/** Compile the high-value slice of memory into knowledge/BRIEF.md (docs/issues/issue-4 Phase 2).
 *  Q3 kept this manual — no write path triggers it — so the file is a snapshot, not a live view. */
export function registerBriefCommand(program: Command, paths: MemoriaPaths, core: MemoriaCore): void {
    program
        .command('brief')
        .description('Compile recent decisions, high-utility memory and repo state into a markdown brief')
        .option('--project <name>', 'Limit the brief to one project')
        .option('--days <n>', 'Decision window in days', '30')
        .option('--top-k <n>', 'Max decisions and high-utility memories to list', '10')
        .option('--out <path>', 'Output file (default: <knowledge>/BRIEF.md)')
        .option('--stdout', 'Print markdown instead of writing a file')
        .option('--json', 'Machine-readable JSON output')
        .action(async (options: BriefCommandOptions) => {
            const days = Number(options.days ?? '30')
            if (!Number.isFinite(days) || days <= 0) throw new Error(`Invalid --days '${options.days}'. Use a positive number`)
            const topK = Number(options.topK ?? '10')
            if (!Number.isFinite(topK) || topK <= 0) throw new Error(`Invalid --top-k '${options.topK}'. Use a positive number`)

            const result = await core.brief({ project: options.project, days, topK })
            if (!result.ok || !result.data) throw new Error(result.error ?? 'brief failed')

            const markdown = renderBrief(result.data)
            if (options.stdout) {
                console.log(markdown)
                return
            }

            const outPath = options.out ? path.resolve(options.out) : path.join(paths.knowledgeDir, 'BRIEF.md')
            await fs.mkdir(path.dirname(outPath), { recursive: true })
            await fs.writeFile(outPath, markdown, 'utf8')

            if (options.json) {
                console.log(JSON.stringify({ ...result, data: { ...result.data, filePath: outPath } }))
            } else {
                const data = result.data
                console.log(`📝 Brief written: ${outPath}`)
                console.log(`- 範圍: ${data.project ?? '(all projects)'} ｜ 近 ${data.days} 天`)
                console.log(`- 決策: ${data.decisions.length} ｜ 高效用記憶: ${data.high_utility.length} ｜ repository: ${data.repositories.length}`)
                console.log(`- 提示: 在 CLAUDE.md 以 @${path.relative(paths.memoriaHome, outPath)} 引入即可每次 session 自動載入`)
            }
        })
}
