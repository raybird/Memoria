// Utility-feedback loop, adapter side (docs/RFC-utility-feedback.md).
//
// Phase 0 proved lexical reuse is a discriminative utility signal; Phase 1 turns the observation
// into a real write-back. When a turn injects recalled memory, we buffer the recall (keyed by its
// server-issued recall_id) into cross-process hook-state. On the next turn we score how much of the
// injected memory the assistant literally reused (decay-free tokenCoverage) and POST it back to
// `/v1/recall/:id/outcome`. Reporting is default-on and fully fail-open — a broken outcome must
// never disturb the agent loop.
//
// If MEMORIA_UTILITY_SHADOW names a JSONL file, each observation is ALSO appended there for offline
// distribution analysis (the Phase 0 spike log; assistant-only vs full-turn variants).

import fs from 'node:fs'
import { tokenCoverage } from '../core/utils.js'
import { readConversationState, updateConversationState } from './hook-state.js'
import type { MemoriaClient } from '../sdk.js'
import type { RecallHit } from '../core/types.js'

/** Optional JSONL debug log path (Phase 0 spike). null when MEMORIA_UTILITY_SHADOW is unset. */
export function shadowLogPath(): string | null {
    const p = process.env.MEMORIA_UTILITY_SHADOW?.trim()
    return p ? p : null
}

/** Buffer the recall injected this turn (by its server recall_id) for next-turn scoring. No-op without an id. */
export function bufferPendingRecall(conversationId: string, recallId: string | undefined, hits: RecallHit[]): void {
    if (!recallId || hits.length === 0) return
    try {
        const topConfidence = hits[0].relevance ?? hits[0].score ?? 0
        updateConversationState(conversationId, {
            pendingRecall: {
                recallId,
                at: Date.now(),
                topConfidence,
                hits: hits.map((h) => ({ id: h.id, snippet: h.snippet, confidence: h.relevance ?? h.score ?? 0 }))
            }
        })
    } catch {
        // Fail-open: buffering must never break the hook.
    }
}

/**
 * Score reuse of the previously-injected memory against this turn's assistant reply and write it
 * back via `client.recordRecallOutcome`, then clear the buffer. reuseScore is the max tokenCoverage
 * over injected hits (one reused hit ⇒ the recall was "used"). Assistant-only per Phase 0 (§14):
 * including the user prompt is contaminated by the query→recall match. Fully fail-open.
 */
export async function reportRecallOutcome(
    client: MemoriaClient,
    conversationId: string,
    turn: { user: string; assistant: string }
): Promise<void> {
    let pending: ReturnType<typeof readConversationState>['pendingRecall']
    try {
        pending = readConversationState(conversationId).pendingRecall
    } catch {
        return
    }
    if (!pending || pending.hits.length === 0) return

    const reuseScore = Math.max(...pending.hits.map((h) => tokenCoverage(h.snippet, turn.assistant)))

    // Optional Phase 0 debug log (assistant-only + full-turn variants).
    const logPath = shadowLogPath()
    if (logPath) {
        try {
            const reuseFull = Math.max(...pending.hits.map((h) => tokenCoverage(h.snippet, `${turn.user}\n${turn.assistant}`)))
            fs.appendFileSync(logPath, `${JSON.stringify({
                recallId: pending.recallId,
                at: pending.at,
                observedAt: Date.now(),
                hitCount: pending.hits.length,
                top_confidence: pending.topConfidence,
                reuseScore,
                reuseScoreFull: reuseFull
            })}\n`)
        } catch {
            // Fail-open.
        }
    }

    try {
        await client.recordRecallOutcome(pending.recallId, { signal: 'reuse', utility_score: reuseScore })
    } catch {
        // Fail-open: outcome reporting must never disturb the agent.
    } finally {
        try {
            updateConversationState(conversationId, { pendingRecall: undefined })
        } catch {
            // Fail-open.
        }
    }
}
