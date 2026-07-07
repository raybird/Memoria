import { existsSync } from '../paths.js'
import { shortHash, normalizeSkillKey, parseCreatedAt, tokenizeQuery, buildCalibration } from '../utils.js'
import { parseDecisionEvent, parseSkillEvent } from '../extract.js'
import { initDatabase } from './schema.js'
import { withDb } from './connection.js'
import type { StatsData, RecallTelemetryData, GovernanceReviewData, GovernanceReviewItem, GovernanceReviewOptions } from '../types.js'

function countQueryTokens(query: string): number {
    return tokenizeQuery(query).length
}

export function logRecallTelemetry(
    dbPath: string,
    input: { routeMode: string; fallbackUsed: boolean; hitCount: number; latencyMs: number; query?: string; topConfidence?: number }
): string | null {
    if (!existsSync(dbPath)) return null

    return withDb(dbPath, (db) => {
        db.exec(`
          CREATE TABLE IF NOT EXISTS recall_telemetry (
            id TEXT PRIMARY KEY,
            route_mode TEXT,
            fallback_used INTEGER,
            hit_count INTEGER,
            latency_ms INTEGER,
            created_at DATETIME,
            query_hash TEXT,
            token_count INTEGER,
            top_confidence REAL,
            utility_score REAL,
            outcome_kind TEXT,
            observed_at DATETIME
          );
          CREATE INDEX IF NOT EXISTS idx_recall_telemetry_created ON recall_telemetry(created_at);
          CREATE INDEX IF NOT EXISTS idx_recall_telemetry_route ON recall_telemetry(route_mode, created_at);
        `)

        const createdAt = new Date().toISOString()
        const id = `rt_${shortHash(`${createdAt}:${input.routeMode}:${input.latencyMs}:${input.hitCount}`, 24)}`
        // Store a privacy-preserving hash of the query (not the raw text) plus token count / top confidence.
        const queryHash = typeof input.query === 'string' && input.query.trim()
            ? shortHash(input.query.trim().toLowerCase(), 16)
            : null
        const tokenCount = typeof input.query === 'string' ? countQueryTokens(input.query) : null
        const topConfidence = typeof input.topConfidence === 'number' && Number.isFinite(input.topConfidence)
            ? Number(input.topConfidence)
            : null
        db.prepare(`
          INSERT OR REPLACE INTO recall_telemetry
          (id, route_mode, fallback_used, hit_count, latency_ms, created_at, query_hash, token_count, top_confidence)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            id,
            input.routeMode,
            input.fallbackUsed ? 1 : 0,
            Math.max(0, Math.floor(input.hitCount)),
            Math.max(0, Math.floor(input.latencyMs)),
            createdAt,
            queryHash,
            tokenCount,
            topConfidence
        )
        return id
    })
}

/**
 * Write back the observed utility of a prior recall (UFL). In-place UPDATE of the
 * recall_telemetry row. A recallId that does not exist (never logged, or pruned) is a no-op —
 * fail-open, so a late/duplicate outcome never errors. Returns whether a row was updated.
 */
export function recordRecallOutcome(
    dbPath: string,
    recallId: string,
    outcome: { signal: string; utilityScore?: number; used?: boolean; hits?: Array<{ id: string; utilityScore: number }> }
): boolean {
    if (!existsSync(dbPath)) return false
    initDatabase(dbPath)
    return withDb(dbPath, (db) => {
        const table = db
            .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'recall_telemetry' LIMIT 1`)
            .get() as { ok: number } | undefined
        if (!table) return false
        const nowIso = new Date().toISOString()
        const score = typeof outcome.utilityScore === 'number' && Number.isFinite(outcome.utilityScore)
            ? Math.min(1, Math.max(0, outcome.utilityScore))
            : (outcome.used === true ? 1 : outcome.used === false ? 0 : null)
        const info = db
            .prepare(`UPDATE recall_telemetry SET utility_score = ?, outcome_kind = ?, observed_at = ? WHERE id = ?`)
            .run(score, outcome.signal, nowIso, recallId)

        // UFL Phase 3: attribute per-hit utility to individual memories so recall ranking / prune
        // retention can act on it. Additive & fail-open — accrues only when hits are supplied.
        if (Array.isArray(outcome.hits) && outcome.hits.length > 0) {
            const upsert = db.prepare(`
              INSERT INTO memory_utility (ref_id, observations, utility_sum, last_outcome_at)
              VALUES (?, 1, ?, ?)
              ON CONFLICT(ref_id) DO UPDATE SET
                observations = observations + 1,
                utility_sum = utility_sum + excluded.utility_sum,
                last_outcome_at = excluded.last_outcome_at
            `)
            db.transaction((rows: Array<{ id: string; utilityScore: number }>) => {
                for (const hit of rows) {
                    if (!hit || typeof hit.id !== 'string' || !hit.id) continue
                    if (typeof hit.utilityScore !== 'number' || !Number.isFinite(hit.utilityScore)) continue
                    upsert.run(hit.id, Math.min(1, Math.max(0, hit.utilityScore)), nowIso)
                }
            })(outcome.hits)
        }

        return info.changes > 0
    })
}

