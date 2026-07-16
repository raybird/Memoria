import path from 'node:path'
import type { Command } from 'commander'
import { MemoriaCore, resolveMemoriaPaths, runVerify, existsSync, closeAllConnections } from '../../core/index.js'
import { runPreflight } from '../preflight.js'
import { deployAgentSkill } from '../runtime.js'
import type { RuntimeLayout } from '../runtime.js'

export function registerSetupCommand(program: Command, runtimeLayout: RuntimeLayout): void {
    program
        .command('setup')
        .description('Prepare the runtime, initialize data, verify health, and deploy the agent skill')
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
                    return
                }

                const labels: Record<string, string> = {
                    preflight: 'Preflight',
                    install: 'Runtime dependencies',
                    init: 'Data initialized',
                    verify: 'Database verified',
                    skill: 'Agent skill deployed',
                    serve: 'Server running'
                }
                const detail =
                    typeof extra.error === 'string' ? extra.error :
                    typeof extra.path === 'string' ? extra.path :
                    typeof extra.home === 'string' ? extra.home :
                    typeof extra.port === 'number' ? `http://127.0.0.1:${extra.port}` :
                    typeof extra.reason === 'string' ? extra.reason :
                    typeof extra.mode === 'string' ? `${extra.mode} mode` :
                    undefined
                const icon = ok ? '✓' : '✗'
                console.log(`${icon} ${labels[step] ?? step}${detail ? `: ${detail}` : ''}`)
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
                stepLog('init', true, { home: setupPaths.memoriaHome })
            } catch (error) {
                stepLog('init', false, { error: error instanceof Error ? error.message : String(error) })
                process.exitCode = 1
                return
            }

            // Step 4: verify
            stepStart = Date.now()
            const { ok: verifyOk, checks: verifyChecks } = await runVerify(setupPaths)
            stepLog('verify', verifyOk, verifyOk ? { path: setupPaths.dbPath } : { checks: verifyChecks.filter((c) => c.status === 'fail') })
            if (!verifyOk) {
                process.exitCode = 1
                return
            }

            // Step 5: deploy bundled agent skill
            stepStart = Date.now()
            const deployedSkillPath = await deployAgentSkill(runtimeLayout, setupPaths.memoriaHome)
            if (deployedSkillPath) {
                stepLog('skill', true, { path: deployedSkillPath })
            } else {
                stepLog('skill', false, { skipped: true, reason: 'bundled skill source not found (incomplete package?)' })
            }

            // Step 6 (optional): serve
            if (opts.serve) {
                stepStart = Date.now()
                const { startServer } = await import('../../server.js')
                const port = opts.port ? Number(opts.port) : undefined
                const { server, port: actualPort } = await startServer(port, setupPaths.memoriaHome)
                stepLog('serve', true, { port: actualPort })

                const shutdown = () => { server.close(); closeAllConnections(); process.exit(0) }
                process.on('SIGINT', shutdown)
                process.on('SIGTERM', shutdown)
            } else if (!jsonOut) {
                const installedBin = deployedSkillPath
                    ? path.join(deployedSkillPath, 'bin', 'memoria')
                    : 'memoria'
                console.log('\nMemoria setup complete.')
                console.log(`Data root: ${setupPaths.memoriaHome}`)
                console.log(
                    `Start server: MEMORIA_HOME=${JSON.stringify(setupPaths.memoriaHome)} ` +
                    `${JSON.stringify(installedBin)} serve`
                )
                console.log(
                    `Install background service: ${JSON.stringify(installedBin)} service install ` +
                    `--memoria-home ${JSON.stringify(setupPaths.memoriaHome)}`
                )
            }
        })
}
