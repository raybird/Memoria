// Codex CLI Adapter
//
// Integrates Memoria into OpenAI's Codex CLI via its hook system. Codex hooks
// receive one JSON object on stdin and may return JSON on stdout to inject
// context or take action (the same shape Claude Code uses). Wire the adapter
// into a `hooks.json` next to your Codex config, or an inline `[hooks]` table
// in ~/.codex/config.toml:
//
//   {
//     "hooks": {
//       "UserPromptSubmit": [
//         { "matcher": "", "hooks": [{ "type": "command", "command": "memoria adapter codex" }] }
//       ],
//       "Stop": [
//         { "matcher": "", "hooks": [{ "type": "command", "command": "memoria adapter codex" }] }
//       ]
//     }
//   }
//
// The same command handles both events; it dispatches on hook_event_name from
// the JSON payload. `UserPromptSubmit` injects recalled memory via
// hookSpecificOutput.additionalContext (added as extra developer context);
// `Stop` persists the completed turn from the payload's last_assistant_message.

import { BaseAdapter } from './adapter.js'
import type { MemoriaAdapterConfig } from './adapter.js'
import type { RecallHit } from '../core/types.js'

export interface CodexAdapterConfig extends MemoriaAdapterConfig {}

/** Shape of the JSON Codex writes to a hook's stdin. Fields are optional because they vary by event. */
export interface CodexHookInput {
    hook_event_name?: string
    session_id?: string
    transcript_path?: string
    cwd?: string
    /** UserPromptSubmit: the text the user just submitted */
    prompt?: string
    /** Stop: the assistant's final message for the turn */
    last_assistant_message?: string | null
    stop_hook_active?: boolean
}

/** Hook response Codex expects on stdout. */
export interface CodexHookOutput {
    hookSpecificOutput?: {
        hookEventName: string
        additionalContext?: string
    }
}

export class CodexAdapter extends BaseAdapter {
    constructor(config: CodexAdapterConfig) {
        super(config)
    }

    /**
     * Dispatch on hook_event_name. Always resolves; never throws.
     * Errors are swallowed when failOpen is true (the default).
     */
    async handleHookEvent(input: CodexHookInput): Promise<CodexHookOutput> {
        const event = input.hook_event_name ?? ''
        if (event === 'UserPromptSubmit') return this.handleUserPromptSubmit(input)
        if (event === 'Stop') {
            await this.handleStop(input)
            return {}
        }
        return {}
    }

    /** Recall relevant memory and inject it via additionalContext. */
    async handleUserPromptSubmit(input: CodexHookInput): Promise<CodexHookOutput> {
        const userMessage = (input.prompt ?? '').trim()
        const conversationId = input.session_id ?? 'codex-session'
        if (!userMessage) {
            return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit' } }
        }

        try {
            const rc = await this.recallForContext({ userMessage, conversationId })
            return {
                hookSpecificOutput: {
                    hookEventName: 'UserPromptSubmit',
                    additionalContext: rc.injectedText
                }
            }
        } catch (error) {
            if (!this.config.failOpen) throw error
            return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit' } }
        }
    }

    /** Persist the completed turn using the payload's last_assistant_message. */
    async handleStop(input: CodexHookInput): Promise<void> {
        try {
            const conversationId = input.session_id ?? 'codex-session'
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
