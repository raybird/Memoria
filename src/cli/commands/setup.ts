import path from 'node:path'
import type { Command } from 'commander'
import {
    MemoriaCore,
    resolveMemoriaPaths,
    detectLocalMemoriaRoot,
    runVerify,
    existsSync,
    closeAllConnections,
    resolveDefaultGlobalDataRoot,
    loadInstallSettingsSync,
    saveInstallSettings,
    resolveLocalVectorDbPath,
    getExplicitVectorEnv
} from '../../core/index.js'
import type { InstallHostAgent } from '../../core/index.js'
import { runPreflight } from '../preflight.js'
import {
    deployAgentSkill,
    deployHostAgentSkill,
    HOST_AGENTS,
    installVectorDeps,
    parseAgentFlag
} from '../runtime.js'
import type { RuntimeLayout } from '../runtime.js'
import { applyInstructionWiring } from '../agent-integration.js'
import {
    promptSetupChoices,
    buildSetupPlan,
    assertSetupPlanSafe,
    generateSetupBrief,
    runFullVectorIngest,
    verifyVectorReadiness
} from '../setup-plan.js'
import type { SetupChoices, ComponentReadiness } from '../setup-plan.js'

function collectRepeatedOption(val: string, prev: string[] = []): string[] {
    return [...prev, val]
}

