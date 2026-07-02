// Codex CLI Adapter (reference implementation)
// Phase 2: Shows how to integrate Memoria into OpenAI's Codex CLI workflows.
//
// Codex CLI integration points:
//   - Instruction / developer message (per-session context injection)
//   - Turn completion (write memory after each turn; Codex CLI can invoke an
//     external `notify` program with a JSON payload on turn events)
//
// Codex also speaks MCP: see resources/mcp/codex-cli.mcp.json for a
// declarative wiring of the mcp-memory-libsql server.
//
// Integration pattern (Responses-style message array):
//
//   import { CodexAdapter } from './src/adapter/codex-adapter.js'
//
//   const adapter = new CodexAdapter({
//     client: new MemoriaClient(),
//     project: 'my-codex-project',
//     recallTopK: 5,
//   })
//
//   // Before each turn: build the message array with memory context prepended
//   const messages = await adapter.buildCodexMessages(userInput, session.id)
//
//   // Model call with injected memory
//   const result = await codex.respond({ messages })
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

export interface CodexAdapterConfig extends MemoriaAdapterConfig {
    /**
     * Whether to inject memory as a dedicated developer message or as a
     * text prefix in the user turn (default: 'developer-message').
     */
    injectionMode?: 'developer-message' | 'user-prefix'
}

// Minimal Codex / OpenAI Responses message shape (avoids an SDK import dep)
export interface CodexMessage {
    role: 'system' | 'developer' | 'user' | 'assistant'
    content: string
}

export class CodexAdapter extends BaseAdapter {
    private readonly injectionMode: 'developer-message' | 'user-prefix'

    constructor(config: CodexAdapterConfig) {
        super(config)
        this.injectionMode = config.injectionMode ?? 'developer-message'
    }

    /**
     * Build a `messages` array for a Codex turn with memory context prepended.
     * Pass the result directly to the model call.
     */
    async buildCodexMessages(
        userMessage: string,
        conversationId: string,
        priorMessages: CodexMessage[] = []
    ): Promise<CodexMessage[]> {
        const context = await this.recallForContext({ userMessage, conversationId })

        if (!context.injectedText) {
            return [...priorMessages, { role: 'user', content: userMessage }]
        }

        if (this.injectionMode === 'developer-message') {
            // Inject memory as a developer instruction turn before the user message
            return [
                ...priorMessages,
                { role: 'developer', content: context.injectedText },
                { role: 'user', content: userMessage }
            ]
        }

        // Prefix memory context directly in the user turn
        const prefixed = `${context.injectedText}\n\n---\n\n${userMessage}`
        return [...priorMessages, { role: 'user', content: prefixed }]
    }

    /**
     * Get a developer instruction string for the Codex session.
     * Send once per session as a `developer` role message (or fold into AGENTS.md).
     */
    getDeveloperInstruction(): string {
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
            const type = h.type === 'decision' ? 'Decision' : h.type === 'skill' ? 'Skill' : 'Session'
            return `- [${type} ${date} @ ${h.project}] ${h.snippet}`
        })

        return [
            '--- Memoria Context (past session memory, confidence: ' +
            (hits[0].score * 100).toFixed(0) + '%) ---',
            ...lines,
            '--- end of Memoria Context ---'
        ].join('\n')
    }
}
