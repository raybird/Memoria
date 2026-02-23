// Gemini CLI Adapter (reference implementation)
// Phase 2: Shows how to integrate Memoria into Gemini CLI / Gemini API workflows
//
// Gemini CLI hook points:
//   - System instruction (per-session context injection)
//   - Response callback (write memory after each turn)
//
// Integration pattern (Gemini API / Gemini CLI extension):
//
//   import { GeminiAdapter } from './src/adapter/gemini-adapter.js'
//
//   const adapter = new GeminiAdapter({
//     client: new MemoriaClient(),
//     project: 'my-gemini-project',
//     recallTopK: 5,
//   })
//
//   // Before each turn: inject context
//   const context = await adapter.beforePrompt({
//     userMessage: userInput,
//     conversationId: session.id,
//   })
//
//   // Build Gemini contents with injected memory
//   const contents = adapter.buildGeminiContents(userInput, context)
//
//   // Gemini API call
//   const result = await gemini.generateContent({ contents, systemInstruction })
//
//   // After response: write to Memoria
//   await adapter.afterResponse({
//     response: result.response.text(),
//     conversationId: session.id,
//     userMessage: userInput,
//   })

import { BaseAdapter } from './adapter.js'
import type { MemoriaAdapterConfig, AdapterContext } from './adapter.js'
import type { RecallHit } from '../core/types.js'

export interface GeminiAdapterConfig extends MemoriaAdapterConfig {
    /**
     * Whether to inject memory as a dedicated system turn or as a
     * text prefix in the user turn (default: 'system-turn').
     */
    injectionMode?: 'system-turn' | 'user-prefix'
}

// Minimal type for Gemini `Content` object (avoids @google/generative-ai import dep)
export interface GeminiContent {
    role: 'user' | 'model' | 'system'
    parts: Array<{ text: string }>
}

export class GeminiAdapter extends BaseAdapter {
    private readonly injectionMode: 'system-turn' | 'user-prefix'

    constructor(config: GeminiAdapterConfig) {
        super(config)
        this.injectionMode = config.injectionMode ?? 'system-turn'
    }

    /**
     * Build a `contents` array for the Gemini API with memory context prepended.
     * Pass the result directly to `generateContent({ contents })`.
     */
    async buildGeminiContents(
        userMessage: string,
        conversationId: string,
        priorContents: GeminiContent[] = []
    ): Promise<GeminiContent[]> {
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
        } else {
            // Prefix memory context directly in user turn
            const prefixed = `${context.injectedText}\n\n---\n\nUser: ${userMessage}`
            return [...priorContents, { role: 'user', parts: [{ text: prefixed }] }]
        }
    }

    /**
     * Get system instruction string for Gemini API.
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
