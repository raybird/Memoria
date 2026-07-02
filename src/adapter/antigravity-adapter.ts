// Antigravity CLI Adapter (reference implementation)
// Phase 2: Shows how to integrate Memoria into Google's Antigravity CLI workflows.
//
// Antigravity is built on Gemini models and consumes a Gemini-style `contents`
// array. Integration points:
//   - System instruction (per-session context injection)
//   - Response callback (write memory after each turn)
//
// Antigravity also speaks MCP: see resources/mcp/antigravity-cli.mcp.json for a
// declarative wiring of the mcp-memory-libsql server.
//
// Integration pattern:
//
//   import { AntigravityAdapter } from './src/adapter/antigravity-adapter.js'
//
//   const adapter = new AntigravityAdapter({
//     client: new MemoriaClient(),
//     project: 'my-antigravity-project',
//     recallTopK: 5,
//   })
//
//   // Before each turn: build contents with injected memory
//   const contents = await adapter.buildContents(userInput, session.id)
//
//   // Model call
//   const result = await model.generateContent({ contents, systemInstruction })
//
//   // After response: write to Memoria
//   await adapter.afterResponse({
//     response: result.text,
//     conversationId: session.id,
//     userMessage: userInput,
//   })

import { BaseAdapter } from './adapter.js'
import type { MemoriaAdapterConfig } from './adapter.js'
import type { RecallHit } from '../core/types.js'

export interface AntigravityAdapterConfig extends MemoriaAdapterConfig {
    /**
     * Whether to inject memory as a dedicated context turn or as a
     * text prefix in the user turn (default: 'system-turn').
     */
    injectionMode?: 'system-turn' | 'user-prefix'
}

// Minimal Gemini-style `Content` object (avoids a generative-ai import dep)
export interface AntigravityContent {
    role: 'user' | 'model' | 'system'
    parts: Array<{ text: string }>
}

export class AntigravityAdapter extends BaseAdapter {
    private readonly injectionMode: 'system-turn' | 'user-prefix'

    constructor(config: AntigravityAdapterConfig) {
        super(config)
        this.injectionMode = config.injectionMode ?? 'system-turn'
    }

    /**
     * Build a `contents` array with memory context prepended.
     * Pass the result directly to `generateContent({ contents })`.
     */
    async buildContents(
        userMessage: string,
        conversationId: string,
        priorContents: AntigravityContent[] = []
    ): Promise<AntigravityContent[]> {
        const context = await this.recallForContext({ userMessage, conversationId })

        if (!context.injectedText) {
            return [...priorContents, { role: 'user', parts: [{ text: userMessage }] }]
        }

        if (this.injectionMode === 'system-turn') {
            // Inject as model "context" turn before the user message
            return [
                ...priorContents,
                { role: 'model', parts: [{ text: context.injectedText }] },
                { role: 'user', parts: [{ text: userMessage }] }
            ]
        }

        // Prefix memory context directly in the user turn
        const prefixed = `${context.injectedText}\n\n---\n\nUser: ${userMessage}`
        return [...priorContents, { role: 'user', parts: [{ text: prefixed }] }]
    }

    /**
     * Get a system instruction string for the Antigravity session.
     * Call once per session and pass as `systemInstruction.parts[0].text`.
     */
    getSystemInstruction(): string {
        return [
            'You have access to a persistent memory system called Memoria.',
            'When relevant context from past sessions is provided between "--- Memoria Context ---" markers,',
            'use that information to provide coherent, contextually-aware responses.',
            'Do not fabricate memories. If no context is provided, proceed normally.'
        ].join(' ')
    }

    protected override formatRecallText(hits: RecallHit[]): string {
        if (hits.length === 0) return ''

        const lines = hits.map((h) => {
            const date = h.timestamp.slice(0, 10)
            const type = h.type === 'decision' ? '🔵 Decision' : h.type === 'skill' ? '🟢 Skill' : '💬 Session'
            return `${type} [${date}] [${h.project}]: ${h.snippet}`
        })

        return [
            '--- Memoria Context (past session memory, confidence: ' +
            (hits[0].score * 100).toFixed(0) + '%) ---',
            ...lines,
            '--- end of Memoria Context ---'
        ].join('\n')
    }
}
