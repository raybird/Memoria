import path from 'node:path'
import type { Command } from 'commander'
import { MemoriaCore, resolveMemoriaPaths, runVerify, existsSync } from '../../core/index.js'
import { runPreflight } from '../preflight.js'
import { deployAgentSkill } from '../runtime.js'
import type { RuntimeLayout } from '../runtime.js'

export function registerSetupCommand(program: Command, runtimeLayout: RuntimeLayout): void {
    program
        .command('setup')
        .description('One-shot setup: preflight → install deps → init → (optional serve)')
        .option('--serve', 'Start HTTP server after setup')
        .option('--port <port>', 'Port for serve (default: 3917)')
        .option('--memoria-home <path>', 'Data root for .memory/ knowledge/ configs (default: ./memoria)')
        .option('--json', 'Emit JSON step logs for machine consumption')
        .action(async (opts: { serve?: boolean; port?: string; json?: boolean; memoriaHome?: string; ['memoria-home']?: string }) => {
            const jsonOut = Boolean(opts.json)
            const requestedHome = opts.memoriaHome ?? opts['memoria-home'] ?? process.env.MEMORIA_HOME
            const setupMemoriaHome = path.resolve(requestedHome ?? path.join(process.cwd(), 'memoria'))
            const setupPaths = resolveMemoriaPaths(setupMemoriaHome)
            const setupCore = new MemoriaCore(setupPaths)

            function stepLog(step: string, ok: boolean, extra: Record<string, unknown> = {}): void {
                const ms = Date.now() - stepStart
                if (jsonOut) {
                    console.log(JSON.stringify({ step, ok, ms, ...extra }))
                } else {
                    const icon = ok ? '✓' : '✗'
                    console.log(`${icon} [${step}] ${JSON.stringify(extra)}`)
                }
            }

            let stepStart = Date.now()

            // Step 1: preflight
            stepStart = Date.now()
            const { ok: preflightOk, checks } = await runPreflight(setupPaths.memoriaHome, runtimeLayout)
            if (!preflightOk) {
                stepLog('preflight', false, { mode: runtimeLayout.mode, checks })
                process.exitCode = 1
                return
            }
            stepLog('preflight', true, { mode: runtimeLayout.mode })

            // Step 2: pnpm install (if node_modules missing)
            const pkgDir = runtimeLayout.runtimeRoot
            if (runtimeLayout.canSelfInstallDeps && !existsSync(path.join(pkgDir, 'node_modules'))) {
                stepStart = Date.now()
                try {
                    const { execSync } = await import('node:child_process')
                    execSync('pnpm install', { cwd: pkgDir, stdio: 'pipe' })
                    stepLog('install', true)
                } catch (error) {
                    stepLog('install', false, { error: error instanceof Error ? error.message : String(error) })
                    process.exitCode = 1
                    return
                }
            } else if (!runtimeLayout.canSelfInstallDeps) {
                stepStart = Date.now()
                stepLog('install', true, { skipped: true, reason: 'installed runtime already packaged' })
            }

            // Step 3: init
            stepStart = Date.now()
            try {
                await setupCore.init()
                stepLog('init', true)
            } catch (error) {
                stepLog('init', false, { error: error instanceof Error ? error.message : String(error) })
                process.exitCode = 1
                return
            }

            // Step 4: verify
            stepStart = Date.now()
            const { ok: verifyOk, checks: verifyChecks } = await runVerify(setupPaths)
            stepLog('verify', verifyOk, verifyOk ? {} : { checks: verifyChecks.filter((c) => c.status === 'fail') })
            if (!verifyOk) {
                process.exitCode = 1
                return
            }

            // Step 5: deploy bundled agent skill
            stepStart = Date.now()
            const deployedSkillPath = await deployAgentSkill(runtimeLayout, setupPaths.memoriaHome)
            if (deployedSkillPath) {
                stepLog('skill', true, { path: deployedSkillPath })
            }

            // Step 6 (optional): serve
            if (opts.serve) {
                stepStart = Date.now()
                const { startServer } = await import('../../server.js')
                const port = opts.port ? Number(opts.port) : undefined
                const { server, port: actualPort } = await startServer(port, setupPaths.memoriaHome)
                stepLog('serve', true, { port: actualPort })

                const shutdown = () => { server.close(); process.exit(0) }
                process.on('SIGINT', shutdown)
                process.on('SIGTERM', shutdown)
            } else if (!jsonOut) {
                console.log('\n✅ Memoria setup complete!')
                console.log(`   Data root: ${setupPaths.memoriaHome}`)
                console.log(`   Run: MEMORIA_HOME="${setupPaths.memoriaHome}" ./cli serve`)
            }
        })
}
