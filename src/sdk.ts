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
    RecallTelemetryData
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
