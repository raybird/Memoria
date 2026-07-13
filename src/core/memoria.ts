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
    queryGovernanceReview,
    logRecallTelemetry,
    recordRecallOutcome,
    runVerify,
    buildMemoryIndex,
    recallTree,
    recallKeyword,
    applyUtilityWeighting,
    querySessionSummary,
    listSourceRecords,
    registerRepository,
    listRepositories,
    findRepository,
    relocateRepositoryInstance,
    removeRepository
} from './db/index.js'
import { importSourceFile } from './source-import.js'
import { resolveRepositoryIdentity } from './git/identity.js'
import { getHostId } from './git/host.js'
import { recallVector, rrfFuse } from './recall-vector.js'
import { buildCompiledWiki } from './wiki-build.js'
import { fileQueryResult } from './wiki-query.js'
import { runWikiLint } from './wiki-lint.js'
import type {
    FiledQueryData,
    FileQueryInput,
    MemoriaPaths,
    ImportSourceInput,
    ImportedSourceData,
    SessionData,
    MemoriaResult,
    RecallFilter,
    RecallHit,
    SessionSummary,
    HealthStatus,
    StatsData,
    RecallTelemetryData,
    GovernanceReviewData,
    GovernanceReviewOptions,
    RecallOutcomeInput,
    WikiBuildResult,
    WikiLintOptions,
    WikiLintResult,
    RepoAddInput,
    RepoRegistrationData,
    RepoListItem,
    RepoStatusData,
    RepoRemoveOptions,
    RepoRemoveData
} from './types.js'

// Payload a producer hands back to withResult; the wrapper stamps source/timestamp/latency
// and folds `extra` (e.g. route_mode, fallback_used, reasoning_path) into the success meta.
type ResultPayload<T> = {
    data: T
    evidence: string[]
    confidence: number
    extra?: Record<string, unknown>
}

