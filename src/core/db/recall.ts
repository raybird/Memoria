import type Database from 'better-sqlite3'
import { existsSync } from '../paths.js'
import { slugify, shortHash, deriveScope, maybeParseJson, normalizeSkillKey, parseCreatedAt, parseBoundaryDate, tokenizeQuery, tokenCoverage } from '../utils.js'
import { safeDate } from '../utils.js'
import { parseDecisionEvent, parseSkillEvent } from '../extract.js'
import { initDatabase } from './schema.js'
import { withDb } from './connection.js'
import { truncateText } from './mappers.js'
import type { MemoryIndexBuildOptions, MemoryIndexBuildResult, RecallHit } from '../types.js'

const DEFAULT_DECAY_HALF_LIFE_DAYS = 90

// UFL Phase 3 — utility-weighted ranking. A memory needs at least this many recorded outcomes
// before its observed utility is allowed to nudge ranking (a weak lexical-reuse signal must not act
// on a single observation). Weighting only ever DOWN-weights: factor ∈ [UTILITY_FLOOR, 1], so a
// persistently-ignored memory sinks toward half score while a well-reused one stays at its baseline
// — utility never boosts a hit above its relevance×decay score. Below the observation threshold the
// factor is exactly 1, so behaviour is byte-identical to pre-Phase-3 on any DB with no observations.
const UTILITY_MIN_OBSERVATIONS = 2
const UTILITY_FLOOR = 0.5

function utilityFactor(meanUtility: number): number {
    const m = Math.min(1, Math.max(0, meanUtility))
    return UTILITY_FLOOR + (1 - UTILITY_FLOOR) * m
}

