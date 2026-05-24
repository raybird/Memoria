import type { Command } from 'commander'
import { runPrune } from '../../core/index.js'
import type { MemoriaPaths, PruneOptions } from '../../core/index.js'

export function registerPruneCommand(program: Command, paths: MemoriaPaths): void {
    program
        .command('prune')
        .description('Prune old runtime artifacts and optional duplicate skills')
        .option('--exports-days <days>', 'Remove export files older than N days')
        .option('--checkpoints-days <days>', 'Remove checkpoints older than N days')
        .option('--dedupe-skills', 'Delete duplicate skills by normalized skill name')
        .option('--consolidate-days <days>', 'Consolidate old session nodes under same topic older than N days')
        .option('--stale-days <days>', 'Remove memory nodes and sessions never recalled and older than N days')
        .option('--all', 'Apply default pruning targets (30 days + dedupe + consolidate 90d + stale 180d)')
        .option('--dry-run', 'Preview prune actions without deleting')
        .option('--json', 'Machine-readable JSON output')
        .action(async (options: PruneOptions & { json?: boolean }) => {
            const dryRun = Boolean(options.dryRun)
            const result = await runPrune(paths, options)

            if (options.json) {
                console.log(JSON.stringify({ ok: true, dryRun, ...result }))
            } else {
                console.log(`🧹 Memoria Prune${dryRun ? ' (dry-run)' : ''}`)
                if (result.exports) {
                    const r = result.exports
                    console.log(`- exports: matched=${r.matched}, ${dryRun ? 'would_remove' : 'removed'}=${dryRun ? r.matched : r.removed}, bytes=${r.bytes}`)
                }
                if (result.checkpoints) {
                    const r = result.checkpoints
                    console.log(`- checkpoints: matched=${r.matched}, ${dryRun ? 'would_remove' : 'removed'}=${dryRun ? r.matched : r.removed}, bytes=${r.bytes}`)
                }
                if (result.dedupe) {
                    const r = result.dedupe
                    console.log(`- dedupe-skills: groups=${r.duplicateGroups}, ${dryRun ? 'would_remove' : 'removed'}=${r.removed}`)
                }
                if (result.consolidate) {
                    const r = result.consolidate
                    console.log(`- consolidate: groups=${r.groupsFound}, consolidated=${r.sessionsConsolidated}, nodes_removed=${r.nodesRemoved}`)
                }
                if (result.stale) {
                    const r = result.stale
                    console.log(`- stale: nodes=${r.staleNodes}, sessions=${r.staleSessions}, removed_nodes=${r.removedNodes}, removed_sessions=${r.removedSessions}`)
                }
            }
        })
}
