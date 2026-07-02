// Antigravity CLI Adapter
//
// Integrates Memoria into Google's Antigravity CLI (`agy`) via its agent hook
// system. Hooks receive one JSON object on stdin and return JSON on stdout to
// inject context or gate actions. Wire the adapter into your hooks.json under
// the customization directory (`.agents/hooks/` / settings.json `hooks`):
//
//   {
//     "memoria": {
//       "PreInvocation": [
//         { "matcher": "", "hooks": [{ "type": "command", "command": "memoria adapter antigravity", "timeout": 30 }] }
//       ],
//       "Stop": [
//         { "matcher": "", "hooks": [{ "type": "command", "command": "memoria adapter antigravity", "timeout": 30 }] }
//       ]
//     }
//   }
//
// The same command handles both events; it dispatches on hook_event_name.
// `PreInvocation` recalls memory and injects it before the model runs; `Stop`
// persists the completed turn. Antigravity's context-injection output field is
// `additionalContext`; some builds expect it at the top level and some nested
// under hookSpecificOutput (Claude Code compatible), so we emit both. The
// handler is fail-open: if a payload lacks the prompt / assistant text, it
// degrades to a no-op rather than disturbing the agent loop.

import { BaseAdapter } from './adapter.js'
import type { MemoriaAdapterConfig } from './adapter.js'
import type { RecallHit } from '../core/types.js'

export interface AntigravityAdapterConfig extends MemoriaAdapterConfig {}

/** Shape of the JSON Antigravity writes to a hook's stdin. Fields are optional because they vary by event. */
export interface AntigravityHookInput {
    hook_event_name?: string
    session_id?: string
    transcript_path?: string
    cwd?: string
    timestamp?: string
    /** PreInvocation: the text the user just submitted (Claude Code compatible field) */
    prompt?: string
    /** Stop: the assistant's final message for the turn */
    last_assistant_message?: string | null
}

/** Hook response Antigravity accepts on stdout (top-level + nested for max compatibility). */
export interface AntigravityHookOutput {
    additionalContext?: string
    hookSpecificOutput?: {
        hookEventName: string
        additionalContext?: string
    }
}

export class AntigravityAdapter extends BaseAdapter {
    constructor(config: AntigravityAdapterConfig) {
        super(config)
    }

    /**
     * Dispatch on hook_event_name. Always resolves; never throws.
     * Errors are swallowed when failOpen is true (the default).
     */
    async handleHookEvent(input: AntigravityHookInput): Promise<AntigravityHookOutput> {
        const event = input.hook_event_name ?? ''
        // PreInvocation is Antigravity's context-injection point; UserPromptSubmit is the Claude-compatible alias.
        if (event === 'PreInvocation' || event === 'UserPromptSubmit') return this.handlePreInvocation(input)
        // Stop / PostInvocation mark turn completion.
        if (event === 'Stop' || event === 'PostInvocation') {
            await this.handleStop(input)
            return {}
        }
        return {}
    }

    /** Recall relevant memory and inject it before the model runs. */
    async handlePreInvocation(input: AntigravityHookInput): Promise<AntigravityHookOutput> {
        const userMessage = (input.prompt ?? '').trim()
        const conversationId = input.session_id ?? 'antigravity-session'
        const eventName = input.hook_event_name ?? 'PreInvocation'
        if (!userMessage) return {}

        try {
            const rc = await this.recallForContext({ userMessage, conversationId })
            if (!rc.injectedText) return {}
            return {
                additionalContext: rc.injectedText,
                hookSpecificOutput: { hookEventName: eventName, additionalContext: rc.injectedText }
            }
        } catch (error) {
            if (!this.config.failOpen) throw error
            return {}
        }
    }

    /** Persist the completed turn using the payload's last_assistant_message. */
    async handleStop(input: AntigravityHookInput): Promise<void> {
        try {
            const conversationId = input.session_id ?? 'antigravity-session'
            const assistant = (input.last_assistant_message ?? '').trim()
            if (!assistant) return
            if (!this.shouldWrite(conversationId)) return

            await this.client.remember({
                timestamp: new Date().toISOString(),
                project: this.config.project,
                summary: assistant.slice(0, 200),
                events: [
                    {
                        event_type: 'ConversationTurn',
                        timestamp: new Date().toISOString(),
                        content: { user: '', assistant }
                    }
                ]
            })
            this.markWritten(conversationId)
        } catch (error) {
            if (!this.config.failOpen) throw error
        }
    }

    protected override formatRecallText(hits: RecallHit[]): string {
        if (hits.length === 0) return ''
        const lines = hits.map((h) => {
            const date = h.timestamp.slice(0, 10)
            const tag = h.type === 'decision' ? 'Decision' : h.type === 'skill' ? 'Skill' : 'Session'
            return `- [${tag} ${date} @ ${h.project}] ${h.snippet}`
        })
        return [
            '## Memoria — Relevant past memory',
            ...lines,
            ''
        ].join('\n')
    }
}
