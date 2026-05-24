import path from 'node:path'
import type { Command } from 'commander'
import type { MemoriaCore, ImportSourceInput } from '../../core/index.js'

export function registerSourceCommand(program: Command, core: MemoriaCore): void {
    const sourceCommand = program
        .command('source')
        .description('Import and inspect non-session raw sources')

    sourceCommand
        .command('add')
        .description('Import a markdown or text source and generate a source-summary page')
        .argument('<file>', 'Path to source file')
        .option('--type <type>', 'Override source type: note|article|document')
        .option('--title <title>', 'Override source title')
        .option('--scope <scope>', 'Scope for the imported source')
        .option('--json', 'Machine-readable JSON output')
        .action(async (file: string, options: ImportSourceInput & { json?: boolean }) => {
            const result = await core.addSource({
                filePath: path.resolve(file),
                type: options.type,
                title: options.title,
                scope: options.scope
            })
            if (!result.ok) throw new Error(result.error)
            if (options.json) {
                console.log(JSON.stringify(result))
            } else {
                console.log(`${result.data?.deduped ? '✓ 已重用來源' : '✓ 已導入來源'}: ${result.data?.source.id}`)
                console.log(`- title: ${result.data?.source.title}`)
                console.log(`- type: ${result.data?.source.type}`)
                console.log(`- stored source: ${result.data?.source.origin_path}`)
                console.log(`- summary page: ${result.data?.page.filepath}`)
            }
        })

    sourceCommand
        .command('list')
        .description('List imported raw sources')
        .option('--type <type>', 'Filter by source type')
        .option('--scope <scope>', 'Filter by scope')
        .option('--limit <n>', 'Maximum rows to return', '20')
        .option('--json', 'Machine-readable JSON output')
        .action(async (options: { type?: string; scope?: string; limit?: string; json?: boolean }) => {
            const limit = Number(options.limit ?? '20')
            if (!Number.isFinite(limit) || limit <= 0) throw new Error(`Invalid --limit '${options.limit}'. Use a positive number`)
            const result = await core.listSources({ type: options.type, scope: options.scope, limit })
            if (!result.ok) throw new Error(result.error)
            if (options.json) {
                console.log(JSON.stringify(result))
            } else {
                console.log(`📚 Sources: ${result.data?.length ?? 0}`)
                for (const source of result.data ?? []) {
                    console.log(`- ${source.id}: ${source.title} | type=${source.type} | scope=${source.scope}`)
                }
            }
        })
}
