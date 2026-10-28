import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { existsSync, probeDepsLocation } from '../core/index.js'
import type { InstallHostAgent } from '../core/index.js'

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

export function quoteShellArg(value: string): string {
    return `'${value.replaceAll("'", `'"'"'`)}'`
}

export async function deployAgentSkill(runtimeLayout: RuntimeLayout, memoriaHome: string): Promise<string | undefined> {
    const skillSourcePath = getBundledSkillSourcePath(runtimeLayout)
    if (!skillSourcePath) return undefined

    const targetDir = canonicalSkillDir(memoriaHome)
    await assertHostSkillTarget(targetDir)
    await writeSkillCopy(runtimeLayout, skillSourcePath, targetDir, memoriaHome)
    return targetDir
}

/** issue-22 / issue-28: host agents whose own skill directory `setup --agent` can deploy into. */
const HOST_AGENT_SKILL_DIRS: Record<InstallHostAgent, (ctx?: { homedir?: string; env?: NodeJS.ProcessEnv }) => string> = {
    'claude-code': (ctx) => {
        const home = ctx?.homedir?.trim() || (ctx?.env ?? process.env).HOME?.trim() || os.homedir()
        return path.join(home, '.claude', 'skills', 'memoria')
    },
    'codex': (ctx) => {
        const env = ctx?.env ?? process.env
        const codexHome = env.CODEX_HOME?.trim()
        if (codexHome) return path.join(path.resolve(codexHome), 'skills', 'memoria')
        const home = ctx?.homedir?.trim() || env.HOME?.trim() || os.homedir()
        return path.join(home, '.codex', 'skills', 'memoria')
    }
}

export const HOST_AGENTS = Object.keys(HOST_AGENT_SKILL_DIRS) as InstallHostAgent[]

export function parseAgentFlag(raw: string | string[] | undefined): InstallHostAgent[] {
    if (raw === undefined) return []
    const tokens = (Array.isArray(raw) ? raw : [raw])
        .flatMap((item) => item.split(','))
        .map((s) => s.trim())
        .filter(Boolean)

    if (tokens.length === 0) {
        throw new Error(`unknown agent ''; valid values: ${HOST_AGENTS.join(', ')}, both, none`)
    }

    const picked: InstallHostAgent[] = []
    let sawNone = false
    for (const token of tokens) {
        if (token === 'none') {
            sawNone = true
            continue
        }
        if (token === 'both') {
            for (const h of HOST_AGENTS) {
                if (!picked.includes(h)) picked.push(h)
            }
            continue
        }
        if (Object.hasOwn(HOST_AGENT_SKILL_DIRS, token)) {
            const agent = token as InstallHostAgent
            if (!picked.includes(agent)) picked.push(agent)
            continue
        }
        throw new Error(`unknown agent '${token}'; valid values: ${HOST_AGENTS.join(', ')}, both, none`)
    }

    if (sawNone && picked.length > 0) {
        throw new Error(`cannot combine '--agent none' with other host agents (${picked.join(', ')})`)
    }
    return picked
}

export function resolveHostAgentSkillDir(
    agent: string,
    ctx?: { homedir?: string; env?: NodeJS.ProcessEnv }
): string | undefined {
    // Own keys only: `toString`, `constructor`… are on every object and are not host agents.
    return Object.hasOwn(HOST_AGENT_SKILL_DIRS, agent)
        ? HOST_AGENT_SKILL_DIRS[agent as InstallHostAgent](ctx)
        : undefined
}

/**
 * Standard macOS root-level OS aliases (`/tmp -> private/tmp`, `/var -> private/var`, `/etc -> private/etc`).
 * Every other ancestor component along a user/temp path must be a real directory (never a symlink).
 */
function isPlatformRootAlias(dirPath: string): boolean {
    return process.platform === 'darwin' && (dirPath === '/tmp' || dirPath === '/var' || dirPath === '/etc')
}

/**
 * Walk up from `targetPath`'s parent all the way to the filesystem root,
 * verify that the nearest existing ancestor is a writable real directory (not a file or symlink),
 * and continue checking every ancestor above it so an existing real child directory (even many
 * levels deep, e.g. `<fixture>/link/a/b/c/d/e/skills`) cannot mask a symlinked ancestor higher up
 * (F-2 / review-a02c01c).
 */
