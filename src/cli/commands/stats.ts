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
                if (s.recallRouting) {
                    const rr = s.recallRouting
                    console.log(`- recall routing (${rr.window}):`)
                    console.log(`  - queries=${rr.totalQueries}, fallback_rate=${(rr.fallbackRate * 100).toFixed(1)}%`)
                    console.log(`  - route_counts: skipped=${rr.routeCounts.skipped}, keyword=${rr.routeCounts.keyword}, tree=${rr.routeCounts.tree}, hybrid_tree=${rr.routeCounts.hybrid_tree}, hybrid_fallback=${rr.routeCounts.hybrid_fallback}`)
                    console.log(`  - latency_ms: avg=${rr.avgLatencyMs}, p95=${rr.p95LatencyMs}`)
                    console.log(`  - avg_hit_count=${rr.avgHitCount}`)
                }
            }
        })
}
