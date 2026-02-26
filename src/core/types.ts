// Core types for Memoria
// Centralised type definitions shared between core modules, CLI, HTTP server, and SDK

export type Json = Record<string, unknown>

export type SessionEvent = {
    id?: string
    timestamp?: string
    type?: string
    event_type?: string
    content?: unknown
    metadata?: unknown
}

export type SessionData = {
    id?: string
    timestamp?: string
    project?: string
    summary?: string
    events?: SessionEvent[]
}

export type MemoriaPaths = {
    memoriaHome: string
    memoryDir: string
    knowledgeDir: string
    dbPath: string
    sessionsPath: string
    configPath: string
}

export type VerifyStatus = 'pass' | 'fail'

export type VerifyCheck = {
    id: string
    status: VerifyStatus
    detail: string
}

export type ExportType = 'all' | 'decisions' | 'skills'
export type ExportFormat = 'json' | 'markdown'

export type ExportDecision = {
    id: string
    session_id: string
    timestamp: string
    project: string
    decision: string
    rationale: string
    impact_level: string
}

export type ExportSkill = {
    id: string
    session_id: string
    timestamp: string
    project: string
    skill_name: string
    category: string
    pattern: string
}

export type ExportOptions = {
    from?: string
    to?: string
    project?: string
    type?: ExportType
    format?: ExportFormat
    out?: string
}

export type PruneOptions = {
    exportsDays?: string
    checkpointsDays?: string
    dedupeSkills?: boolean
    all?: boolean
    dryRun?: boolean
}

// ─── Runtime API types ───────────────────────────────────────────────────────

/** Standard envelope for all MemoriaCore API responses */
export type MemoriaResult<T> = {
    ok: boolean
    data?: T
    error?: string
    meta: {
        source: string       // 'sqlite' | 'markdown' | 'mcp'
        evidence: string[]   // IDs of sessions/events/skills supporting this result
        confidence: number   // 0–1; 1.0 for writes, keyword-match for reads
        reasoning_path?: string[] // Optional retrieval path for tree/hybrid recall
        route_mode?: string  // Optional routing mode used by recall
        fallback_used?: boolean // Whether hybrid route fell back to keyword recall
        timestamp: string    // ISO8601
        latency_ms: number   // end-to-end operation time
    }
}

export type RecallFilter = {
    query: string
    project?: string
    top_k?: number         // default 5
    time_window?: string   // ISO duration, e.g. 'P7D'
    mode?: 'keyword' | 'tree' | 'hybrid'
}

export type RecallHit = {
    type: 'session' | 'decision' | 'skill'
    id: string
    session_id: string
    timestamp: string
    project: string
    snippet: string
    score: number
    node_id?: string
    reasoning_path?: string[]
}

export type MemoryIndexBuildOptions = {
    project?: string
    since?: string
    dryRun?: boolean
    sessionId?: string
}

export type MemoryIndexBuildResult = {
    sessionsConsidered: number
    sessionsIndexed: number
    nodesUpserted: number
    linksUpserted: number
}

export type SessionSummary = {
    sessionId: string
    timestamp: string
    project: string
    eventCount: number
    summary: string
    decisions: Array<{ id: string; decision: string; impact_level: string }>
    skills: Array<{ id: string; skill_name: string; category: string }>
}

export type HealthStatus = {
    ok: boolean
    db: 'ok' | 'missing' | 'error'
    dirs: 'ok' | 'partial' | 'missing'
    checks: VerifyCheck[]
}

export type StatsData = {
    sessions: number
    events: number
    skills: number
    lastSession?: {
        id: string
        timestamp: string
        project: string
    }
    topSkills: Array<{
        name: string
        use_count: number
        success_rate: number
    }>
    recallRouting?: {
        window: string
        totalQueries: number
        routeCounts: {
            keyword: number
            tree: number
            hybrid_tree: number
            hybrid_fallback: number
        }
        fallbackRate: number
        avgLatencyMs: number
        p95LatencyMs: number
        avgHitCount: number
    }
}

export type RecallTelemetryPoint = {
    id: string
    route_mode: string
    fallback_used: boolean
    hit_count: number
    latency_ms: number
    created_at: string
}

export type RecallTelemetryData = {
    window: string
    total: number
    rows: RecallTelemetryPoint[]
}