export function queryStats(dbPath: string): StatsData {
    return withDb(dbPath, (db) => {
        const sessions = Number((db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number }).c)
        const events = Number((db.prepare('SELECT COUNT(*) AS c FROM events').get() as { c: number }).c)
        const skills = Number((db.prepare('SELECT COUNT(*) AS c FROM skills').get() as { c: number }).c)

        const lastSession = db
            .prepare('SELECT id, timestamp, project FROM sessions ORDER BY timestamp DESC LIMIT 1')
            .get() as { id: string; timestamp: string; project: string } | undefined

        const topSkills = db
            .prepare('SELECT name, use_count, success_rate FROM skills ORDER BY use_count DESC, name ASC LIMIT 5')
            .all() as { name: string; use_count: number; success_rate: number }[]

        const window = 'P7D'
        const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        const recallTelemetryTable = db
            .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'recall_telemetry' LIMIT 1`)
            .get() as { ok: number } | undefined
        const telemetryRows = recallTelemetryTable
            ? db
                .prepare(`
                  SELECT route_mode, fallback_used, hit_count, latency_ms, top_confidence, utility_score
                  FROM recall_telemetry
                  WHERE created_at >= ?
                `)
                .all(sinceIso) as Array<{ route_mode: string; fallback_used: number; hit_count: number; latency_ms: number; top_confidence: number | null; utility_score: number | null }>
            : []

        const routeCounts = {
            skipped: 0,
            keyword: 0,
            tree: 0,
            hybrid_tree: 0,
            hybrid_fallback: 0
        }
        let fallbackCount = 0
        let hitCountSum = 0
        const latencies: number[] = []
        // Zero-hit rate and avg confidence are computed over non-skipped queries only: a skipped
        // query intentionally returns no hits (adaptive gate), so it is not a recall miss.
        let nonSkippedCount = 0
        let zeroHitCount = 0
        let confidenceSum = 0
        let confidenceCount = 0

        for (const row of telemetryRows) {
            const mode = row.route_mode
            if (mode in routeCounts) {
                routeCounts[mode as keyof typeof routeCounts] += 1
            }
            if (row.fallback_used === 1) fallbackCount += 1
            hitCountSum += Number(row.hit_count ?? 0)
            latencies.push(Number(row.latency_ms ?? 0))
            if (mode !== 'skipped') {
                nonSkippedCount += 1
                if (Number(row.hit_count ?? 0) === 0) zeroHitCount += 1
                if (row.top_confidence != null) {
                    confidenceSum += Number(row.top_confidence)
                    confidenceCount += 1
                }
            }
        }

        latencies.sort((a, b) => a - b)
        const totalQueries = telemetryRows.length
        const avgLatencyMs = totalQueries > 0
            ? Number((latencies.reduce((sum, x) => sum + x, 0) / totalQueries).toFixed(2))
            : 0
        const p95LatencyMs = totalQueries > 0
            ? latencies[Math.min(latencies.length - 1, Math.floor((latencies.length - 1) * 0.95))]
            : 0
        const fallbackRate = totalQueries > 0 ? Number((fallbackCount / totalQueries).toFixed(4)) : 0
        const avgHitCount = totalQueries > 0 ? Number((hitCountSum / totalQueries).toFixed(2)) : 0
        const zeroHitRate = nonSkippedCount > 0 ? Number((zeroHitCount / nonSkippedCount).toFixed(4)) : 0
        const avgConfidence = confidenceCount > 0 ? Number((confidenceSum / confidenceCount).toFixed(4)) : 0

        // UFL Phase 2: confidence×utility calibration over rows that carry an observed utility_score.
        // Additive & presentational — omitted entirely when no row is scored, so existing output is unchanged.
        const calibration = buildCalibration(
            telemetryRows.map((row) => ({ confidence: row.top_confidence, utility: row.utility_score }))
        )

        const recallRouting = {
            window,
            totalQueries,
            routeCounts,
            fallbackRate,
            avgLatencyMs,
            p95LatencyMs,
            avgHitCount,
            zeroHitRate,
            avgConfidence,
            ...(calibration.scoredQueries > 0 ? { calibration } : {})
        }

        return { sessions, events, skills, lastSession, topSkills, recallRouting }
    })
}

export function queryRecallTelemetry(
    dbPath: string,
    options?: { window?: string; limit?: number }
): RecallTelemetryData {
    return withDb(dbPath, (db) => {
        const window = options?.window && /^P\d+D$/.test(options.window) ? options.window : 'P7D'
        const limitRaw = options?.limit ?? 100
        const limit = Math.min(500, Math.max(1, Math.floor(limitRaw)))
        const days = Number(/^P(\d+)D$/.exec(window)?.[1] ?? '7')
        const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

        const tableExists = db
            .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'recall_telemetry' LIMIT 1`)
            .get() as { ok: number } | undefined

        if (!tableExists) {
            return { window, total: 0, rows: [] }
        }

        const rows = db
            .prepare(`
              SELECT id, route_mode, fallback_used, hit_count, latency_ms, created_at, query_hash, token_count, top_confidence,
                     utility_score, outcome_kind, observed_at
              FROM recall_telemetry
              WHERE created_at >= ?
              ORDER BY created_at DESC
              LIMIT ?
            `)
            .all(sinceIso, limit) as Array<{
            id: string
            route_mode: string
            fallback_used: number
            hit_count: number
            latency_ms: number
            created_at: string
            query_hash: string | null
            token_count: number | null
            top_confidence: number | null
            utility_score: number | null
            outcome_kind: string | null
            observed_at: string | null
        }>

        // UFL Phase 2: calibration over the returned window. Additive; omitted when nothing is scored.
        const calibration = buildCalibration(
            rows.map((r) => ({ confidence: r.top_confidence, utility: r.utility_score }))
        )

        return {
            window,
            total: rows.length,
            ...(calibration.scoredQueries > 0 ? { calibration } : {}),
            rows: rows.map((r) => ({
                id: r.id,
                route_mode: r.route_mode,
                fallback_used: r.fallback_used === 1,
                hit_count: Number(r.hit_count ?? 0),
                latency_ms: Number(r.latency_ms ?? 0),
                created_at: r.created_at,
                query_hash: r.query_hash ?? undefined,
                token_count: r.token_count == null ? undefined : Number(r.token_count),
                top_confidence: r.top_confidence == null ? undefined : Number(r.top_confidence),
                utility_score: r.utility_score == null ? undefined : Number(r.utility_score),
                outcome_kind: r.outcome_kind ?? undefined,
                observed_at: r.observed_at ?? undefined
            }))
        }
    })
}

