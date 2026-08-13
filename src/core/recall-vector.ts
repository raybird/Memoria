// Semantic recall via the optional libSQL vector index (docs/RFC-semantic-recall.md).
//
// Design contract (RFC §2): libSQL is a semantic INDEX, not a store. The helper returns ranked
// prefixed Memoria ids only; every authoritative field (timestamp, project, snippet) is re-read
// from the local SQLite source of truth. The whole path is opt-in (mode:'vector'), gated by
// LIBSQL_URL, and fail-open — any failure degrades to the lexical floor, never blocks recall().
//
// The embedding helper lives OUTSIDE core deps (skills/memoria-vector, spawned via
// node:child_process): Memoria-only mode stays dependency-free. Spawn-per-query is viable because
// the Phase 0' spike measured ~950ms cached model load + ~3ms inference (multilingual-e5-small q8).

import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from './paths.js'
import { withDb } from './db/connection.js'
import { maybeParseJson, parseCreatedAt } from './utils.js'
import { parseSkillEvent } from './extract.js'

export type VectorRecallStatus = 'ok' | 'unavailable' | 'timeout' | 'error'

export type VectorRow = {
    type: 'session' | 'decision' | 'skill'
    id: string
    session_id: string
    timestamp: string
    project: string
    snippet: string
    score: number
    // Deliberately never set on this path (issue-9). `relevance` means LEXICAL match quality, and a
    // vector hit is precisely the case where that measure is meaningless — the query paraphrases the
    // memory instead of quoting it. Leaving it absent is what lets recall() report
    // `confidence: null` ("cannot judge") rather than 0 ("judged, and it is bad").
    relevance?: never
    node_id?: string
}

const DEFAULT_TIMEOUT_MS = 4000
const OVERFETCH_FACTOR = 3

// Same display-snippet semantics as the keyword path: compact JSON if it parses, else raw text.
function toSnippet(content: string): string {
    const parsed = maybeParseJson(content)
    return typeof parsed === 'object' && parsed !== null
        ? JSON.stringify(parsed).slice(0, 200)
        : String(content).slice(0, 200)
}

// The bridge's skill entity slug transform (build-mcp-bridge-payload.mjs): NOT slugify().
function bridgeSkillSlug(name: string): string {
    return name.toLowerCase().replace(/\s+/g, '_')
}

function resolveHelperScript(): string | null {
    const override = process.env.MEMORIA_VECTOR_RECALL_CMD?.trim()
    if (override) return override
    const here = dirname(fileURLToPath(import.meta.url))
    // dist/cli.mjs → ../skills; tsx on src/core/*.ts → ../../skills.
    for (const rel of ['../skills/memoria-vector/vector-recall.mjs', '../../skills/memoria-vector/vector-recall.mjs']) {
        const p = resolve(here, rel)
        if (existsSync(p)) return p
    }
    return null
}

/** What `doctor` needs to say something true about the optional semantic layer (issue-12).
 *
 * Lives beside `resolveHelperScript` rather than in the doctor command on purpose: a diagnostic that
 * re-implements the search order drifts from it, and then confidently reports on a helper that
 * recall never loads. Reusing the resolution is the whole point of the check.
 *
 * Every field describes an OPT-IN layer. `enabled:false` is a healthy state, not a failure — the
 * renderer must not turn it into one (`scripts/test-no-clone-install.sh` asserts every doctor check
 * passes on an install that has no vector layer at all).
 */
export type VectorLayerReport = {
    /** LIBSQL_URL is what gates the whole path; without it recall never reaches the helper. */
    enabled: boolean
    helperPath: string | null
    /** MEMORIA_VECTOR_RECALL_CMD, when the caller points us at their own helper. */
    override: string | null
    provider: string
    /** null = not probed; `embedderUnknownReason` says why. */
    embedderInstalled: boolean | null
    embedderDir: string | null
    /** Why the embedder was not probed, so a renderer can say the check was SKIPPED rather than
     *  quietly omitting a line — the same no-silent-caps rule the truncation paths follow. */
    embedderUnknownReason: 'overridden_helper' | 'provider_needs_no_embedder' | 'helper_unresolved' | null
}

