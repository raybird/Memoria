// Setup planning, interactive prompts, full vector corpus ingest, and readiness verification (docs/issues/issue-28).

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline/promises'
import {
    MemoriaCore,
    resolveMemoriaPaths,
    existsSync,
    buildMemoryIndex,
    inspectVectorLayer,
    countEmbeddableEntities,
    probeDepsLocation,
    renderBrief,
    resolveInstallSettingsPath,
    resolveDefaultGlobalDataRoot,
    loadInstallSettingsSync,
    resolveLocalVectorDbPath,
    getExplicitVectorEnv,
    assertIngestDbPathMatchesRoot
} from '../core/index.js'
import type { InstallHostAgent, MemoriaPaths } from '../core/index.js'
import {
    assertHostSkillTarget,
    assertWritableAncestorDir,
    canonicalSkillDir,
    resolveHostAgentSkillDir,
    runChild,
    skillPathOverlapError,
    skillPathsOverlap
} from './runtime.js'
import type { RuntimeLayout } from './runtime.js'
import {
    planInstructionWiring,
    assertInstructionTargetsSafe
} from './agent-integration.js'
import type { InstructionWiringPlan } from './agent-integration.js'

export type SetupChoices = {
    scope: 'global' | 'project'
    dataRoot: string
    hosts: InstallHostAgent[]
    vector: boolean
    wireInstructions: boolean
    saveSettings: boolean
}

export type SetupPlan = {
    choices: SetupChoices
    paths: MemoriaPaths
    briefPath: string
    settingsPath: string
    hostSkillTargets: Array<{ agent: InstallHostAgent; dir: string }>
    instructionPlan: InstructionWiringPlan
    vectorModelDownloadNeeded: boolean
}

export type ComponentReadiness = {
    status: 'ready' | 'skipped' | 'failed'
    detail: string
    corpusVerified?: boolean
    isolatedProbeVerified?: boolean
}

export type SetupReadinessSummary = {
    ok: boolean
    core: ComponentReadiness
    agent: ComponentReadiness
    vector: ComponentReadiness
}

