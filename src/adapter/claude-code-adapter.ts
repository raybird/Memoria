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
// The same command handles both events; it dispatches on hook_event_name.
// Unlike the Codex/Antigravity adapters, `Stop` recovers both the user and
// assistant text from the session transcript file rather than the payload.

import { readFile } from 'node:fs/promises'
import { StdinHookAdapter } from './stdin-hook-adapter.js'
import type { HookInput, HookTurn } from './stdin-hook-adapter.js'
import type { MemoriaAdapterConfig } from './adapter.js'

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

export class ClaudeCodeAdapter extends StdinHookAdapter {
    protected readonly injectEvents = ['UserPromptSubmit'] as const
    protected readonly stopEvents = ['Stop'] as const
    protected readonly defaultConversationId = 'claude-code-session'

    private readonly transcriptScanLimit: number

    constructor(config: ClaudeCodeAdapterConfig) {
        super(config)
        this.transcriptScanLimit = config.transcriptScanLimit ?? 50
    }

    /** Recover the completed turn from the session transcript rather than the payload. */
    protected async extractTurn(input: HookInput): Promise<HookTurn | null> {
        const transcriptPath = typeof input.transcript_path === 'string' ? input.transcript_path : ''
        if (!transcriptPath) return null
        return this.readLastTurn(transcriptPath)
    }

    protected buildInjectOutput(eventName: string, text?: string): ClaudeCodeHookOutput {
        const output: ClaudeCodeHookOutput = { hookSpecificOutput: { hookEventName: eventName } }
        if (text !== undefined) output.hookSpecificOutput!.additionalContext = text
        return output
    }

    /**
     * Scan the JSONL transcript backwards and extract the most recent
     * user/assistant pair. Each transcript line is a message envelope
     * like `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]}}`.
     */
    private async readLastTurn(transcriptPath: string): Promise<HookTurn | null> {
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
