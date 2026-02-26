// MemoriaCore – the central API class
// Provides: remember(), recall(), summarizeSession(), health()
// All methods return MemoriaResult<T> with structured evidence/confidence fields.

import fs from 'node:fs/promises'
import path from 'node:path'
import { existsSync } from './paths.js'
import {
    initDatabase,
    importSession,
    syncDailyNote,
    extractDecisions,
    extractSkills,
    queryStats,
    queryRecallTelemetry,
    logRecallTelemetry,
    runVerify,
    buildMemoryIndex,
    recallTree,
    recallKeyword,
    querySessionSummary
} from './db.js'
import type {
    MemoriaPaths,
    SessionData,
    MemoriaResult,
    RecallFilter,
    RecallHit,
    SessionSummary,
    HealthStatus,
    StatsData,
    RecallTelemetryData
} from './types.js'

export class MemoriaCore {
    readonly paths: MemoriaPaths

    constructor(paths: MemoriaPaths) {
        this.paths = paths
    }

    // ─── Init ────────────────────────────────────────────────────────────────

    async init(): Promise<void> {
        const dirs = [
            this.paths.memoryDir,
            this.paths.sessionsPath,
            path.join(this.paths.memoryDir, 'checkpoints'),
            path.join(this.paths.memoryDir, 'exports'),
            this.paths.knowledgeDir,
            path.join(this.paths.knowledgeDir, 'Daily'),
            path.join(this.paths.knowledgeDir, 'Skills'),
            path.join(this.paths.knowledgeDir, 'Decisions'),
            this.paths.configPath
        ]
        await Promise.all(dirs.map((d) => fs.mkdir(d, { recursive: true })))
        initDatabase(this.paths.dbPath)
    }

    // ─── remember() ──────────────────────────────────────────────────────────

    async remember(data: SessionData): Promise<MemoriaResult<{ sessionId: string }>> {
        const start = Date.now()
        try {
            await this.init()
            const sessionId = importSession(this.paths.dbPath, data)
            await syncDailyNote(this.paths.memoriaHome, this.paths.dbPath, sessionId)
            await extractDecisions(this.paths.memoriaHome, this.paths.dbPath, sessionId)
            await extractSkills(this.paths.memoriaHome, this.paths.dbPath, sessionId)

            // Auto-build tree index by default after successful sync.
            // Disable with MEMORIA_INDEX_AUTOBUILD=0.
            if (process.env.MEMORIA_INDEX_AUTOBUILD !== '0') {
                try {
                    buildMemoryIndex(this.paths.dbPath, { sessionId, project: data.project })
                } catch {
                    // Keep remember() fail-open for indexing errors.
                }
            }

            return {
                ok: true,
                data: { sessionId },
                meta: {
                    source: 'sqlite',
                    evidence: [sessionId],
                    confidence: 1.0,
                    timestamp: new Date().toISOString(),
                    latency_ms: Date.now() - start
                }
            }
        } catch (error) {
            return {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
                meta: {
                    source: 'sqlite',
                    evidence: [],
                    confidence: 0,
                    timestamp: new Date().toISOString(),
                    latency_ms: Date.now() - start
                }
            }
        }
    }

    // ─── recall() ────────────────────────────────────────────────────────────

