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
        recall_id?: string   // Correlates a recall to a later utility outcome (UFL); success recall only
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
    mode?: 'keyword' | 'tree' | 'hybrid' | 'vector'  // vector: opt-in semantic route (LIBSQL_URL-gated)
}

/** Git provenance attached to hits that came from a promoted git summary (issue-1 §21). */
export type RecallHitSource = {
    type: string           // git_commit_range | git_branch_summary | git_merge_summary | git_release_summary
    repository: string
    branch?: string
    tag?: string
    base_sha?: string
    head_sha?: string
    summary_id: string
}

export type RecallHit = {
    type: 'session' | 'decision' | 'skill'
    id: string
    session_id: string
    timestamp: string
    project: string
    snippet: string
    score: number          // ranking score = relevance × time-decay (drives ordering)
    relevance?: number     // decay-free match quality (0–1); basis for meta.confidence
    node_id?: string
    reasoning_path?: string[]
    source?: RecallHitSource
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

// ─── Confidence×utility calibration (UFL Phase 2) ────────────────────────────
// Presentational only: buckets recall telemetry rows that carry an observed
// utility_score by their top_confidence, so you can see whether confidence tracks
// real utility. Never feeds back into the confidence calculation.
export type CalibrationBucket = {
    range: string          // e.g. "[0.50,0.75)"
    lower: number          // bucket lower bound (inclusive)
    upper: number          // bucket upper bound
    count: number          // scored rows in this bucket
    meanConfidence: number // mean top_confidence in this bucket
    meanUtility: number    // mean utility_score in this bucket
}

export type CalibrationSummary = {
    scoredQueries: number             // rows with both top_confidence and utility_score
    buckets: CalibrationBucket[]      // non-empty buckets, ascending by confidence
    monotonic: boolean | null         // does meanUtility rise with confidence? null if <2 buckets
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
            vector: number             // semantic-only hits served
            hybrid_vector: number      // semantic + lexical fused
            vector_unavailable: number // LIBSQL_URL unset / helper missing / helper error → lexical floor
            vector_timeout: number     // helper exceeded MEMORIA_VECTOR_TIMEOUT_MS → lexical floor
        }
        fallbackRate: number
        avgLatencyMs: number
        p95LatencyMs: number
        avgHitCount: number
        zeroHitRate: number      // fraction of non-skipped queries that returned no hits
        avgConfidence: number    // mean calibrated top confidence over non-skipped queries
        calibration?: CalibrationSummary  // confidence×utility buckets (UFL Phase 2), present only if any row is scored
    }
}

export type RecallTelemetryPoint = {
    id: string
    route_mode: string
    fallback_used: boolean
    hit_count: number
    latency_ms: number
    created_at: string
    query_hash?: string       // privacy-preserving hash of the normalized query (not raw text)
    token_count?: number      // number of distinct query tokens
    top_confidence?: number   // calibrated top-hit confidence for this query
    utility_score?: number    // observed lexical-reuse utility of this recall [0,1] (UFL), if reported
    outcome_kind?: string     // signal source for utility_score, e.g. 'reuse' | 'explicit'
    observed_at?: string      // ISO8601 when the outcome was written back
}

export type RecallOutcomeInput = {
    signal: string            // outcome source, e.g. 'reuse'
    utility_score?: number    // observed utility [0,1]
    used?: boolean            // explicit host signal that the recall was used
    hits?: Array<{            // per-hit utility attribution (UFL Phase 3); accrues into memory_utility
        id: string            // RecallHit.id the utility is attributed to (session/event id)
        utility_score: number // observed utility [0,1] for this specific hit
    }>
}