export function registerSetupCommand(program: Command, runtimeLayout: RuntimeLayout): void {
    program
        .command('setup')
        .description('Prepare the runtime, initialize data, verify health, deploy skills, and wire agent instructions')
        .option('--serve', 'Start HTTP server after setup')
        .option('--port <port>', 'Port for serve (default: 3917)')
        .option('--memoria-home <path>', 'Data root for .memory/ knowledge/ configs (default: ./memoria or global root)')
        .option('--scope <scope>', 'Installation scope: global or project')
        .option('--global', 'Shortcut for --scope global')
        .option('--project', 'Shortcut for --scope project')
        .option('--interactive', 'Force interactive setup wizard')
        .option('--json', 'Emit JSON step logs for machine consumption')
        .option('--agent <name>', `Deploy the skill into host agent skill directories (${HOST_AGENTS.join(', ')}, both, none)`, collectRepeatedOption)
        .option('--vector', 'Enable local semantic recall (install deps, warm model, and index corpus)')
        .option('--no-vector', 'Keep basic lexical/tree recall mode without downloading vector model')
        .option('-y, --yes', 'Skip interactive confirmation when applying onboarding changes')
        .action(async (opts: {
            serve?: boolean
            port?: string
            json?: boolean
            memoriaHome?: string
            ['memoria-home']?: string
            scope?: string
            global?: boolean
            project?: boolean
            interactive?: boolean
            agent?: string | string[]
            vector?: boolean
            yes?: boolean
        }) => {
            const jsonOut = Boolean(opts.json)
            const rawArgv = process.argv.slice(2)
            const hasExplicitVectorTrue = rawArgv.includes('--vector')
            const hasExplicitNoVector = rawArgv.includes('--no-vector')

            if (opts.global && opts.project) {
                console.error('✗ Cannot combine --global and --project')
                process.exitCode = 1
                return
            }
            if (hasExplicitVectorTrue && hasExplicitNoVector) {
                console.error('✗ Cannot combine --vector and --no-vector')
                process.exitCode = 1
                return
            }
            if (opts.interactive && jsonOut) {
                console.error('✗ Cannot combine --interactive and --json')
                process.exitCode = 1
                return
            }

            const explicitScope = opts.scope ?? (opts.global ? 'global' : opts.project ? 'project' : undefined)
            if (explicitScope !== undefined && explicitScope !== 'global' && explicitScope !== 'project') {
                console.error(`✗ Invalid --scope '${explicitScope}'; expected 'global' or 'project'`)
                process.exitCode = 1
                return
            }

            const requestedHome = opts.memoriaHome ?? opts['memoria-home'] ?? process.env.MEMORIA_HOME
            const existingSettings = loadInstallSettingsSync()
            const defaultGlobalRoot = existingSettings?.defaultDataRoot ?? resolveDefaultGlobalDataRoot()

            const hasAnyAutomationFlag = Boolean(
                jsonOut ||
                opts.serve ||
                opts.port ||
                requestedHome ||
                explicitScope !== undefined ||
                opts.agent !== undefined ||
                hasExplicitVectorTrue ||
                hasExplicitNoVector ||
                opts.yes
            )
            const shouldRunInteractive = Boolean(
                opts.interactive || (!hasAnyAutomationFlag && process.stdin.isTTY && process.stdout.isTTY)
            )

            // Onboarding mode is active when running interactively or when the caller explicitly passes
            // `--scope` / `--global` / `--project` / `--yes` / `--no-vector`. Legacy automation calls
            // (`setup --json`, `setup --memoria-home X`, `setup --agent claude-code`, `setup --vector`)
            // keep their exact pre-issue-28 behavior unless onboarding flags are combined.
            const isFullOnboarding = Boolean(
                shouldRunInteractive ||
                explicitScope !== undefined ||
                opts.yes ||
                hasExplicitNoVector
            )

            // When onboarding a project, honor an already-present local Memoria root (`cwd/.memory`,
            // `cwd/knowledge`, or `cwd/memoria`) so `setup --scope project` targets the exact same root
            // that `resolveMemoriaPaths()` / `memoria doctor` / `memoria recall` resolve in `cwd`.
            // Legacy non-onboarding `setup` keeps `./memoria` for backward compatibility (`test-bootstrap.sh`).
            const defaultProjectRoot = isFullOnboarding
                ? (detectLocalMemoriaRoot(process.cwd()) ?? path.join(process.cwd(), 'memoria'))
                : path.join(process.cwd(), 'memoria')

            let stepStart = Date.now()
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
                    'agent-skill': 'Host agent skill deployed',
                    brief: 'Brief compiled',
                    instructions: 'Agent instructions wired',
                    'vector-deps': 'Semantic recall dependencies',
                    'vector-ingest': 'Vector index synced',
                    readiness: 'Readiness verified',
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

            let choices: SetupChoices
            if (shouldRunInteractive) {
                const prompted = await promptSetupChoices({
                    defaultGlobalRoot,
                    defaultProjectRoot,
                    requestedHome,
                    existingHosts: existingSettings?.hosts,
                    existingVector: existingSettings?.vector?.enabled
                })
                if (!prompted.confirmed) {
                    console.log('Setup cancelled; no files or settings were changed.')
                    return
                }
                choices = prompted.choices
            } else {
                let parsedHosts: InstallHostAgent[] = []
                if (opts.agent !== undefined) {
                    try {
                        parsedHosts = parseAgentFlag(opts.agent)
                    } catch (error) {
                        stepLog('agent-skill', false, { error: error instanceof Error ? error.message : String(error) })
                        process.exitCode = 1
                        return
                    }
                }
                const scope: 'global' | 'project' = explicitScope ?? 'project'
                const dataRoot = path.resolve(
                    requestedHome ?? (scope === 'global' ? defaultGlobalRoot : defaultProjectRoot)
                )
                const vector = hasExplicitVectorTrue ? true : false
                const rootWasInVectorRoots = Boolean(existingSettings?.vector?.roots?.includes(dataRoot))
                choices = {
                    scope,
                    dataRoot,
                    hosts: parsedHosts,
                    vector,
                    wireInstructions: isFullOnboarding && parsedHosts.length > 0,
                    saveSettings: isFullOnboarding && (scope === 'global' || vector || rootWasInVectorRoots)
                }
            }

            const plan = await buildSetupPlan(choices, runtimeLayout)
            const setupPaths = plan.paths
            const setupCore = new MemoriaCore(setupPaths)

            // Pre-check all planned targets BEFORE writing anything (SCN-009, SCN-012, issue-22).
            try {
                await assertSetupPlanSafe(plan)
            } catch (error) {
                const msg = error instanceof Error ? error.message : String(error)
                const failedHost = plan.hostSkillTargets.find((h) => msg.includes(h.dir))
                const stepName = msg.includes('MEMORIA_DB_PATH')
                    ? 'vector-deps'
                    : failedHost
                    ? 'agent-skill'
                    : 'instructions'
                stepLog(stepName, false, {
                    error: msg,
                    ...(failedHost ? { path: failedHost.dir } : {})
                })
                process.exitCode = 1
                return
            }

            const coreState: ComponentReadiness = { status: 'failed', detail: 'not started' }
            const agentState: ComponentReadiness =
                choices.hosts.length === 0
                    ? { status: 'skipped', detail: 'no host agent selected' }
                    : { status: 'failed', detail: 'not started' }
            const vectorState: ComponentReadiness =
                !choices.vector
                    ? { status: 'skipped', detail: 'basic lexical/tree mode (vector not requested)' }
                    : { status: 'failed', detail: 'not started' }

            const reportFailureSummary = (failedStep: string, reason: string): void => {
                if (jsonOut) {
                    stepLog('readiness', false, {
                        failedStep,
                        error: reason,
                        core: coreState,
                        agent: agentState,
                        vector: vectorState
                    })
                } else {
                    console.log('\nSetup incomplete:')
                    console.log(`  core: ${coreState.status} (${coreState.detail})`)
                    console.log(`  agent: ${agentState.status} (${agentState.detail})`)
                    console.log(`  vector: ${vectorState.status} (${vectorState.detail})`)
                    console.log(`  retry: memoria setup --scope ${choices.scope} --memoria-home ${JSON.stringify(setupPaths.memoriaHome)}${choices.vector ? ' --vector' : ''} --yes`)
                }
            }

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
                const msg = error instanceof Error ? error.message : String(error)
                coreState.detail = msg
                stepLog('init', false, { error: msg })
                process.exitCode = 1
                return
            }

            // Step 4: verify
            stepStart = Date.now()
            const { ok: verifyOk, checks: verifyChecks } = await runVerify(setupPaths)
            stepLog('verify', verifyOk, verifyOk ? { path: setupPaths.dbPath } : { checks: verifyChecks.filter((c) => c.status === 'fail') })
            if (!verifyOk) {
                coreState.detail = 'database verification failed'
                process.exitCode = 1
                return
            }
            coreState.status = 'ready'
            coreState.detail = setupPaths.memoriaHome

            // Step 5: deploy bundled agent skill into <memoriaHome>/.agents/skills/memoria
            stepStart = Date.now()
            const deployedSkillPath = await deployAgentSkill(runtimeLayout, setupPaths.memoriaHome)
            if (deployedSkillPath) {
                stepLog('skill', true, { path: deployedSkillPath })
            } else {
                stepLog('skill', false, { skipped: true, reason: 'bundled skill source not found (incomplete package?)' })
            }

            // Step 5b (--agent): deploy into each selected host agent's skill discovery directory
            if (plan.hostSkillTargets.length > 0) {
                for (const target of plan.hostSkillTargets) {
                    stepStart = Date.now()
                    try {
                        const deployed = await deployHostAgentSkill(runtimeLayout, setupPaths.memoriaHome, target.agent, target.dir)
                        if (!deployed) throw new Error('bundled skill source not found (incomplete package?)')
                        stepLog('agent-skill', true, { agent: target.agent, ...deployed })
                        if (deployed.backup && !jsonOut) console.log(`  previous copy backed up to ${deployed.backup}`)
                    } catch (error) {
                        const msg = error instanceof Error ? error.message : String(error)
                        agentState.status = 'failed'
                        agentState.detail = msg
                        stepLog('agent-skill', false, { error: msg, path: target.dir })
                        if (isFullOnboarding) reportFailureSummary('agent-skill', msg)
                        process.exitCode = 1
                        return
                    }
                }
            }

            // Step 5c (onboarding brief + instruction wiring when onboarding mode is active)
            if (isFullOnboarding) {
                stepStart = Date.now()
                try {
                    const briefOut = await generateSetupBrief(setupPaths, setupCore)
                    if (!jsonOut) {
                        stepLog('brief', true, { path: briefOut })
                    }
                    if (plan.instructionPlan.targets.length > 0) {
                        stepStart = Date.now()
                        const wired = await applyInstructionWiring(plan.instructionPlan, setupPaths.memoriaHome)
                        if (!jsonOut) {
                            stepLog('instructions', true, {
                                path: wired.updated.length > 0 ? wired.updated.join(', ') : 'already up to date (reused)',
                                backups: wired.backups
                            })
                            for (const b of wired.backups) {
                                console.log(`  instruction backup saved to ${b}`)
                            }
                        }
                    }
                    if (plan.hostSkillTargets.length > 0) {
                        agentState.status = 'ready'
                        agentState.detail = plan.hostSkillTargets.map((h) => `${h.agent}:${h.dir}`).join(', ')
                    }
                } catch (error) {
                    const msg = error instanceof Error ? error.message : String(error)
                    agentState.status = 'failed'
                    agentState.detail = msg
                    stepLog('instructions', false, { error: msg })
                    reportFailureSummary('instructions', msg)
                    process.exitCode = 1
                    return
                }
            } else if (plan.hostSkillTargets.length > 0) {
                agentState.status = 'ready'
                agentState.detail = plan.hostSkillTargets.map((h) => `${h.agent}:${h.dir}`).join(', ')
            }

            const persistOnboardingSettings = async (vectorReady: boolean): Promise<void> => {
                const prev = loadInstallSettingsSync()
                const mergedHosts = Array.from(new Set([...(prev?.hosts ?? []), ...choices.hosts]))
                const explicitVec = getExplicitVectorEnv(process.env)
                const providerRaw = (explicitVec.embedProvider ?? prev?.vector?.provider ?? 'local').trim()
                const provider: 'local' | 'stub' = providerRaw === 'stub' ? 'stub' : 'local'
                const prevRoots = prev?.vector?.roots ?? []

                const nextRoots = vectorReady
                    ? Array.from(new Set([...prevRoots, setupPaths.memoriaHome]))
                    : prevRoots.filter((r) => path.resolve(r) !== setupPaths.memoriaHome)
                const vectorEnabled = nextRoots.length > 0

                await saveInstallSettings({
                    version: 1,
                    defaultDataRoot: choices.scope === 'global' ? setupPaths.memoriaHome : prev?.defaultDataRoot,
                    ...(mergedHosts.length > 0 ? { hosts: mergedHosts } : {}),
                    vector: {
                        enabled: vectorEnabled,
                        provider,
                        ...(nextRoots.length > 0 ? { roots: nextRoots } : {})
                    },
                    updatedAt: new Date().toISOString()
                })
            }

            // Persist core/host settings before vector step so partial retry can reuse core & host choices,
            // while this root stays out of `vector.roots` until vector verification actually passes (SCN-010).
            if (choices.saveSettings) {
                await persistOnboardingSettings(false)
            }

            // Step 5d (--vector): install deps + warm model, and when full onboarding is active (or LIBSQL_URL / global config),
            // also run full corpus ingest & readiness verification.
            if (choices.vector) {
                stepStart = Date.now()
                try {
                    const installed = await installVectorDeps(runtimeLayout)
                    stepLog('vector-deps', true, { ...installed })
                    if (!jsonOut && installed.shadowedBy) {
                        console.log(`  note: ${installed.shadowedBy} beside the helper takes precedence; this install is used once it is gone`)
                    }

                    if (isFullOnboarding) {
                        const explicitVec = getExplicitVectorEnv(process.env)
                        const prevLibsql = process.env.LIBSQL_URL
                        const effectiveVecUrl = explicitVec.libsqlUrl || `file:${resolveLocalVectorDbPath(setupPaths.memoriaHome)}`
                        process.env.LIBSQL_URL = effectiveVecUrl
                        try {
                            stepStart = Date.now()
                            const coverage = await runFullVectorIngest(setupPaths, runtimeLayout, process.env)
                            if (!jsonOut) {
                                stepLog('vector-ingest', true, {
                                    path: `${ effectiveVecUrl } (embedded=${coverage.embedded}/${coverage.expected}, missing=${coverage.missing})`,
                                    ...coverage
                                })
                            }

                            stepStart = Date.now()
                            const verified = await verifyVectorReadiness(setupPaths, runtimeLayout, process.env)
                            vectorState.status = 'ready'
                            vectorState.detail = verified.corpusVerified
                                ? `route=${verified.routeMode}, coverage=${verified.embedded}/${verified.expected}`
                                : `empty corpus (0/0); isolated vector probe verified (${verified.routeMode})`
                            vectorState.corpusVerified = verified.corpusVerified
                            vectorState.isolatedProbeVerified = verified.isolatedProbeVerified
                        } finally {
                            if (!explicitVec.libsqlUrl && !choices.saveSettings) {
                                if (prevLibsql === undefined) delete process.env.LIBSQL_URL
                                else process.env.LIBSQL_URL = prevLibsql
                            }
                        }
                    } else {
                        vectorState.status = 'ready'
                        vectorState.detail = `deps installed (${installed.provider})`
                    }
                } catch (error) {
                    const msg = error instanceof Error ? error.message : String(error)
                    vectorState.status = 'failed'
                    vectorState.detail = msg
                    stepLog('vector-deps', false, { error: msg })
                    if (isFullOnboarding) reportFailureSummary('vector', msg)
                    process.exitCode = 1
                    return
                }
            }

            // Persist final install settings (including vector.enabled=true when vector succeeded)
            if (choices.saveSettings) {
                await persistOnboardingSettings(choices.vector)
            }

            if (isFullOnboarding) {
                stepStart = Date.now()
                stepLog('readiness', true, {
                    scope: choices.scope,
                    dataRoot: setupPaths.memoriaHome,
                    core: coreState,
                    agent: agentState,
                    vector: vectorState
                })
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
                if (isFullOnboarding) {
                    console.log(`  core:   ${coreState.status} (${coreState.detail})`)
                    console.log(`  agent:  ${agentState.status} (${agentState.detail})`)
                    console.log(`  vector: ${vectorState.status} (${vectorState.detail})`)
                }
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
