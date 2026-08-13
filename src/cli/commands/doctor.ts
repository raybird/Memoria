import type { Command } from 'commander'
import { existsSync, inspectVectorLayer, resolveMemoriaHomeInfo } from '../../core/index.js'
import type { MemoriaPaths, VectorLayerReport } from '../../core/index.js'

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
function vectorChecks(report: VectorLayerReport): DoctorCheck[] {
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

    if (report.embedderInstalled === false) {
        checks.push({
            name: 'vector embedder',
            ok: false,
            value: `@huggingface/transformers missing in ${report.embedderDir}`,
            fix: 'MEMORIA_EMBED_PROVIDER=local needs @huggingface/transformers, which is a devDependency ' +
                'of the helper — "npm install --omit=dev" and NODE_ENV=production both skip it. Run ' +
                `"npm install" (without --omit=dev) inside ${report.embedderDir}, or set MEMORIA_EMBED_PROVIDER=stub.`
        })
    } else if (report.embedderInstalled === true) {
        checks.push({ name: 'vector embedder', ok: true, value: '@huggingface/transformers installed' })
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

    return checks
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
                ...vectorChecks(inspectVectorLayer())
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