export function inspectVectorLayer(): VectorLayerReport {
    const override = process.env.MEMORIA_VECTOR_RECALL_CMD?.trim() || null
    // `resolveHelperScript` hands back an override verbatim without probing it — recallVector is the
    // one that applies `existsSync` (:206). Repeat that here, or a typo'd override would be reported
    // as a healthy helper while recall quietly degrades, which is the exact failure being diagnosed.
    const resolved = resolveHelperScript()
    const helperPath = resolved !== null && existsSync(resolved) ? resolved : null
    const provider = (process.env.MEMORIA_EMBED_PROVIDER ?? 'local').trim()
    const report: VectorLayerReport = {
        enabled: Boolean(process.env.LIBSQL_URL?.trim()),
        helperPath,
        override,
        provider,
        embedderInstalled: null,
        embedderDir: null,
        embedderUnknownReason: null
    }
    // Only the helper we ship has a dependency layout we can reason about. An override may name a
    // bare command, or a copy bundled into someone else's image — probing a sibling node_modules
    // there would manufacture a failure out of a working setup. Each skip names itself, because the
    // people most likely to hit the missing-embedder failure are exactly the ones running an
    // override, and a check that silently does not run is worse for them than no check at all.
    if (helperPath === null) {
        report.embedderUnknownReason = 'helper_unresolved'
        return report
    }
    if (override !== null) {
        report.embedderUnknownReason = 'overridden_helper'
        return report
    }
    if (provider !== 'local') {
        report.embedderUnknownReason = 'provider_needs_no_embedder'
        return report
    }
    const dir = dirname(helperPath)
    report.embedderDir = dir
    report.embedderInstalled = existsSync(resolve(dir, 'node_modules', '@huggingface', 'transformers'))
    return report
}

function runHelper(
    script: string,
    query: string,
    topK: number,
    timeoutMs: number
): Promise<{ status: VectorRecallStatus; hits: Array<{ name: string; distance: number }> }> {
    return new Promise((resolvePromise) => {
        const child = spawn(process.execPath, [script], { stdio: ['pipe', 'pipe', 'pipe'] })
        let stdout = ''
        let settled = false
        const finish = (status: VectorRecallStatus, hits: Array<{ name: string; distance: number }> = []) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            resolvePromise({ status, hits })
        }
        const timer = setTimeout(() => {
            try { child.kill('SIGKILL') } catch { /* already gone */ }
            finish('timeout')
        }, timeoutMs)
        child.stdout.on('data', (c) => { stdout += c })
        child.stderr.resume()
        child.on('error', () => finish('error'))
        child.on('close', (code) => {
            if (code !== 0) return finish('error')
            try {
                const parsed = JSON.parse(stdout) as { hits?: Array<{ name?: unknown; distance?: unknown }> }
                const hits = (Array.isArray(parsed.hits) ? parsed.hits : [])
                    .filter((h) => typeof h?.name === 'string' && h.name)
                    .map((h) => ({ name: String(h.name), distance: Number(h.distance ?? 0) }))
                finish('ok', hits)
            } catch {
                finish('error')
            }
        })
        child.stdin.end(JSON.stringify({ query, topK }))
    })
}

