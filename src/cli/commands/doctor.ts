import path from 'node:path'
import type { Command } from 'commander'
import { existsSync, inspectVectorLayer, resolveMemoriaHomeInfo } from '../../core/index.js'
import type { MemoriaPaths, VectorLayerReport } from '../../core/index.js'
import { quoteShellArg } from '../runtime.js'

type DoctorCheck = { name: string; ok: boolean; value: string; fix?: string }

/** Semantic recall is the piece most likely to break silently across an upgrade or a redeploy
 * (issue-12): the helper can be missing, or present but without an embedding backend, and either way
 * `recall` fails open and returns lexical results that look perfectly reasonable.
 *
 * The hard rule here is that **an opt-in feature that is switched off is not unhealthy**. `ok` is
 * `checks.every(...)`, so counting an unset LIBSQL_URL as a failure would hand a red light to every
 * user who never wanted semantic recall — which trains people to ignore doctor, and that is worse
 * than not checking at all. Same judgement as issue-7's on `verify`.
 */
function vectorChecks(report: VectorLayerReport, paths: MemoriaPaths): DoctorCheck[] {
    if (!report.enabled) {
        return [{ name: 'vector recall', ok: true, value: 'not enabled (LIBSQL_URL unset)' }]
    }

    const checks: DoctorCheck[] = [{
        name: 'vector recall',
        ok: true,
        value: `enabled (provider=${report.provider})`
    }]

    // Report the override explicitly: without this line a reader cannot tell whether the helper
    // being diagnosed is the one this install ships or one someone else pointed us at.
    if (report.override) {
        checks.push({ name: 'vector helper (overridden)', ok: true, value: report.override })
    }

    checks.push({
        name: 'vector helper',
        ok: report.helperPath !== null,
        value: report.helperPath ?? 'not found',
        fix: report.helperPath !== null ? undefined :
            'LIBSQL_URL is set but skills/memoria-vector/vector-recall.mjs was not found next to this ' +
            'install, so recall silently falls back to lexical results (route_mode=vector_unavailable). ' +
            'Reinstall from npm (the package ships the helper), or set MEMORIA_VECTOR_RECALL_CMD to its path.'
    })

    if (report.embedderInstalled === false && report.embedderSource !== 'sibling') {
        // issue-25: the global-install shape. Nothing next to the helper, so the remedy is the user
        // cache — an in-place `npm install` here is exactly what the next `npm i -g` wipes again.
        const target = report.embedderCacheDir ?? 'the user cache (~/.cache/memoria/vector)'
        checks.push({
            name: 'vector embedder',
            ok: false,
            value: report.embedderSource === 'cache'
                ? `@huggingface/transformers missing in ${report.embedderDir}`
                : `no dependency install for this helper (none beside it, none in ${target})`,
            fix: 'MEMORIA_EMBED_PROVIDER=local needs @huggingface/transformers. Run "memoria setup --vector": ' +
                `it installs the helper's dependencies into ${target}, which "npm i -g" upgrades do not touch, ` +
                'and warms the model once — the first load can outlast the recall timeout (route_mode=vector_timeout). ' +
                "It only needs re-running when an upgrade changes the helper's dependency set. " +
                'Run it with MEMORIA_HOME set (or pass --memoria-home): setup also initializes the data root, ' +
                'and without either it creates ./memoria in the current directory. ' +
                'Or set MEMORIA_EMBED_PROVIDER=stub.'
        })
    } else if (report.embedderInstalled === false) {
        checks.push({
            name: 'vector embedder',
            ok: false,
            value: `@huggingface/transformers missing in ${report.embedderDir}`,
            fix: 'MEMORIA_EMBED_PROVIDER=local needs @huggingface/transformers, which is a devDependency ' +
                'of the helper — "npm install --omit=dev" and NODE_ENV=production both skip it, and on a global ' +
                'install every "npm i -g" upgrade replaces this directory, wiping it together with the cached model. Run ' +
                `"npm install" (without --omit=dev) inside ${report.embedderDir}, again after each upgrade, ` +
                `then warm the model once there with: echo '{"query":"warm up"}' | node vector-recall.mjs — ` +
                'the first run downloads and loads it and can outlast the recall timeout (route_mode=vector_timeout). ' +
                'Or set MEMORIA_EMBED_PROVIDER=stub.'
        })
    } else if (report.embedderInstalled === true) {
        checks.push({ name: 'vector embedder', ok: true, value: `@huggingface/transformers installed (${report.embedderDir})` })
    } else if (report.embedderUnknownReason === 'overridden_helper') {
        // Say the check was skipped instead of omitting the line. Whoever set an override is the most
        // likely person to be missing the embedder, and an absent line reads as "nothing to report"
        // rather than "not checked" — the failure mode this whole section exists to prevent.
        checks.push({
            name: 'vector embedder',
            ok: true,
            value: 'not checked (helper overridden; its dependency layout is not ours to assume)'
        })
    }

    // issue-18: the failure that actually happened twice is not an empty store, it is a store that
    // is SHORT — and nothing reported it. Once (before issue-7) the bridge payload narrowed to 3 of
    // 10 sessions while ingest still answered {"ok":true}; again in 2026-08 when one new memory's
    // node existed but was never embedded, leaving semantic recall blind to it for 11 days with no
    // signal anywhere. A coverage number turns both into something a person can see.
    if (report.coverage) {
        const { embedded, expected, missing } = report.coverage
        checks.push({
            name: 'vector coverage',
            ok: missing === 0,
            value: `embedded=${embedded} expected=${expected} missing=${missing}`,
            fix: missing === 0 ? undefined :
                `${missing} memories are not in the vector index, so semantic recall cannot see them — ` +
                'and that degrades silently (the helper answers "ok" with zero rows). ' + ingestFix(report.helperPath, paths)
        })
    } else if (report.coverageUnknownReason === 'remote_libsql') {
        // Named rather than omitted, for the same reason the overridden-helper skip is named.
        checks.push({
            name: 'vector coverage',
            ok: true,
            value: 'not measured (remote libSQL; only file: URLs can be counted locally)'
        })
    } else if (report.coverageUnknownReason === 'overridden_helper') {
        checks.push({
            name: 'vector coverage',
            ok: true,
            value: 'not measured (helper overridden; the index may not be filled by our ingest path)'
        })
    } else if (report.coverageUnknownReason === 'read_failed' || report.coverageUnknownReason === 'no_local_db') {
        checks.push({
            name: 'vector coverage',
            ok: true,
            value: `not measured (${report.coverageUnknownReason})`
        })
    }

    return checks
}

