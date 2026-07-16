import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { RuntimeInvocation } from './runtime.js'

export type ServicePlatform = 'linux' | 'darwin'

export type UserServiceSpec = {
    platform: ServicePlatform
    label: string
    serviceName: string
    definitionPath: string
    memoriaHome: string
    invocation: RuntimeInvocation
    port: number
    content: string
    uid?: number
    logPaths: string[]
}

export type ServiceCommandResult = {
    code: number
    stdout: string
    stderr: string
}

export type ServiceCommandRunner = (command: string, args: string[]) => ServiceCommandResult

export type ServiceStatus = {
    platform: ServicePlatform
    installed: boolean
    loaded: boolean
    running: boolean
    definitionPath: string
    detail?: string
}

type BuildUserServiceSpecInput = {
    memoriaHome: string
    invocation: RuntimeInvocation
    port: number
    platform?: NodeJS.Platform
    homeDir?: string
    xdgConfigHome?: string
    uid?: number
}

const SERVICE_LABEL = 'io.github.raybird.memoria'
const SYSTEMD_SERVICE_NAME = 'memoria.service'

function resolvePlatform(platform: NodeJS.Platform = process.platform): ServicePlatform {
    if (platform === 'linux' || platform === 'darwin') return platform
    throw new Error(`Background services are supported on macOS and Linux, not ${platform}`)
}

function assertSingleLine(value: string, label: string): void {
    if (value.includes('\n') || value.includes('\r') || value.includes('\0')) {
        throw new Error(`${label} must not contain control characters`)
    }
}

function escapeXml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&apos;')
}

function quoteSystemd(value: string): string {
    assertSingleLine(value, 'systemd value')
    return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%')}"`
}

function renderSystemdService(
    memoriaHome: string,
    invocation: RuntimeInvocation,
    port: number
): string {
    const command = [invocation.command, ...invocation.args, 'serve', '--port', String(port), '--json']
        .map(quoteSystemd)
        .join(' ')

    return `[Unit]
Description=Memoria personal memory service
After=network.target

[Service]
Type=simple
Environment=${quoteSystemd(`MEMORIA_HOME=${memoriaHome}`)}
Environment=${quoteSystemd(`MEMORIA_PORT=${port}`)}
WorkingDirectory=${quoteSystemd(memoriaHome)}
ExecStart=${command}
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
`
}

function renderLaunchAgent(
    memoriaHome: string,
    invocation: RuntimeInvocation,
    port: number,
    stdoutPath: string,
    stderrPath: string
): string {
    const args = [invocation.command, ...invocation.args, 'serve', '--port', String(port), '--json']
        .map((arg) => `        <string>${escapeXml(arg)}</string>`)
        .join('\n')

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${SERVICE_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${args}
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>MEMORIA_HOME</key>
        <string>${escapeXml(memoriaHome)}</string>
        <key>MEMORIA_PORT</key>
        <string>${port}</string>
    </dict>
    <key>WorkingDirectory</key>
    <string>${escapeXml(memoriaHome)}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>2</integer>
    <key>StandardOutPath</key>
    <string>${escapeXml(stdoutPath)}</string>
    <key>StandardErrorPath</key>
    <string>${escapeXml(stderrPath)}</string>
</dict>
</plist>
`
}

export function buildUserServiceSpec(input: BuildUserServiceSpecInput): UserServiceSpec {
    const platform = resolvePlatform(input.platform)
    const homeDir = path.resolve(input.homeDir ?? os.homedir())
    const memoriaHome = path.resolve(input.memoriaHome)
    const invocation = {
        command: path.resolve(input.invocation.command),
        args: input.invocation.args.map((arg) => path.isAbsolute(arg) ? path.resolve(arg) : arg)
    }

    if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
        throw new Error(`Invalid service port: ${input.port}`)
    }
    assertSingleLine(memoriaHome, 'Memoria home')
    assertSingleLine(invocation.command, 'Runtime command')
    for (const arg of invocation.args) assertSingleLine(arg, 'Runtime argument')

    if (platform === 'linux') {
        const configHome = path.resolve(
            input.xdgConfigHome ?? process.env.XDG_CONFIG_HOME ?? path.join(homeDir, '.config')
        )
        const definitionPath = path.join(configHome, 'systemd', 'user', SYSTEMD_SERVICE_NAME)
        return {
            platform,
            label: SERVICE_LABEL,
            serviceName: SYSTEMD_SERVICE_NAME,
            definitionPath,
            memoriaHome,
            invocation,
            port: input.port,
            content: renderSystemdService(memoriaHome, invocation, input.port),
            logPaths: []
        }
    }

    const uid = input.uid ?? process.getuid?.()
    if (uid === undefined) throw new Error('Unable to determine the macOS user id')
    const logDir = path.join(homeDir, 'Library', 'Logs', 'Memoria')
    const stdoutPath = path.join(logDir, 'server.log')
    const stderrPath = path.join(logDir, 'server.error.log')
    const definitionPath = path.join(homeDir, 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`)

    return {
        platform,
        label: SERVICE_LABEL,
        serviceName: SERVICE_LABEL,
        definitionPath,
        memoriaHome,
        invocation,
        port: input.port,
        content: renderLaunchAgent(memoriaHome, invocation, input.port, stdoutPath, stderrPath),
        uid,
        logPaths: [stdoutPath, stderrPath]
    }
}

