import type { Command } from 'commander'
import { runPreflight } from '../preflight.js'
import type { MemoriaPaths } from '../../core/index.js'
import type { RuntimeLayout } from '../runtime.js'

export function registerPreflightCommand(program: Command, paths: MemoriaPaths, runtimeLayout: RuntimeLayout): void {
    program
        .command('preflight')
        .description('Check prerequisites (Node.js, pnpm, disk space, write permission)')
        .option('--json', 'Machine-readable JSON output')
        .action(async (opts: { json?: boolean }) => {
            const { ok, checks } = await runPreflight(paths.memoriaHome, runtimeLayout)

            if (opts.json) {
                console.log(JSON.stringify({ ok, checks, mode: runtimeLayout.mode }))
            } else {
                console.log(`Runtime mode: ${runtimeLayout.mode}`)
                for (const c of checks) {
                    const icon = c.status === 'pass' ? '✓' : '✗'
                    console.log(`${icon} ${c.id}: ${c.detail}`)
                    if (c.status === 'fail' && c.fix) console.log(`  → Fix: ${c.fix}`)
                }
                if (ok) {
                    console.log('✅ Preflight passed.')
                } else {
                    console.log('❌ Preflight failed. Fix the issues above and retry.')
                }
            }

            if (!ok) process.exitCode = 1
        })
}
