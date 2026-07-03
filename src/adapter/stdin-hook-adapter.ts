// Shared base for stdin/stdout hook adapters (Codex, Antigravity, Claude Code).
//
// Each `memoria adapter <name>` invocation reads one hook JSON object on stdin,
// dispatches on hook_event_name, and writes a JSON response on stdout. The three
// providers differ only in: which event names mean "inject" vs "stop", the default
// conversation id, how the completed turn is extracted, and the exact output shape.
// Everything else — recall + prompt buffering on inject, dedupe + write on stop,
// and the injected-context formatting — is identical, so it lives here.

import { BaseAdapter } from './adapter.js'
import { hashTurn } from './hook-state.js'
import type { RecallHit } from '../core/types.js'

/** Superset of the fields the supported CLIs place on a hook's stdin JSON. */
export interface HookInput {
    hook_event_name?: string
    session_id?: string
    transcript_path?: string
    cwd?: string
    timestamp?: string
    prompt?: string
    last_assistant_message?: string | null
    [key: string]: unknown
}

/** A completed user/assistant turn to persist. */
export interface HookTurn {
    user: string
    assistant: string
}

export abstract class StdinHookAdapter extends BaseAdapter {
    /** Event names that should recall memory and inject context. */
    protected abstract readonly injectEvents: readonly string[]
    /** Event names that mark turn completion and persist the turn. */
    protected abstract readonly stopEvents: readonly string[]
    /** Fallback conversation id when the payload omits session_id. */
    protected abstract readonly defaultConversationId: string

    /** Dispatch a hook payload; always resolves, never throws when failOpen (the default). */
    async handleHookEvent(input: HookInput): Promise<unknown> {
        const event = typeof input.hook_event_name === 'string' ? input.hook_event_name : ''
        if (this.injectEvents.includes(event)) return this.handleInject(input, event)
        if (this.stopEvents.includes(event)) {
            await this.handleStop(input)
            return {}
        }
        return {}
    }

    protected conversationId(input: HookInput): string {
        return (typeof input.session_id === 'string' && input.session_id.trim()) || this.defaultConversationId
    }

    /** User turn text for an inject event (default: the `prompt` field; may be async). */
    protected extractUserMessage(input: HookInput): string | Promise<string> {
        return typeof input.prompt === 'string' ? input.prompt : ''
    }

    /** The turn to persist on a stop event, or null to skip. */
    protected abstract extractTurn(input: HookInput, conversationId: string): Promise<HookTurn | null> | HookTurn | null

    /** Provider-specific inject-output shape. `text === undefined` means "no context to inject". */
    protected abstract buildInjectOutput(eventName: string, text?: string): unknown

    protected async handleInject(input: HookInput, event: string): Promise<unknown> {
        const userMessage = (await this.extractUserMessage(input)).trim()
        const conversationId = this.conversationId(input)
        if (!userMessage) return this.buildInjectOutput(event)
        // Buffer the prompt so a later Stop hook (a separate process) can attach it to the turn.
        this.rememberUserPrompt(conversationId, userMessage)
        try {
            const rc = await this.recallForContext({ userMessage, conversationId })
            return this.buildInjectOutput(event, rc.injectedText)
        } catch (error) {
            if (!this.config.failOpen) throw error
            return this.buildInjectOutput(event)
        }
    }

    protected async handleStop(input: HookInput): Promise<void> {
        try {
            const conversationId = this.conversationId(input)
            const turn = await this.extractTurn(input, conversationId)
            const assistant = turn?.assistant.trim() ?? ''
            if (!turn || !assistant) return
            const user = turn.user
            const contentHash = hashTurn(`${user}\n${assistant}`)
            if (!this.shouldWrite(conversationId, contentHash)) return

            await this.client.remember({
                timestamp: new Date().toISOString(),
                project: this.config.project,
                summary: assistant.slice(0, 200),
                events: [
                    {
                        event_type: 'ConversationTurn',
                        timestamp: new Date().toISOString(),
                        content: { user, assistant }
                    }
                ]
            })
            this.markWritten(conversationId, contentHash)
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
        return ['## Memoria — Relevant past memory', ...lines, ''].join('\n')
    }
}
