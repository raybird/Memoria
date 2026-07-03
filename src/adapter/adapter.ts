// Memoria Agent Adapter – core types and abstract base class
// Phase 2: Provider-agnostic hooks for AI Agent orchestration layers
//
// Usage pattern:
//   const adapter = new CodexAdapter({ client, project: 'my-project' })
//   const injected = await adapter.beforePrompt({ userMessage, conversationId })
//   // → send `injected` as system context to model
//   await adapter.afterResponse({ response, conversationId, userMessage })
//   // → deduped + throttled write to Memoria

import { MemoriaClient } from '../sdk.js'
import type { RecallHit } from '../core/types.js'
import { readConversationState, updateConversationState, hashTurn } from './hook-state.js'

// ─── Config ──────────────────────────────────────────────────────────────────

export interface MemoriaAdapterConfig {
    /** MemoriaClient instance (HTTP SDK) or base URL string */
    client: MemoriaClient | string
    /** Project name tag written on every session */
    project?: string
    /** Max recall results injected to prompt (default: 5) */
    recallTopK?: number
    /** Minimum ms between writes for the same conversationId (default: 5000) */
    throttleMs?: number
    /** If true (default), errors are swallowed and never bubble to the agent */
    failOpen?: boolean
    /** Deduplicate: skip a write whose content matches the previous write for the same conversationId within this many seconds (default: 0 = always skip an identical consecutive write) */
    dedupeWindowSec?: number
    /** Optional time window for recall, ISO duration e.g. 'P7D' */
    recallTimeWindow?: string
}

// ─── Context / Response types ─────────────────────────────────────────────────

export interface AdapterContext {
    /** Current user turn text */
    userMessage: string
    /** Stable ID for this conversation (used for throttle/dedupe) */
    conversationId: string
    /** Override project for this turn */
    project?: string
}

export interface AdapterResponse {
    /** AI model's text response */
    response: string
    /** Conversation ID (matches the beforePrompt call) */
    conversationId: string
    /** Original user message for context */
    userMessage?: string
    /** Override project */
    project?: string
}

export interface RecallContext {
    hits: RecallHit[]
    injectedText: string
}

// ─── BaseAdapter ──────────────────────────────────────────────────────────────

export abstract class BaseAdapter {
    protected readonly client: MemoriaClient
    protected readonly config: Required<Omit<MemoriaAdapterConfig, 'client'>>

    constructor(config: MemoriaAdapterConfig) {
        if (typeof config.client === 'string') {
            this.client = new MemoriaClient(config.client)
        } else {
            this.client = config.client
        }

        this.config = {
            project: config.project ?? 'default',
            recallTopK: config.recallTopK ?? 5,
            throttleMs: config.throttleMs ?? 5000,
            failOpen: config.failOpen ?? true,
            dedupeWindowSec: config.dedupeWindowSec ?? 0,
            recallTimeWindow: config.recallTimeWindow ?? ''
        }
    }

    // ── Public hooks ────────────────────────────────────────────────────────────

    /**
     * Call BEFORE sending the user prompt to the model.
     * Recalls relevant memories and returns formatted text to inject into context.
     * If failOpen (default), never throws; returns '' on error.
     */
    async beforePrompt(context: AdapterContext): Promise<string> {
        try {
            const rc = await this.recallForContext(context)
            return rc.injectedText
        } catch (error) {
            if (!this.config.failOpen) throw error
            return ''
        }
    }

    /**
     * Call AFTER receiving the model response.
     * Applies throttle + dedupe, then writes to Memoria.
     * If failOpen (default), never throws.
     */
    async afterResponse(response: AdapterResponse): Promise<void> {
        try {
            const contentHash = hashTurn(`${response.userMessage ?? ''}\n${response.response}`)
            if (!this.shouldWrite(response.conversationId, contentHash)) return
            const sessionData = this.buildSessionData(response)
            await this.client.remember(sessionData)
            this.markWritten(response.conversationId, contentHash)
        } catch (error) {
            if (!this.config.failOpen) throw error
        }
    }

    // ── Internal helpers ────────────────────────────────────────────────────────

    /**
     * Recall and format for prompt injection.
     * Subclasses can override formatRecallText() to customize output.
     */
    protected async recallForContext(context: AdapterContext): Promise<RecallContext> {
        const project = context.project ?? this.config.project
        const filter = {
            query: context.userMessage,
            project,
            top_k: this.config.recallTopK,
            ...(this.config.recallTimeWindow ? { time_window: this.config.recallTimeWindow } : {})
        }
        const result = await this.client.recall(filter)
        const hits = result.ok && result.data ? result.data : []
        const injectedText = hits.length > 0 ? this.formatRecallText(hits) : ''
        return { hits, injectedText }
    }

    /**
     * Format recall hits into a string to inject into the prompt.
     * Subclasses should override this for provider-specific formatting.
     */
    protected formatRecallText(hits: RecallHit[]): string {
        const lines = hits.map(
            (h) => `[${h.type.toUpperCase()} | ${h.project} | ${h.timestamp.slice(0, 10)}] ${h.snippet}`
        )
        return [
            '--- Memoria Context (relevant past memory) ---',
            ...lines,
            '--- end of context ---'
        ].join('\n')
    }

    /**
     * Build SessionData from an agent response turn.
     * Subclasses can override to include richer event data.
     */
    protected buildSessionData(response: AdapterResponse) {
        return {
            timestamp: new Date().toISOString(),
            project: response.project ?? this.config.project,
            summary: response.response.slice(0, 200),
            events: [
                {
                    event_type: 'ConversationTurn',
                    timestamp: new Date().toISOString(),
                    content: {
                        user: response.userMessage ?? '',
                        assistant: response.response
                    }
                }
            ]
        }
    }

    /**
     * Throttle + dedupe check, backed by cross-process conversation state so it
     * works across separate hook invocations (each hook is its own process).
     * Skips the write when the content duplicates the last write (bounded by
     * dedupeWindowSec) or when it lands within throttleMs of the last write.
     */
    protected shouldWrite(conversationId: string, contentHash?: string): boolean {
        const state = readConversationState(conversationId)
        if (state.lastWriteAt === undefined) return true
        const elapsed = Date.now() - state.lastWriteAt
        if (contentHash !== undefined) {
            // Content-aware: suppress only an identical repeat write (bounded by dedupeWindowSec);
            // a distinct turn always writes, so no legitimate turn is ever dropped.
            if (state.lastWriteHash !== contentHash) return true
            const windowMs = this.config.dedupeWindowSec > 0 ? this.config.dedupeWindowSec * 1000 : Infinity
            return elapsed >= windowMs
        }
        // No content signal (e.g. the reference SDK path) → fall back to the time throttle.
        return elapsed >= this.config.throttleMs
    }

    protected markWritten(conversationId: string, contentHash?: string): void {
        updateConversationState(conversationId, { lastWriteAt: Date.now(), lastWriteHash: contentHash })
    }

    /** Buffer the user prompt (UserPromptSubmit) so a later Stop hook can attach it to the turn. */
    protected rememberUserPrompt(conversationId: string, prompt: string): void {
        updateConversationState(conversationId, { lastUserPrompt: prompt })
    }

    /** Read the buffered user prompt for this conversation ('' if none). */
    protected takeUserPrompt(conversationId: string): string {
        return readConversationState(conversationId).lastUserPrompt ?? ''
    }
}
