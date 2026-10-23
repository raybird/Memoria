// Inner-loop unit assertions for Task 1.1 (SCN-003, SCN-009, SCN-012):
// - Platform install-settings path resolution (Linux XDG, macOS Application Support, Windows APPDATA, explicit override)
// - Atomic write & Zod validation of user install settings
// - Never persisting auth tokens (LIBSQL_AUTH_TOKEN stripped/rejected)
// - Precedence order: explicit override > MEMORIA_HOME > local cwd > saved global default > fallback
// - Effective vector environment derivation (follows effective dataRoot unless overridden by env)
// - DB path mismatch guard for vector ingest

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
    resolveInstallSettingsPath,
    loadInstallSettingsSync,
    saveInstallSettings,
    resolveEffectiveVectorEnv,
    applyEffectiveVectorEnv,
    getExplicitVectorEnv,
    assertIngestDbPathMatchesRoot
} from '../src/core/install-settings.js'
import { resolveMemoriaHomeInfo, resolveMemoriaPaths, detectLocalMemoriaRoot } from '../src/core/paths.js'
import { countEmbeddableEntities } from '../src/core/recall-vector.js'

let failures = 0

function ok(label: string): void {
    console.log(`  ✓ ${label}`)
}

function fail(label: string, detail: string): void {
    console.error(`  ✗ ${label}: ${detail}`)
    failures += 1
}

function eq(label: string, actual: unknown, expected: unknown): void {
    if (Object.is(actual, expected)) ok(label)
    else fail(label, `expected ${String(expected)}, got ${String(actual)}`)
}

