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
// `UserPromptSubmit` carries the user text in `prompt`; `Stop` recovers the
// completed user/assistant turn from the session transcript file.

import { StdinHookAdapter } from './stdin-hook-adapter.js'
import type { HookInput, HookTurn } from './stdin-hook-adapter.js'
import type { MemoriaAdapterConfig } from './adapter.js'
import { readLastTurn } from './transcript.js'

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
        return readLastTurn(transcriptPath, this.transcriptScanLimit)
    }

    protected buildInjectOutput(eventName: string, text?: string): ClaudeCodeHookOutput {
        const output: ClaudeCodeHookOutput = { hookSpecificOutput: { hookEventName: eventName } }
        if (text !== undefined) output.hookSpecificOutput!.additionalContext = text
        return output
    }
}
