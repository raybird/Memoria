// Utility helpers for Memoria
// Extracted from cli.ts – pure functions with no side-effects

import { createHash } from 'node:crypto'
import type { Json, SessionData, SessionEvent, CalibrationSummary, CalibrationBucket } from './types.js'

export function safeDate(raw?: string): Date {
    const d = raw ? new Date(raw) : new Date()
    return Number.isNaN(d.getTime()) ? new Date() : d
}

// Word-token pattern for recall/telemetry tokenization: ASCII alphanumerics plus CJK
// unified ideographs (U+4E00–U+9FFF); everything else is a delimiter.
//
// NOTE: this range is intentionally NARROWER than the adaptive-gate CJK class in
// memoria.ts (CJK_CHAR, which also spans kana U+3040–U+30FF and hangul U+AC00–U+D7A3).
// A short pure-kana/hangul query can therefore pass the length gate yet yield no tokens
// here. Unifying the two ranges is a deliberate open decision (up: index kana/hangul in
// the keyword path; down: stop weighting scripts the tokenizer drops) — see
// docs/HANDOVER-improvements.md P5. Kept behaviour-preserving for now.
export const TOKEN_SPLIT_PATTERN = /[^a-z0-9一-鿿]+/

// Lowercase, split on non-token chars, trim, keep tokens >= minLength, dedupe.
export function tokenizeQuery(query: string, minLength = 2): string[] {
    return Array.from(
        new Set(
            query
                .toLowerCase()
                .split(TOKEN_SPLIT_PATTERN)
                .map((t) => t.trim())
                .filter((t) => t.length >= minLength)
        )
    )
}

// Decay-free match quality: fraction of distinct query tokens present in the text. Basis for
// recall's meta.confidence (how well the query matched, independent of the hit's age and of bm25
// IDF, which collapses to ~0 for terms present in every indexed document). A pure text helper here
// so callers outside the DB layer (e.g. the adapter utility-shadow spike) can reuse it without
// pulling in better-sqlite3.
export function tokenCoverage(query: string, text: string): number {
    const tokens = tokenizeQuery(query)
    if (tokens.length === 0) return 0
    const haystack = text.toLowerCase()
    let found = 0
    for (const token of tokens) if (haystack.includes(token)) found += 1
    return found / tokens.length
}

// Confidence×utility calibration (UFL Phase 2). Pure aggregation over telemetry points that carry
// BOTH a top_confidence and an observed utility_score: bucket by confidence in `bucketCount` equal
// widths over [0,1], emit only non-empty buckets, and flag whether mean utility rises monotonically
// with confidence. Presentational only — never feeds back into the confidence calculation. Lives
// here (pure, no better-sqlite3) so any core caller can reuse it.
export function buildCalibration(
    points: Array<{ confidence: number | null | undefined; utility: number | null | undefined }>,
    bucketCount = 4
): CalibrationSummary {
    const n = Math.max(1, Math.floor(bucketCount))
    const acc = Array.from({ length: n }, () => ({ count: 0, confSum: 0, utilSum: 0 }))
    let scoredQueries = 0

    for (const p of points) {
        if (typeof p.confidence !== 'number' || !Number.isFinite(p.confidence)) continue
        if (typeof p.utility !== 'number' || !Number.isFinite(p.utility)) continue
        const conf = Math.min(1, Math.max(0, p.confidence))
        const util = Math.min(1, Math.max(0, p.utility))
        const idx = Math.min(n - 1, Math.floor(conf * n))
        acc[idx].count += 1
        acc[idx].confSum += conf
        acc[idx].utilSum += util
        scoredQueries += 1
    }

    const buckets: CalibrationBucket[] = []
    for (let i = 0; i < n; i++) {
        if (acc[i].count === 0) continue
        const lower = i / n
        const upper = (i + 1) / n
        buckets.push({
            range: `[${lower.toFixed(2)},${upper.toFixed(2)}${i === n - 1 ? ']' : ')'}`,
            lower: Number(lower.toFixed(4)),
            upper: Number(upper.toFixed(4)),
            count: acc[i].count,
            meanConfidence: Number((acc[i].confSum / acc[i].count).toFixed(4)),
            meanUtility: Number((acc[i].utilSum / acc[i].count).toFixed(4))
        })
    }

    let monotonic: boolean | null = null
    if (buckets.length >= 2) {
        monotonic = true
        for (let i = 1; i < buckets.length; i++) {
            if (buckets[i].meanUtility < buckets[i - 1].meanUtility) {
                monotonic = false
                break
            }
        }
    }

    return { scoredQueries, buckets, monotonic }
}

export function slugify(input: string): string {
    const cleaned = input
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
    return cleaned || 'untitled'
}