// Re-rank final hits by their accrued per-memory utility. Reads memory_utility (populated by recall
// outcomes) and multiplies each hit's ranking score by its utilityFactor. Confidence is untouched
// (it derives from `relevance`, not `score`), so this changes only ORDERING, never the reported
// match quality. Guarantees: no table / no matching rows / none past the observation threshold ⇒ the
// input array is returned unchanged (no re-sort), preserving byte-identical output. Fail-open.
export function applyUtilityWeighting(dbPath: string, hits: RecallHit[]): RecallHit[] {
    if (hits.length === 0 || !existsSync(dbPath)) return hits
    try {
        return withDb(dbPath, { readonly: true }, (db) => {
            const tableExists = db
                .prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'memory_utility' LIMIT 1`)
                .get() as { ok: number } | undefined
            if (!tableExists) return hits

            const ids = [...new Set(hits.map((h) => h.id))]
            const placeholders = ids.map(() => '?').join(',')
            const rows = db
                .prepare(`SELECT ref_id, observations, utility_sum FROM memory_utility WHERE ref_id IN (${placeholders})`)
                .all(...ids) as { ref_id: string; observations: number; utility_sum: number }[]

            const factorById = new Map<string, number>()
            for (const r of rows) {
                if (r.observations < UTILITY_MIN_OBSERVATIONS) continue
                const mean = r.observations > 0 ? r.utility_sum / r.observations : 0
                factorById.set(r.ref_id, utilityFactor(mean))
            }
            if (factorById.size === 0) return hits

            return hits
                .map((h, i) => ({ h, i, score: h.score * (factorById.get(h.id) ?? 1) }))
                .sort((a, b) => (b.score - a.score) || (a.i - b.i))
                .map((w) => ({ ...w.h, score: w.score }))
        })
    } catch {
        return hits // fail-open: utility weighting must never break recall
    }
}

function computeDecayFactor(timestamp: string, halfLifeDays = DEFAULT_DECAY_HALF_LIFE_DAYS): number {
    const ageMs = Date.now() - parseCreatedAt(timestamp)
    if (ageMs <= 0) return 1.0
    const ageDays = ageMs / (24 * 60 * 60 * 1000)
    return 1 / (1 + ageDays / halfLifeDays)
}

function scoreNode(title: string, summary: string, tokens: string[], timestamp?: string): number {
    if (tokens.length === 0) return 0
    const haystack = `${title} ${summary}`.toLowerCase()
    let score = 0
    for (const token of tokens) {
        if (haystack.includes(token)) score += 1
    }
    const relevance = score / tokens.length
    if (!timestamp) return relevance
    return relevance * computeDecayFactor(timestamp)
}

function extractTopicFromSession(
    summary: string,
    decision: string,
    skill: string,
    timestamp: string
): { title: string; summary: string } {
    const fallbackDate = safeDate(timestamp).toISOString().slice(0, 10)
    if (decision.trim()) {
        const title = truncateText(decision.trim(), 72)
        return { title, summary: truncateText(summary || decision, 180) }
    }
    if (skill.trim()) {
        const title = truncateText(skill.trim(), 72)
        return { title, summary: truncateText(summary || skill, 180) }
    }
    if (summary.trim()) {
        const title = truncateText(summary, 72)
        return { title, summary: truncateText(summary, 180) }
    }
    return { title: `Session ${fallbackDate}`, summary: `Session memory captured on ${fallbackDate}` }
}

export function buildMemoryIndex(dbPath: string, options: MemoryIndexBuildOptions = {}): MemoryIndexBuildResult {
    if (!existsSync(dbPath)) {
        throw new Error(`sessions.db not found: ${dbPath}`)
    }
    initDatabase(dbPath)

    return withDb(dbPath, (db) => {
    const nowIso = new Date().toISOString()
    const dryRun = Boolean(options.dryRun)
    const projectFilter = options.project?.trim()
    const scopeFilter = options.scope?.trim()
    const since = parseBoundaryDate(options.since, '--since')
    const specificSessionId = options.sessionId?.trim()

        const sessions = db.prepare(`
          SELECT id, timestamp, project, scope, summary
          FROM sessions
          WHERE 1 = 1
            ${specificSessionId ? 'AND id = ?' : ''}
            ${projectFilter ? 'AND project = ?' : ''}
            ${scopeFilter ? 'AND scope = ?' : ''}
            ${since ? 'AND timestamp >= ?' : ''}
            AND id NOT IN (SELECT DISTINCT session_id FROM memory_node_sources)
          ORDER BY timestamp ASC
        `).all(
            ...[
                ...(specificSessionId ? [specificSessionId] : []),
                ...(projectFilter ? [projectFilter] : []),
                ...(scopeFilter ? [scopeFilter] : []),
                ...(since ? [since.toISOString()] : [])
            ]
        ) as { id: string; timestamp: string; project: string; scope: string; summary: string }[]

        if (sessions.length === 0) {
            return { sessionsConsidered: 0, sessionsIndexed: 0, nodesUpserted: 0, linksUpserted: 0 }
        }

        let nodesUpserted = 0
        let linksUpserted = 0

        const upsertNode = db.prepare(`
          INSERT OR REPLACE INTO memory_nodes
          (id, parent_id, project, scope, title, summary, level, path_key, created_at, updated_at, last_synced_at)
          VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?,
            COALESCE((SELECT created_at FROM memory_nodes WHERE id = ?), ?),
            ?,
            COALESCE((SELECT last_synced_at FROM memory_nodes WHERE id = ?), NULL)
          )
        `)

        const upsertSource = db.prepare(`
          INSERT OR REPLACE INTO memory_node_sources (node_id, session_id, created_at)
          VALUES (?, ?, COALESCE((SELECT created_at FROM memory_node_sources WHERE node_id = ? AND session_id = ?), ?))
        `)

        const eventRowsBySession = db.prepare(`
          SELECT session_id, event_type, content
          FROM events
          WHERE session_id = ?
            AND event_type IN ('DecisionMade', 'SkillLearned')
          ORDER BY timestamp ASC
        `)

        const tx = db.transaction(() => {
            for (const session of sessions) {
                const project = (session.project ?? 'default').trim() || 'default'
                const scope = (session.scope ?? deriveScope(session)).trim() || deriveScope(session)
                const projectSlug = slugify(project).toLowerCase()
                const scopeSlug = slugify(scope).toLowerCase()
                const rootNodeId = `node:project:${scopeSlug}:${projectSlug}`
                const rootPathKey = `${scopeSlug}/${projectSlug}`

                if (!dryRun) {
                    upsertNode.run(
                        rootNodeId,
                        null,
                        project,
                        scope,
                        project,
                        `Project memory directory for ${project}`,
                        0,
                        rootPathKey,
                        rootNodeId,
                        nowIso,
                        nowIso,
                        rootNodeId
                    )
                }
                nodesUpserted += 1

                const eventRows = eventRowsBySession.all(session.id) as { session_id: string; event_type: string; content: string }[]
                let decisionText = ''
                let skillText = ''
                for (const row of eventRows) {
                    if (!decisionText && row.event_type === 'DecisionMade') {
                        decisionText = parseDecisionEvent(row.content).decision
                    }
                    if (!skillText && row.event_type === 'SkillLearned') {
                        skillText = parseSkillEvent(row.content).skill_name
                    }
                    if (decisionText && skillText) break
                }

                const topic = extractTopicFromSession(session.summary ?? '', decisionText, skillText, session.timestamp)
                const topicSlug = slugify(topic.title).toLowerCase()
                const topicNodeId = `node:topic:${scopeSlug}:${projectSlug}:${shortHash(topicSlug, 20)}`
                const topicPathKey = `${rootPathKey}/${topicSlug}`

                if (!dryRun) {
                    upsertNode.run(
                        topicNodeId,
                        rootNodeId,
                        project,
                        scope,
                        topic.title,
                        topic.summary,
                        1,
                        topicPathKey,
                        topicNodeId,
                        nowIso,
                        nowIso,
                        topicNodeId
                    )
                }
                nodesUpserted += 1

                const sessionNodeId = `node:session:${session.id}`
                const sessionTitle = truncateText(session.summary?.trim() || session.id, 80)
                const sessionSummary = truncateText(session.summary?.trim() || `Session ${session.id}`, 180)
                const sessionPathKey = `${topicPathKey}/${slugify(session.id).toLowerCase()}`

                if (!dryRun) {
                    upsertNode.run(
                        sessionNodeId,
                        topicNodeId,
                        project,
                        scope,
                        sessionTitle,
                        sessionSummary,
                        2,
                        sessionPathKey,
                        sessionNodeId,
                        nowIso,
                        nowIso,
                        sessionNodeId
                    )

                    upsertSource.run(topicNodeId, session.id, topicNodeId, session.id, nowIso)
                    upsertSource.run(sessionNodeId, session.id, sessionNodeId, session.id, nowIso)
                }
                nodesUpserted += 1
                linksUpserted += 2
            }
        })

        tx()

        return {
            sessionsConsidered: sessions.length,
            sessionsIndexed: sessions.length,
            nodesUpserted,
            linksUpserted
        }
    })
}

export function recallTree(
    dbPath: string,
    query: string,
    projectFilter?: string,
    scopeFilter?: string,
    topK = 5
): RecallHit[] {
    if (!existsSync(dbPath)) return []

    return withDb(dbPath, (db) => {
        const filter = buildScopeClause({ project: 'project', scope: 'scope' }, { projectFilter, scopeFilter })
        const allNodes = db.prepare(`
          SELECT id, parent_id, project, scope, title, summary, level, updated_at
          FROM memory_nodes
          WHERE 1 = 1
          ${filter.sql}
        `).all(...filter.params) as {
            id: string
            parent_id: string | null
            project: string
            scope: string
            title: string
            summary: string
            level: number
            updated_at: string
        }[]

        const nodes = allNodes.filter((node) => node.level >= 1)

        if (nodes.length === 0) return []

        const nodeById = new Map<string, (typeof allNodes)[number]>()
        for (const node of allNodes) nodeById.set(node.id, node)

        const tokens = tokenizeQuery(query)
        const scored = nodes
            .map((node) => ({
                node,
                score: scoreNode(node.title ?? '', node.summary ?? '', tokens, node.updated_at)
            }))
            .filter((entry) => entry.score > 0)
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score
                return parseCreatedAt(b.node.updated_at) - parseCreatedAt(a.node.updated_at)
            })
            .slice(0, Math.max(1, topK))

        if (scored.length === 0) return []

        const getPath = (nodeId: string): string[] => {
            const pathTitles: string[] = []
            let cursor: string | null = nodeId
            let guard = 0
            while (cursor && guard < 16) {
                const n = nodeById.get(cursor)
                if (!n) break
                pathTitles.push(n.title)
                cursor = n.parent_id
                guard += 1
            }
            return pathTitles.reverse()
        }

        const sessionIdsByNode = db.prepare(`
          SELECT session_id FROM memory_node_sources
          WHERE node_id = ?
          ORDER BY created_at DESC
          LIMIT ?
        `)

        const getSession = db.prepare(`
          SELECT id, timestamp, project, summary
          FROM sessions
          WHERE id = ?
        `)

        const hits: RecallHit[] = []
        for (const entry of scored) {
            const linked = sessionIdsByNode.all(entry.node.id, 3) as { session_id: string }[]
            const reasoningPath = getPath(entry.node.id)
            for (const link of linked) {
                const session = getSession.get(link.session_id) as {
                    id: string
                    timestamp: string
                    project: string
                    summary: string
                } | undefined
                if (!session) continue
                hits.push({
                    type: 'session',
                    id: session.id,
                    session_id: session.id,
                    timestamp: session.timestamp,
                    project: session.project,
                    snippet: truncateText(session.summary ?? entry.node.summary ?? entry.node.title, 200),
                    score: entry.score,
                    relevance: scoreNode(entry.node.title ?? '', entry.node.summary ?? '', tokens),
                    node_id: entry.node.id,
                    reasoning_path: reasoningPath
                })
            }
        }

        const deduped = new Map<string, RecallHit>()
        for (const hit of hits) {
            const existing = deduped.get(hit.id)
            if (!existing || hit.score > existing.score) deduped.set(hit.id, hit)
        }

        const finalHits = Array.from(deduped.values())
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score
                return parseCreatedAt(b.timestamp) - parseCreatedAt(a.timestamp)
            })
            .slice(0, topK)

        // Record recall hits — used by stale cleanup to identify active memory nodes
        try {
            const hitNodeIds = [...new Set(finalHits.map((h) => h.node_id).filter(Boolean))]
            if (hitNodeIds.length > 0) {
                const now = new Date().toISOString()
                const stmt = db.prepare('UPDATE memory_nodes SET last_synced_at = ? WHERE id = ?')
                db.transaction(() => { for (const id of hitNodeIds) stmt.run(now, id) })()
            }
        } catch { /* fail-open: tracking failure must not affect recall results */ }

        return finalHits
    })
}

type KeywordRow = { type: string; id: string; session_id: string; timestamp: string; project: string; snippet: string; score: number; relevance: number }

const FTS_MIN_TERM_LEN = 3

// Compact a raw event/session `content` field into a display snippet: pretty JSON if it parses as
// an object, else the raw text, both capped at 200 chars. Shared by the FTS and LIKE recall paths.
function buildSnippet(content: string): string {
    const parsed = maybeParseJson(content)
    return typeof parsed === 'object' && parsed !== null
        ? JSON.stringify(parsed).slice(0, 200)
        : String(content).slice(0, 200)
}

// Build the optional project/scope/after-date WHERE predicates shared across every recall query.
// `cols` names the columns per query (raw column, table alias, or COALESCE expression); the
// returned params line up positionally with the `?` placeholders in `sql`.
function buildScopeClause(
    cols: { project: string; scope: string; time?: string },
    opts: { projectFilter?: string; scopeFilter?: string; afterDate?: Date }
): { sql: string; params: string[] } {
    const parts: string[] = []
    const params: string[] = []
    if (opts.projectFilter) { parts.push(`AND ${cols.project} = ?`); params.push(opts.projectFilter) }
    if (opts.scopeFilter) { parts.push(`AND ${cols.scope} = ?`); params.push(opts.scopeFilter) }
    if (opts.afterDate && cols.time) { parts.push(`AND ${cols.time} >= ?`); params.push(opts.afterDate.toISOString()) }
    return { sql: parts.join('\n        '), params }
}

function buildFtsMatch(query: string): string {
    // Trigram FTS terms need >=3 chars. Quote each as an FTS5 string literal (escaping embedded
    // quotes) and OR-join so bm25 ranks by how many / how rare the matched terms are.
    return tokenizeQuery(query, FTS_MIN_TERM_LEN)
        .map((t) => `"${t.replace(/"/g, '""')}"`)
        .join(' OR ')
}