export async function promptSetupChoices(defaults: {
    defaultGlobalRoot: string
    defaultProjectRoot: string
    requestedHome?: string
    existingHosts?: InstallHostAgent[]
    existingVector?: boolean
}): Promise<{ choices: SetupChoices; confirmed: boolean }> {
    const lineQueue: string[] = []
    let eof = false
    let waiter: ((line: string | null) => void) | null = null

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: Boolean(process.stdin.isTTY && process.stdout.isTTY)
    })

    rl.on('line', (line) => {
        if (waiter) {
            const resolve = waiter
            waiter = null
            resolve(line)
        } else {
            lineQueue.push(line)
        }
    })
    rl.on('close', () => {
        eof = true
        if (waiter) {
            const resolve = waiter
            waiter = null
            resolve(null)
        }
    })

    const ask = async (promptText: string): Promise<string | null> => {
        process.stdout.write(promptText)
        if (lineQueue.length > 0) {
            const next = lineQueue.shift()!
            if (!process.stdin.isTTY) process.stdout.write(`${next}\n`)
            return next
        }
        if (eof) return null
        return new Promise<string | null>((resolve) => {
            waiter = (val) => {
                if (val !== null && !process.stdin.isTTY) process.stdout.write(`${val}\n`)
                resolve(val)
            }
        })
    }

    try {
        const globalRootPreview = defaults.requestedHome
            ? path.resolve(defaults.requestedHome)
            : defaults.defaultGlobalRoot
        const projectRootPreview = defaults.requestedHome
            ? path.resolve(defaults.requestedHome)
            : defaults.defaultProjectRoot

        console.log('\n=== Memoria Interactive Setup ===')
        console.log('1) Global memory (shared across folders; recommended)')
        console.log(`   root: ${globalRootPreview}`)
        console.log('2) Project memory (current folder only)')
        console.log(`   root: ${projectRootPreview}`)
        const rawScope = await ask('Select data location [1/2, default 1]: ')
        if (rawScope === null) return { choices: { scope: 'global', dataRoot: globalRootPreview, hosts: [], vector: false, wireInstructions: false, saveSettings: false }, confirmed: false }
        const scopeAns = rawScope.trim()
        const scope: 'global' | 'project' =
            scopeAns === '2' || scopeAns.toLowerCase() === 'project' ? 'project' : 'global'
        const dataRoot = defaults.requestedHome
            ? path.resolve(defaults.requestedHome)
            : scope === 'global'
            ? defaults.defaultGlobalRoot
            : defaults.defaultProjectRoot

        console.log('\nSelect host agent integration:')
        console.log('1) Claude Code (~/.claude/skills/memoria + CLAUDE.md)')
        console.log('2) Codex (~/.codex/skills/memoria + AGENTS.md)')
        console.log('3) Both Claude Code and Codex (recommended)')
        console.log('4) None (data root skill only)')
        const rawHost = await ask('Select agent [1/2/3/4, default 3]: ')
        if (rawHost === null) return { choices: { scope, dataRoot, hosts: [], vector: false, wireInstructions: false, saveSettings: false }, confirmed: false }
        const hostAns = rawHost.trim()
        let hosts: InstallHostAgent[] = ['claude-code', 'codex']
        if (hostAns === '1' || hostAns.toLowerCase() === 'claude-code') hosts = ['claude-code']
        else if (hostAns === '2' || hostAns.toLowerCase() === 'codex') hosts = ['codex']
        else if (hostAns === '4' || hostAns.toLowerCase() === 'none') hosts = []

        console.log('\nEnable local semantic recall (vector mode)?')
        console.log('1) Yes — install local embedding runtime (~700MB on first run), warm model & index corpus')
        console.log('2) No  — basic lexical/tree recall only (no model download)')
        const vecDefault = defaults.existingVector ? '1' : '2'
        const rawVec = await ask(`Enable local semantic recall [1/2, default ${vecDefault}]: `)
        if (rawVec === null) return { choices: { scope, dataRoot, hosts, vector: false, wireInstructions: false, saveSettings: false }, confirmed: false }
        const vecAns = rawVec.trim() || vecDefault
        const vector = vecAns === '1' || vecAns.toLowerCase() === 'y' || vecAns.toLowerCase() === 'yes'

        const choices: SetupChoices = {
            scope,
            dataRoot: path.resolve(dataRoot),
            hosts,
            vector,
            wireInstructions: hosts.length > 0,
            saveSettings: true
        }

        const plan = await buildSetupPlan(choices)
        printSetupPlanPreview(plan)

        const rawConfirm = await ask('\nApply this setup plan? [y/N]: ')
        const confirmAns = (rawConfirm ?? '').trim().toLowerCase()
        const confirmed = confirmAns === 'y' || confirmAns === 'yes'
        return { choices, confirmed }
    } finally {
        rl.close()
    }
}

export async function buildSetupPlan(
    choices: SetupChoices,
    runtimeLayout?: RuntimeLayout
): Promise<SetupPlan> {
    const paths = resolveMemoriaPaths(choices.dataRoot)
    const briefPath = path.join(paths.knowledgeDir, 'BRIEF.md')
    const settingsPath = resolveInstallSettingsPath()

    const hostSkillTargets: Array<{ agent: InstallHostAgent; dir: string }> = []
    for (const agent of choices.hosts) {
        const dir = resolveHostAgentSkillDir(agent)
        if (!dir) {
            throw new Error(`unknown agent '${agent}'`)
        }
        hostSkillTargets.push({ agent, dir })
    }

    const instructionPlan = choices.wireInstructions
        ? await planInstructionWiring({
            scope: choices.scope,
            dataRoot: paths.memoriaHome,
            projectRoot: process.cwd(),
            briefPath,
            hosts: choices.hosts
        })
        : { targets: [] }

    let vectorModelDownloadNeeded = false
    if (choices.vector) {
        const provider = (process.env.MEMORIA_EMBED_PROVIDER ?? 'local').trim()
        if (provider === 'local' && runtimeLayout) {
            const helperDir = path.join(runtimeLayout.runtimeRoot, 'skills', 'memoria-vector')
            const loc = probeDepsLocation(helperDir)
            const hasTransformers = Boolean(
                loc?.dir && existsSync(path.join(loc.dir, 'node_modules', '@huggingface', 'transformers'))
            )
            vectorModelDownloadNeeded = !hasTransformers
        }
    }

    return {
        choices,
        paths,
        briefPath,
        settingsPath,
        hostSkillTargets,
        instructionPlan,
        vectorModelDownloadNeeded
    }
}