export function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
        return JSON.stringify(value)
    }

    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(',')}]`
    }

    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    const entries = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    return `{${entries.join(',')}}`
}

export function shortHash(input: string, length = 16): string {
    return createHash('sha256').update(input).digest('hex').slice(0, length)
}

export function resolveSessionId(sessionData: SessionData): string {
    const explicit = sessionData.id?.trim()
    if (explicit) return explicit

    const events = (sessionData.events ?? []).map((event) => ({
        timestamp: event.timestamp ?? '',
        event_type: event.type ?? event.event_type ?? 'UnknownEvent',
        content: event.content ?? '',
        metadata: event.metadata ?? {}
    }))

    const fingerprint = stableStringify({
        timestamp: sessionData.timestamp ?? '',
        project: sessionData.project ?? 'default',
        scope: deriveScope(sessionData),
        summary: sessionData.summary ?? '',
        events
    })

    return `session_${shortHash(fingerprint)}`
}

export function resolveEventId(event: SessionEvent, sessionId: string, index: number): string {
    const explicit = event.id?.trim()
    if (explicit) return explicit

    const fingerprint = stableStringify({
        session_id: sessionId,
        index,
        timestamp: event.timestamp ?? '',
        event_type: event.type ?? event.event_type ?? 'UnknownEvent',
        content: event.content ?? '',
        metadata: event.metadata ?? {}
    })

    return `evt_${shortHash(fingerprint)}`
}

export function deriveScope(sessionData: Pick<SessionData, 'scope' | 'project'>): string {
    const explicit = sessionData.scope?.trim()
    if (explicit) return explicit
    const project = sessionData.project?.trim()
    return project ? `project:${project}` : 'global'
}

export function getEventType(event: SessionEvent): string {
    return event.type ?? event.event_type ?? 'UnknownEvent'
}

export function getEventContentObject(event: SessionEvent): Json {
    if (event.content && typeof event.content === 'object' && !Array.isArray(event.content)) {
        return event.content as Json
    }
    return {}
}

export function maybeParseJson(raw: string): unknown {
    try {
        return JSON.parse(raw)
    } catch {
        return raw
    }
}

export function normalizeSkillKey(name: string): string {
    return slugify(name).toLowerCase()
}

export function parseDaysOption(raw: string | undefined, optionName: string): number | undefined {
    if (raw === undefined) return undefined
    const value = Number(raw)
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`Invalid ${optionName}: expected non-negative number, got '${raw}'`)
    }
    return value
}

export function parseBoundaryDate(raw: string | undefined, optionName: string): Date | undefined {
    if (!raw) return undefined
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) {
        throw new Error(`Invalid ${optionName}: expected ISO date/time, got '${raw}'`)
    }
    return d
}

export function inDateRange(ts: string, from?: Date, to?: Date): boolean {
    const t = new Date(ts)
    if (Number.isNaN(t.getTime())) return false
    if (from && t < from) return false
    if (to && t > to) return false
    return true
}

export function parseCreatedAt(raw: string | undefined): number {
    if (!raw) return 0
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? 0 : d.getTime()
}

const TRIVIAL_SUMMARY_SET = new Set([
    '', 'ok', 'okay', 'thanks', 'thank you', 'got it', 'sounds good', 'cool', 'yes', 'no',
    'hi', 'hello', 'hey', 'yo', 'sure', 'nice', 'great', '👍', '👌', '收到', '好', '好的', '謝謝', '谢谢', '你好', '哈囉', '嗨'
])

export function isLowValueMemoryText(raw: string | undefined): boolean {
    const text = (raw ?? '').trim().toLowerCase()
    if (!text) return true
    if (TRIVIAL_SUMMARY_SET.has(text)) return true
    if (/^(hi|hello|hey|yo|good morning|good afternoon|good evening|哈囉|你好|嗨|安安)[!.!\s]*$/i.test(text)) return true
    return text.length < 8
}

function extractEventText(event: SessionEvent): string {
    if (typeof event.content === 'string') return event.content.trim()
    if (event.content && typeof event.content === 'object' && !Array.isArray(event.content)) {
        const obj = event.content as Json
        const preferredFields = ['decision', 'skill_name', 'text', 'summary', 'pattern']
        for (const key of preferredFields) {
            const value = obj[key]
            if (typeof value === 'string' && value.trim()) return value.trim()
        }
        for (const value of Object.values(obj)) {
            if (typeof value === 'string' && value.trim()) return value.trim()
        }
    }
    return ''
}

export function sanitizeSessionDataForImport(sessionData: SessionData): SessionData {
    const originalEvents = sessionData.events ?? []
    const dedupedEvents: SessionEvent[] = []
    const seenKeys = new Set<string>()

    for (const event of originalEvents) {
        const dedupeKey = stableStringify({
            timestamp: event.timestamp ?? '',
            event_type: event.type ?? event.event_type ?? 'UnknownEvent',
            content: event.content ?? '',
            metadata: event.metadata ?? {}
        })
        if (seenKeys.has(dedupeKey)) continue
        seenKeys.add(dedupeKey)
        dedupedEvents.push(event)
    }

    const summary = sessionData.summary?.trim() ?? ''
    if (!isLowValueMemoryText(summary)) {
        return { ...sessionData, summary, events: dedupedEvents }
    }

    const signalEvent = dedupedEvents.find((event) => {
        const eventType = getEventType(event)
        return eventType === 'DecisionMade' || eventType === 'SkillLearned' || eventType === 'UserMessage'
    })

    const derivedSummary = extractEventText(signalEvent ?? dedupedEvents[0] ?? {})

    return {
        ...sessionData,
        summary: derivedSummary || summary,
        events: dedupedEvents
    }
}