export type RecallTelemetryData = {
    window: string
    total: number
    rows: RecallTelemetryPoint[]
    calibration?: CalibrationSummary  // confidence×utility buckets (UFL Phase 2) over the returned rows
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
    mode?: 'keyword' | 'tree' | 'hybrid' | 'vector'
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

// ─── Git-Aware Memory (docs/issues/issue-1) ──────────────────────────────────

export type RepositoryStatus = 'active' | 'disabled' | 'limited_history'

export type RepositoryRecord = {
    id: string
    name: string
    fingerprint: string
    normalized_remote_url?: string
    root_commit_sha?: string
    default_branch?: string
    status: RepositoryStatus
    created_at: string
    updated_at: string
}

export type RepositoryInstanceRecord = {
    id: string
    repository_id: string
    local_path: string
    git_common_dir?: string
    host_id: string
    is_available: boolean
    last_seen_at?: string
    created_at: string
    updated_at: string
}

export type GitWorktreeRecord = {
    id: string
    repository_id: string
    repository_instance_id: string
    worktree_path: string
    current_branch?: string
    current_head_sha?: string
    is_main_worktree: boolean
    last_scanned_at?: string
    working_tree_dirty?: boolean
    created_at: string
    updated_at: string
}

export type RepoAddInput = {
    path: string
    name?: string
    defaultBranch?: string
    scanHistory?: boolean   // Phase 2: scan full history on add
    historyLimit?: number   // Phase 2: cap initial history scan
}

export type RepoRegistrationData = {
    repository: RepositoryRecord
    instance: RepositoryInstanceRecord
    worktree: GitWorktreeRecord
    created: boolean
    initial_scan?: RepoSyncData
}

export type RepoSyncOptions = {
    noSummary?: boolean     // Phase 4: skip summary planning
    forceSummary?: boolean  // Phase 4: summarize even trivial ranges
    from?: string           // Phase 4: explicit range base
    to?: string             // Phase 4: explicit range head
    dryRun?: boolean        // Phase 3: report without writing
    /** First-scan commit cap: undefined → default cap, <=0 → unlimited (--scan-history). */
    historyLimit?: number
}

export type RepoSyncData = {
    repository_id: string
    scan_run_id: string
    previous_head?: string
    current_head?: string
    new_commits: number
    new_refs: number
    new_tags: number
    events_created: number
    summaries_created: number
    memories_promoted: number
    warnings: string[]
    /** Present only for --dry-run: what WOULD be written (nothing was). */
    dry_run?: {
        commits: string[]
        events: Array<{ type: string; ref?: string }>
    }
}

export type RepoListItem = {
    repository: RepositoryRecord
    instance?: RepositoryInstanceRecord
    worktree?: GitWorktreeRecord
}

export type RepoLiveStatus = {
    current_branch?: string
    head_sha?: string
    working_tree_dirty: boolean
    is_shallow: boolean
    head_moved_since_last_seen: boolean
}

export type RepoStatusData = {
    repository: RepositoryRecord
    instance?: RepositoryInstanceRecord
    worktree?: GitWorktreeRecord
    live?: RepoLiveStatus
}

export type GitSummaryType = 'commit_range' | 'branch' | 'merge' | 'release'

export type GitSummaryStatus = 'pending' | 'enriched'

/** Structured summary payload (spec §7.5) — what generators produce and agents write back. */
export type GitSummaryContent = {
    title: string
    summary: string
    key_changes: string[]
    decisions: Array<{ decision: string; reason?: string }>
    known_limitations: string[]
    risks: string[]
    affected_domains: string[]
    importance: number
    confidence: number
}

export type GitSummaryRangeRecord = {
    id: string
    repository_id: string
    summary_type: GitSummaryType
    base_sha?: string
    head_sha: string
    source_ref?: string
    target_ref?: string
    tag_name?: string
    range_fingerprint: string
    created_at: string
}

export type GitSummaryRecord = GitSummaryContent & {
    id: string
    repository_id: string
    summary_range_id: string
    summary_type: GitSummaryType
    generator: string
    generator_version?: string
    prompt_version: string
    status: GitSummaryStatus
    metadata?: Json
    created_at: string
    updated_at: string
    range?: GitSummaryRangeRecord
}

export type RepoSummarizeOptions = {
    branch?: string
    range?: string        // "<base>..<head>"
    merge?: string        // merge commit sha
    tag?: string
    type?: GitSummaryType // label override for explicit --range
    force?: boolean       // bypass the trivial filter
    promote?: boolean     // Phase 5: promote resulting summaries
}

export type RepoSummarizeData = {
    created: number
    summaries: GitSummaryRecord[]
    memories_promoted: number
    warnings: string[]
}

export type PendingSummaryRequest = {
    summary_id: string
    summary_type: GitSummaryType
    prompt_version: string
    range: GitSummaryRangeRecord
    current: GitSummaryContent
    context: {
        commits: Array<{ sha: string; subject: string }>
        changed_files: Array<{ path: string; additions: number; deletions: number }>
        diffstat: { files: number; additions: number; deletions: number }
        diff?: string
        warnings: string[]
    }
}

export type PendingSummariesData = {
    requests: PendingSummaryRequest[]
}

export type RepoRemoveOptions = {
    deleteObservations?: boolean
    deleteSummaries?: boolean
    deleteMemories?: boolean
}

export type RepoRemoveData = {
    repository_id: string
    status: RepositoryStatus
    deleted: {
        observations: number
        summaries: number
        memories: number
    }
}
