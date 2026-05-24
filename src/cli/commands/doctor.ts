import type { Command } from 'commander'
import { existsSync } from '../../core/index.js'
import type { MemoriaPaths } from '../../core/index.js'

export function registerDoctorCommand(program: Command, paths: MemoriaPaths): void {
    program
        .command('doctor')
        .description('Check local runtime and directory health')
        .option('--json', 'Machine-readable JSON output')
        .action(async (opts: { json?: boolean }) => {
            const envDetails = [
                `- MEMORIA_DB_PATH=${process.env.MEMORIA_DB_PATH ?? '(not set)'}`,
                `- MEMORIA_SESSIONS_PATH=${process.env.MEMORIA_SESSIONS_PATH ?? '(not set)'}`,
                `- MEMORIA_CONFIG_PATH=${process.env.MEMORIA_CONFIG_PATH ?? '(not set)'}`
            ]
            const checks = [
                { name: 'MEMORIA_HOME', ok: true, value: paths.memoriaHome },
                { name: 'memory dir', ok: existsSync(paths.memoryDir), value: paths.memoryDir },
                { name: 'knowledge dir', ok: existsSync(paths.knowledgeDir), value: paths.knowledgeDir },
                { name: 'sessions path', ok: existsSync(paths.sessionsPath), value: paths.sessionsPath },
                { name: 'config path', ok: existsSync(paths.configPath), value: paths.configPath },
                { name: 'sessions.db', ok: existsSync(paths.dbPath), value: paths.dbPath }
            ]

            if (opts.json) {
                console.log(JSON.stringify({ ok: checks.every((c) => c.ok), paths, checks }))
            } else {
                console.log('Resolved path envs:')
                for (const line of envDetails) console.log(line)
                for (const c of checks) {
                    console.log(`${c.ok ? '✓' : '✗'} ${c.name}: ${c.value}`)
                }
            }
        })
}
