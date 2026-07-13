// Memoria Node.js SDK client
// Wraps the HTTP API with TypeScript-typed methods.
// Uses node:fetch (Node 18+ built-in), zero external dependencies.
//
// Usage:
//   import { MemoriaClient } from './sdk.js'
//   const client = new MemoriaClient()          // default http://localhost:3917
//   const r = await client.remember(sessionData)
//   const hits = await client.recall({ query: 'SQLite migration' })

import type {
    MemoriaResult,
    SessionData,
    RecallFilter,
    RecallHit,
    SessionSummary,
    HealthStatus,
    StatsData,
    RecallTelemetryData,
    RecallOutcomeInput,
    RepoAddInput,
    RepoRegistrationData,
    RepoListItem,
    RepoStatusData,
    RepoSyncData,
    RepoSummarizeOptions,
    RepoSummarizeData,
    PendingSummariesData,
    GitSummaryRecord
} from './core/types.js'

const DEFAULT_BASE_URL = 'http://localhost:3917'

export class MemoriaClient {
    private readonly baseUrl: string

    constructor(baseUrl?: string) {
        this.baseUrl = (baseUrl ?? process.env.MEMORIA_SERVER_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    }

    private async post<T>(path: string, body: unknown): Promise<MemoriaResult<T>> {
        const res = await fetch(`${this.baseUrl}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
        return (await res.json()) as MemoriaResult<T>
    }

    private async get<T>(path: string): Promise<MemoriaResult<T>> {
        const res = await fetch(`${this.baseUrl}${path}`)
        return (await res.json()) as MemoriaResult<T>
    }

    /** Write a session (events, decisions, skills) into persistent memory */
    async remember(data: SessionData): Promise<MemoriaResult<{ sessionId: string }>> {
        return this.post('/v1/remember', data)
    }

    /** Recall relevant memories matching the filter */
    async recall(filter: RecallFilter): Promise<MemoriaResult<RecallHit[]>> {
        return this.post('/v1/recall', filter)
    }

    /**
     * Report the observed utility of a prior recall (UFL). Fail-open: a network/server error
     * resolves to { ok:false } instead of throwing, so it never disrupts the agent loop.
     */
    async recordRecallOutcome(recallId: string, outcome: RecallOutcomeInput): Promise<MemoriaResult<{ updated: boolean }>> {
        try {
            return await this.post(`/v1/recall/${encodeURIComponent(recallId)}/outcome`, outcome)
        } catch (error) {
            return {
                ok: false,
                error: error instanceof Error ? error.message : String(error),
                meta: { source: 'mcp', evidence: [], confidence: 0, timestamp: new Date().toISOString(), latency_ms: 0 }
            }
        }
    }

    /**
     * Report EXPLICIT host feedback that a prior recall was (not) useful — the high-fidelity UFL
     * signal (Phase 3(a)). Recorded under `outcome_kind='explicit'` and, when hit ids are supplied,
     * attributed per-memory so it fully overrides the weak reuse proxy in ranking / retention.
     * Fail-open (delegates to recordRecallOutcome).
     */
    async markRecallUseful(recallId: string, useful: boolean, hitIds?: string[]): Promise<MemoriaResult<{ updated: boolean }>> {
        const outcome: RecallOutcomeInput = {
            signal: 'explicit',
            used: useful,
            ...(hitIds && hitIds.length > 0
                ? { hits: hitIds.map((id) => ({ id, utility_score: useful ? 1 : 0 })) }
                : {})
        }
        return this.recordRecallOutcome(recallId, outcome)
    }

    /** Get a structured summary of a specific session */
    async summarizeSession(sessionId: string): Promise<MemoriaResult<SessionSummary>> {
        return this.get(`/v1/sessions/${encodeURIComponent(sessionId)}/summary`)
    }

    /** Check health of the Memoria service */
    async health(): Promise<MemoriaResult<HealthStatus>> {
        return this.get('/v1/health')
    }

    /** Get stats (session/event/skill counts, top skills) */
    async stats(): Promise<MemoriaResult<StatsData>> {
        return this.get('/v1/stats')
    }

    /** Get recall routing telemetry for observability */
    async recallTelemetry(opts?: { window?: string; limit?: number }): Promise<MemoriaResult<RecallTelemetryData>> {
        const params = new URLSearchParams()
        if (opts?.window) params.set('window', opts.window)
        if (typeof opts?.limit === 'number') params.set('limit', String(opts.limit))
        const suffix = params.toString() ? `?${params.toString()}` : ''
        return this.get(`/v1/telemetry/recall${suffix}`)
    }

    // ─── Git-Aware Memory (docs/issues/issue-1) ──────────────────────────────

    /** Register a local git repository for read-only observation */
    async repoAdd(input: RepoAddInput & { path: string }): Promise<MemoriaResult<RepoRegistrationData>> {
        return this.post('/v1/repos', {
            path: input.path,
            name: input.name,
            default_branch: input.defaultBranch,
            scan_history: input.scanHistory,
            history_limit: input.historyLimit
        })
    }

    /** List repositories observed by Memoria */
    async repoList(): Promise<MemoriaResult<RepoListItem[]>> {
        return this.get('/v1/repos')
    }

    /** Registry + live git state of a repository (by id, name, or path) */
    async repoStatus(ref: string): Promise<MemoriaResult<RepoStatusData>> {
        return this.get(`/v1/repos/${encodeURIComponent(ref)}/status`)
    }

    /** Incremental scan; §20 repo_sync contract (generate_summaries=false skips summaries) */
    async repoSync(ref: string, opts?: { generate_summaries?: boolean; dry_run?: boolean; force_summary?: boolean; from?: string; to?: string }): Promise<MemoriaResult<RepoSyncData>> {
        return this.post(`/v1/repos/${encodeURIComponent(ref)}/sync`, opts ?? {})
    }

    /** Generate summaries for a branch/range/merge/tag, or process pending events */
    async repoSummarize(ref: string, opts?: RepoSummarizeOptions): Promise<MemoriaResult<RepoSummarizeData>> {
        return this.post(`/v1/repos/${encodeURIComponent(ref)}/summarize`, opts ?? {})
    }

    /** Pending summary requests awaiting agent enrichment (with rebuilt context) */
    async repoPendingSummaries(ref: string): Promise<MemoriaResult<PendingSummariesData>> {
        return this.get(`/v1/repos/${encodeURIComponent(ref)}/summaries/pending`)
    }

    /** Write back an agent-generated §7.5 summary payload */
    async repoSubmitSummary(ref: string, summaryId: string, payload: unknown): Promise<MemoriaResult<{ summary: GitSummaryRecord; promoted: boolean }>> {
        return this.post(`/v1/repos/${encodeURIComponent(ref)}/summaries/${encodeURIComponent(summaryId)}`, payload)
    }

    /** Poll health until service is ready. Useful right after startup. */
    async waitUntilReady(opts?: { maxWaitMs?: number; intervalMs?: number }): Promise<boolean> {
        const deadline = Date.now() + (opts?.maxWaitMs ?? 10_000)
        const interval = opts?.intervalMs ?? 500

        while (Date.now() < deadline) {
            try {
                const r = await this.health()
                if (r.data?.ok) return true
            } catch {
                // not yet up, keep polling
            }
            await new Promise((r) => setTimeout(r, interval))
        }
        return false
    }
}
