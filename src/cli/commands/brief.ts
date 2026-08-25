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
    global?: boolean
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
        .option('--global', 'Ignore the working directory: one all-projects BRIEF.md (pre-issue-17 behaviour)')
        .option('--stdout', 'Print markdown instead of writing a file')
        .option('--json', 'Machine-readable JSON output')
        .action(async (options: BriefCommandOptions) => {
            const days = Number(options.days ?? '30')
            if (!Number.isFinite(days) || days <= 0) throw new Error(`Invalid --days '${options.days}'. Use a positive number`)
            const topK = Number(options.topK ?? '10')
            if (!Number.isFinite(topK) || topK <= 0) throw new Error(`Invalid --top-k '${options.topK}'. Use a positive number`)

            // cwd scoping (docs/issues/issue-17). An explicit --project keeps writing BRIEF.md —
            // only DETECTED scope changes the filename, so existing callers are untouched.
            // `--global` is the one-flag escape hatch back to the pre-issue-17 behaviour, which the
            // repo requires of any breaking default change; it simply skips detection.
            const detectionAttempted = !options.project && !options.global
            const detected = detectionAttempted ? await core.resolveProjectForCwd(process.cwd()) : null
            const scope = options.project ?? detected?.project

            const result = await core.brief({ project: scope, days, topK })
            if (!result.ok || !result.data) throw new Error(result.error ?? 'brief failed')

            const markdown = renderBrief(result.data)
            if (options.stdout) {
                console.log(markdown)
                return
            }

            // One global BRIEF.md cannot hold a cwd-filtered result: `brief` is manual and CLAUDE.md
            // `@`-imports a fixed path, so whoever ran it last would decide what every project sees.
            const fileName = detected ? `BRIEF-${detected.project}.md` : 'BRIEF.md'
            const outPath = options.out ? path.resolve(options.out) : path.join(paths.knowledgeDir, fileName)
            await fs.mkdir(path.dirname(outPath), { recursive: true })
            await fs.writeFile(outPath, markdown, 'utf8')

            if (options.json) {
                console.log(JSON.stringify({ ...result, data: { ...result.data, filePath: outPath } }))
            } else {
                const data = result.data
                console.log(`📝 Brief written: ${outPath}`)
                console.log(`- 範圍: ${data.project ?? '(all projects)'} ｜ 近 ${data.days} 天`)
                if (detected) {
                    console.log(`- 偵測到工作目錄屬於 ${detected.project}（${detected.root}）`)
                } else if (detectionAttempted) {
                    // Only when detection actually ran and found nothing. Asking for --global is a
                    // choice, not a fallback, and reporting it as one would be misleading.
                    console.log('- 未偵測到已註冊 repo，退回全域範圍（未任意挑選 repo）')
                }
                console.log(`- 決策: ${data.decisions.length} ｜ 高效用記憶: ${data.high_utility.length} ｜ repository: ${data.repositories.length}`)
                // Reported every run, not only when scoped: this class is derived from what is
                // registered, so the number moving is the only signal that a project was
                // reclassified out of it (SCN-011 / SCN-012).
                console.log(`- 環境類記憶: ${data.totals.environment_memories} 筆（不屬任何已註冊 repo，每個專案的 brief 都會帶上）`)
                if (detected) {
                    // The project's CLAUDE.md lives in the repo, not under MEMORIA_HOME, so the
                    // relative form used for the global brief does not resolve from there — this
                    // line has to be absolute and copy-pasteable as-is. Printed rather than written
                    // into a doc: the recipe someone follows is the one the command just printed
                    // (docs/HANDOVER.md §8, the v1.25.1 lesson), and a second copy would drift.
                    console.log(`- 接線: 在 ${path.join(detected.root, 'CLAUDE.md')} 加上這一行即可每次 session 自動載入`)
                    console.log(`  @${outPath}`)
                } else {
                    console.log(`- 提示: 在 CLAUDE.md 以 @${path.relative(paths.memoriaHome, outPath)} 引入即可每次 session 自動載入`)
                }
            }
        })
}