// Map ranked prefixed names back to authoritative local rows (RFC §5a). Unknown ids, filtered-out
// rows, and unmappable prefixes are silently dropped — the index may lag the source of truth.
function mapNamesToRows(
    dbPath: string,
    names: string[],
    projectFilter?: string,
    scopeFilter?: string,
    afterDate?: Date
): VectorRow[] {
    if (!existsSync(dbPath)) return []
    return withDb(dbPath, { readonly: true }, (db) => {
        const sessionStmt = db.prepare('SELECT id, timestamp, project, scope, summary FROM sessions WHERE id = ?')
        const eventStmt = db.prepare(`
          SELECT e.id, e.session_id, e.timestamp, e.content, s.project, s.scope
          FROM events e JOIN sessions s ON s.id = e.session_id
          WHERE e.id = ? AND e.event_type = ?
        `)
        const nodeSourceStmt = db.prepare('SELECT session_id FROM memory_node_sources WHERE node_id = ? ORDER BY created_at DESC LIMIT 1')

        // skill:<slug> entities carry the bridge's name slug, not an event id — build a slug map
        // over recent SkillLearned events once, only if any skill: name is present.
        let skillBySlug: Map<string, { id: string; session_id: string; timestamp: string; content: string; project: string; scope: string }> | null = null
        const loadSkillMap = () => {
            if (skillBySlug) return skillBySlug
            skillBySlug = new Map()
            const rows = db.prepare(`
              SELECT e.id, e.session_id, e.timestamp, e.content, s.project, s.scope
              FROM events e JOIN sessions s ON s.id = e.session_id
              WHERE e.event_type = 'SkillLearned'
              ORDER BY e.timestamp DESC LIMIT 500
            `).all() as Array<{ id: string; session_id: string; timestamp: string; content: string; project: string; scope: string }>
            for (const row of rows) {
                const slug = bridgeSkillSlug(parseSkillEvent(row.content).skill_name.trim())
                if (slug && !skillBySlug.has(slug)) skillBySlug.set(slug, row)
            }
            return skillBySlug
        }

        const passesFilters = (project: string, scope: string, timestamp: string): boolean => {
            if (projectFilter && project !== projectFilter) return false
            if (scopeFilter && scope !== scopeFilter) return false
            if (afterDate && parseCreatedAt(timestamp) < afterDate.getTime()) return false
            return true
        }

        const rows: VectorRow[] = []
        const seen = new Set<string>()
        const push = (row: VectorRow) => {
            const key = `${row.id}:${row.session_id}`
            if (seen.has(key)) return
            seen.add(key)
            rows.push(row)
        }

        for (const name of names) {
            const sep = name.indexOf(':')
            if (sep <= 0) continue
            const prefix = name.slice(0, sep)
            const ref = name.slice(sep + 1)

            if (prefix === 'session') {
                const s = sessionStmt.get(ref) as { id: string; timestamp: string; project: string; scope: string; summary: string | null } | undefined
                if (!s || !passesFilters(s.project, s.scope, s.timestamp)) continue
                const content = s.summary ?? ''
                push({ type: 'session', id: s.id, session_id: s.id, timestamp: s.timestamp, project: s.project, snippet: toSnippet(content), score: 0 })
            } else if (prefix === 'decision') {
                const e = eventStmt.get(ref, 'DecisionMade') as { id: string; session_id: string; timestamp: string; content: string; project: string; scope: string } | undefined
                if (!e || !passesFilters(e.project, e.scope, e.timestamp)) continue
                push({ type: 'decision', id: e.id, session_id: e.session_id, timestamp: e.timestamp, project: e.project, snippet: toSnippet(e.content), score: 0 })
            } else if (prefix === 'skill') {
                const e = loadSkillMap().get(ref)
                if (!e || !passesFilters(e.project, e.scope, e.timestamp)) continue
                push({ type: 'skill', id: e.id, session_id: e.session_id, timestamp: e.timestamp, project: e.project, snippet: toSnippet(e.content), score: 0 })
            } else if (prefix === 'mem_node') {
                const src = nodeSourceStmt.get(ref) as { session_id: string } | undefined
                if (!src) continue
                const s = sessionStmt.get(src.session_id) as { id: string; timestamp: string; project: string; scope: string; summary: string | null } | undefined
                if (!s || !passesFilters(s.project, s.scope, s.timestamp)) continue
                const content = s.summary ?? ''
                push({ type: 'session', id: s.id, session_id: s.id, timestamp: s.timestamp, project: s.project, snippet: toSnippet(content), score: 0, node_id: ref })
            }
            // project: / skill_profile / anything else → not a RecallHit type; drop.
        }
        return rows
    })
}

/**
 * Query the optional semantic index. Returns ranked authoritative rows plus a status for the
 * RFC §6 degradation matrix. Never throws — every failure maps to a status the caller can route.
 */
export async function recallVector(
    dbPath: string,
    query: string,
    projectFilter?: string,
    scopeFilter?: string,
    topK = 5,
    afterDate?: Date
): Promise<{ rows: VectorRow[]; status: VectorRecallStatus }> {
    if (!process.env.LIBSQL_URL?.trim()) return { rows: [], status: 'unavailable' }
    const script = resolveHelperScript()
    if (!script || !existsSync(script)) return { rows: [], status: 'unavailable' }
    const timeoutMs = Math.max(100, Number(process.env.MEMORIA_VECTOR_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS)
    try {
        const { status, hits } = await runHelper(script, query, Math.max(1, topK) * OVERFETCH_FACTOR, timeoutMs)
        if (status !== 'ok') return { rows: [], status }
        const rows = mapNamesToRows(dbPath, hits.map((h) => h.name), projectFilter, scopeFilter, afterDate).slice(0, Math.max(1, topK))
        return { rows, status: 'ok' }
    } catch {
        return { rows: [], status: 'error' }
    }
}

/**
 * Reciprocal Rank Fusion (RFC §5b): rank-position based, so lexical relevance×decay scores and
 * vector cosine distances never need to share a scale. Ties keep first-list (lexical) precedence
 * via stable sort + insertion order. The fused value replaces `score` (ordering only — confidence
 * still derives from `relevance`).
 */
export function rrfFuse<T extends { id: string; session_id: string; score?: number }>(
    lists: T[][],
    topK: number,
    k = 60
): T[] {
    const acc = new Map<string, { row: T; score: number }>()
    for (const list of lists) {
        list.forEach((row, rank) => {
            const key = `${row.id}:${row.session_id}`
            const inc = 1 / (k + rank + 1)
            const entry = acc.get(key)
            if (entry) entry.score += inc
            else acc.set(key, { row, score: inc })
        })
    }
    return Array.from(acc.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(1, topK))
        .map((e) => ({ ...e.row, score: e.score }))
}
