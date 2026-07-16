import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
    buildUserServiceSpec,
    installUserService,
    queryUserServiceStatus,
    startUserService,
    stopUserService,
    uninstallUserService
} from '../src/cli/service-manager.ts'
import type { ServiceCommandResult, ServiceCommandRunner } from '../src/cli/service-manager.ts'

type CommandCall = { command: string; args: string[] }

function createRunner(calls: CommandCall[]): ServiceCommandRunner {
    return (command, args): ServiceCommandResult => {
        calls.push({ command, args: [...args] })
        if (command === 'systemctl' && args.includes('is-active')) {
            return { code: 0, stdout: 'active\n', stderr: '' }
        }
        if (command === 'systemctl' && args.includes('LoadState')) {
            return { code: 0, stdout: 'loaded\n', stderr: '' }
        }
        if (command === 'launchctl' && args[0] === 'print') {
            return { code: 0, stdout: 'state = running\n', stderr: '' }
        }
        return { code: 0, stdout: '', stderr: '' }
    }
}

function hasCall(calls: CommandCall[], command: string, args: string[]): boolean {
    return calls.some((call) =>
        call.command === command &&
        call.args.length === args.length &&
        call.args.every((arg, index) => arg === args[index])
    )
}

const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'memoria-service-'))

try {
    console.log('[service] linux systemd user lifecycle')
    const linuxCalls: CommandCall[] = []
    const linuxRunner = createRunner(linuxCalls)
    const linuxHome = path.join(tmpDir, 'linux user')
    const linuxData = path.join(tmpDir, 'linux data % root')
    const linuxSpec = buildUserServiceSpec({
        platform: 'linux',
        homeDir: linuxHome,
        xdgConfigHome: path.join(linuxHome, 'xdg config'),
        memoriaHome: linuxData,
        invocation: {
            command: '/opt/Node Runtime/bin/node',
            args: ['/opt/Memoria Runtime/dist/cli.mjs']
        },
        port: 3917
    })

    assert.equal(
        linuxSpec.definitionPath,
        path.join(linuxHome, 'xdg config', 'systemd', 'user', 'memoria.service')
    )
    assert.match(linuxSpec.content, /ExecStart="\/opt\/Node Runtime\/bin\/node" "\/opt\/Memoria Runtime\/dist\/cli\.mjs" "serve"/)
    assert.match(linuxSpec.content, /Environment="MEMORIA_HOME=.*linux data %% root"/)
    assert.match(linuxSpec.content, /WorkingDirectory=".*linux data %% root"/)

    await installUserService(linuxSpec, { start: true }, linuxRunner)
    assert.equal(await fs.readFile(linuxSpec.definitionPath, 'utf8'), linuxSpec.content)
    assert.ok(hasCall(linuxCalls, 'systemctl', ['--user', 'daemon-reload']))
    assert.ok(hasCall(linuxCalls, 'systemctl', ['--user', 'enable', '--now', 'memoria.service']))

    const linuxStatus = queryUserServiceStatus(linuxSpec, linuxRunner)
    assert.equal(linuxStatus.installed, true)
    assert.equal(linuxStatus.running, true)

    await stopUserService(linuxSpec, linuxRunner)
    assert.ok(hasCall(linuxCalls, 'systemctl', ['--user', 'stop', 'memoria.service']))

    await uninstallUserService(linuxSpec, linuxRunner)
    assert.equal((await fs.stat(linuxSpec.definitionPath).catch(() => undefined)), undefined)
    assert.ok(hasCall(linuxCalls, 'systemctl', ['--user', 'disable', '--now', 'memoria.service']))

    console.log('[service] macOS LaunchAgent lifecycle')
    const macCalls: CommandCall[] = []
    const macRunner = createRunner(macCalls)
    const macHome = path.join(tmpDir, 'mac user')
    const macData = path.join(tmpDir, 'mac data & root')
    const macSpec = buildUserServiceSpec({
        platform: 'darwin',
        homeDir: macHome,
        memoriaHome: macData,
        invocation: {
            command: '/opt/homebrew/bin/node',
            args: ['/Users/test/Library/Application Support/Memoria/dist/cli.mjs']
        },
        port: 4917,
        uid: 501
    })

    assert.equal(
        macSpec.definitionPath,
        path.join(macHome, 'Library', 'LaunchAgents', 'io.github.raybird.memoria.plist')
    )
    assert.match(macSpec.content, /<string>\/opt\/homebrew\/bin\/node<\/string>/)
    assert.match(macSpec.content, /Application Support\/Memoria\/dist\/cli\.mjs/)
    assert.match(macSpec.content, /mac data &amp; root/)

    await installUserService(macSpec, { start: true }, macRunner)
    assert.equal(await fs.readFile(macSpec.definitionPath, 'utf8'), macSpec.content)
    if (process.platform === 'darwin') {
        const plistCheck = spawnSync('/usr/bin/plutil', ['-lint', macSpec.definitionPath], { encoding: 'utf8' })
        assert.equal(plistCheck.status, 0, plistCheck.stderr || plistCheck.stdout)
    }
    assert.ok(hasCall(macCalls, 'launchctl', ['bootstrap', 'gui/501', macSpec.definitionPath]))

    const macStatus = queryUserServiceStatus(macSpec, macRunner)
    assert.equal(macStatus.loaded, true)
    assert.equal(macStatus.running, true)

    await startUserService(macSpec, macRunner)
    assert.ok(hasCall(macCalls, 'launchctl', ['kickstart', '-k', 'gui/501/io.github.raybird.memoria']))

    await stopUserService(macSpec, macRunner)
    assert.ok(hasCall(macCalls, 'launchctl', ['bootout', 'gui/501', macSpec.definitionPath]))

    await uninstallUserService(macSpec, macRunner)
    assert.equal((await fs.stat(macSpec.definitionPath).catch(() => undefined)), undefined)

    console.log('[service] validation')
    assert.throws(
        () => buildUserServiceSpec({
            platform: 'win32',
            memoriaHome: tmpDir,
            invocation: { command: process.execPath, args: [] },
            port: 3917
        }),
        /supported on macOS and Linux/
    )
    assert.throws(
        () => buildUserServiceSpec({
            platform: 'linux',
            memoriaHome: tmpDir,
            invocation: { command: process.execPath, args: [] },
            port: 70000
        }),
        /Invalid service port/
    )

    console.log('[service] ok')
} finally {
    await fs.rm(tmpDir, { recursive: true, force: true })
}
