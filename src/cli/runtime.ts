import fs from 'node:fs/promises'
import os from 'node:os'
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
    await writeSkillCopy(runtimeLayout, skillSourcePath, targetDir, memoriaHome)
    return targetDir
}

/** issue-22: host agents whose own skill directory `setup --agent` can deploy into. */
const HOST_AGENT_SKILL_DIRS: Record<string, () => string> = {
    'claude-code': () => path.join(os.homedir(), '.claude', 'skills', 'memoria')
}

export const HOST_AGENTS = Object.keys(HOST_AGENT_SKILL_DIRS)

export function resolveHostAgentSkillDir(agent: string): string | undefined {
    // Own keys only: `toString`, `constructor`… are on every object and are not host agents.
    return Object.hasOwn(HOST_AGENT_SKILL_DIRS, agent) ? HOST_AGENT_SKILL_DIRS[agent]() : undefined
}

/**
 * `setup` replaces a host skill directory only when it is absent, empty, or a copy `setup` itself wrote —
 * one whose SKILL.md frontmatter carries both deployment marks. Anything else is the user's own skill,
 * and overwriting it would be a silent, irreversible loss (issue-22 SCN-006).
 */
export async function assertHostSkillTarget(targetDir: string): Promise<void> {
    const check = await checkHostSkillTarget(targetDir)
    if (!check.ok) throw new Error(`refusing to overwrite ${targetDir}: ${check.reason}; move it aside to deploy`)
}

async function checkHostSkillTarget(targetDir: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const stat = await fs.lstat(targetDir).catch(() => undefined)
    if (!stat) return { ok: true }
    if (!stat.isDirectory()) return { ok: false, reason: 'it exists and is not a directory' }
    if ((await fs.readdir(targetDir)).length === 0) return { ok: true }

    const skill = await fs.readFile(path.join(targetDir, 'SKILL.md'), 'utf8').catch(() => undefined)
    if (skill === undefined) return { ok: false, reason: 'it is not empty and has no SKILL.md written by memoria setup' }
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skill)?.[1] ?? ''
    const marked = /^deployment_mode:\s*"?installed"?\s*$/m.test(frontmatter)
        && /^repository:\s*"?Memoria"?\s*$/m.test(frontmatter)
    return marked
        ? { ok: true }
        : { ok: false, reason: 'its SKILL.md lacks the deployment marks (deployment_mode: installed, repository: Memoria), so it was not written by memoria setup' }
}

/**
 * The marks prove a copy descends from a deployed template, not that nobody edited it since — copying a
 * deployed skill by hand and adding to it was the documented workaround before `--agent`. So a non-empty
 * target is moved into `<memoriaHome>/.agents/skill-backups/` first: outside the host's skills directory,
 * where it would otherwise load as a second "memoria" skill (review 81bb75d M-1).
 */
export async function deployHostAgentSkill(
    runtimeLayout: RuntimeLayout,
    memoriaHome: string,
    agent: string,
    targetDir: string
): Promise<{ path: string; backup?: string } | undefined> {
    const skillSourcePath = getBundledSkillSourcePath(runtimeLayout)
    if (!skillSourcePath) return undefined

    await assertHostSkillTarget(targetDir)
    let backup: string | undefined
    if ((await fs.readdir(targetDir).catch(() => [])).length > 0) {
        backup = path.join(memoriaHome, '.agents', 'skill-backups', `${agent}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
        await fs.mkdir(path.dirname(backup), { recursive: true })
        await fs.cp(targetDir, backup, { recursive: true, verbatimSymlinks: true })
    }
    await writeSkillCopy(runtimeLayout, skillSourcePath, targetDir, memoriaHome)
    return { path: targetDir, ...(backup ? { backup } : {}) }
}

async function writeSkillCopy(runtimeLayout: RuntimeLayout, skillSourcePath: string, targetDir: string, memoriaHome: string): Promise<void> {
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
    // The skill reads its data root from here: a copy outside <memoriaHome> cannot derive it from its own path.
    await fs.writeFile(path.join(targetDir, 'DATA_ROOT'), `${memoriaHome}\n`, 'utf8')
}
