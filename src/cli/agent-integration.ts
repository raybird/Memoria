// Managed instruction file wiring for Memoria onboarding (docs/issues/issue-28).
//
// Wires shared `AGENTS.md` and Claude Code `CLAUDE.md` using bounded managed sections:
//   <!-- memoria:managed:start -->
//   ...
//   <!-- memoria:managed:end -->
//
// Safety rules (SCN-005, SCN-008, SCN-009):
//   - Pre-check all planned target paths before any write: reject symlinks, directories/special files,
//     or unwritable parent directories.
//   - Before modifying an existing non-empty file whose content will change, back it up under
//     `<dataRoot>/.agents/instruction-backups/`.
//   - Preserve every byte outside the managed block. Re-running with the same inputs produces
//     byte-identical output (idempotent, no duplicate sections).

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { InstallHostAgent } from '../core/index.js'
import { assertWritableAncestorDir } from './runtime.js'

export const MANAGED_START = '<!-- memoria:managed:start -->'
export const MANAGED_END = '<!-- memoria:managed:end -->'

export type InstructionTargetPlan = {
    path: string
    role: 'shared-agents' | 'codex-agents' | 'claude-instructions'
    action: 'create' | 'update' | 'unchanged'
    nextContent: string
}

export type InstructionWiringPlan = {
    targets: InstructionTargetPlan[]
}

export function escapeClaudeImportPath(targetPath: string): string {
    return targetPath.replace(/ /g, '\\ ')
}

export function upsertManagedBlock(existingContent: string | null, managedBody: string): string {
    const block = `${MANAGED_START}\n${managedBody.trim()}\n${MANAGED_END}`
    if (existingContent === null || existingContent.length === 0) {
        return `${block}\n`
    }

    const startIdx = existingContent.indexOf(MANAGED_START)
    const endIdx = existingContent.indexOf(MANAGED_END)
    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        const before = existingContent.slice(0, startIdx)
        const after = existingContent.slice(endIdx + MANAGED_END.length)
        return `${before}${block}${after}`
    }

    const sep = existingContent.endsWith('\n\n')
        ? ''
        : existingContent.endsWith('\n')
        ? '\n'
        : '\n\n'
    return `${existingContent}${sep}${block}\n`
}

function buildSharedAgentsBody(briefPath: string, dataRoot: string): string {
    return [
        '## Memoria Context',
        `Before starting work, read ${briefPath} if it is not already in context.`,
        `Memoria data root: ${dataRoot}`
    ].join('\n')
}

function buildClaudeBody(sharedAgentsImport: string, briefImport: string): string {
    return [
        `@${escapeClaudeImportPath(sharedAgentsImport)}`,
        `@${escapeClaudeImportPath(briefImport)}`
    ].join('\n')
}

async function readIfRegularFile(filePath: string): Promise<string | null> {
    try {
        const stat = await fs.lstat(filePath)
        if (!stat.isFile()) return null
        return await fs.readFile(filePath, 'utf8')
    } catch {
        return null
    }
}

