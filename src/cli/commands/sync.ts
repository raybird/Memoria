import path from 'node:path'
import type { Command } from 'commander'
import type { MemoriaCore, MemoriaPaths } from '../../core/index.js'
import { readSession, previewSync } from '../shared.js'

export function registerSyncCommand(program: Command, paths: MemoriaPaths, core: MemoriaCore): void {
    program
        .command('sync')
        .description('Import session JSON and sync notes')
        .argument('<sessionFile>', 'Path to session JSON file')
        .option('--dry-run', 'Validate and preview without writing files')
        .option('--json', 'Machine-readable JSON output')
        .action(async (sessionFile: string, options: { dryRun?: boolean; json?: boolean }) => {
            const absSessionPath = path.resolve(sessionFile)
            const sessionData = await readSession(absSessionPath)

            if (options.dryRun) {
                previewSync(paths, absSessionPath, sessionData)
                return
            }

            const result = await core.remember(sessionData)
            if (!result.ok) throw new Error(result.error)

            if (options.json) {
                console.log(JSON.stringify({ ok: true, step: 'sync', sessionId: result.data?.sessionId, meta: result.meta }))
            } else {
                console.log(`✓ 已導入會話: ${result.data?.sessionId}`)
                console.log('✅ 同步完成!')
            }
        })
}
