import type { Command } from 'commander'
import { buildMemoryIndex } from '../../core/index.js'
import type { MemoriaPaths, MemoryIndexBuildOptions } from '../../core/index.js'

export function registerIndexCommand(program: Command, paths: MemoriaPaths): void {
    const indexCommand = program
        .command('index')
        .description('Build and inspect lightweight tree memory index')

    indexCommand
        .command('build')
        .description('Build incremental tree index from unindexed sessions')
        .option('--project <name>', 'Scope build to one project')
        .option('--scope <name>', 'Scope build to one memory scope (e.g. global, agent:main)')
        .option('--since <isoDate>', 'Only include sessions at/after this ISO date')
        .option('--session-id <id>', 'Build index for one specific session id')
        .option('--dry-run', 'Show what would be indexed without writing nodes')
        .option('--json', 'Machine-readable JSON output')
        .action(async (options: MemoryIndexBuildOptions & { json?: boolean }) => {
            const result = buildMemoryIndex(paths.dbPath, options)
            if (options.json) {
                console.log(JSON.stringify({ ok: true, ...result }))
            } else {
                console.log(`🌲 Memory index build${options.dryRun ? ' (dry-run)' : ''}`)
                console.log(`- sessions considered: ${result.sessionsConsidered}`)
                console.log(`- sessions indexed: ${result.sessionsIndexed}`)
                console.log(`- nodes upserted: ${result.nodesUpserted}`)
                console.log(`- source links upserted: ${result.linksUpserted}`)
            }
        })
}