export async function planInstructionWiring(opts: {
    scope: 'global' | 'project'
    dataRoot: string
    projectRoot?: string
    briefPath: string
    hosts: InstallHostAgent[]
    homedir?: string
    env?: NodeJS.ProcessEnv
}): Promise<InstructionWiringPlan> {
    const targets: InstructionTargetPlan[] = []
    if (opts.hosts.length === 0) return { targets }

    const dataRoot = path.resolve(opts.dataRoot)
    const briefPath = path.resolve(opts.briefPath)
    const env = opts.env ?? process.env
    const home = opts.homedir?.trim() || env.HOME?.trim() || os.homedir()

    const addTarget = async (
        targetPath: string,
        role: InstructionTargetPlan['role'],
        managedBody: string
    ): Promise<void> => {
        const resolvedPath = path.resolve(targetPath)
        if (targets.some((t) => t.path === resolvedPath)) return
        const existing = await readIfRegularFile(resolvedPath)
        const nextContent = upsertManagedBlock(existing, managedBody)
        const action: InstructionTargetPlan['action'] =
            existing === null ? 'create' : existing === nextContent ? 'unchanged' : 'update'
        targets.push({ path: resolvedPath, role, action, nextContent })
    }

    if (opts.scope === 'project') {
        const projectRoot = path.resolve(opts.projectRoot ?? process.cwd())
        const agentsPath = path.join(projectRoot, 'AGENTS.md')
        await addTarget(agentsPath, 'shared-agents', buildSharedAgentsBody(briefPath, dataRoot))

        if (opts.hosts.includes('claude-code')) {
            const claudePath = path.join(projectRoot, 'CLAUDE.md')
            const relBrief = path.relative(projectRoot, briefPath)
            const briefImport =
                relBrief && !relBrief.startsWith('..') && !path.isAbsolute(relBrief)
                    ? relBrief.split(path.sep).join('/')
                    : briefPath
            await addTarget(claudePath, 'claude-instructions', buildClaudeBody('AGENTS.md', briefImport))
        }
        return { targets }
    }

    // Global scope
    const sharedGlobalAgents = path.join(dataRoot, 'AGENTS.md')
    await addTarget(sharedGlobalAgents, 'shared-agents', buildSharedAgentsBody(briefPath, dataRoot))

    if (opts.hosts.includes('codex')) {
        const codexHome = env.CODEX_HOME?.trim()
            ? path.resolve(env.CODEX_HOME.trim())
            : path.join(home, '.codex')
        const codexAgents = path.join(codexHome, 'AGENTS.md')
        await addTarget(codexAgents, 'codex-agents', buildSharedAgentsBody(briefPath, dataRoot))
    }

    if (opts.hosts.includes('claude-code')) {
        const claudeGlobal = path.join(home, '.claude', 'CLAUDE.md')
        await addTarget(claudeGlobal, 'claude-instructions', buildClaudeBody(sharedGlobalAgents, briefPath))
    }

    return { targets }
}

/**
 * Pre-check all planned instruction targets before touching disk (SCN-009).
 * Refuses symlinks, directories at file targets, or parent paths occupied by plain files.
 */
export async function assertInstructionTargetsSafe(plan: InstructionWiringPlan): Promise<void> {
    for (const target of plan.targets) {
        const stat = await fs.lstat(target.path).catch(() => undefined)
        if (stat) {
            if (stat.isSymbolicLink()) {
                throw new Error(
                    `refusing to modify ${target.path}: it is a symbolic link; replace it with a regular file or omit instruction wiring`
                )
            }
            if (!stat.isFile()) {
                throw new Error(
                    `refusing to modify ${target.path}: it exists and is not a regular file`
                )
            }
            await assertWritableAncestorDir(target.path, 'modify')
            // Verify writeability by opening for reading/writing check
            try {
                await fs.access(target.path, fs.constants.R_OK | fs.constants.W_OK)
            } catch {
                throw new Error(`refusing to modify ${target.path}: permission denied (not readable/writable)`)
            }
        } else {
            await assertWritableAncestorDir(target.path, 'create')
        }
    }
}

export async function applyInstructionWiring(
    plan: InstructionWiringPlan,
    dataRoot: string
): Promise<{ updated: string[]; backups: string[] }> {
    await assertInstructionTargetsSafe(plan)
    const updated: string[] = []
    const backups: string[] = []
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')

    for (const target of plan.targets) {
        if (target.action === 'unchanged') continue

        const existingStat = await fs.lstat(target.path).catch(() => undefined)
        if (existingStat && existingStat.isFile()) {
            const backupDir = path.join(path.resolve(dataRoot), '.agents', 'instruction-backups', stamp)
            await fs.mkdir(backupDir, { recursive: true })
            const safeName = `${target.role}-${path.basename(target.path)}`
            const backupPath = path.join(backupDir, safeName)
            await fs.copyFile(target.path, backupPath)
            backups.push(backupPath)
        }

        await fs.mkdir(path.dirname(target.path), { recursive: true })
        const tmpFile = `${target.path}.tmp-${process.pid}-${Date.now()}`
        await fs.writeFile(tmpFile, target.nextContent, 'utf8')
        await fs.rename(tmpFile, target.path)
        updated.push(target.path)
    }

    return { updated, backups }
}