export const defaultServiceCommandRunner: ServiceCommandRunner = (command, args) => {
    const result = spawnSync(command, args, { encoding: 'utf8' })
    if (result.error) {
        return {
            code: 127,
            stdout: result.stdout ?? '',
            stderr: result.error.message
        }
    }
    return {
        code: result.status ?? 1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? ''
    }
}

function commandDetail(result: ServiceCommandResult): string {
    return result.stderr.trim() || result.stdout.trim() || `exit code ${result.code}`
}

function runRequired(
    runner: ServiceCommandRunner,
    command: string,
    args: string[]
): ServiceCommandResult {
    const result = runner(command, args)
    if (result.code !== 0) {
        throw new Error(`${command} ${args.join(' ')} failed: ${commandDetail(result)}`)
    }
    return result
}

function launchctlDomain(spec: UserServiceSpec): string {
    return `gui/${spec.uid}`
}

function launchctlTarget(spec: UserServiceSpec): string {
    return `${launchctlDomain(spec)}/${spec.label}`
}

export async function installUserService(
    spec: UserServiceSpec,
    options: { start?: boolean } = {},
    runner: ServiceCommandRunner = defaultServiceCommandRunner
): Promise<void> {
    await fs.mkdir(path.dirname(spec.definitionPath), { recursive: true })
    for (const logPath of spec.logPaths) {
        await fs.mkdir(path.dirname(logPath), { recursive: true })
    }
    await fs.writeFile(spec.definitionPath, spec.content, 'utf8')

    if (spec.platform === 'linux') {
        runRequired(runner, 'systemctl', ['--user', 'daemon-reload'])
        const enableArgs = ['--user', 'enable']
        if (options.start !== false) enableArgs.push('--now')
        enableArgs.push(spec.serviceName)
        runRequired(runner, 'systemctl', enableArgs)
        return
    }

    if (options.start !== false) {
        runner('launchctl', ['bootout', launchctlDomain(spec), spec.definitionPath])
        runRequired(runner, 'launchctl', ['bootstrap', launchctlDomain(spec), spec.definitionPath])
    }
}

export async function startUserService(
    spec: UserServiceSpec,
    runner: ServiceCommandRunner = defaultServiceCommandRunner
): Promise<void> {
    if (!existsSync(spec.definitionPath)) {
        throw new Error(`Service is not installed: ${spec.definitionPath}`)
    }

    if (spec.platform === 'linux') {
        runRequired(runner, 'systemctl', ['--user', 'daemon-reload'])
        runRequired(runner, 'systemctl', ['--user', 'start', spec.serviceName])
        return
    }

    const loaded = runner('launchctl', ['print', launchctlTarget(spec)]).code === 0
    if (loaded) {
        runRequired(runner, 'launchctl', ['kickstart', '-k', launchctlTarget(spec)])
    } else {
        runRequired(runner, 'launchctl', ['bootstrap', launchctlDomain(spec), spec.definitionPath])
    }
}

export async function stopUserService(
    spec: UserServiceSpec,
    runner: ServiceCommandRunner = defaultServiceCommandRunner
): Promise<void> {
    if (spec.platform === 'linux') {
        if (existsSync(spec.definitionPath)) {
            runRequired(runner, 'systemctl', ['--user', 'stop', spec.serviceName])
        }
        return
    }

    if (existsSync(spec.definitionPath)) {
        runner('launchctl', ['bootout', launchctlDomain(spec), spec.definitionPath])
    }
}

export function queryUserServiceStatus(
    spec: UserServiceSpec,
    runner: ServiceCommandRunner = defaultServiceCommandRunner
): ServiceStatus {
    const installed = existsSync(spec.definitionPath)
    if (!installed) {
        return {
            platform: spec.platform,
            installed: false,
            loaded: false,
            running: false,
            definitionPath: spec.definitionPath
        }
    }

    if (spec.platform === 'linux') {
        const loadResult = runner(
            'systemctl',
            ['--user', 'show', '--property', 'LoadState', '--value', spec.serviceName]
        )
        const activeResult = runner('systemctl', ['--user', 'is-active', spec.serviceName])
        return {
            platform: spec.platform,
            installed,
            loaded: loadResult.code === 0 && loadResult.stdout.trim() === 'loaded',
            running: activeResult.code === 0 && activeResult.stdout.trim() === 'active',
            definitionPath: spec.definitionPath,
            detail: commandDetail(activeResult)
        }
    }

    const result = runner('launchctl', ['print', launchctlTarget(spec)])
    return {
        platform: spec.platform,
        installed,
        loaded: result.code === 0,
        running: result.code === 0 && /\bstate\s*=\s*running\b/.test(result.stdout),
        definitionPath: spec.definitionPath,
        detail: commandDetail(result)
    }
}

export async function uninstallUserService(
    spec: UserServiceSpec,
    runner: ServiceCommandRunner = defaultServiceCommandRunner
): Promise<void> {
    if (spec.platform === 'linux') {
        runner('systemctl', ['--user', 'disable', '--now', spec.serviceName])
        await fs.rm(spec.definitionPath, { force: true })
        runRequired(runner, 'systemctl', ['--user', 'daemon-reload'])
        return
    }

    runner('launchctl', ['bootout', launchctlDomain(spec), spec.definitionPath])
    await fs.rm(spec.definitionPath, { force: true })
}