// Wraps a producer in the MemoriaResult envelope: success meta on return, error meta on throw.
// `elapsed()` exposes the same clock the final latency_ms uses, for producers that log latency
// mid-flight (e.g. recall telemetry). Throwing produces the ok:false envelope with this source.
async function withResult<T>(
    source: string,
    producer: (ctx: { elapsed: () => number }) => Promise<ResultPayload<T>>
): Promise<MemoriaResult<T>> {
    const start = Date.now()
    try {
        const payload = await producer({ elapsed: () => Date.now() - start })
        return {
            ok: true,
            data: payload.data,
            meta: {
                source,
                evidence: payload.evidence,
                confidence: payload.confidence,
                ...(payload.extra ?? {}),
                timestamp: new Date().toISOString(),
                latency_ms: Date.now() - start
            }
        }
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            meta: {
                source,
                evidence: [],
                confidence: 0,
                timestamp: new Date().toISOString(),
                latency_ms: Date.now() - start
            }
        }
    }
}

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
            path.join(this.paths.memoryDir, 'sources'),
            path.join(this.paths.memoryDir, 'checkpoints'),
            path.join(this.paths.memoryDir, 'exports'),
            this.paths.knowledgeDir,
            path.join(this.paths.knowledgeDir, 'Daily'),
            path.join(this.paths.knowledgeDir, 'Sources'),
            path.join(this.paths.knowledgeDir, 'Skills'),
            path.join(this.paths.knowledgeDir, 'Decisions'),
            this.paths.configPath
        ]
        await Promise.all(dirs.map((d) => fs.mkdir(d, { recursive: true })))
        initDatabase(this.paths.dbPath)
    }

    async addSource(input: ImportSourceInput): Promise<MemoriaResult<ImportedSourceData>> {
        return withResult('markdown', async () => {
            await this.init()
            const data = await importSourceFile(this.paths, input)
            await buildCompiledWiki(this.paths)
            return { data, evidence: [data.source.id, data.page.id], confidence: 1 }
        })
    }

    async buildWiki(): Promise<MemoriaResult<WikiBuildResult>> {
        return withResult('markdown', async () => {
            await this.init()
            const data = await buildCompiledWiki(this.paths)
            return { data, evidence: Object.values(data.specialPages), confidence: 1 }
        })
    }

    async listSources(options?: { type?: string; scope?: string; limit?: number }): Promise<MemoriaResult<ReturnType<typeof listSourceRecords>>> {
        return withResult('sqlite', async () => {
            if (!existsSync(this.paths.dbPath)) {
                return { data: [], evidence: [], confidence: 1 }
            }
            initDatabase(this.paths.dbPath)
            const data = listSourceRecords(this.paths.dbPath, options)
            return { data, evidence: data.map((item) => item.id), confidence: 1 }
        })
    }

    async fileQuery(input: FileQueryInput): Promise<MemoriaResult<FiledQueryData>> {
        return withResult('markdown', async () => {
            await this.init()
            const recallResult = await this.recall({
                query: input.query,
                scope: input.scope,
                top_k: input.top_k,
                time_window: input.time_window,
                mode: input.mode
            })
            if (!recallResult.ok) {
                throw new Error(recallResult.error)
            }
            const hits = recallResult.data ?? []
            if (hits.length === 0) {
                throw new Error('No recall hits found for file-query')
            }
            const data = await fileQueryResult(this.paths, input, hits)
            await buildCompiledWiki(this.paths)
            return {
                data,
                evidence: [data.artifact.id, data.page.id, ...hits.map((hit) => hit.id)],
                confidence: hits[0]?.score ?? 0
            }
        })
    }

    async wikiLint(options?: WikiLintOptions): Promise<MemoriaResult<WikiLintResult>> {
        return withResult('sqlite', async () => {
            await this.init()
            const data = runWikiLint(this.paths, options)
            return { data, evidence: data.findings.map((finding) => finding.id), confidence: 1 }
        })
    }

    // ─── remember() ──────────────────────────────────────────────────────────

    async remember(data: SessionData): Promise<MemoriaResult<{ sessionId: string }>> {
        return withResult('sqlite', async () => {
            await this.init()
            const sessionId = importSession(this.paths.dbPath, data)
            await syncDailyNote(this.paths.memoriaHome, this.paths.dbPath, sessionId)
            await extractDecisions(this.paths.memoriaHome, this.paths.dbPath, sessionId)
            await extractSkills(this.paths.memoriaHome, this.paths.dbPath, sessionId)

            // Auto-build tree index by default after successful sync.
            // Disable with MEMORIA_INDEX_AUTOBUILD=0.
            if (process.env.MEMORIA_INDEX_AUTOBUILD !== '0') {
                try {
                    buildMemoryIndex(this.paths.dbPath, { sessionId, project: data.project, scope: data.scope })
                } catch {
                    // Keep remember() fail-open for indexing errors.
                }
            }

            try {
                await buildCompiledWiki(this.paths)
            } catch {
                // Keep remember() fail-open for wiki build errors.
            }

            return { data: { sessionId }, evidence: [sessionId], confidence: 1.0 }
        })
    }

    // ─── recall() ────────────────────────────────────────────────────────────

    async recall(filter: RecallFilter): Promise<MemoriaResult<RecallHit[]>> {
        return withResult('sqlite', async ({ elapsed }) => {
            if (!existsSync(this.paths.dbPath)) {
                return { data: [], evidence: [], confidence: 0 }
            }
            initDatabase(this.paths.dbPath)

            if (shouldSkipAdaptiveRecall(filter)) {
                try {
                    logRecallTelemetry(this.paths.dbPath, {
                        routeMode: 'skipped',
                        fallbackUsed: false,
                        hitCount: 0,
                        latencyMs: elapsed(),
                        query: filter.query,
                        topConfidence: 0
                    })
                } catch {
                    // Keep recall fail-open when telemetry logging fails.
                }

                return {
                    data: [],
                    evidence: [],
                    confidence: 0,
                    extra: { route_mode: 'skipped', fallback_used: false }
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

            // Vector mode never touches the tree route: it is lexical floor + semantic index
            // (RFC-semantic-recall §3). All other modes keep their exact pre-vector code paths.
            const treeRaw = mode !== 'keyword' && mode !== 'vector'
                ? recallTree(this.paths.dbPath, filter.query, filter.project, filter.scope, topK)
                : []
            const keywordRaw = mode === 'tree'
                ? []
                : recallKeyword(this.paths.dbPath, filter.query, filter.project, filter.scope, topK, afterDate)
            // Opt-in semantic route (LIBSQL_URL-gated, fail-open). Awaited before ranking; the
            // keyword floor above is authoritative whenever this degrades.
            const vectorOutcome = mode === 'vector'
                ? await recallVector(this.paths.dbPath, filter.query, filter.project, filter.scope, topK, afterDate)
                : null

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
                relevance?: number
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

                if (mode === 'vector') {
                    // Degradation matrix (RFC-semantic-recall §6): every non-ok status serves the
                    // lexical floor; ok+hits fuses by rank (RRF) so scales never mix.
                    const v = vectorOutcome!
                    if (v.status !== 'ok') {
                        routeMode = v.status === 'timeout' ? 'vector_timeout' : 'vector_unavailable'
                        fallbackUsed = true
                        return keywordRaw as RawRecallRow[]
                    }
                    if (v.rows.length === 0) {
                        routeMode = 'keyword'
                        return keywordRaw as RawRecallRow[]
                    }
                    routeMode = keywordRaw.length > 0 ? 'hybrid_vector' : 'vector'
                    return rrfFuse<RawRecallRow>([keywordRaw as RawRecallRow[], v.rows as RawRecallRow[]], topK)
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

            const rawHits: RecallHit[] = raw.map((r, i) => ({
                type: r.type as RecallHit['type'],
                id: r.id,
                session_id: r.session_id,
                timestamp: r.timestamp,
                project: r.project,
                snippet: r.snippet,
                // score = relevance × time-decay (ranking); relevance is the decay-free match quality
                score: Number.isFinite(r.score) ? Number(r.score) : 0,
                relevance: Number.isFinite(r.relevance) ? Number(r.relevance) : undefined,
                node_id: typeof r.node_id === 'string' ? r.node_id : undefined,
                reasoning_path: Array.isArray(r.reasoning_path) ? r.reasoning_path : undefined
            }))

            // UFL Phase 3: re-rank by accrued per-memory utility (byte-identical when no observations
            // exist). Runs before telemetry so recall_id's top_confidence reflects the surfaced order.
            const hits: RecallHit[] = applyUtilityWeighting(this.paths.dbPath, rawHits)

            let recallId: string | null = null
            try {
                recallId = logRecallTelemetry(this.paths.dbPath, {
                    routeMode,
                    fallbackUsed,
                    hitCount: hits.length,
                    latencyMs: elapsed(),
                    query: filter.query,
                    topConfidence: hits.length > 0 ? (hits[0].relevance ?? hits[0].score) : 0
                })
            } catch {
                // Keep recall fail-open when telemetry logging fails.
            }

            return {
                data: hits,
                evidence: hits.map((h) => h.id),
                // Confidence reflects match quality (decay-free), not recency; fall back to score
                // for rows that predate the relevance field.
                confidence: hits.length > 0 ? (hits[0].relevance ?? hits[0].score) : 0,
                extra: {
                    reasoning_path: hits[0]?.reasoning_path,
                    route_mode: routeMode,
                    fallback_used: fallbackUsed,
                    // UFL: correlates this recall to a later utility outcome. Success branch only.
                    recall_id: recallId ?? undefined
                }
            }
        })
    }

    // ─── summarizeSession() ──────────────────────────────────────────────────

    async summarizeSession(sessionId: string): Promise<MemoriaResult<SessionSummary>> {
        return withResult('sqlite', async () => {
            if (!existsSync(this.paths.dbPath)) {
                throw new Error('Database not found. Run init first.')
            }
            initDatabase(this.paths.dbPath)

            const raw = querySessionSummary(this.paths.dbPath, sessionId)
            if (!raw) {
                throw new Error(`Session not found: ${sessionId}`)
            }

            const summary: SessionSummary = {
                sessionId: raw.session.id,
                timestamp: raw.session.timestamp,
                project: raw.session.project,
                scope: raw.session.scope,
                eventCount: raw.session.event_count,
                summary: raw.session.summary,
                decisions: raw.decisions,
                skills: raw.skills
            }

            return { data: summary, evidence: [sessionId], confidence: 1.0 }
        })
    }

    // ─── health() ────────────────────────────────────────────────────────────

    async health(): Promise<MemoriaResult<HealthStatus>> {
        return withResult('sqlite', async () => {
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

            return { data: status, evidence: [], confidence: 1.0 }
        })
    }

    // ─── stats() ─────────────────────────────────────────────────────────────

    async stats(): Promise<MemoriaResult<StatsData>> {
        return withResult('sqlite', async () => {
            if (!existsSync(this.paths.dbPath)) {
                throw new Error('Database not found. Run init first.')
            }
            initDatabase(this.paths.dbPath)
            const data = queryStats(this.paths.dbPath)
            return { data, evidence: [], confidence: 1.0 }
        })
    }

    // ─── recallTelemetry() ────────────────────────────────────────────────────

    async recallTelemetry(options?: { window?: string; limit?: number }): Promise<MemoriaResult<RecallTelemetryData>> {
        return withResult('sqlite', async () => {
            if (!existsSync(this.paths.dbPath)) {
                throw new Error('Database not found. Run init first.')
            }
            initDatabase(this.paths.dbPath)
            const data = queryRecallTelemetry(this.paths.dbPath, options)
            return { data, evidence: [], confidence: 1.0 }
        })
    }

    async governanceReview(options?: GovernanceReviewOptions): Promise<MemoriaResult<GovernanceReviewData>> {
        return withResult('sqlite', async () => {
            if (!existsSync(this.paths.dbPath)) {
                throw new Error('Database not found. Run init first.')
            }
            initDatabase(this.paths.dbPath)
            const data = queryGovernanceReview(this.paths.dbPath, options)
            return {
                data,
                evidence: data.items.map((item) => item.id),
                confidence: data.items.length > 0 ? 1.0 : 0.8
            }
        })
    }

    // ─── recordRecallOutcome() — UFL utility feedback write-back ────────────────

    async recordRecallOutcome(recallId: string, outcome: RecallOutcomeInput): Promise<MemoriaResult<{ updated: boolean }>> {
        return withResult('sqlite', async () => {
            const updated = recordRecallOutcome(this.paths.dbPath, recallId, {
                signal: outcome.signal,
                utilityScore: outcome.utility_score,
                used: outcome.used,
                hits: Array.isArray(outcome.hits)
                    ? outcome.hits.map((h) => ({ id: h.id, utilityScore: h.utility_score }))
                    : undefined
            })
            // Not-found is a valid no-op (pruned/unknown id): ok:true, updated:false, low confidence.
            return { data: { updated }, evidence: updated ? [recallId] : [], confidence: updated ? 1 : 0 }
        })
    }

    // ─── Git-Aware Memory (docs/issues/issue-1) ──────────────────────────────

    async repoAdd(input: RepoAddInput): Promise<MemoriaResult<RepoRegistrationData>> {
        return withResult('sqlite', async () => {
            await this.init()
            const identity = await resolveRepositoryIdentity(path.resolve(input.path))
            const hostId = await getHostId(this.paths.memoryDir)
            const data = registerRepository(this.paths.dbPath, {
                name: input.name ?? path.basename(identity.repositoryRoot),
                nameExplicit: Boolean(input.name),
                fingerprint: identity.fingerprint,
                normalizedRemoteUrl: identity.normalizedRemoteUrl,
                rootCommitSha: identity.rootCommitSha,
                defaultBranch: input.defaultBranch ?? identity.defaultBranch,
                status: identity.isShallow ? 'limited_history' : 'active',
                hostId,
                localPath: identity.repositoryRoot,
                gitCommonDir: identity.gitCommonDir,
                worktreePath: identity.repositoryRoot,
                currentBranch: identity.currentBranch,
                currentHeadSha: identity.headSha,
                isMainWorktree: identity.isMainWorktree
            })
            return { data, evidence: [data.repository.id, data.instance.id], confidence: 1 }
        })
    }

    async repoList(): Promise<MemoriaResult<RepoListItem[]>> {
        return withResult('sqlite', async () => {
            await this.init()
            const hostId = await getHostId(this.paths.memoryDir)
            const data = listRepositories(this.paths.dbPath, hostId)
            return { data, evidence: data.map((item) => item.repository.id), confidence: 1 }
        })
    }

    async repoStatus(ref: string): Promise<MemoriaResult<RepoStatusData>> {
        return withResult('sqlite', async () => {
            await this.init()
            const hostId = await getHostId(this.paths.memoryDir)
            const found = findRepository(this.paths.dbPath, ref, hostId)
            if (!found) throw new Error(`repository_not_found: ${ref}`)

            let live: RepoStatusData['live']
            if (found.instance) {
                try {
                    const identity = await resolveRepositoryIdentity(found.instance.local_path)
                    live = {
                        current_branch: identity.currentBranch ?? undefined,
                        head_sha: identity.headSha ?? undefined,
                        working_tree_dirty: identity.workingTreeDirty,
                        is_shallow: identity.isShallow,
                        head_moved_since_last_seen: Boolean(
                            found.worktree?.current_head_sha &&
                            identity.headSha &&
                            identity.headSha !== found.worktree.current_head_sha
                        )
                    }
                } catch {
                    // Path gone or not a repo anymore: report registry state only (relocate fixes it).
                    live = undefined
                }
            }
            const data: RepoStatusData = { ...found, live }
            return { data, evidence: [found.repository.id], confidence: 1 }
        })
    }

    async repoRelocate(ref: string, newPath: string): Promise<MemoriaResult<RepoStatusData>> {
        return withResult('sqlite', async () => {
            await this.init()
            const hostId = await getHostId(this.paths.memoryDir)
            const found = findRepository(this.paths.dbPath, ref, hostId)
            if (!found) throw new Error(`repository_not_found: ${ref}`)

            const identity = await resolveRepositoryIdentity(path.resolve(newPath))
            if (identity.fingerprint !== found.repository.fingerprint) {
                throw new Error('repository_identity_mismatch: the new path contains a different repository history')
            }
            const { instance, worktree } = relocateRepositoryInstance(
                this.paths.dbPath,
                found.repository.id,
                hostId,
                identity.repositoryRoot,
                identity.gitCommonDir
            )
            const data: RepoStatusData = { repository: found.repository, instance, worktree }
            return { data, evidence: [found.repository.id, instance.id], confidence: 1 }
        })
    }

    async repoRemove(ref: string, options: RepoRemoveOptions = {}): Promise<MemoriaResult<RepoRemoveData>> {
        return withResult('sqlite', async () => {
            await this.init()
            const hostId = await getHostId(this.paths.memoryDir)
            const found = findRepository(this.paths.dbPath, ref, hostId)
            if (!found) throw new Error(`repository_not_found: ${ref}`)
            const data = removeRepository(this.paths.dbPath, found.repository.id, options)
            return { data, evidence: [data.repository_id], confidence: 1 }
        })
    }
}

const EXPLICIT_RECALL_HINTS = [
    'remember',
    'memory',
    'previous',
    'previously',
    'last time',
    'earlier',
    'before',
    'recall',
    'what did we',
    '我們之前',
    '之前',
    '上次',
    '還記得',
    '回憶',
    '記得'
]

function isEmojiOnlyQuery(query: string): boolean {
    const stripped = query.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]/gu, '')
    return stripped.length === 0 && query.trim().length > 0
}