export function printSetupPlanPreview(plan: SetupPlan): void {
    console.log('\n--- Planned Setup Changes ---')
    console.log(`Scope:             ${plan.choices.scope}`)
    console.log(`Data root:         ${plan.paths.memoriaHome}`)
    console.log(`Database:          ${plan.paths.dbPath}`)
    console.log(`Brief output:      ${plan.briefPath}`)
    if (plan.choices.saveSettings) {
        console.log(`Install settings:  ${plan.settingsPath}`)
    }
    if (plan.hostSkillTargets.length > 0) {
        for (const h of plan.hostSkillTargets) {
            console.log(`Host skill (${h.agent}): ${h.dir}`)
        }
    } else {
        console.log('Host skills:       none (data-root skill only)')
    }
    for (const t of plan.instructionPlan.targets) {
        console.log(`Instruction (${t.action}): ${t.path}`)
    }
    if (plan.choices.vector) {
        const explicitVec = getExplicitVectorEnv(process.env)
        const provider = (explicitVec.embedProvider ?? 'local').trim()
        const vectorDb = explicitVec.libsqlUrl || `file:${resolveLocalVectorDbPath(plan.paths.memoriaHome)}`
        console.log(`Semantic recall:   enabled (provider=${provider}, store=${vectorDb})`)
        console.log(`Model download:    ${plan.vectorModelDownloadNeeded ? 'required (~700MB first-time install)' : 'reusing existing cache/install'}`)
    } else {
        console.log('Semantic recall:   disabled (basic lexical/tree mode; no model download)')
    }
}

async function assertRegularFileOrCreatable(filePath: string, actionLabel = 'write'): Promise<void> {
    const stat = await fs.lstat(filePath).catch(() => undefined)
    if (stat) {
        if (stat.isSymbolicLink() || !stat.isFile()) {
            throw new Error(
                `refusing to ${actionLabel} ${filePath}: it exists and is not a regular file`
            )
        }
        await assertWritableAncestorDir(filePath, actionLabel)
        try {
            await fs.access(filePath, fs.constants.R_OK | fs.constants.W_OK)
        } catch {
            throw new Error(`refusing to ${actionLabel} ${filePath}: permission denied (not readable/writable)`)
        }
    } else {
        await assertWritableAncestorDir(filePath, actionLabel)
    }
}

async function assertRealDirectoryOrCreatable(dirPath: string, actionLabel = 'initialize'): Promise<void> {
    const stat = await fs.lstat(dirPath).catch(() => undefined)
    if (stat) {
        if (stat.isSymbolicLink() || !stat.isDirectory()) {
            throw new Error(
                `refusing to ${actionLabel} ${dirPath}: it exists and is not a directory`
            )
        }
        try {
            await fs.access(dirPath, fs.constants.W_OK)
        } catch {
            throw new Error(`refusing to ${actionLabel} ${dirPath}: permission denied (not writable)`)
        }
        await assertWritableAncestorDir(dirPath, actionLabel)
    } else {
        await assertWritableAncestorDir(dirPath, actionLabel)
    }
}

/**
 * Pre-check all planned targets BEFORE any file or database is modified (SCN-009, SCN-012, F-1, F-2).
 */
