// Cross-process conversation state for hook adapters.
//
// Each `memoria adapter <name>` invocation is a fresh, short-lived process, so
// throttle/dedupe state and the pending user prompt cannot live in memory — they
// would reset on every hook. This module persists a tiny per-conversation record
// to disk so the UserPromptSubmit and Stop hooks (separate processes) can
// coordinate: throttle/dedupe duplicate writes and carry the user prompt into the
// Stop turn. All operations are best-effort and fail-open.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'

export interface ConversationState {
    /** Epoch ms of the last successful write for this conversation. */
    lastWriteAt?: number
    /** Content hash of the last write (for dedupe). */
    lastWriteHash?: string
    /** The user prompt buffered by UserPromptSubmit, read back on Stop. */
    lastUserPrompt?: string
    /**
     * Recall injected this turn, buffered for the utility-feedback Phase 0 shadow spike
     * (gated by MEMORIA_UTILITY_SHADOW; see adapter/utility-shadow.ts). Read back on the next
     * turn to score lexical reuse. Absent in normal operation.
     */
    pendingRecall?: {
        recallId: string
        at: number
        topConfidence: number
        hits: { id: string; snippet: string; confidence: number }[]
    }
}

function stateDir(): string {
    const explicit = process.env.MEMORIA_ADAPTER_STATE_DIR?.trim()
    if (explicit) return explicit
    const home = process.env.MEMORIA_HOME?.trim()
    if (home) return path.join(home, '.memory', 'adapter-state')
    return path.join(os.tmpdir(), 'memoria-adapter-state')
}

function stateFile(conversationId: string): string {
    const key = createHash('sha256').update(conversationId).digest('hex').slice(0, 32)
    return path.join(stateDir(), `${key}.json`)
}

export function readConversationState(conversationId: string): ConversationState {
    try {
        return JSON.parse(fs.readFileSync(stateFile(conversationId), 'utf8')) as ConversationState
    } catch {
        return {}
    }
}

export function updateConversationState(conversationId: string, patch: ConversationState): void {
    try {
        fs.mkdirSync(stateDir(), { recursive: true })
        const merged = { ...readConversationState(conversationId), ...patch }
        fs.writeFileSync(stateFile(conversationId), JSON.stringify(merged))
    } catch {
        // Best-effort: persistence must never break the hook.
    }
}

/** Short stable hash of a turn's content, used for write dedupe. */
export function hashTurn(text: string): string {
    return createHash('sha256').update(text).digest('hex').slice(0, 16)
}
