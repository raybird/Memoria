// Utility helpers for Memoria
// Extracted from cli.ts – pure functions with no side-effects

import { createHash } from 'node:crypto'
import type { Json, SessionData, SessionEvent } from './types.js'

export function safeDate(raw?: string): Date {
    const d = raw ? new Date(raw) : new Date()
    return Number.isNaN(d.getTime()) ? new Date() : d
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
