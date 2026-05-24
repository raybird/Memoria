import type { Command } from 'commander'
import { runVerify } from '../../core/index.js'
import type { MemoriaPaths } from '../../core/index.js'

export function registerVerifyCommand(program: Command, paths: MemoriaPaths): void {
    program
        .command('verify')
        .description('Run runtime, schema, and writeability verification checks')
        .option('--json', 'Output machine-readable JSON report')
        .action(async (options: { json?: boolean }) => {
            const { ok, checks } = await runVerify(paths)

            if (options.json) {
                console.log(JSON.stringify({ ok, paths, checks }, null, 2))
            } else {
                console.log('🔎 Memoria Verify')
                console.log(`- ok: ${ok ? 'yes' : 'no'}`)
                console.log(`- db path: ${paths.dbPath}`)
                for (const check of checks) {
                    console.log(`${check.status === 'pass' ? '✓' : '✗'} ${check.id}: ${check.detail}`)
                }
            }

            if (!ok) process.exitCode = 1
        })
}