export async function assertSetupPlanSafe(plan: SetupPlan): Promise<void> {
    // 1. If vector is requested, verify MEMORIA_DB_PATH matches the data root's DB
    if (plan.choices.vector) {
        assertIngestDbPathMatchesRoot(plan.paths)
    }

    // 2. Verify data root and every internal directory `init()` / backup / skill deployment creates
    const internalDirs = [
        plan.paths.memoriaHome,
        plan.paths.memoryDir,
        plan.paths.sessionsPath,
        path.join(plan.paths.memoryDir, 'sources'),
        path.join(plan.paths.memoryDir, 'checkpoints'),
        path.join(plan.paths.memoryDir, 'exports'),
        plan.paths.knowledgeDir,
        path.join(plan.paths.knowledgeDir, 'Daily'),
        path.join(plan.paths.knowledgeDir, 'Sources'),
        path.join(plan.paths.knowledgeDir, 'Skills'),
        path.join(plan.paths.knowledgeDir, 'Decisions'),
        plan.paths.configPath,
        path.join(plan.paths.memoriaHome, '.agents'),
        path.join(plan.paths.memoriaHome, '.agents', 'skills'),
        path.join(plan.paths.memoriaHome, '.agents', 'skill-backups'),
        path.join(plan.paths.memoriaHome, '.agents', 'instruction-backups')
    ]
    for (const dir of internalDirs) {
        await assertRealDirectoryOrCreatable(dir, 'initialize')
    }

    // Verify internal file targets inside the data root (DB, BRIEF.md, and local vector DB when requested)
    await assertRegularFileOrCreatable(plan.paths.dbPath, 'initialize')
    await assertRegularFileOrCreatable(plan.briefPath, 'write')
    if (plan.choices.vector) {
        const explicitVec = getExplicitVectorEnv(process.env)
        const vecUrl = explicitVec.libsqlUrl || `file:${resolveLocalVectorDbPath(plan.paths.memoriaHome)}`
        if (vecUrl.startsWith('file:')) {
            await assertRegularFileOrCreatable(vecUrl.slice('file:'.length), 'initialize')
        }
    }

    // 3. Check the canonical data-root skill (a real directory) and every host skill target up front; a host
    //    path that IS the canonical one (CODEX_HOME=<dataRoot>/.agents) or lies inside it would destroy or hide it
    const canonicalDir = canonicalSkillDir(plan.paths.memoriaHome)
    await assertHostSkillTarget(canonicalDir)
    for (const target of plan.hostSkillTargets) {
        if (await skillPathsOverlap(target.dir, canonicalDir)) throw skillPathOverlapError(target.agent, target.dir, canonicalDir)
        await assertHostSkillTarget(target.dir, 'host')
    }

    // 4. Check all instruction targets up front
    await assertInstructionTargetsSafe(plan.instructionPlan)

    // 5. If saving install settings, verify settingsPath is not a symlink/directory and its ancestor is writable
    if (plan.choices.saveSettings) {
        await assertRegularFileOrCreatable(plan.settingsPath, 'overwrite')
    }
}

export async function generateSetupBrief(paths: MemoriaPaths, core: MemoriaCore): Promise<string> {
    const result = await core.brief({ days: 30, topK: 10 })
    if (!result.ok || !result.data) {
        throw new Error(result.error ?? 'failed to generate brief')
    }
    const markdown = renderBrief(result.data)
    const outPath = path.join(paths.knowledgeDir, 'BRIEF.md')
    await fs.mkdir(path.dirname(outPath), { recursive: true })
    await fs.writeFile(outPath, markdown, 'utf8')
    return outPath
}

/**
 * Build the tree index and ingest the full corpus into the vector store, unaffected by any existing
 * MCP sync cursor (`--sync-target` uses a unique run id and cleans its cursor row afterwards).
 */