export async function checkWritableAncestorDir(
    targetPath: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
    let curr = path.dirname(path.resolve(targetPath))
    let checkedWritableNearest = false
    while (curr && curr !== path.dirname(curr)) {
        const dirStat = await fs.lstat(curr).catch(() => undefined)
        if (dirStat) {
            if (dirStat.isSymbolicLink()) {
                if (!isPlatformRootAlias(curr)) {
                    return { ok: false, reason: `ancestor ${curr} exists and is not a directory` }
                }
            } else if (!dirStat.isDirectory()) {
                return { ok: false, reason: `ancestor ${curr} exists and is not a directory` }
            }
            if (!checkedWritableNearest) {
                try {
                    await fs.access(curr, fs.constants.W_OK)
                } catch {
                    return { ok: false, reason: `parent directory ${curr} is not writable` }
                }
                checkedWritableNearest = true
            }
        }
        curr = path.dirname(curr)
    }
    return { ok: true }
}

export async function assertWritableAncestorDir(targetPath: string, actionLabel = 'create'): Promise<void> {
    const check = await checkWritableAncestorDir(targetPath)
    if (!check.ok) {
        throw new Error(`refusing to ${actionLabel} ${targetPath}: ${check.reason}`)
    }
}

/**
 * issue-29: `<memoriaHome>/.agents/skills/memoria` is the one real copy of the deployed skill; each
 * host skill directory is a symlink (Windows: junction) to it, so a plain `setup` refreshes every host.
 */
export function canonicalSkillDir(memoriaHome: string): string {
    return path.join(path.resolve(memoriaHome), '.agents', 'skills', 'memoria')
}

/** What a host skill target holds now, which decides how `deployHostAgentSkill` replaces it. */
export type SkillTargetState = 'absent' | 'empty' | 'marked' | 'link'

type SkillTargetCheck = { ok: true; state: SkillTargetState } | { ok: false; reason: string }

/**
 * `setup` replaces a skill directory only when it is absent, empty, or a copy `setup` itself wrote —
 * one whose SKILL.md frontmatter carries both deployment marks. Anything else is the user's own skill,
 * and overwriting it would be a silent, irreversible loss (issue-22 SCN-006).
 *
 * `canonical` mode (the default) is for `<memoriaHome>/.agents/skills/memoria`, which must stay a real
 * directory. `host` mode also accepts a symlink to a Memoria canonical directory (issue-29).
 */
export async function assertHostSkillTarget(targetDir: string, mode: 'canonical' | 'host' = 'canonical'): Promise<SkillTargetState> {
    const check = await checkHostSkillTarget(targetDir, mode).catch((error: unknown): SkillTargetCheck => ({
        ok: false,
        reason: `it cannot be inspected (${error instanceof Error ? error.message : String(error)})`
    }))
    if (!check.ok) throw new Error(`refusing to overwrite ${targetDir}: ${check.reason}; move it aside to deploy`)
    return check.state
}

/** Only ENOENT means "not there"; any other lstat failure is an answer we do not have. */
async function lstatIfExists(target: string) {
    try {
        return await fs.lstat(target)
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
        throw error
    }
}

async function checkHostSkillTarget(targetDir: string, mode: 'canonical' | 'host'): Promise<SkillTargetCheck> {
    const stat = await lstatIfExists(targetDir)
    const ancestorCheck = await checkWritableAncestorDir(targetDir)
    if (!ancestorCheck.ok) return ancestorCheck
    if (!stat) return { ok: true, state: 'absent' }
    if (stat.isSymbolicLink()) {
        return mode === 'host'
            ? checkManagedSkillLink(targetDir)
            : { ok: false, reason: 'it is a symlink, and the data-root skill directory must be a real directory' }
    }
    if (!stat.isDirectory()) return { ok: false, reason: 'it exists and is not a directory' }
    if ((await fs.readdir(targetDir)).length === 0) return { ok: true, state: 'empty' }
    const marks = await checkDeploymentMarks(targetDir)
    return marks.ok ? { ok: true, state: 'marked' } : marks
}

/**
 * A host link is Memoria's to replace when it resolves to a path ending in `.agents/skills/memoria` that
 * is either gone (a root that was moved or deleted: repair it) or a real directory with both marks.
 * Neither proves `setup` made the link — the tail and the marks are public conventions — so anything
 * short of both is refused, even a marked directory somewhere else.
 */
async function checkManagedSkillLink(linkPath: string): Promise<SkillTargetCheck> {
    const resolved = path.resolve(path.dirname(linkPath), await fs.readlink(linkPath))
    if (resolved.split(path.sep).slice(-3).join('/') !== '.agents/skills/memoria') {
        return { ok: false, reason: `it is a symlink to ${resolved}, which is not a <data root>/.agents/skills/memoria directory` }
    }
    const stat = await lstatIfExists(resolved)
    if (!stat) return { ok: true, state: 'link' }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
        return { ok: false, reason: `it is a symlink to ${resolved}, which is not a real directory` }
    }
    const marks = await checkDeploymentMarks(resolved)
    return marks.ok ? { ok: true, state: 'link' } : { ok: false, reason: `it is a symlink to ${resolved}, and ${marks.reason}` }
}