async function main(): Promise<void> {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'memoria-t11-'))
    try {
        console.log('[driver] platform install-settings path resolution (SCN-014 / Task 1.1)')
        eq(
            'explicit MEMORIA_USER_CONFIG_PATH wins on any platform',
            resolveInstallSettingsPath({ platform: 'linux', homedir: '/home/u', env: { MEMORIA_USER_CONFIG_PATH: '/custom/install.json' } }),
            path.resolve('/custom/install.json')
        )
        eq(
            'linux uses XDG_CONFIG_HOME when absolute',
            resolveInstallSettingsPath({ platform: 'linux', homedir: '/home/u', env: { XDG_CONFIG_HOME: '/xdg/cfg' } }),
            path.join('/xdg/cfg', 'memoria', 'install.json')
        )
        eq(
            'linux ignores relative XDG_CONFIG_HOME and falls back to ~/.config',
            resolveInstallSettingsPath({ platform: 'linux', homedir: '/home/u', env: { XDG_CONFIG_HOME: 'relative/cfg' } }),
            path.join('/home/u', '.config', 'memoria', 'install.json')
        )
        eq(
            'darwin uses ~/Library/Application Support/memoria/install.json',
            resolveInstallSettingsPath({ platform: 'darwin', homedir: '/Users/u', env: {} }),
            path.join('/Users/u', 'Library', 'Application Support', 'memoria', 'install.json')
        )
        eq(
            'win32 uses APPDATA when present',
            resolveInstallSettingsPath({ platform: 'win32', homedir: 'C:\\Users\\u', env: { APPDATA: 'C:\\Users\\u\\AppData\\Roaming' } }),
            path.join('C:\\Users\\u\\AppData\\Roaming', 'memoria', 'install.json')
        )

        console.log('[driver] save & load install settings + token non-persistence (SCN-002, SCN-012)')
        const cfgFile = path.join(tmp, 'cfg', 'install.json')
        const envBase: NodeJS.ProcessEnv = { MEMORIA_USER_CONFIG_PATH: cfgFile }
        eq('missing install.json returns null', loadInstallSettingsSync({ env: envBase }), null)

        const globalRoot = path.join(tmp, 'global-data')
        await saveInstallSettings(
            {
                version: 1,
                defaultDataRoot: globalRoot,
                hosts: ['claude-code', 'codex'],
                vector: {
                    enabled: true,
                    provider: 'local'
                },
                updatedAt: '2026-10-23T00:00:00.000Z'
            },
            { env: { ...envBase, LIBSQL_AUTH_TOKEN: 'secret-token-must-not-be-saved' } }
        )
        const rawSaved = await fs.readFile(cfgFile, 'utf8')
        if (rawSaved.includes('secret-token-must-not-be-saved') || rawSaved.includes('authToken')) {
            fail('token non-persistence', 'install.json leaked auth token')
        } else {
            ok('install.json never persists LIBSQL_AUTH_TOKEN')
        }

        const loaded = loadInstallSettingsSync({ env: envBase })
        eq('loaded defaultDataRoot matches saved', loaded?.defaultDataRoot, path.resolve(globalRoot))
        eq('loaded vector.enabled matches saved', loaded?.vector?.enabled, true)

        console.log('[driver] data-root precedence: explicit > env > local detected > global-config > fallback (SCN-002, SCN-003, SCN-012)')
        const emptyCwd = path.join(tmp, 'empty-cwd')
        const localCwd = path.join(tmp, 'local-cwd')
        const nestedCwd = path.join(tmp, 'nested-cwd')
        await fs.mkdir(emptyCwd, { recursive: true })
        await fs.mkdir(path.join(localCwd, '.memory'), { recursive: true })
        await fs.mkdir(path.join(nestedCwd, 'memoria', 'knowledge'), { recursive: true })

        const resGlobal = resolveMemoriaHomeInfo({ cwd: emptyCwd, env: envBase })
        eq('empty cwd with saved global config -> source=global-config', resGlobal.source, 'global-config')
        eq('empty cwd with saved global config -> home=globalRoot', resGlobal.home, path.resolve(globalRoot))

        const resLocal = resolveMemoriaHomeInfo({ cwd: localCwd, env: envBase })
        eq('cwd with .memory beats global-config -> source=detected', resLocal.source, 'detected')
        eq('cwd with .memory -> home=localCwd', resLocal.home, path.resolve(localCwd))

        const resNested = resolveMemoriaHomeInfo({ cwd: nestedCwd, env: envBase })
        eq('cwd with ./memoria/knowledge beats global-config -> source=detected', resNested.source, 'detected')
        eq('cwd with ./memoria/knowledge -> home=nestedCwd/memoria', resNested.home, path.join(nestedCwd, 'memoria'))

        const envOverrideRoot = path.join(tmp, 'env-override')
        const resEnv = resolveMemoriaHomeInfo({
            cwd: localCwd,
            env: { ...envBase, MEMORIA_HOME: envOverrideRoot }
        })
        eq('MEMORIA_HOME beats local detected and global-config -> source=env', resEnv.source, 'env')
        eq('MEMORIA_HOME -> home=envOverrideRoot', resEnv.home, path.resolve(envOverrideRoot))

        const explicitPaths = resolveMemoriaPaths(path.join(tmp, 'explicit-arg'), {
            cwd: localCwd,
            env: { ...envBase, MEMORIA_HOME: envOverrideRoot }
        })
        eq('explicit memoriaHomeOverride beats MEMORIA_HOME', explicitPaths.memoriaHome, path.join(tmp, 'explicit-arg'))

        console.log('[driver] vector store follows effective data root & respects env overrides (SCN-012)')
        const vecGlobal = resolveEffectiveVectorEnv(globalRoot, { env: envBase })
        eq(
            'when vector enabled in settings and LIBSQL_URL unset, derives file:<effectiveDataRoot>/.memory/vectors.db',
            vecGlobal.libsqlUrl,
            `file:${path.join(globalRoot, '.memory', 'vectors.db')}`
        )
        eq('derives provider from settings when MEMORIA_EMBED_PROVIDER unset', vecGlobal.embedProvider, 'local')

        const switchedRoot = path.join(tmp, 'switched-root')
        const vecSwitched = resolveEffectiveVectorEnv(switchedRoot, { env: envBase })
        eq(
            'when effective data root switches to another root not in vector.roots, local vector store is not enabled (does not mix global vectors.db)',
            vecSwitched.libsqlUrl,
            undefined
        )

        // When switchedRoot IS in vector.roots, it gets its own <switchedRoot>/.memory/vectors.db (and globalRoot stays off if not in roots)
        await saveInstallSettings(
            {
                version: 1,
                defaultDataRoot: globalRoot,
                vector: {
                    enabled: true,
                    provider: 'local',
                    roots: [switchedRoot]
                },
                updatedAt: '2026-10-23T00:00:00.000Z'
            },
            { env: envBase }
        )
        const vecSwitchedEnabled = resolveEffectiveVectorEnv(switchedRoot, { env: envBase })
        eq(
            'when project root is in vector.roots, derives file:<switchedRoot>/.memory/vectors.db',
            vecSwitchedEnabled.libsqlUrl,
            `file:${path.join(switchedRoot, '.memory', 'vectors.db')}`
        )
        const vecGlobalDisabledWhenOnlyProjInRoots = resolveEffectiveVectorEnv(globalRoot, { env: envBase })
        eq(
            'when vector.roots only contains project root, defaultDataRoot is NOT implicitly vector-enabled (review-f38ce84 #7)',
            vecGlobalDisabledWhenOnlyProjInRoots.libsqlUrl,
            undefined
        )

        // Restore globalRoot in vector.roots for subsequent assertions
        await saveInstallSettings(
            {
                version: 1,
                defaultDataRoot: globalRoot,
                hosts: ['claude-code', 'codex'],
                vector: {
                    enabled: true,
                    provider: 'local',
                    roots: [globalRoot]
                },
                updatedAt: '2026-10-23T00:00:00.000Z'
            },
            { env: envBase }
        )

        // Verify getExplicitVectorEnv distinguishes auto-injected process.env from caller env (review-f38ce84 #1)
        const prevProcConfig = process.env.MEMORIA_USER_CONFIG_PATH
        const prevProcLibsql = process.env.LIBSQL_URL
        const prevProcProvider = process.env.MEMORIA_EMBED_PROVIDER
        delete process.env.LIBSQL_URL
        delete process.env.MEMORIA_EMBED_PROVIDER
        process.env.MEMORIA_USER_CONFIG_PATH = cfgFile
        try {
            applyEffectiveVectorEnv(globalRoot)
            eq(
                'applyEffectiveVectorEnv injects globalRoot LIBSQL_URL into process.env',
                process.env.LIBSQL_URL,
                `file:${path.join(globalRoot, '.memory', 'vectors.db')}`
            )
            const explicitAfterAuto = getExplicitVectorEnv(process.env)
            eq(
                'getExplicitVectorEnv treats auto-injected LIBSQL_URL as undefined (not an explicit user override)',
                explicitAfterAuto.libsqlUrl,
                undefined
            )
            applyEffectiveVectorEnv(switchedRoot)
            eq(
                're-running applyEffectiveVectorEnv on non-vector root clears auto-injected LIBSQL_URL',
                process.env.LIBSQL_URL,
                undefined
            )
        } finally {
            if (prevProcLibsql === undefined) delete process.env.LIBSQL_URL
            else process.env.LIBSQL_URL = prevProcLibsql
            if (prevProcProvider === undefined) delete process.env.MEMORIA_EMBED_PROVIDER
            else process.env.MEMORIA_EMBED_PROVIDER = prevProcProvider
            if (prevProcConfig === undefined) delete process.env.MEMORIA_USER_CONFIG_PATH
            else process.env.MEMORIA_USER_CONFIG_PATH = prevProcConfig
        }

        const vecOverridden = resolveEffectiveVectorEnv(globalRoot, {
            env: {
                ...envBase,
                LIBSQL_URL: 'file:/custom/override-vec.db',
                MEMORIA_EMBED_PROVIDER: 'stub'
            }
        })
        eq('explicit LIBSQL_URL wins over saved settings', vecOverridden.libsqlUrl, 'file:/custom/override-vec.db')
        eq('explicit MEMORIA_EMBED_PROVIDER wins over saved settings', vecOverridden.embedProvider, 'stub')

        console.log('[driver] MEMORIA_DB_PATH mismatch check (SCN-012)')
        const okPaths = resolveMemoriaPaths(globalRoot, { env: envBase })
        try {
            assertIngestDbPathMatchesRoot(okPaths)
            ok('matching dbPath passes assertIngestDbPathMatchesRoot')
        } catch (err) {
            fail('matching dbPath should pass', String(err))
        }

        const mismatchPaths = resolveMemoriaPaths(globalRoot, {
            env: { ...envBase, MEMORIA_DB_PATH: path.join(tmp, 'other.db') }
        })
        let caughtMismatch = false
        try {
            assertIngestDbPathMatchesRoot(mismatchPaths)
        } catch {
            caughtMismatch = true
        }
        eq('mismatched MEMORIA_DB_PATH throws descriptive error before ingest', caughtMismatch, true)

        console.log('[driver] multi-target host & instruction wiring assertions (SCN-004, SCN-005, SCN-008, SCN-009 / Task 2.1)')
        const { parseAgentFlag, resolveHostAgentSkillDir } = await import('../src/cli/runtime.js')
        const {
            planInstructionWiring,
            assertInstructionTargetsSafe,
            applyInstructionWiring
        } = await import('../src/cli/agent-integration.js')

        eq('parseAgentFlag("both") returns claude-code and codex', JSON.stringify(parseAgentFlag('both')), JSON.stringify(['claude-code', 'codex']))
        eq('parseAgentFlag("none") returns empty array', JSON.stringify(parseAgentFlag('none')), JSON.stringify([]))
        eq('parseAgentFlag("codex") returns ["codex"]', JSON.stringify(parseAgentFlag('codex')), JSON.stringify(['codex']))
        eq('resolveHostAgentSkillDir("codex") honors CODEX_HOME', resolveHostAgentSkillDir('codex', { env: { CODEX_HOME: '/custom/codex' } }), path.join('/custom/codex', 'skills', 'memoria'))

        // SCN-005 & SCN-008: Managed block insertion, backup, preservation of user text, idempotency, space path escaping
        const projWithSpace = path.join(tmp, 'my project dir')
        const dataWithSpace = path.join(projWithSpace, 'memoria')
        await fs.mkdir(projWithSpace, { recursive: true })
        await fs.mkdir(path.join(dataWithSpace, 'knowledge'), { recursive: true })
        const briefPath = path.join(dataWithSpace, 'knowledge', 'BRIEF.md')
        await fs.writeFile(briefPath, '# Brief\n', 'utf8')

        const agentsPath = path.join(projWithSpace, 'AGENTS.md')
        const claudePath = path.join(projWithSpace, 'CLAUDE.md')
        const originalAgents = '# User Rules\n\nAlways keep custom rule 1.\n'
        const originalClaude = '# Claude Specific\n\nCustom claude rule A.\n'
        await fs.writeFile(agentsPath, originalAgents, 'utf8')
        await fs.writeFile(claudePath, originalClaude, 'utf8')

        const plan1 = await planInstructionWiring({
            scope: 'project',
            dataRoot: dataWithSpace,
            projectRoot: projWithSpace,
            briefPath,
            hosts: ['claude-code', 'codex']
        })
        await assertInstructionTargetsSafe(plan1)
        const res1 = await applyInstructionWiring(plan1, dataWithSpace)
        eq('first wiring creates backups for existing AGENTS.md and CLAUDE.md', res1.backups.length, 2)

        const agentsAfter1 = await fs.readFile(agentsPath, 'utf8')
        const claudeAfter1 = await fs.readFile(claudePath, 'utf8')
        if (!agentsAfter1.includes('Always keep custom rule 1.') || !agentsAfter1.includes(briefPath)) {
            fail('AGENTS.md wiring', `missing original text or brief path: ${agentsAfter1}`)
        } else {
            ok('AGENTS.md preserves user rules and adds brief read instruction')
        }
        if (!claudeAfter1.includes('Custom claude rule A.') || !claudeAfter1.includes('@AGENTS.md') || !claudeAfter1.includes('@memoria/knowledge/BRIEF.md')) {
            fail('CLAUDE.md wiring', `missing original text or @ imports: ${claudeAfter1}`)
        } else {
            ok('CLAUDE.md preserves user rules and imports @AGENTS.md + brief')
        }

        // Re-run (SCN-008): idempotent, no duplicate managed blocks
        const plan2 = await planInstructionWiring({
            scope: 'project',
            dataRoot: dataWithSpace,
            projectRoot: projWithSpace,
            briefPath,
            hosts: ['claude-code', 'codex']
        })
        await applyInstructionWiring(plan2, dataWithSpace)
        const agentsAfter2 = await fs.readFile(agentsPath, 'utf8')
        const claudeAfter2 = await fs.readFile(claudePath, 'utf8')
        eq('AGENTS.md is byte-identical on idempotent re-run', agentsAfter2, agentsAfter1)
        eq('CLAUDE.md is byte-identical on idempotent re-run', claudeAfter2, claudeAfter1)

        // Global scope with spaces in dataRoot (SCN-005): @ import escapes spaces
        const globalHomeSpace = path.join(tmp, 'home with space')
        const globalDataSpace = path.join(globalHomeSpace, '.memoria')
        const globalBriefSpace = path.join(globalDataSpace, 'knowledge', 'BRIEF.md')
        const globalPlan = await planInstructionWiring({
            scope: 'global',
            dataRoot: globalDataSpace,
            briefPath: globalBriefSpace,
            hosts: ['claude-code', 'codex'],
            homedir: globalHomeSpace,
            env: { CODEX_HOME: path.join(globalHomeSpace, '.codex') }
        })
        await assertInstructionTargetsSafe(globalPlan)
        await applyInstructionWiring(globalPlan, globalDataSpace)
        const globalClaude = await fs.readFile(path.join(globalHomeSpace, '.claude', 'CLAUDE.md'), 'utf8')
        if (!globalClaude.includes(globalBriefSpace.replace(/ /g, '\\ '))) {
            fail('global CLAUDE.md space escaping', `expected escaped path in:\n${globalClaude}`)
        } else {
            ok('global CLAUDE.md escapes spaces in @ import paths')
        }

        // SCN-009: symlink at instruction target is rejected by assertInstructionTargetsSafe
        const unsafeHome = path.join(tmp, 'unsafe-home')
        await fs.mkdir(path.join(unsafeHome, '.claude'), { recursive: true })
        const outsideTarget = path.join(tmp, 'outside.md')
        await fs.writeFile(outsideTarget, 'outside', 'utf8')
        await fs.symlink(outsideTarget, path.join(unsafeHome, '.claude', 'CLAUDE.md'))
        const unsafePlan = await planInstructionWiring({
            scope: 'global',
            dataRoot: globalDataSpace,
            briefPath: globalBriefSpace,
            hosts: ['claude-code'],
            homedir: unsafeHome
        })
        let caughtUnsafeSymlink = false
        try {
            await assertInstructionTargetsSafe(unsafePlan)
        } catch {
            caughtUnsafeSymlink = true
        }
        eq('symlink instruction file is refused before writing', caughtUnsafeSymlink, true)

        // Review-f38ce84 #2: assertHostSkillTarget & assertSetupPlanSafe reject plain file blocking ancestor
        const { assertHostSkillTarget } = await import('../src/cli/runtime.js')
        const { assertSetupPlanSafe, buildSetupPlan } = await import('../src/cli/setup-plan.js')
        const blockedCodexHome = path.join(tmp, 'blocked-codex-home')
        await fs.mkdir(blockedCodexHome, { recursive: true })
        // Put a plain file at `<blockedCodexHome>/.codex/skills` so `<blockedCodexHome>/.codex/skills/memoria` cannot be created
        await fs.mkdir(path.join(blockedCodexHome, '.codex'), { recursive: true })
        await fs.writeFile(path.join(blockedCodexHome, '.codex', 'skills'), 'not a directory', 'utf8')
        let caughtBlockedSkillAncestor = false
        try {
            await assertHostSkillTarget(path.join(blockedCodexHome, '.codex', 'skills', 'memoria'))
        } catch {
            caughtBlockedSkillAncestor = true
        }
        eq('plain file at ~/.codex/skills is rejected by assertHostSkillTarget pre-check (review-f38ce84 #2)', caughtBlockedSkillAncestor, true)

        // Plain file blocking settingsPath parent is rejected by assertSetupPlanSafe
        const blockedSettingsParent = path.join(tmp, 'blocked-settings-parent')
        await fs.writeFile(blockedSettingsParent, 'plain file', 'utf8')
        const prevUserCfg = process.env.MEMORIA_USER_CONFIG_PATH
        process.env.MEMORIA_USER_CONFIG_PATH = path.join(blockedSettingsParent, 'install.json')
        try {
            const badSettingsPlan = await buildSetupPlan({
                scope: 'global',
                dataRoot: path.join(tmp, 'safe-root'),
                hosts: [],
                vector: false,
                wireInstructions: false,
                saveSettings: true
            })
            let caughtBadSettingsParent = false
            try {
                await assertSetupPlanSafe(badSettingsPlan)
            } catch {
                caughtBadSettingsParent = true
            }
            eq('plain file blocking install.json parent is rejected by assertSetupPlanSafe (review-f38ce84 #2)', caughtBadSettingsParent, true)
        } finally {
            if (prevUserCfg === undefined) delete process.env.MEMORIA_USER_CONFIG_PATH
            else process.env.MEMORIA_USER_CONFIG_PATH = prevUserCfg
        }

        // Review-f38ce84 #5: detectLocalMemoriaRoot detects cwd/.memory, cwd/knowledge, cwd/memoria/.memory
        eq('detectLocalMemoriaRoot(localCwd) returns localCwd when cwd/.memory exists', detectLocalMemoriaRoot(localCwd), path.resolve(localCwd))
        eq('detectLocalMemoriaRoot(nestedCwd) returns nestedCwd/memoria when cwd/memoria/knowledge exists', detectLocalMemoriaRoot(nestedCwd), path.join(nestedCwd, 'memoria'))
        eq('detectLocalMemoriaRoot(emptyCwd) returns null when no local layout exists', detectLocalMemoriaRoot(emptyCwd), null)

        // Review-f38ce84 #3: countEmbeddableEntities counts corpus directly from SQLite even before vectors.db has memoria_vectors table
        const { MemoriaCore } = await import('../src/core/memoria.js')
        const countRoot = path.join(tmp, 'count-root')
        const countPaths = resolveMemoriaPaths(countRoot, { env: envBase })
        const countCore = new MemoriaCore(countPaths)
        await countCore.init()
        eq('countEmbeddableEntities is 0 on fresh empty DB', countEmbeddableEntities(countPaths.dbPath), 0)
        await countCore.rememberNote({ text: 'First embeddable decision', project: 'p1', rationale: 'r1' })
        const afterNoteCount = countEmbeddableEntities(countPaths.dbPath)
        if (afterNoteCount > 0) {
            ok(`countEmbeddableEntities returns ${afterNoteCount} (>0) directly from SQLite before any vector table exists (review-f38ce84 #3)`)
        } else {
            fail('countEmbeddableEntities', `expected >0 after rememberNote, got ${afterNoteCount}`)
        }

        console.log('[driver] review-62075c8-followup assertions (F-1, F-2, F-3)')
        const { getRuntimeLayout } = await import('../src/cli/runtime.js')
        const { runFullVectorIngest, verifyVectorReadiness } = await import('../src/cli/setup-plan.js')
        const runtimeLayout = getRuntimeLayout()

        // F-1a: plain file at <dataRoot>/.agents/skills is rejected by assertSetupPlanSafe BEFORE init
        const f1BlockedRoot = path.join(tmp, 'f1-blocked-root')
        await fs.mkdir(path.join(f1BlockedRoot, '.agents'), { recursive: true })
        await fs.writeFile(path.join(f1BlockedRoot, '.agents', 'skills'), 'plain file', 'utf8')
        const f1BlockedPlan = await buildSetupPlan({
            scope: 'project',
            dataRoot: f1BlockedRoot,
            hosts: [],
            vector: false,
            wireInstructions: false,
            saveSettings: false
        }, runtimeLayout)
        let caughtF1BlockedSkill = false
        try {
            await assertSetupPlanSafe(f1BlockedPlan)
        } catch {
            caughtF1BlockedSkill = true
        }
        eq('F-1a: plain file at <dataRoot>/.agents/skills is rejected by assertSetupPlanSafe', caughtF1BlockedSkill, true)

        // F-1b: hand-written <dataRoot>/.agents/skills/memoria/SKILL.md without deployment marks is rejected by assertSetupPlanSafe
        const f1HandRoot = path.join(tmp, 'f1-hand-root')
        await fs.mkdir(path.join(f1HandRoot, '.agents', 'skills', 'memoria'), { recursive: true })
        await fs.writeFile(path.join(f1HandRoot, '.agents', 'skills', 'memoria', 'SKILL.md'), '---\nname: custom\n---\nHand-written\n', 'utf8')
        const f1HandPlan = await buildSetupPlan({
            scope: 'project',
            dataRoot: f1HandRoot,
            hosts: [],
            vector: false,
            wireInstructions: false,
            saveSettings: false
        }, runtimeLayout)
        let caughtF1HandSkill = false
        try {
            await assertSetupPlanSafe(f1HandPlan)
        } catch {
            caughtF1HandSkill = true
        }
        eq('F-1b: unmarked <dataRoot>/.agents/skills/memoria/SKILL.md is rejected by assertSetupPlanSafe', caughtF1HandSkill, true)

        // F-1c: symlink at <dataRoot>/.memory is rejected by assertSetupPlanSafe
        const f1SymRoot = path.join(tmp, 'f1-sym-root')
        const f1OutsideMem = path.join(tmp, 'f1-outside-mem')
        await fs.mkdir(f1SymRoot, { recursive: true })
        await fs.mkdir(f1OutsideMem, { recursive: true })
        await fs.symlink(f1OutsideMem, path.join(f1SymRoot, '.memory'))
        const f1SymPlan = await buildSetupPlan({
            scope: 'project',
            dataRoot: f1SymRoot,
            hosts: [],
            vector: false,
            wireInstructions: false,
            saveSettings: false
        }, runtimeLayout)
        let caughtF1SymMemory = false
        try {
            await assertSetupPlanSafe(f1SymPlan)
        } catch {
            caughtF1SymMemory = true
        }
        eq('F-1c: symlink at <dataRoot>/.memory is rejected by assertSetupPlanSafe', caughtF1SymMemory, true)

        // F-2: <HOME>/.codex is a symlink to an unselected directory that ALREADY contains a real `skills/` subdir and `AGENTS.md` file
        const f2Home = path.join(tmp, 'f2-home')
        const f2Unselected = path.join(tmp, 'f2-unselected-host')
        await fs.mkdir(f2Home, { recursive: true })
        await fs.mkdir(path.join(f2Unselected, 'skills'), { recursive: true })
        await fs.writeFile(path.join(f2Unselected, 'AGENTS.md'), '# Unselected Host Rules\n', 'utf8')
        await fs.symlink(f2Unselected, path.join(f2Home, '.codex'))

        let caughtF2Skill = false
        try {
            await assertHostSkillTarget(path.join(f2Home, '.codex', 'skills', 'memoria'))
        } catch {
            caughtF2Skill = true
        }
        eq('F-2a: assertHostSkillTarget rejects ~/.codex/skills/memoria when ~/.codex is a symlink even if skills/ exists', caughtF2Skill, true)

        const f2InstrPlan = await planInstructionWiring({
            scope: 'global',
            dataRoot: path.join(f2Home, '.memoria'),
            briefPath: path.join(f2Home, '.memoria', 'knowledge', 'BRIEF.md'),
            hosts: ['codex'],
            homedir: f2Home,
            env: { HOME: f2Home }
        })
        let caughtF2Instr = false
        try {
            await assertInstructionTargetsSafe(f2InstrPlan)
        } catch {
            caughtF2Instr = true
        }
        eq('F-2b: assertInstructionTargetsSafe rejects ~/.codex/AGENTS.md when ~/.codex is a symlink even if AGENTS.md exists', caughtF2Instr, true)

        // F-3: Empty corpus (expected=0) with a pre-existing 0-byte vector DB file initializes memoria_vectors so verifyVectorReadiness succeeds
        const f3Root = path.join(tmp, 'f3-empty-root')
        const f3Paths = resolveMemoriaPaths(f3Root, { env: envBase })
        const f3Core = new MemoriaCore(f3Paths)
        await f3Core.init()
        const f3EmptyVecDb = path.join(f3Root, '.memory', 'vectors.db')
        await fs.writeFile(f3EmptyVecDb, '', 'utf8')
        const prevLibsql = process.env.LIBSQL_URL
        const prevProvider = process.env.MEMORIA_EMBED_PROVIDER
        process.env.LIBSQL_URL = `file:${f3EmptyVecDb}`
        process.env.MEMORIA_EMBED_PROVIDER = 'stub'
        try {
            const f3Env = { ...process.env, LIBSQL_URL: `file:${f3EmptyVecDb}`, MEMORIA_EMBED_PROVIDER: 'stub' }
            const f3Ingest = await runFullVectorIngest(f3Paths, runtimeLayout, f3Env)
            eq('F-3a: runFullVectorIngest on empty corpus returns missing=0', f3Ingest.missing, 0)
            let f3ReadyOk = false
            try {
                const f3Ready = await verifyVectorReadiness(f3Paths, runtimeLayout, f3Env)
                f3ReadyOk = f3Ready.isolatedProbeVerified === true && f3Ready.expected === 0 && f3Ready.embedded === 0
            } catch {
                f3ReadyOk = false
            }
            eq('F-3b: verifyVectorReadiness succeeds on empty corpus even when vectors.db started as a 0-byte file', f3ReadyOk, true)
        } finally {
            if (prevLibsql === undefined) delete process.env.LIBSQL_URL
            else process.env.LIBSQL_URL = prevLibsql
            if (prevProvider === undefined) delete process.env.MEMORIA_EMBED_PROVIDER
            else process.env.MEMORIA_EMBED_PROVIDER = prevProvider
        }
    } finally {
        await fs.rm(tmp, { recursive: true, force: true })
    }

    if (failures > 0) {
        console.error(`[driver] ${failures} assertion(s) failed`)
        process.exit(1)
    }
    console.log('[driver] all assertions passed')
}

main().catch((err) => {
    console.error(err)
    process.exit(1)
})
