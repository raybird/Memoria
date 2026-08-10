import type { Command } from 'commander'
import type { MemoriaCore, MemoriaPaths } from '../../core/index.js'

export function registerStatsCommand(program: Command, paths: MemoriaPaths, core: MemoriaCore): void {
    program
        .command('stats')
        .description('Show session, event, and skill statistics')
        .option('--json', 'Machine-readable JSON output')
        .action(async (opts: { json?: boolean }) => {
            const result = await core.stats()
            if (!result.ok) throw new Error(result.error)
            const s = result.data!

            if (opts.json) {
                console.log(JSON.stringify(result))
            } else {
                console.log('📊 Memoria Stats')
                console.log(`- db path: ${paths.dbPath}`)
                console.log(`- sessions: ${s.sessions}`)
                console.log(`- events: ${s.events}`)
                console.log(`- skills: ${s.skills}`)
                if (s.lastSession) {
                    console.log(`- last session: ${s.lastSession.id} (${s.lastSession.project}, ${s.lastSession.timestamp})`)
                }
                if (s.topSkills.length > 0) {
                    console.log('- top skills:')
                    for (const skill of s.topSkills) {
                        console.log(`  - ${skill.name}: uses=${skill.use_count}, success=${(skill.success_rate * 100).toFixed(1)}%`)
                    }
                }
                // Only speak up when the index is actually behind — a fully-indexed corpus says nothing.
                if (s.memoryIndex && s.memoryIndex.missing > 0) {
                    console.log(`- ⚠ memory index: ${s.memoryIndex.indexed}/${s.memoryIndex.sessions} sessions indexed (${s.memoryIndex.missing} missing)`)
                    console.log(`  ↳ tree recall and MCP bridge payload skip unindexed sessions — run "memoria index build"`)
                }
                if (s.recallRouting) {
                    const rr = s.recallRouting
                    console.log(`- recall routing (${rr.window}):`)
                    console.log(`  - queries=${rr.totalQueries}, fallback_rate=${(rr.fallbackRate * 100).toFixed(1)}%`)
                    console.log(`  - route_counts: skipped=${rr.routeCounts.skipped}, keyword=${rr.routeCounts.keyword}, tree=${rr.routeCounts.tree}, hybrid_tree=${rr.routeCounts.hybrid_tree}, hybrid_fallback=${rr.routeCounts.hybrid_fallback}`)
                    // Semantic route counters appear only once vector mode has been used — the
                    // default stats output stays identical for Memoria-only deployments.
                    const vecTotal = rr.routeCounts.vector + rr.routeCounts.hybrid_vector + rr.routeCounts.vector_unavailable + rr.routeCounts.vector_timeout
                    if (vecTotal > 0) {
                        console.log(`  - vector_routes: vector=${rr.routeCounts.vector}, hybrid_vector=${rr.routeCounts.hybrid_vector}, unavailable=${rr.routeCounts.vector_unavailable}, timeout=${rr.routeCounts.vector_timeout}`)
                    }
                    console.log(`  - latency_ms: avg=${rr.avgLatencyMs}, p95=${rr.p95LatencyMs}`)
                    console.log(`  - avg_hit_count=${rr.avgHitCount}`)
                    if (rr.calibration && rr.calibration.scoredQueries > 0) {
                        const cal = rr.calibration
                        const monoLabel = cal.monotonic === null ? 'n/a' : cal.monotonic ? 'yes' : 'no'
                        console.log(`  - calibration (confidence→utility): scored=${cal.scoredQueries}, monotonic=${monoLabel}`)
                        for (const b of cal.buckets) {
                            console.log(`    - conf ${b.range}: n=${b.count}, mean_conf=${b.meanConfidence}, mean_utility=${b.meanUtility}`)
                        }
                    }
                    // Utility per route — the comparison that answers "does semantic beat lexical?".
                    // Appears only once outcomes exist; `uplift` stays null until two routes are scored,
                    // because a single route has nothing to be better than.
                    if (rr.routeUtility && rr.routeUtility.scoredQueries > 0) {
                        const ru = rr.routeUtility
                        const verdict = ru.best !== null && ru.uplift !== null
                            ? `best=${ru.best} (+${ru.uplift})`
                            : 'best=n/a (需要至少兩種 route 有 outcome 才能比較)'
                        console.log(`  - route_utility: scored=${ru.scoredQueries}, ${verdict}`)
                        for (const r of ru.routes) {
                            console.log(`    - ${r.route_mode}: n=${r.scoredQueries}, mean_utility=${r.meanUtility}, mean_conf=${r.meanConfidence}`)
                        }
                    }
                }
            }
        })
}