export async function runFullVectorIngest(
    paths: MemoriaPaths,
    runtimeLayout: RuntimeLayout,
    env: NodeJS.ProcessEnv = process.env
): Promise<{ embedded: number; expected: number; missing: number }> {
    assertIngestDbPathMatchesRoot(paths)
    buildMemoryIndex(paths.dbPath, {})

    // Measure embeddable corpus directly from SQLite: `inspectVectorLayer().coverage` is null whenever
    // the vector DB does not have a `memoria_vectors` table yet (e.g. an existing empty file) or when
    // `LIBSQL_URL` is a remote URL, so `beforeReport.coverage?.expected ?? 0` would misreport a populated
    // corpus as empty (review-f38ce84 #3).
    const expected = existsSync(paths.dbPath) ? countEmbeddableEntities(paths.dbPath) : 0
    if (expected === 0) {
        // F-3: If the corpus is empty (`expected === 0`) and `LIBSQL_URL` points at an already-existing
        // empty file (e.g. 0-byte `vectors.db` with no `memoria_vectors` table yet), `inspectVectorLayer`
        // would fail with `read_failed` (`no such table: memoria_vectors`). Initialize the empty native
        // vector table so `inspectVectorLayer` and `doctor` measure `embedded=0 expected=0 missing=0`.
        const libsqlUrl = (env.LIBSQL_URL ?? process.env.LIBSQL_URL)?.trim() ?? ''
        if (libsqlUrl.startsWith('file:')) {
            const vecFilePath = libsqlUrl.slice('file:'.length)
            if (existsSync(vecFilePath) && inspectVectorLayer(paths.dbPath).coverage === null) {
                const helperDir = path.join(runtimeLayout.runtimeRoot, 'skills', 'memoria-vector')
                const initRes = await runChild(
                    process.execPath,
                    [
                        '--input-type=module',
                        '-e',
                        `import { importDep } from './deps.mjs'; import { DIM } from './embed.mjs'; const { createClient } = await importDep('@libsql/client'); const db = createClient({ url: process.env.LIBSQL_URL, authToken: process.env.LIBSQL_AUTH_TOKEN }); try { await db.execute(\`CREATE TABLE IF NOT EXISTS memoria_vectors (name TEXT PRIMARY KEY, kind TEXT, text TEXT, updated_at TEXT, v F32_BLOB(\${DIM}))\`); await db.execute('CREATE INDEX IF NOT EXISTS memoria_vectors_idx ON memoria_vectors (libsql_vector_idx(v))'); } finally { db.close(); }`
                    ],
                    { cwd: helperDir, env, timeoutMs: 60_000 }
                )
                if (!initRes.ok) {
                    throw new Error(`vector store initialization failed (${initRes.status}): ${initRes.stderr.trim() || initRes.stdout.trim()}`)
                }
            }
        }
        return { embedded: 0, expected: 0, missing: 0 }
    }

    const buildScript = path.join(
        runtimeLayout.runtimeRoot,
        'skills',
        'memoria-memory-sync',
        'scripts',
        'build-mcp-bridge-payload.mjs'
    )
    const ingestScript = path.join(
        runtimeLayout.runtimeRoot,
        'skills',
        'memoria-vector',
        'vector-ingest.mjs'
    )

    if (!existsSync(buildScript)) throw new Error(`bridge payload script missing: ${buildScript}`)
    if (!existsSync(ingestScript)) throw new Error(`vector ingest script missing: ${ingestScript}`)

    const tmpOut = await fs.mkdtemp(path.join(os.tmpdir(), 'memoria-setup-ingest-'))
    const syncTarget = `memoria-setup-full-${Date.now()}-${process.pid}`
    const timeoutMs = 10 * 60_000
    try {
        const buildRes = await runChild(
            process.execPath,
            [
                buildScript,
                '--memoria-home', paths.memoriaHome,
                '--sync-target', syncTarget,
                '--payload-mode', 'full',
                '--out', tmpOut
            ],
            { env, timeoutMs }
        )
        if (!buildRes.ok) {
            throw new Error(`bridge payload build failed (${buildRes.status}): ${buildRes.stderr.trim() || buildRes.stdout.trim()}`)
        }
        const payloadPath = buildRes.stdout.trim().split('\n').pop()?.trim()
        if (!payloadPath || !existsSync(payloadPath)) {
            throw new Error('bridge payload script did not produce a payload file')
        }

        const ingestRes = await runChild(process.execPath, [ingestScript, payloadPath], { env, timeoutMs })
        if (!ingestRes.ok) {
            throw new Error(`vector ingest failed (${ingestRes.status}): ${ingestRes.stderr.trim() || ingestRes.stdout.trim()}`)
        }
    } finally {
        await fs.rm(tmpOut, { recursive: true, force: true })
    }

    const afterReport = inspectVectorLayer(paths.dbPath)
    if (!afterReport.coverage) {
        throw new Error(
            `vector coverage could not be verified after ingest (${afterReport.coverageUnknownReason ?? 'unknown'})`
        )
    }
    if (afterReport.coverage.missing > 0) {
        throw new Error(
            `vector coverage incomplete after ingest: embedded=${afterReport.coverage.embedded} ` +
            `expected=${afterReport.coverage.expected} missing=${afterReport.coverage.missing}`
        )
    }
    return afterReport.coverage
}