async function checkDeploymentMarks(dir: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const skill = await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8').catch(() => undefined)
    if (skill === undefined) return { ok: false, reason: 'it is not empty and has no SKILL.md written by memoria setup' }
    const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skill)?.[1] ?? ''
    const marked = /^deployment_mode:\s*"?installed"?\s*$/m.test(frontmatter)
        && /^repository:\s*"?Memoria"?\s*$/m.test(frontmatter)
    return marked
        ? { ok: true }
        : { ok: false, reason: 'its SKILL.md lacks the deployment marks (deployment_mode: installed, repository: Memoria), so it was not written by memoria setup' }
}

/**
 * Compares where two skill paths land without following their last component: a host link to the
 * canonical directory is the normal case, not an overlap. The parent is resolved through its nearest
 * existing ancestor so platform aliases (macOS `/tmp`) and not-yet-created directories compare alike.
 */
export async function isSameSkillPath(a: string, b: string): Promise<boolean> {
    const comparable = async (target: string): Promise<string> => {
        const tail = [path.basename(target)]
        let head = path.dirname(path.resolve(target))
        for (;;) {
            const real = await fs.realpath(head).catch(() => undefined)
            const parent = path.dirname(head)
            if (real || parent === head) {
                const joined = path.join(real ?? head, ...tail)
                return process.platform === 'win32' ? joined.toLowerCase() : joined
            }
            tail.unshift(path.basename(head))
            head = parent
        }
    }
    return (await comparable(a)) === (await comparable(b))
}

export function skillPathOverlapError(agent: string, targetDir: string, canonicalDir: string): Error {
    return new Error(
        `refusing to deploy the ${agent} skill to ${targetDir}: it is the data root's own skill directory ${canonicalDir}, ` +
        `and linking it to itself would destroy it; point ${agent} at another directory (e.g. a different CODEX_HOME)`
    )
}

/**
 * Points a host skill directory at the canonical copy `deployAgentSkill` wrote. A link holds nothing of
 * its own and an empty directory nothing at all, so neither is backed up. A marked physical directory —
 * what `setup` deployed before issue-29, or a copy someone cp'd from it and edited — may hold the user's
 * own work, so it is copied whole into `<memoriaHome>/.agents/skill-backups/` first: outside the host's
 * skills directory, where it would otherwise load as a second "memoria" skill (review 81bb75d M-1).
 */