/** issue-27: the coverage fix is followed by an agent, which can only run what is printed. So it is one
 *  command with real paths, not a description: the payload goes to a temporary directory, not the data
 *  root (the builder's default), and the exit status is ingest's, so a failure is not hidden by the
 *  cleanup that follows it. It runs in a subshell so pasting it does not overwrite the caller's D or S.
 *
 *  `--sync-target` names a target nothing ever commits a cursor for. The builder only takes nodes newer
 *  than its target's cursor, and run-sync-with-enhancement.sh advances the default target's cursor after
 *  an MCP ingest whether or not the vector ingest kept up — so with the default, this command would exit
 *  0, embed nothing, and leave `missing` where it was (review d22e5cb S-1). */
function ingestFix(helperPath: string | null, paths: MemoriaPaths): string {
    if (!helperPath) return 'Re-run the ingest two-step once the vector helper resolves (see "vector helper" above).'
    // The builder always reads <home>/.memory/sessions.db. Under a MEMORIA_DB_PATH pointing elsewhere a
    // runnable command would embed a different corpus — and, if the counts happen to match, turn this
    // check green over memories that never reached the index (review d22e5cb S-2).
    if (path.resolve(paths.dbPath) !== path.resolve(paths.memoriaHome, '.memory', 'sessions.db')) {
        return `MEMORIA_DB_PATH points at ${paths.dbPath}, but the ingest two-step reads ` +
            `${path.join(paths.memoriaHome, '.memory', 'sessions.db')}, so no command is printed here. ` +
            'Run the two-step against a data root whose .memory/sessions.db is that database.'
    }
    // Coverage is only measured when the helper is ours, not an override (inspectVectorLayer), so
    // helperPath is <package>/skills/memoria-vector/vector-recall.mjs and its grandparent is skills/.
    const skillsRoot = path.dirname(path.dirname(helperPath))
    const build = quoteShellArg(path.join(skillsRoot, 'memoria-memory-sync', 'scripts', 'build-mcp-bridge-payload.mjs'))
    const ingest = quoteShellArg(path.join(skillsRoot, 'memoria-vector', 'vector-ingest.mjs'))
    return 'Run it in the same environment as this doctor (LIBSQL_URL, MEMORIA_EMBED_PROVIDER). ' +
        'Run: (D=$(mktemp -d) && ' +
        `node ${build} --memoria-home ${quoteShellArg(paths.memoriaHome)} --sync-target memoria-doctor-repair --out "$D" >/dev/null && ` +
        `node ${ingest} "$D"/*.json; S=$?; rm -rf "$D"; exit $S)`
}