export function queryGovernanceReview(
    dbPath: string,
    options: GovernanceReviewOptions = {}
): GovernanceReviewData {
    initDatabase(dbPath)
    return withDb(dbPath, (db) => {
        const projectFilter = options.project?.trim()
        const scopeFilter = options.scope?.trim()
        const limit = Math.min(100, Math.max(1, Math.floor(options.limit ?? 20)))

        const decisionRows = db.prepare(`
          SELECT e.id, e.session_id, e.timestamp, e.content, s.project, s.scope
          FROM events e JOIN sessions s ON s.id = e.session_id
          WHERE e.event_type = 'DecisionMade'
            ${projectFilter ? 'AND s.project = ?' : ''}
            ${scopeFilter ? 'AND s.scope = ?' : ''}
          ORDER BY e.timestamp DESC
        `).all(...[...(projectFilter ? [projectFilter] : []), ...(scopeFilter ? [scopeFilter] : [])]) as Array<{
            id: string
            session_id: string
            timestamp: string
            content: string
            project: string
            scope: string
        }>

        const skillRows = db.prepare(`
          SELECT e.id, e.session_id, e.timestamp, e.content, s.project, s.scope
          FROM events e JOIN sessions s ON s.id = e.session_id
          WHERE e.event_type = 'SkillLearned'
            ${projectFilter ? 'AND s.project = ?' : ''}
            ${scopeFilter ? 'AND s.scope = ?' : ''}
          ORDER BY e.timestamp DESC
        `).all(...[...(projectFilter ? [projectFilter] : []), ...(scopeFilter ? [scopeFilter] : [])]) as Array<{
            id: string
            session_id: string
            timestamp: string
            content: string
            project: string
            scope: string
        }>

        type CandidateAccum = {
            kind: 'decision' | 'skill'
            title: string
            normalized_title: string
            latest_session_id: string
            latest_timestamp: string
            sessionIds: Set<string>
            highImpact: boolean
        }

        const byKey = new Map<string, CandidateAccum>()

        for (const row of decisionRows) {
            const fields = parseDecisionEvent(row.content)
            const title = fields.decision.trim()
            if (!title) continue
            const normalized = normalizeSkillKey(title)
            const key = `decision:${normalized}`
            const impact = fields.impact_level.toLowerCase() === 'high'
            const existing = byKey.get(key)
            if (!existing) {
                byKey.set(key, {
                    kind: 'decision',
                    title,
                    normalized_title: normalized,
                    latest_session_id: row.session_id,
                    latest_timestamp: row.timestamp,
                    sessionIds: new Set([row.session_id]),
                    highImpact: impact
                })
                continue
            }
            existing.sessionIds.add(row.session_id)
            existing.highImpact = existing.highImpact || impact
            if (parseCreatedAt(row.timestamp) > parseCreatedAt(existing.latest_timestamp)) {
                existing.latest_timestamp = row.timestamp
                existing.latest_session_id = row.session_id
                existing.title = title
            }
        }

        for (const row of skillRows) {
            const fields = parseSkillEvent(row.content)
            const title = fields.skill_name.trim()
            if (!title) continue
            const normalized = normalizeSkillKey(title)
            const key = `skill:${normalized}`
            const existing = byKey.get(key)
            if (!existing) {
                byKey.set(key, {
                    kind: 'skill',
                    title,
                    normalized_title: normalized,
                    latest_session_id: row.session_id,
                    latest_timestamp: row.timestamp,
                    sessionIds: new Set([row.session_id]),
                    highImpact: false
                })
                continue
            }
            existing.sessionIds.add(row.session_id)
            if (parseCreatedAt(row.timestamp) > parseCreatedAt(existing.latest_timestamp)) {
                existing.latest_timestamp = row.timestamp
                existing.latest_session_id = row.session_id
                existing.title = title
            }
        }

        const items: GovernanceReviewItem[] = Array.from(byKey.values())
            .map((entry) => {
                const sourceCount = entry.sessionIds.size
                const repeated = sourceCount >= 2
                const rationale: GovernanceReviewItem['rationale'] | null = repeated
                    ? 'repeated'
                    : entry.kind === 'decision' && entry.highImpact
                        ? 'high-impact'
                        : null
                if (!rationale) return null
                const score = sourceCount * 10 + (entry.highImpact ? 5 : 0)
                return {
                    id: `${entry.kind}:${entry.normalized_title}`,
                    kind: entry.kind,
                    title: entry.title,
                    normalized_title: entry.normalized_title,
                    source_count: sourceCount,
                    latest_session_id: entry.latest_session_id,
                    latest_timestamp: entry.latest_timestamp,
                    rationale,
                    score
                }
            })
            .filter((item): item is GovernanceReviewItem => item !== null)
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score
                return parseCreatedAt(b.latest_timestamp) - parseCreatedAt(a.latest_timestamp)
            })
            .slice(0, limit)

        return {
            total: items.length,
            items
        }
    })
}