    async recall(filter: RecallFilter): Promise<MemoriaResult<RecallHit[]>> {
        const start = Date.now()
        try {
            if (!existsSync(this.paths.dbPath)) {
                return {
                    ok: true,
                    data: [],
                    meta: {
                        source: 'sqlite',
                        evidence: [],
                        confidence: 0,
                        timestamp: new Date().toISOString(),
                        latency_ms: Date.now() - start
                    }
                }
            }

            const topK = filter.top_k ?? 5
            const mode = filter.mode ?? 'keyword'
            let afterDate: Date | undefined
            if (filter.time_window) {
                // Parse ISO duration P<n>D (days only, extend as needed)
                const match = /^P(\d+)D$/.exec(filter.time_window)
                if (match) {
                    const days = Number(match[1])
                    afterDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
                }
            }

            const treeRaw = mode !== 'keyword'
                ? recallTree(this.paths.dbPath, filter.query, filter.project, topK)
                : []
            const keywordRaw = mode === 'tree'
                ? []
                : recallKeyword(this.paths.dbPath, filter.query, filter.project, topK, afterDate)

            let routeMode: string = mode
            let fallbackUsed = false

            type RawRecallRow = {
                type: string
                id: string
                session_id: string
                timestamp: string
                project: string
                snippet: string
                score?: number
                node_id?: string
                reasoning_path?: string[]
            }

            const raw: RawRecallRow[] = (() => {
                if (mode === 'tree') {
                    routeMode = 'tree'
                    return treeRaw as RawRecallRow[]
                }
                if (mode === 'keyword') {
                    routeMode = 'keyword'
                    return keywordRaw as RawRecallRow[]
                }

                // hybrid mode: prefer tree route, then merge keyword fallback if needed
                const merged = [...treeRaw, ...keywordRaw].filter((item, index, arr) =>
                    arr.findIndex((x) => x.id === item.id && x.session_id === item.session_id) === index
                ) as RawRecallRow[]

                const treeIds = new Set((treeRaw as RawRecallRow[]).map((r) => `${r.id}:${r.session_id}`))
                const usedKeyword = merged.some((r) => !treeIds.has(`${r.id}:${r.session_id}`))

                fallbackUsed = treeRaw.length === 0 || usedKeyword
                routeMode = fallbackUsed ? 'hybrid_fallback' : 'hybrid_tree'
                return merged.slice(0, topK)
            })()

            const hits: RecallHit[] = raw.map((r, i) => ({
                type: r.type as RecallHit['type'],
                id: r.id,
                session_id: r.session_id,
                timestamp: r.timestamp,
                project: r.project,
                snippet: r.snippet,
                // Score based on recency: most recent → score 1.0
                score: Number.isFinite(r.score) ? Number(r.score) : (raw.length === 1 ? 1.0 : 1.0 - i / (raw.length - 1)),
                node_id: typeof r.node_id === 'string' ? r.node_id : undefined,
                reasoning_path: Array.isArray(r.reasoning_path) ? r.reasoning_path : undefined
            }))

            try {
                logRecallTelemetry(this.paths.dbPath, {
                    routeMode,
                    fallbackUsed,
                    hitCount: hits.length,
                    latencyMs: Date.now() - start
                })
            } catch {
                // Keep recall fail-open when telemetry logging fails.
            }

            return {
                ok: true,
                data: hits,
                meta: {
                    source: 'sqlite',
                    evidence: hits.map((h) => h.id),
                    confidence: hits.length > 0 ? hits[0].score : 0,
                    reasoning_path: hits[0]?.reasoning_path,
                    route_mode: routeMode,
                    fallback_used: fallbackUsed,
                    timestamp: new Date().toISOString(),
                    latency_ms: Date.now() - start
                }
            }
        } catch (error) {
            return {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
                meta: {
                    source: 'sqlite',
                    evidence: [],
                    confidence: 0,
                    timestamp: new Date().toISOString(),
                    latency_ms: Date.now() - start
                }
            }
        }
    }

    // ─── summarizeSession() ──────────────────────────────────────────────────

    async summarizeSession(sessionId: string): Promise<MemoriaResult<SessionSummary>> {
        const start = Date.now()
        try {
            if (!existsSync(this.paths.dbPath)) {
                return {
                    ok: false,
                    error: 'Database not found. Run init first.',
                    meta: {
                        source: 'sqlite',
                        evidence: [],
                        confidence: 0,
                        timestamp: new Date().toISOString(),
                        latency_ms: Date.now() - start
                    }
                }
            }

            const raw = querySessionSummary(this.paths.dbPath, sessionId)
            if (!raw) {
                return {
                    ok: false,
                    error: `Session not found: ${sessionId}`,
                    meta: {
                        source: 'sqlite',
                        evidence: [],
                        confidence: 0,
                        timestamp: new Date().toISOString(),
                        latency_ms: Date.now() - start
                    }
                }
            }

            const summary: SessionSummary = {
                sessionId: raw.session.id,
                timestamp: raw.session.timestamp,
                project: raw.session.project,
                eventCount: raw.session.event_count,
                summary: raw.session.summary,
                decisions: raw.decisions,
                skills: raw.skills
            }

            return {
                ok: true,
                data: summary,
                meta: {
                    source: 'sqlite',
                    evidence: [sessionId],
                    confidence: 1.0,
                    timestamp: new Date().toISOString(),
                    latency_ms: Date.now() - start
                }
            }
        } catch (error) {
            return {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
                meta: {
                    source: 'sqlite',
                    evidence: [],
                    confidence: 0,
                    timestamp: new Date().toISOString(),
                    latency_ms: Date.now() - start
                }
            }
        }
    }

