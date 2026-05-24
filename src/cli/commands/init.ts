import type { Command } from 'commander'
import type { MemoriaCore, MemoriaPaths } from '../../core/index.js'

export function registerInitCommand(program: Command, paths: MemoriaPaths, core: MemoriaCore): void {
    program
        .command('init')
        .description('Initialize memory database and directories')
        .option('--json', 'Machine-readable JSON output')
        .action(async (opts: { json?: boolean }) => {
            await core.init()
            if (opts.json) {
                console.log(JSON.stringify({ ok: true, step: 'init', paths: { memoriaHome: paths.memoriaHome, db: paths.dbPath } }))
            } else {
                console.log(`✓ 初始化完成: ${paths.memoriaHome}`)
                console.log(`- db path: ${paths.dbPath}`)
                console.log(`- sessions path: ${paths.sessionsPath}`)
                console.log(`- config path: ${paths.configPath}`)
            }
        })
}
