// Claude Code Adapter
//
// Integrates Memoria into Anthropic's Claude Code via its hook system.
// Hooks receive JSON on stdin and may return JSON on stdout to inject
// context or take action. Wire the adapter into ~/.claude/settings.json:
//
//   {
//     "hooks": {
//       "UserPromptSubmit": [
//         { "matcher": "", "hooks": [{ "type": "command", "command": "memoria adapter claude-code" }] }
//       ],
//       "Stop": [
//         { "matcher": "", "hooks": [{ "type": "command", "command": "memoria adapter claude-code" }] }
//       ]
//     }
//   }
//
// The same command handles both events; it dispatches on hook_event_name
// from the JSON payload.

import { readFile } from 'node:fs/promises'
import { BaseAdapter } from './adapter.js'
import type { MemoriaAdapterConfig } from './adapter.js'
import { hashTurn } from './hook-state.js'
import type { RecallHit } from '../core/types.js'

export interface ClaudeCodeAdapterConfig extends MemoriaAdapterConfig {
    /** Max transcript lines to scan backwards when locating the last turn (default: 50) */
    transcriptScanLimit?: number
}

/** Shape of the JSON Claude Code writes to a hook's stdin. Fields are optional because they vary by event. */
export interface ClaudeCodeHookInput {
    hook_event_name?: string
    session_id?: string
    transcript_path?: string
    cwd?: string
    prompt?: string
}

/** Hook response Claude Code expects on stdout. */
export interface ClaudeCodeHookOutput {
    hookSpecificOutput?: {
        hookEventName: string
        additionalContext?: string
    }
}

export class ClaudeCodeAdapter extends BaseAdapter {
    private readonly transcriptScanLimit: number

    constructor(config: ClaudeCodeAdapterConfig) {
        super(config)
        this.transcriptScanLimit = config.transcriptScanLimit ?? 50
    }

    /**
     * Dispatch on hook_event_name. Always resolves; never throws.
     * Errors are swallowed when failOpen is true (the default).
     */
    async handleHookEvent(input: ClaudeCodeHookInput): Promise<ClaudeCodeHookOutput> {
        const event = input.hook_event_name ?? ''
        if (event === 'UserPromptSubmit') return this.handleUserPromptSubmit(input)
        if (event === 'Stop') {
            await this.handleStop(input)
            return {}
        }
        return {}
    }

    /** Recall relevant memory and inject it via additionalContext. */
    async handleUserPromptSubmit(input: ClaudeCodeHookInput): Promise<ClaudeCodeHookOutput> {
        const userMessage = (input.prompt ?? '').trim()
        const conversationId = input.session_id ?? 'claude-code-session'
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

    /** Persist the last user/assistant turn from the transcript file. */
    async handleStop(input: ClaudeCodeHookInput): Promise<void> {
        try {
            const transcriptPath = input.transcript_path
            const conversationId = input.session_id ?? 'claude-code-session'
            if (!transcriptPath) return

            const turn = await this.readLastTurn(transcriptPath)
            if (!turn) return
            const contentHash = hashTurn(`${turn.user}\n${turn.assistant}`)
            if (!this.shouldWrite(conversationId, contentHash)) return

            await this.client.remember({
                timestamp: new Date().toISOString(),
                project: this.config.project,
                summary: turn.assistant.slice(0, 200),
                events: [
                    {
                        event_type: 'ConversationTurn',
                        timestamp: new Date().toISOString(),
                        content: { user: turn.user, assistant: turn.assistant }
                    }
                ]
            })
            this.markWritten(conversationId, contentHash)
        } catch (error) {
            if (!this.config.failOpen) throw error
        }
    }

    /**
     * Scan the JSONL transcript backwards and extract the most recent
     * user/assistant pair. Each transcript line is a message envelope
     * like `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]}}`.
     */
    private async readLastTurn(transcriptPath: string): Promise<{ user: string; assistant: string } | null> {
        const raw = await readFile(transcriptPath, 'utf8').catch(() => '')
        if (!raw) return null
        const lines = raw.split('\n').filter(Boolean).slice(-this.transcriptScanLimit)

        let lastUser = ''
        let lastAssistant = ''
        for (let i = lines.length - 1; i >= 0; i--) {
            const text = extractTextFromTranscriptLine(lines[i])
            if (!text) continue
            const role = extractRoleFromTranscriptLine(lines[i])
            if (role === 'assistant' && !lastAssistant) lastAssistant = text
            else if (role === 'user' && !lastUser) lastUser = text
            if (lastUser && lastAssistant) break
        }
        if (!lastUser || !lastAssistant) return null
        return { user: lastUser, assistant: lastAssistant }
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

function extractRoleFromTranscriptLine(line: string): 'user' | 'assistant' | null {
    try {
        const obj = JSON.parse(line) as { type?: string; message?: { role?: string } }
        const role = obj.message?.role ?? obj.type
        if (role === 'user' || role === 'assistant') return role
        return null
    } catch {
        return null
    }
}

function extractTextFromTranscriptLine(line: string): string {
    try {
        const obj = JSON.parse(line) as { message?: { content?: unknown } }
        const content = obj.message?.content
        if (typeof content === 'string') return content
        if (Array.isArray(content)) {
            return content
                .map((part) => {
                    if (typeof part === 'string') return part
                    if (part && typeof part === 'object' && 'text' in part && typeof (part as { text: unknown }).text === 'string') {
                        return (part as { text: string }).text
                    }
                    return ''
                })
                .filter(Boolean)
                .join('\n')
        }
        return ''
    } catch {
        return ''
    }
}