function bm25ToRelevance(rank: number): number {
    // bm25() returns <= 0 with more-negative = more relevant. Map to [0,1), monotonic increasing.
    const x = rank < 0 ? -rank : 0
    return x / (1 + x)
}

function queryRecallFts(
    db: Database.Database,
    query: string,
    match: string,
    projectFilter?: string,
    scopeFilter?: string,
    topK = 5,
    afterDate?: Date
): KeywordRow[] {
    const filter = buildScopeClause(
        { project: 'COALESCE(s.project, ss.project)', scope: 'COALESCE(s.scope, ss.scope)', time: 'COALESCE(s.timestamp, se.timestamp)' },
        { projectFilter, scopeFilter, afterDate }
    )
    const rows = db.prepare(`
      SELECT recall_fts.kind AS kind,
             recall_fts.ref_id AS id,
             recall_fts.session_id AS session_id,
             COALESCE(s.timestamp, se.timestamp) AS timestamp,
             COALESCE(s.project, ss.project) AS project,
             recall_fts.body AS content,
             bm25(recall_fts) AS rank
      FROM recall_fts
      LEFT JOIN sessions s  ON recall_fts.kind = 'session' AND s.id = recall_fts.ref_id
      LEFT JOIN events   se ON recall_fts.kind IN ('decision', 'skill') AND se.id = recall_fts.ref_id
      LEFT JOIN sessions ss ON recall_fts.kind IN ('decision', 'skill') AND ss.id = recall_fts.session_id
      WHERE recall_fts MATCH ?
        AND (recall_fts.kind = 'session' OR ss.id IS NOT NULL)
        ${filter.sql}
      ORDER BY rank
      LIMIT ?
    `).all(match, ...filter.params, Math.max(1, topK) * 4) as { kind: string; id: string; session_id: string; timestamp: string; project: string; content: string; rank: number }[]

    return rows
        .map((r) => {
            const relevance = tokenCoverage(query, String(r.content))
            const score = bm25ToRelevance(r.rank) * computeDecayFactor(r.timestamp)
            return { type: r.kind, id: r.id, session_id: r.session_id, timestamp: r.timestamp, project: r.project, snippet: buildSnippet(r.content), score, relevance }
        })
        .sort((a, b) => {
            if (Math.abs(b.score - a.score) > 0.001) return b.score - a.score
            return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        })
        .slice(0, topK)
}

