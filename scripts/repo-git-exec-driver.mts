// Assertion driver for scripts/test-repo-git-exec.sh (issue-1 Phase 0).
// Run via `pnpm exec tsx` from the repo root: argv = <fixtureRepo> <nonGitDir> <homeDir>.

import path from 'node:path'
import fs from 'node:fs/promises'
import { runGit, GitExecError } from '../src/core/git/git-exec.js'
import { loadMemoriaConfig, defaultMemoriaConfig, CONFIG_FILE_NAME } from '../src/core/config.js'
import { getHostId } from '../src/core/git/host.js'

const [fixtureRepo, nonGitDir, homeDir] = process.argv.slice(2)
if (!fixtureRepo || !nonGitDir || !homeDir) {
    console.error('usage: tsx repo-git-exec-driver.mts <fixtureRepo> <nonGitDir> <homeDir>')
    process.exit(2)
}

function ok(label: string): void {
    console.log(`  ✓ ${label}`)
}

function fail(label: string, detail: unknown): never {
    console.error(`  ✗ ${label}: ${String(detail)}`)
    process.exit(1)
}

async function expectGitError(label: string, code: string, run: () => Promise<unknown>): Promise<void> {
    try {
        await run()
    } catch (error) {
        if (error instanceof GitExecError && error.code === code) return ok(label)
        fail(label, `expected GitExecError(${code}), got ${String(error)}`)
    }
    fail(label, `expected GitExecError(${code}), but call succeeded`)
}

// ── git-exec: allowlist + classification ────────────────────────────────────
const head = await runGit(fixtureRepo, ['rev-parse', 'HEAD'])
if (!/^[0-9a-f]{40}$/.test(head.stdout.trim())) fail('rev-parse HEAD returns sha', head.stdout)
ok('allowlisted rev-parse HEAD returns sha')

const list = await runGit(fixtureRepo, ['tag', '--list'])
ok(`tag --list allowed (${list.stdout.trim() === '' ? 'empty' : 'has tags'})`)

await expectGitError('commit rejected (write command)', 'git_command_not_allowed', () =>
    runGit(fixtureRepo, ['commit', '--allow-empty', '-m', 'nope']))
await expectGitError('tag creation rejected (list-only contract)', 'git_command_not_allowed', () =>
    runGit(fixtureRepo, ['tag', 'v9.9.9']))
await expectGitError('global-flag injection rejected', 'git_command_not_allowed', () =>
    runGit(fixtureRepo, ['-c', 'core.hooksPath=/tmp', 'status']))
await expectGitError('non-git dir classified', 'not_a_git_repository', () =>
    runGit(nonGitDir, ['rev-parse', 'HEAD']))

const ancestor = await runGit(fixtureRepo, ['merge-base', '--is-ancestor', 'HEAD', 'HEAD'], { allowExitCodes: [1] })
if (ancestor.exitCode !== 0) fail('merge-base --is-ancestor HEAD HEAD', `exit ${ancestor.exitCode}`)
ok('allowExitCodes lets boolean git answers through')

// ── config loader ────────────────────────────────────────────────────────────
const configDir = path.join(homeDir, 'configs')
const missing = await loadMemoriaConfig({ configPath: configDir })
const defaults = defaultMemoriaConfig()
if (missing.git.summarization.minimumCommits !== 2 || missing.git.summarization.promoteImportanceThreshold !== 0.7) {
    fail('missing config.json yields spec defaults', JSON.stringify(missing))
}
if (JSON.stringify(missing) !== JSON.stringify(defaults)) fail('missing config equals defaultMemoriaConfig()', '')
ok('missing config.json yields spec §27 defaults')

await fs.mkdir(configDir, { recursive: true })
const configFile = path.join(configDir, CONFIG_FILE_NAME)

await fs.writeFile(configFile, '{ not json', 'utf8')
try {
    await loadMemoriaConfig({ configPath: configDir })
    fail('malformed JSON throws', 'no error thrown')
} catch (error) {
    if (!/Invalid JSON/.test(String(error))) fail('malformed JSON throws descriptive error', error)
    ok('malformed JSON throws descriptive error')
}

await fs.writeFile(configFile, JSON.stringify({ git: { summarization: { minimumCommits: 5 } } }), 'utf8')
const partial = await loadMemoriaConfig({ configPath: configDir })
if (partial.git.summarization.minimumCommits !== 5) fail('override applied', JSON.stringify(partial))
if (partial.git.summarization.maxDiffBytes !== 200_000 || partial.git.filters.excludePaths.length === 0) {
    fail('unspecified keys keep defaults', JSON.stringify(partial))
}
ok('partial config merges with defaults')

await fs.writeFile(configFile, JSON.stringify({ git: { summarization: { promoteImportanceThreshold: 3 } } }), 'utf8')
try {
    await loadMemoriaConfig({ configPath: configDir })
    fail('schema violation throws', 'no error thrown')
} catch (error) {
    if (!/Invalid config/.test(String(error))) fail('schema violation throws descriptive error', error)
    ok('schema violation throws descriptive error')
}

// ── host id ──────────────────────────────────────────────────────────────────
const memoryDir = path.join(homeDir, '.memory')
const first = await getHostId(memoryDir)
const second = await getHostId(memoryDir)
if (!/^[0-9a-f-]{36}$/.test(first)) fail('host id is a UUID', first)
if (first !== second) fail('host id is stable across calls', `${first} != ${second}`)
ok('host id generated once and stable')

console.log('  driver: all assertions passed')
