import type { Command } from 'commander'
import { existsSync, resolveMemoriaHomeInfo } from '../../core/index.js'
import type { MemoriaPaths } from '../../core/index.js'

type DoctorCheck = { name: string; ok: boolean; value: string; fix?: string }

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

            // Did we land on a real data root, or silently fall back to the runtime root?
            // A fallback means this folder was never set up — warn instead of pretending it is healthy.
            const homeInfo = resolveMemoriaHomeInfo()
            const homeFix =
                `This folder has no Memoria memory yet (resolved by ${homeInfo.source}). ` +
                `Run "memoria setup --memoria-home <path>" here, or set MEMORIA_HOME to an initialized data root ` +
                `before syncing — otherwise writes land in the runtime root.`
            const homeOk = homeInfo.source !== 'fallback'

            const checks: DoctorCheck[] = [
                { name: 'MEMORIA_HOME', ok: homeOk, value: `${paths.memoriaHome} (${homeInfo.source})`, fix: homeOk ? undefined : homeFix },
                { name: 'memory dir', ok: existsSync(paths.memoryDir), value: paths.memoryDir },
                { name: 'knowledge dir', ok: existsSync(paths.knowledgeDir), value: paths.knowledgeDir },
                { name: 'sessions path', ok: existsSync(paths.sessionsPath), value: paths.sessionsPath },
                { name: 'config path', ok: existsSync(paths.configPath), value: paths.configPath },
                { name: 'sessions.db', ok: existsSync(paths.dbPath), value: paths.dbPath }
            ]

            if (opts.json) {
                console.log(JSON.stringify({ ok: checks.every((c) => c.ok), homeSource: homeInfo.source, paths, checks }))
            } else {
                console.log('Resolved path envs:')
                for (const line of envDetails) console.log(line)
                for (const c of checks) {
                    console.log(`${c.ok ? '✓' : '✗'} ${c.name}: ${c.value}`)
                    if (!c.ok && c.fix) console.log(`  ↳ fix: ${c.fix}`)
                }
            }
        })
}