export function recallKeyword(
    dbPath: string,
    query: string,
    projectFilter?: string,
    scopeFilter?: string,
    topK = 5,
    afterDate?: Date
): Array<{ type: string; id: string; session_id: string; timestamp: string; project: string; snippet: string; score: number; relevance: number }> {
    return withDb(dbPath, (db) => {
        // Primary path: FTS5 + bm25 over the trigram-indexed corpus.
        try {
            const match = buildFtsMatch(query)
            if (match) {
                const ftsRows = queryRecallFts(db, query, match, projectFilter, scopeFilter, topK, afterDate)
                if (ftsRows.length > 0) return ftsRows
            }
        } catch {
            // recall_fts missing (pre-migration DB) or a malformed MATCH → fall through to LIKE.
        }
        // Fallback path: original LIKE scan. Covers sub-trigram (1-2 char) / CJK-short queries and
        // any query the FTS index does not answer, so behaviour is a strict superset of before.
        return queryRecallLike(db, query, projectFilter, scopeFilter, topK, afterDate)
    })
}

function queryRecallLike(
    db: Database.Database,
    query: string,
    projectFilter?: string,
    scopeFilter?: string,
    topK = 5,
    afterDate?: Date
): KeywordRow[] {
    type Row = { id: string; session_id: string; timestamp: string; content: string; project: string }
    const q = `%${query.toLowerCase()}%`

    // Decision and skill rows share one query, parameterized by event_type.
    const eventFilter = buildScopeClause({ project: 's.project', scope: 's.scope', time: 'e.timestamp' }, { projectFilter, scopeFilter, afterDate })
    const eventStmt = db.prepare(`
      SELECT e.id, e.session_id, e.timestamp, e.content, s.project
      FROM events e JOIN sessions s ON s.id = e.session_id
      WHERE e.event_type = ?
        AND LOWER(e.content) LIKE ?
        ${eventFilter.sql}
      ORDER BY e.timestamp DESC
      LIMIT ?
    `)
    const decisionRows = eventStmt.all('DecisionMade', q, ...eventFilter.params, topK) as Row[]
    const skillRows = eventStmt.all('SkillLearned', q, ...eventFilter.params, topK) as Row[]

    const sessionFilter = buildScopeClause({ project: 'project', scope: 'scope', time: 'timestamp' }, { projectFilter, scopeFilter, afterDate })
    const sessionRows = db.prepare(`
      SELECT id, id AS session_id, timestamp, COALESCE(summary, '') AS content, project
      FROM sessions
      WHERE (LOWER(summary) LIKE ? OR LOWER(project) LIKE ?)
        ${sessionFilter.sql}
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(q, q, ...sessionFilter.params, topK) as Row[]

    const all = [
        ...decisionRows.map((r) => ({ type: 'decision' as const, ...r })),
        ...skillRows.map((r) => ({ type: 'skill' as const, ...r })),
        ...sessionRows.map((r) => ({ type: 'session' as const, ...r }))
    ]

    const tokens = tokenizeQuery(query)

    return all
        .map((r) => {
            const snippet = buildSnippet(r.content)
            const scored = scoreNode('', snippet, tokens, r.timestamp)
            const score = Math.max(scored, computeDecayFactor(r.timestamp) * 0.1)
            const relevance = tokenCoverage(query, String(r.content))
            return { type: r.type, id: r.id, session_id: r.session_id, timestamp: r.timestamp, project: r.project, snippet, score, relevance }
        })
        .sort((a, b) => {
            if (Math.abs(b.score - a.score) > 0.001) return b.score - a.score
            return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        })
        .slice(0, topK)
}