    // ─── health() ────────────────────────────────────────────────────────────

    async health(): Promise<MemoriaResult<HealthStatus>> {
        const start = Date.now()
        try {
            const { ok, checks } = await runVerify(this.paths)
            const dbOk = checks.find((c) => c.id === 'db_connect')?.status === 'pass'
                ? 'ok' as const
                : existsSync(this.paths.dbPath) ? 'error' as const : 'missing' as const
            const dirsOk = checks
                .filter((c) => c.id.endsWith('_exists'))
                .every((c) => c.status === 'pass') ? 'ok' as const
                : checks.some((c) => c.id.endsWith('_exists') && c.status === 'pass') ? 'partial' as const
                    : 'missing' as const

            const status: HealthStatus = { ok, db: dbOk, dirs: dirsOk, checks }

            return {
                ok: true,
                data: status,
                meta: {
                    source: 'sqlite',
                    evidence: [],
                    confidence: 1.0,
                    timestamp: new Date().toISOString(),
                    latency_ms: Date.now() - start
                }
            }
        } catch (error) {
            return {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
                meta: {
                    source: 'sqlite',
                    evidence: [],
                    confidence: 0,
                    timestamp: new Date().toISOString(),
                    latency_ms: Date.now() - start
                }
            }
        }
    }

    // ─── stats() ─────────────────────────────────────────────────────────────

    async stats(): Promise<MemoriaResult<StatsData>> {
        const start = Date.now()
        try {
            if (!existsSync(this.paths.dbPath)) {
                return {
                    ok: false,
                    error: 'Database not found. Run init first.',
                    meta: {
                        source: 'sqlite',
                        evidence: [],
                        confidence: 0,
                        timestamp: new Date().toISOString(),
                        latency_ms: Date.now() - start
                    }
                }
            }
            const data = queryStats(this.paths.dbPath)
            return {
                ok: true,
                data,
                meta: {
                    source: 'sqlite',
                    evidence: [],
                    confidence: 1.0,
                    timestamp: new Date().toISOString(),
                    latency_ms: Date.now() - start
                }
            }
        } catch (error) {
            return {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
                meta: {
                    source: 'sqlite',
                    evidence: [],
                    confidence: 0,
                    timestamp: new Date().toISOString(),
                    latency_ms: Date.now() - start
                }
            }
        }
    }

    // ─── recallTelemetry() ────────────────────────────────────────────────────

    async recallTelemetry(options?: { window?: string; limit?: number }): Promise<MemoriaResult<RecallTelemetryData>> {
        const start = Date.now()
        try {
            if (!existsSync(this.paths.dbPath)) {
                return {
                    ok: false,
                    error: 'Database not found. Run init first.',
                    meta: {
                        source: 'sqlite',
                        evidence: [],
                        confidence: 0,
                        timestamp: new Date().toISOString(),
                        latency_ms: Date.now() - start
                    }
                }
            }

            const data = queryRecallTelemetry(this.paths.dbPath, options)
            return {
                ok: true,
                data,
                meta: {
                    source: 'sqlite',
                    evidence: [],
                    confidence: 1.0,
                    timestamp: new Date().toISOString(),
                    latency_ms: Date.now() - start
                }
            }
        } catch (error) {
            return {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
                meta: {
                    source: 'sqlite',
                    evidence: [],
                    confidence: 0,
                    timestamp: new Date().toISOString(),
                    latency_ms: Date.now() - start
                }
            }
        }
    }
}
