// Utility-feedback Phase 0 shadow spike (see docs/RFC-utility-feedback.md §10).
//
// Goal: cheaply observe whether "lexical reuse" is a usable utility signal BEFORE building the
// real feedback loop. When MEMORIA_UTILITY_SHADOW names a JSONL file, the adapter buffers the
// recall hits it injects each turn and, on the next turn, scores how much of the injected memory
// was literally reused in the turn text (via the existing decay-free tokenCoverage). Each
// observation is appended as one JSONL record for offline distribution analysis.
//
// This is a SPIKE: it does not touch recall(), the schema, or any shipped behaviour. With the env
// var unset every function here is an immediate no-op, and every path is fail-open — a broken
// shadow write must never disturb the agent loop.

import fs from 'node:fs'
import { tokenCoverage, shortHash } from '../core/utils.js'
import { readConversationState, updateConversationState } from './hook-state.js'
import type { RecallHit } from '../core/types.js'

/** The shadow JSONL path when MEMORIA_UTILITY_SHADOW is set to a non-empty value, else null. */
export function shadowLogPath(): string | null {
    const p = process.env.MEMORIA_UTILITY_SHADOW?.trim()
    return p ? p : null
}

/** Buffer the recall hits injected this turn so the next turn can score their reuse. No-op when off. */
export function bufferPendingRecall(conversationId: string, hits: RecallHit[]): void {
    if (!shadowLogPath() || hits.length === 0) return
    try {
        const at = Date.now()
        const topConfidence = hits[0].relevance ?? hits[0].score ?? 0
        updateConversationState(conversationId, {
            pendingRecall: {
                recallId: `rt_shadow_${shortHash(`${conversationId}:${at}`, 12)}`,
                at,
                topConfidence,
                hits: hits.map((h) => ({ id: h.id, snippet: h.snippet, confidence: h.relevance ?? h.score ?? 0 }))
            }
        })
    } catch {
        // Fail-open: a shadow write must never break the hook.
    }
}

/**
 * Score reuse of the previously-injected memory against this turn's text and append one JSONL
 * record, then clear the buffer. reuseScore takes the max tokenCoverage over injected hits — one
 * reused hit means the recall was "used". Two turnText variants are logged (assistant-only vs
 * user+assistant) so Phase 0 can pick the more discriminative one. No-op when off.
 */
export function emitUtilityShadow(conversationId: string, turn: { user: string; assistant: string }): void {
    const logPath = shadowLogPath()
    if (!logPath) return
    try {
        const pending = readConversationState(conversationId).pendingRecall
        if (!pending || pending.hits.length === 0) return

        const assistantText = turn.assistant
        const fullText = `${turn.user}\n${turn.assistant}`
        const reuseAssistant = Math.max(...pending.hits.map((h) => tokenCoverage(h.snippet, assistantText)))
        const reuseFull = Math.max(...pending.hits.map((h) => tokenCoverage(h.snippet, fullText)))

        const record = {
            recallId: pending.recallId,
            at: pending.at,
            observedAt: Date.now(),
            hitCount: pending.hits.length,
            top_confidence: pending.topConfidence,
            // Primary signal: reuse in the assistant reply only (avoids crediting the query→recall
            // match, since the memory was recalled BY matching the user prompt).
            reuseScore: reuseAssistant,
            // Variant for comparison: reuse across the whole turn (user + assistant).
            reuseScoreFull: reuseFull
        }
        fs.appendFileSync(logPath, `${JSON.stringify(record)}\n`)
    } catch {
        // Fail-open.
    } finally {
        // Clear the buffer regardless, so a turn is scored at most once.
        try {
            updateConversationState(conversationId, { pendingRecall: undefined })
        } catch {
            // Fail-open.
        }
    }
}