export async function deployHostAgentSkill(
    runtimeLayout: RuntimeLayout,
    memoriaHome: string,
    agent: string,
    targetDir: string
): Promise<{ path: string; link: string; backup?: string } | undefined> {
    if (!getBundledSkillSourcePath(runtimeLayout)) return undefined

    const canonicalDir = canonicalSkillDir(memoriaHome)
    if (await isSameSkillPath(targetDir, canonicalDir)) throw skillPathOverlapError(agent, targetDir, canonicalDir)
    const canonicalStat = await lstatIfExists(canonicalDir)
    if (!canonicalStat?.isDirectory()) {
        throw new Error(`cannot link ${targetDir}: the data-root skill ${canonicalDir} is not deployed as a real directory`)
    }

    const state = await assertHostSkillTarget(targetDir, 'host')
    let backup: string | undefined
    if (state === 'marked') {
        backup = path.join(memoriaHome, '.agents', 'skill-backups', `${agent}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
        await fs.mkdir(path.dirname(backup), { recursive: true })
        await fs.cp(targetDir, backup, { recursive: true, verbatimSymlinks: true })
        await fs.rm(targetDir, { recursive: true })
    } else if (state === 'empty') {
        await fs.rmdir(targetDir)
    } else if (state === 'link') {
        await fs.unlink(targetDir)
    }
    await fs.mkdir(path.dirname(targetDir), { recursive: true })
    await fs.symlink(canonicalDir, targetDir, process.platform === 'win32' ? 'junction' : 'dir')
    return { path: targetDir, link: canonicalDir, ...(backup ? { backup } : {}) }
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

export type VectorDepsResult = {
    path: string
    provider: 'local' | 'stub'
    reused: boolean
    warmedUp: boolean
    modelCacheDir: string | null
    /** A node_modules beside the helper wins over the cache (deps.mjs), so this install stays unused
     *  until it is gone — reported rather than silently ignored. */
    shadowedBy: string | null
}

/**
 * issue-25: install the semantic-recall helper's dependencies into the user cache that its
 * `deps.mjs` resolves — `${XDG_CACHE_HOME:-~/.cache}/memoria/vector/<lockfile hash>` — where a global
 * `npm i -g` upgrade does not reach. The target comes from `probeDepsLocation` (`node deps.mjs`), the
 * same probe doctor uses, so the lockfile → directory rule has one implementation.
 *
 * Only a directory carrying `.complete` is ever loaded, so the marker is written last: npm and the
 * model warm-up both run against a `.partial-<pid>` staging directory, which is marked and renamed into
 * place only after both succeed. A failure, Ctrl-C or kill at any point before that leaves nothing that
 * reads as installed (review 1ffc3a2 M-1).
 */
export async function installVectorDeps(runtimeLayout: RuntimeLayout): Promise<VectorDepsResult> {
    const helperDir = path.join(runtimeLayout.runtimeRoot, 'skills', 'memoria-vector')
    for (const file of ['deps.mjs', 'embed.mjs', 'package.json', 'package-lock.json']) {
        if (!existsSync(path.join(helperDir, file))) {
            throw new Error(`vector helper incomplete: ${path.join(helperDir, file)} not found (reinstall the package)`)
        }
    }
    const provider = (process.env.MEMORIA_EMBED_PROVIDER ?? 'local').trim()
    if (provider !== 'local' && provider !== 'stub') {
        throw new Error(`Unknown MEMORIA_EMBED_PROVIDER: ${provider} (expected 'local' or 'stub')`)
    }

    const location = probeDepsLocation(helperDir)
    if (!location?.cacheDir) throw new Error(`could not resolve the helper's dependency directory (node ${path.join(helperDir, 'deps.mjs')} failed)`)
    const target = location.cacheDir
    const marker = path.join(target, '.complete')
    await reclaimDeadPartials(target)

    // The stub provider needs only @libsql/client; `local` also needs the ~700MB embedder, so a stub
    // install does not count as complete for it.
    const needsEmbedder = provider === 'local'
    const reused = existsSync(marker) &&
        (!needsEmbedder || existsSync(path.join(target, 'node_modules', '@huggingface', 'transformers')))
    const stage = reused ? target : `${target}.partial-${process.pid}`

    let modelCacheDir: string | null = null
    try {
        if (!reused) {
            await fs.rm(stage, { recursive: true, force: true })
            await fs.mkdir(stage, { recursive: true })
            await fs.copyFile(path.join(helperDir, 'package.json'), path.join(stage, 'package.json'))
            await fs.copyFile(path.join(helperDir, 'package-lock.json'), path.join(stage, 'package-lock.json'))
            // NODE_ENV=production would drop the embedder whatever the flags say (issue-11), so the
            // child never inherits it; the explicit flag decides.
            const env = { ...process.env }
            delete env.NODE_ENV
            const npm = await runChild('npm', ['ci', '--no-audit', '--no-fund', needsEmbedder ? '--include=dev' : '--omit=dev'], { cwd: stage, env, timeoutMs: 30 * 60_000 })
            if (!npm.ok) throw new Error(`npm ci failed (${npm.status}): ${npmReason(npm.stderr)}`)
        }
        if (needsEmbedder) modelCacheDir = await warmUp(helperDir, stage)
        if (!reused) {
            await fs.writeFile(path.join(stage, '.complete'), `${new Date().toISOString()}\n`, 'utf8')
            await fs.rm(target, { recursive: true, force: true })
            await fs.rename(stage, target)
        }
    } catch (error) {
        if (!reused) await fs.rm(stage, { recursive: true, force: true })
        // A reused install whose warm-up fails loses its marker too: doctor must not report an embedder
        // that cannot load.
        else await fs.rm(marker, { force: true })
        throw error
    }

    const shadowedBy = location.source === 'sibling' ? path.join(helperDir, 'node_modules') : null
    return { path: target, provider, reused, warmedUp: needsEmbedder, modelCacheDir, shadowedBy }
}

/**
 * The first model load downloads it and can outlast the recall timeout (issue-23), so pay it here,
 * through the helper's own embed path but pinned to `depsDir` — the staged install, which deps.mjs
 * would not pick yet (no `.complete`) and a sibling node_modules would shadow (review 1ffc3a2 S-2).
 * The child prints only the error message on failure: Node prints the stack after it, so a tail of
 * stderr is all frames. Returns the model cache directory deps.mjs assigned, printed as the last line.
 */
async function warmUp(helperDir: string, depsDir: string): Promise<string> {
    const depsUrl = pathToFileURL(path.join(helperDir, 'deps.mjs')).href
    const embedUrl = pathToFileURL(path.join(helperDir, 'embed.mjs')).href
    const script = [
        'try {',
        `  const deps = await import(${JSON.stringify(depsUrl)})`,
        `  const modelCacheDir = deps.modelCacheDirFor()`,
        `  deps.useDepsLocation({ source: 'cache', dir: ${JSON.stringify(depsDir)}, modelCacheDir, cacheDir: ${JSON.stringify(depsDir)} })`,
        `  const { embedTexts } = await import(${JSON.stringify(embedUrl)})`,
        `  await embedTexts(['warm up'], 'query')`,
        "  process.stdout.write('\\n' + JSON.stringify({ modelCacheDir }) + '\\n')",
        '} catch (error) {',
        '  process.stderr.write(String(error?.message ?? error))',
        '  process.exit(1)',
        '}'
    ].join('\n')
    const run = await runChild(process.execPath, ['--input-type=module', '-e', script], { cwd: helperDir, env: process.env, timeoutMs: 15 * 60_000 })
    if (!run.ok) throw new Error(`model warm-up failed (${run.status}): ${run.stderr.trim() || 'no error output'}`)
    // The result is the last line: the embedder may chatter on stdout first (review 113c6de N-B).
    const last = run.stdout.trim().split('\n').pop() ?? ''
    return (JSON.parse(last) as { modelCacheDir: string }).modelCacheDir
}

/** npm prints the reason first (`npm error code …` and the lines after it) and boilerplate last, so a
 *  plain tail keeps only the boilerplate (review 1ffc3a2 S-1). A failing install script needs more than
 *  the code: its first four lines only name the package and the command, and the script's own error
 *  comes after Node's uncaught-exception source excerpt (reviews 113c6de N-A, b525453 N-A'). So from
 *  the code on, drop what carries no cause — stack frames, that excerpt, blank lines — keep up to eight
 *  lines, and end with the log path. */
function npmReason(stderr: string): string {
    const lines = stderr.split('\n').map((l) => l.trimEnd()).filter(Boolean)
    const log = lines.find((l) => /complete log of this run/.test(l))
    const code = lines.findIndex((l) => /^npm (error|ERR!) code /.test(l))
    if (code < 0) return lines.slice(-5).join(' | ') || 'no error output'
    const excerpt = /^npm (error|ERR!) node:\S+:\d+$/
    const rest = lines.slice(code).filter((l, i, all) =>
        l !== log &&
        !/^npm (error|ERR!)\s+at /.test(l) &&       // stack frame
        !/^npm (error|ERR!)(\s+\^+)?$/.test(l) &&   // blank, or the excerpt's caret
        !excerpt.test(l) &&                         // excerpt location
        !(i > 0 && excerpt.test(all[i - 1])))       // the source line under it
    const picked = rest.slice(0, 8)
    if (log) picked.push(log)
    return picked.join(' | ')
}

/** A staging directory whose process is gone will never be renamed into place; reclaim it (~720MB)
 *  instead of letting each interrupted run leave another. Live ones belong to a concurrent run. */
async function reclaimDeadPartials(target: string): Promise<void> {
    const prefix = `${path.basename(target)}.partial-`
    const entries = await fs.readdir(path.dirname(target)).catch(() => [] as string[])
    for (const entry of entries) {
        if (!entry.startsWith(prefix)) continue
        const pid = Number(entry.slice(prefix.length))
        if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid || isAlive(pid)) continue
        await fs.rm(path.join(path.dirname(target), entry), { recursive: true, force: true })
    }
}

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0)
        return true
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'EPERM'
    }
}

export function runChild(
    command: string,
    args: string[],
    opts: { cwd?: string; env: NodeJS.ProcessEnv; timeoutMs: number }
): Promise<{ ok: boolean; status: string; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'] })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
        child.stderr.on('data', (chunk: Buffer) => { stderr = (stderr + chunk.toString('utf8')).slice(-16_000) })
        const timer = setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs)
        child.on('error', (error) => {
            clearTimeout(timer)
            reject(new Error(`${command} could not start: ${error.message}`))
        })
        child.on('close', (code, signal) => {
            clearTimeout(timer)
            resolve({ ok: code === 0, status: signal ?? `exit ${code}`, stdout, stderr })
        })
    })
}