/**
 * Verify end-to-end vector recall routing without polluting the user's real memory database (SCN-006, SCN-007, SCN-013).
 *
 * Always runs a synthetic memory + paraphrase query inside an isolated temporary root & vector DB to
 * verify the embedding model, libSQL vector store, and recall VectorRow mapping without adding any
 * session, event, or telemetry row to the user's real DB.
 * When the real DB already has memories (`expected > 0`), also verifies that the real DB's vector coverage
 * has `missing === 0` and `embedded === expected`.
 */
export async function verifyVectorReadiness(
    realPaths: MemoriaPaths,
    runtimeLayout: RuntimeLayout,
    env: NodeJS.ProcessEnv = process.env
): Promise<{ corpusVerified: boolean; isolatedProbeVerified: boolean; routeMode: string; expected: number; embedded: number }> {
    const report = inspectVectorLayer(realPaths.dbPath)
    if (!report.enabled) {
        throw new Error('vector recall is not enabled (LIBSQL_URL unset)')
    }
    if (!report.helperPath) {
        throw new Error('vector helper script not found')
    }
    if (report.embedderInstalled === false) {
        throw new Error('vector embedder (@huggingface/transformers) is not installed')
    }
    const realExpected = existsSync(realPaths.dbPath) ? countEmbeddableEntities(realPaths.dbPath) : 0
    if (!report.coverage) {
        throw new Error(
            `vector coverage could not be verified (${report.coverageUnknownReason ?? 'unknown'})`
        )
    } else if (report.coverage.missing > 0) {
        throw new Error(
            `vector coverage is incomplete: embedded=${report.coverage.embedded} expected=${report.coverage.expected} missing=${report.coverage.missing}`
        )
    }

    const expected = report.coverage?.expected ?? realExpected
    const embedded = report.coverage?.embedded ?? 0

    // Isolated probe in a temp directory so the user's real DB never receives synthetic sessions or recall telemetry (SCN-013).
    const probeTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'memoria-vec-probe-'))
    const prevLibsql = process.env.LIBSQL_URL
    try {
        const probeHome = path.join(probeTmp, 'data')
        const probeVecDb = path.join(probeTmp, 'probe-vectors.db')
        const probePaths = resolveMemoriaPaths(probeHome, { env: { ...env, MEMORIA_DB_PATH: undefined } })
        const probeCore = new MemoriaCore(probePaths)
        await probeCore.init()
        await probeCore.rememberNote({
            text: '資料庫統一改用 SQLite 與原生設定檔保存資料位置',
            project: 'probe',
            rationale: '確保跨程序一致性且不依賴 shell 環境變數'
        })

        const probeEnv: NodeJS.ProcessEnv = {
            ...env,
            MEMORIA_HOME: probeHome,
            LIBSQL_URL: `file:${probeVecDb}`
        }
        delete probeEnv.MEMORIA_DB_PATH

        process.env.LIBSQL_URL = `file:${probeVecDb}`
        await runFullVectorIngest(probePaths, runtimeLayout, probeEnv)

        // Query using a paraphrase that does NOT share lexical tokens with the note so only vector route can match,
        // or verify route_mode is vector / hybrid_vector with fallback_used === false.
        const recallRes = await probeCore.recall({
            query: 'cross-process persistent configuration storage',
            mode: 'vector',
            top_k: 3
        })
        if (!recallRes.ok) {
            throw new Error(`vector recall probe failed: ${recallRes.error ?? 'unknown error'}`)
        }
        const meta = (recallRes.meta ?? {}) as { route_mode?: string; fallback_used?: boolean }
        const routeMode = String(meta.route_mode ?? '')
        if ((routeMode !== 'vector' && routeMode !== 'hybrid_vector') || meta.fallback_used !== false) {
            throw new Error(
                `vector recall probe degraded (route_mode=${routeMode}, fallback_used=${String(meta.fallback_used)})`
            )
        }
        if (!Array.isArray(recallRes.data) || recallRes.data.length === 0) {
            throw new Error('vector recall probe returned 0 hits')
        }

        return {
            corpusVerified: expected > 0 && embedded >= expected,
            isolatedProbeVerified: true,
            routeMode,
            expected,
            embedded
        }
    } finally {
        if (prevLibsql === undefined) delete process.env.LIBSQL_URL
        else process.env.LIBSQL_URL = prevLibsql
        await fs.rm(probeTmp, { recursive: true, force: true })
    }
}