export function registerDoctorCommand(program: Command, paths: MemoriaPaths): void {
    program
        .command('doctor')
        .description('Check local runtime and directory health')
        .option('--json', 'Machine-readable JSON output')
        .action(async (opts: { json?: boolean }) => {
            const envDetails = [
                `- MEMORIA_DB_PATH=${process.env.MEMORIA_DB_PATH ?? '(not set)'}`,
                `- MEMORIA_SESSIONS_PATH=${process.env.MEMORIA_SESSIONS_PATH ?? '(not set)'}`,
                `- MEMORIA_CONFIG_PATH=${process.env.MEMORIA_CONFIG_PATH ?? '(not set)'}`
            ]

            // Did we land on a real data root, or silently fall back to the runtime root?
            // A fallback means this folder was never set up — warn instead of pretending it is healthy.
            const homeInfo = resolveMemoriaHomeInfo()
            const homeFix =
                `This folder has no Memoria memory yet (resolved by ${homeInfo.source}). ` +
                `Run "memoria setup --memoria-home <path>" here, or set MEMORIA_HOME to an initialized data root ` +
                `before syncing — otherwise writes land in the runtime root.`
            const homeOk = homeInfo.source !== 'fallback'

            const checks: DoctorCheck[] = [
                { name: 'MEMORIA_HOME', ok: homeOk, value: `${paths.memoriaHome} (${homeInfo.source})`, fix: homeOk ? undefined : homeFix },
                { name: 'memory dir', ok: existsSync(paths.memoryDir), value: paths.memoryDir },
                { name: 'knowledge dir', ok: existsSync(paths.knowledgeDir), value: paths.knowledgeDir },
                { name: 'sessions path', ok: existsSync(paths.sessionsPath), value: paths.sessionsPath },
                { name: 'config path', ok: existsSync(paths.configPath), value: paths.configPath },
                { name: 'sessions.db', ok: existsSync(paths.dbPath), value: paths.dbPath },
                ...vectorChecks(inspectVectorLayer(paths.dbPath), paths)
            ]

            if (opts.json) {
                console.log(JSON.stringify({ ok: checks.every((c) => c.ok), homeSource: homeInfo.source, paths, checks }))
            } else {
                console.log('Resolved path envs:')
                for (const line of envDetails) console.log(line)
                for (const c of checks) {
                    console.log(`${c.ok ? '✓' : '✗'} ${c.name}: ${c.value}`)
                    if (!c.ok && c.fix) console.log(`  ↳ fix: ${c.fix}`)
                }
            }
        })
}
