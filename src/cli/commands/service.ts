import path from 'node:path'
import type { Command } from 'commander'
import { existsSync, resolveMemoriaPaths } from '../../core/index.js'
import type { MemoriaPaths } from '../../core/index.js'
import { getRuntimeInvocation } from '../runtime.js'
import type { RuntimeLayout } from '../runtime.js'
import {
    buildUserServiceSpec,
    installUserService,
    queryUserServiceStatus,
    startUserService,
    stopUserService,
    uninstallUserService
} from '../service-manager.js'
import type { ServiceStatus, UserServiceSpec } from '../service-manager.js'

type OutputOptions = { json?: boolean }
type InstallOptions = OutputOptions & {
    memoriaHome?: string
    ['memoria-home']?: string
    port?: string
    start?: boolean
}

function parsePort(rawPort: string | undefined): number {
    const port = Number(rawPort ?? process.env.MEMORIA_PORT ?? 3917)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Invalid service port: ${rawPort ?? process.env.MEMORIA_PORT}`)
    }
    return port
}

function buildSpec(
    paths: MemoriaPaths,
    runtimeLayout: RuntimeLayout,
    port = parsePort(undefined)
): UserServiceSpec {
    return buildUserServiceSpec({
        memoriaHome: paths.memoriaHome,
        invocation: getRuntimeInvocation(runtimeLayout),
        port
    })
}

function printStatus(
    action: string,
    status: ServiceStatus,
    options: OutputOptions,
    extra: Record<string, unknown> = {}
): void {
    if (options.json) {
        console.log(JSON.stringify({ ok: true, action, ...status, ...extra }))
        return
    }

    const state = !status.installed ? 'not installed' : status.running ? 'running' : 'stopped'
    if (action !== 'status') console.log(`✓ Memoria service ${action} complete.`)
    console.log(`Service: ${state}`)
    console.log(`Platform: ${status.platform}`)
    console.log(`Definition: ${status.definitionPath}`)
    if (status.detail) console.log(`Detail: ${status.detail}`)
}

export function registerServiceCommand(
    program: Command,
    defaultPaths: MemoriaPaths,
    runtimeLayout: RuntimeLayout
): void {
    const service = program
        .command('service')
        .description('Manage the per-user Memoria background service (systemd or launchd)')

    service
        .command('install')
        .description('Install the user service and start it')
        .option('--memoria-home <path>', 'Initialized Memoria data root')
        .option('--port <port>', 'HTTP port (default: 3917 or MEMORIA_PORT)')
        .option('--no-start', 'Install the service definition without starting it')
        .option('--json', 'Machine-readable JSON output')
        .action(async (opts: InstallOptions) => {
            const requestedHome = opts.memoriaHome ?? opts['memoria-home']
            const paths = requestedHome
                ? resolveMemoriaPaths(path.resolve(requestedHome))
                : defaultPaths
            if (!existsSync(paths.dbPath)) {
                throw new Error(
                    `Memoria is not initialized at ${paths.memoriaHome}. Run memoria setup --memoria-home ${JSON.stringify(paths.memoriaHome)} first.`
                )
            }

            const port = parsePort(opts.port)
            const spec = buildSpec(paths, runtimeLayout, port)
            await installUserService(spec, { start: opts.start })
            const status = queryUserServiceStatus(spec)
            printStatus('install', status, opts, {
                memoriaHome: paths.memoriaHome,
                port,
                started: opts.start !== false
            })
        })

    service
        .command('start')
        .description('Start the installed user service')
        .option('--json', 'Machine-readable JSON output')
        .action(async (opts: OutputOptions) => {
            const spec = buildSpec(defaultPaths, runtimeLayout)
            await startUserService(spec)
            printStatus('start', queryUserServiceStatus(spec), opts)
        })

    service
        .command('stop')
        .description('Stop the installed user service')
        .option('--json', 'Machine-readable JSON output')
        .action(async (opts: OutputOptions) => {
            const spec = buildSpec(defaultPaths, runtimeLayout)
            await stopUserService(spec)
            printStatus('stop', queryUserServiceStatus(spec), opts)
        })

    service
        .command('status')
        .description('Show the installed user service state')
        .option('--json', 'Machine-readable JSON output')
        .action((opts: OutputOptions) => {
            const spec = buildSpec(defaultPaths, runtimeLayout)
            printStatus('status', queryUserServiceStatus(spec), opts)
        })

    service
        .command('uninstall')
        .description('Stop and remove the user service definition')
        .option('--json', 'Machine-readable JSON output')
        .action(async (opts: OutputOptions) => {
            const spec = buildSpec(defaultPaths, runtimeLayout)
            await uninstallUserService(spec)
            printStatus('uninstall', queryUserServiceStatus(spec), opts)
        })
}
