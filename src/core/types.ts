// Core types for Memoria
// Centralised type definitions shared between core modules, CLI, HTTP server, and SDK

export type Json = Record<string, unknown>

export type SourceType = 'session' | 'note' | 'article' | 'document' | 'attachment'

export type SourceStatus = 'active' | 'archived'

export type SourceRecord = {
    id: string
    type: SourceType
    scope: string
    title: string
    origin_path?: string
    origin_url?: string
    checksum?: string
    created_at: string
    imported_at: string
    status: SourceStatus
    metadata?: Json
}

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
    scope?: string
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

export type WikiPageType =
    | 'source-summary'
    | 'entity'
    | 'concept'
    | 'synthesis'
    | 'comparison'
    | 'question'
    | 'index-meta'

export type WikiPageStatus = 'draft' | 'active' | 'archived'

export type WikiPage = {
    id: string
    slug: string
    title: string
    page_type: WikiPageType
    scope: string
    summary: string
    filepath?: string
    status: WikiPageStatus
    confidence?: number
    last_built_at?: string
    last_reviewed_at?: string
    metadata?: Json
}

export type WikiPageSourceLink = {
    page_id: string
    source_id: string
    relation_type: string
    created_at: string
}

export type WikiPageLink = {
    from_page_id: string
    to_page_id: string
    link_type: string
    created_at: string
}

export type WikiLintFindingType =
    | 'orphan-page'
    | 'stale-page'
    | 'missing-page'
    | 'missing-link'
    | 'contradiction'
    | 'low-provenance'
    | 'duplicate-page'
    | 'source-not-compiled'

export type WikiLintSeverity = 'high' | 'medium' | 'low'

export type WikiLintFindingStatus = 'open' | 'resolved' | 'dismissed'

export type WikiLintFinding = {
    id: string
    run_id?: string
    finding_type: WikiLintFindingType
    severity: WikiLintSeverity
    page_id?: string
    related_page_id?: string
    source_id?: string
    status: WikiLintFindingStatus
    summary: string
    details?: string
    created_at: string
    resolved_at?: string
}

export type WikiLintRun = {
    id: string
    status: 'completed' | 'failed'
    summary?: string
    created_at: string
}

export type WikiLintResult = {
    run: WikiLintRun
    findings: WikiLintFinding[]
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
    scope?: string
    type?: ExportType
    format?: ExportFormat
    out?: string
}

export type PruneOptions = {
    exportsDays?: string
    checkpointsDays?: string
    dedupeSkills?: boolean
    consolidateDays?: string
    staleDays?: string
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
    scope?: string
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
    scope?: string
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
    scope: string
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
            skipped: number
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

export type GovernanceReviewOptions = {
    project?: string
    scope?: string
    limit?: number
}

export type GovernanceReviewItem = {
    id: string
    kind: 'decision' | 'skill'
    title: string
    normalized_title: string
    source_count: number
    latest_session_id: string
    latest_timestamp: string
    rationale: 'repeated' | 'high-impact'
    score: number
}

export type GovernanceReviewData = {
    total: number
    items: GovernanceReviewItem[]
}

export type UpsertSourceInput = {
    id: string
    type: SourceType
    scope: string
    title: string
    origin_path?: string
    origin_url?: string
    checksum?: string
    created_at: string
    imported_at?: string
    status?: SourceStatus
    metadata?: Json
}

export type UpsertWikiPageInput = {
    id: string
    slug: string
    title: string
    page_type: WikiPageType
    scope: string
    summary: string
    filepath?: string
    status?: WikiPageStatus
    confidence?: number
    last_built_at?: string
    last_reviewed_at?: string
    metadata?: Json
}

export type UpsertWikiPageSourceLinkInput = {
    page_id: string
    source_id: string
    relation_type?: string
    created_at?: string
}

export type UpsertWikiPageLinkInput = {
    from_page_id: string
    to_page_id: string
    link_type?: string
    created_at?: string
}

export type UpsertWikiLintRunInput = {
    id: string
    status?: 'completed' | 'failed'
    summary?: string
    created_at?: string
}

export type UpsertWikiLintFindingInput = {
    id: string
    run_id?: string
    finding_type: WikiLintFindingType
    severity: WikiLintSeverity
    page_id?: string
    related_page_id?: string
    source_id?: string
    status?: WikiLintFindingStatus
    summary: string
    details?: string
    created_at?: string
    resolved_at?: string
}

export type WikiQueryArtifactKind = 'synthesis' | 'comparison'

export type WikiQueryArtifact = {
    id: string
    query: string
    kind: WikiQueryArtifactKind
    page_id: string
    created_at: string
    metadata?: Json
}

export type UpsertWikiQueryArtifactInput = {
    id: string
    query: string
    kind: WikiQueryArtifactKind
    page_id: string
    created_at?: string
    metadata?: Json
}

export type ImportSourceInput = {
    filePath: string
    type?: Extract<SourceType, 'note' | 'article' | 'document'>
    title?: string
    scope?: string
}

export type ImportedSourceData = {
    source: SourceRecord
    page: WikiPage
    deduped: boolean
}

export type FileQueryInput = {
    query: string
    title: string
    kind: WikiQueryArtifactKind
    scope?: string
    top_k?: number
    time_window?: string
    mode?: 'keyword' | 'tree' | 'hybrid'
}

export type FiledQueryData = {
    artifact: WikiQueryArtifact
    page: WikiPage
    hits: RecallHit[]
}

export type WikiLintOptions = {
    stale_days?: number
    limit?: number
}

export type RecentSessionRecord = {
    id: string
    timestamp: string
    project: string
    scope: string
    summary: string
}

export type WikiBuildResult = {
    pagesSynced: number
    sourceCount: number
    pageCount: number
    specialPages: {
        index: string
        log: string
        overview: string
    }
}
