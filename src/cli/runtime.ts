import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from '../core/index.js'

export type RuntimeLayout = {
    mode: 'repo' | 'installed'
    runtimeRoot: string
    canSelfInstallDeps: boolean
}

export type RuntimeInvocation = {
    command: string
    args: string[]
}

function hasRepoMarkers(candidateRoot: string): boolean {
    return existsSync(path.join(candidateRoot, 'package.json')) && existsSync(path.join(candidateRoot, 'src', 'cli.ts'))
}

function findRepoRoot(moduleDir: string): string | undefined {
    return [
        moduleDir,
        path.resolve(moduleDir, '..'),
        path.resolve(moduleDir, '..', '..')
    ].find((candidateRoot) => hasRepoMarkers(candidateRoot))
}

export function getRuntimeLayout(): RuntimeLayout {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url))
    const repoRoot = findRepoRoot(moduleDir)

    if (repoRoot) {
        return {
            mode: 'repo',
            runtimeRoot: repoRoot,
            canSelfInstallDeps: true
        }
    }

    return {
        mode: 'installed',
        runtimeRoot: path.resolve(moduleDir, '..'),
        canSelfInstallDeps: false
    }
}

export function getBundledSkillSourcePath(runtimeLayout: RuntimeLayout): string | undefined {
    const skillSourcePath = path.join(runtimeLayout.runtimeRoot, 'skills', 'memoria-memory-sync')
    return existsSync(path.join(skillSourcePath, 'SKILL.md')) ? skillSourcePath : undefined
}

export function getSkillWrapperTarget(runtimeLayout: RuntimeLayout): string {
    if (runtimeLayout.mode === 'repo') return path.join(runtimeLayout.runtimeRoot, 'cli')

    const installedCandidates = [
        path.join(runtimeLayout.runtimeRoot, 'bin', 'memoria'),
        path.join(runtimeLayout.runtimeRoot, 'dist', 'cli.mjs')
    ]
    const target = installedCandidates.find((candidate) => existsSync(candidate))

    if (!target) {
        throw new Error(`Installed Memoria launcher not found under ${runtimeLayout.runtimeRoot}`)
    }

    return target
}

export function getRuntimeInvocation(runtimeLayout: RuntimeLayout): RuntimeInvocation {
    const bundledCandidates = runtimeLayout.mode === 'repo'
        ? [path.join(runtimeLayout.runtimeRoot, 'dist', 'cli.mjs')]
        : [
            path.join(runtimeLayout.runtimeRoot, 'lib', 'cli.mjs'),
            path.join(runtimeLayout.runtimeRoot, 'dist', 'cli.mjs')
        ]
    const bundledCli = bundledCandidates.find((candidate) => existsSync(candidate))

    if (bundledCli) {
        return { command: process.execPath, args: [bundledCli] }
    }

    return { command: getSkillWrapperTarget(runtimeLayout), args: [] }
}

function quoteShellArg(value: string): string {
    return `'${value.replaceAll("'", `'"'"'`)}'`
}

export async function deployAgentSkill(runtimeLayout: RuntimeLayout, memoriaHome: string): Promise<string | undefined> {
    const skillSourcePath = getBundledSkillSourcePath(runtimeLayout)
    if (!skillSourcePath) return undefined

    const targetDir = path.join(memoriaHome, '.agents', 'skills', 'memoria')
    await fs.rm(targetDir, { recursive: true, force: true })
    await fs.mkdir(path.dirname(targetDir), { recursive: true })
    await fs.cp(skillSourcePath, targetDir, { recursive: true })

    const wrapperDir = path.join(targetDir, 'bin')
    const wrapperPath = path.join(wrapperDir, 'memoria')
    const runtime = getRuntimeInvocation(runtimeLayout)
    const invocation = [runtime.command, ...runtime.args].map(quoteShellArg).join(' ')
    await fs.mkdir(wrapperDir, { recursive: true })
    await fs.writeFile(
        wrapperPath,
        `#!/usr/bin/env bash\nset -euo pipefail\nexec ${invocation} "$@"\n`,
        'utf8'
    )
    await fs.chmod(wrapperPath, 0o755)

    const deployedSkillPath = path.join(skillSourcePath, 'deployed', 'DEPLOYED_SKILL.md')
    const deployedReferencePath = path.join(skillSourcePath, 'deployed', 'DEPLOYED_REFERENCE.md')
    if (existsSync(deployedSkillPath)) {
        await fs.copyFile(deployedSkillPath, path.join(targetDir, 'SKILL.md'))
    }
    if (existsSync(deployedReferencePath)) {
        await fs.copyFile(deployedReferencePath, path.join(targetDir, 'REFERENCE.md'))
    }

    return targetDir
}