// CJK scripts (ideographs, kana, hangul) are information-dense: a 2–4 character CJK query is
// usually a real question, whereas a 2–4 character ASCII query is often a fragment. Weight CJK
// characters so the length gate treats "連線池設定" (meaningful) differently from "next" (noise).
// ASCII-only queries keep their original character-count behaviour (weight 1 → no regression).
//
// NOTE: this class is WIDER than utils.TOKEN_SPLIT_PATTERN (ideographs only). A short pure-kana/
// hangul query can pass this gate but produce no keyword tokens downstream. Aligning the two is a
// deliberate open decision — see docs/HANDOVER-improvements.md P5. Left unchanged for now.
const CJK_CHAR = /[぀-ヿ㐀-鿿가-힣]/
const CJK_WEIGHT = 4

function weightedQueryLength(text: string): number {
    let weight = 0
    for (const ch of text) weight += CJK_CHAR.test(ch) ? CJK_WEIGHT : 1
    return weight
}

function shouldSkipAdaptiveRecall(filter: RecallFilter): boolean {
    if (typeof filter.mode === 'string') return false

    const query = filter.query.trim()
    if (!query) return true

    const lower = query.toLowerCase()
    if (EXPLICIT_RECALL_HINTS.some((hint) => lower.includes(hint))) return false

    if (isEmojiOnlyQuery(query)) return true

    const normalized = lower.replace(/\s+/g, ' ').trim()
    const trivialPhrases = new Set([
        'ok', 'okay', 'thanks', 'thank you', 'got it', 'sounds good', 'cool', 'yes', 'no',
        'hi', 'hello', 'hey', 'yo', 'sure', 'nice', 'great', '👍', '👌',
        // Common short Chinese confirmations (2–4 chars would otherwise pass the CJK-weighted gate).
        '好', '好的', '好喔', '了解', '收到', '知道了', '沒問題', '是的', '對啊', '謝謝', '感謝', '沒事'
    ])
    if (trivialPhrases.has(normalized)) return true

    const greetingPattern = /^(hi|hello|hey|yo|good morning|good afternoon|good evening|哈囉|你好|嗨|安安)[!.!\s]*$/i
    if (greetingPattern.test(query)) return true

    // Script-aware length gate: CJK chars are weighted (see weightedQueryLength) so a short but
    // meaningful CJK query is recalled, while short ASCII fragments are still skipped.
    return weightedQueryLength(normalized) < 8
}
