// Antigravity CLI Adapter
//
// Integrates Memoria into Google's Antigravity CLI (`agy`) via its agent hook
// system. Hooks receive one JSON object on stdin and return JSON on stdout to
// inject context or gate actions. Wire the adapter into a hooks.json under the
// project agents dir (`<project>/.agents/hooks.json`); the top-level key is an
// arbitrary hook-group name (we use "memoria"):
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
// Contract (verified against Antigravity hook docs, July 2026):
//   - `PreInvocation` injects context before the model runs; `Stop` marks turn end.
//   - Antigravity does NOT deliver the user prompt or assistant message as payload
//     fields — both are recovered from `transcript_path`, so this adapter is
//     transcript-based (like Claude Code), not payload-field-based (like Codex).
//   - Injection output MUST be flat `{ "additionalContext": "..." }`; wrapping it
//     under `hookSpecificOutput` fails Antigravity's schema validation.
// The remaining unverified detail is the transcript line FORMAT (assumed to match
// the Claude Code JSONL envelope); capture a real payload with MEMORIA_ADAPTER_DEBUG
// to confirm.

import { StdinHookAdapter } from './stdin-hook-adapter.js'
import type { HookInput, HookTurn } from './stdin-hook-adapter.js'
import type { MemoriaAdapterConfig } from './adapter.js'
import { readLastTurn, readLatestUserMessage } from './transcript.js'

export interface AntigravityAdapterConfig extends MemoriaAdapterConfig {
    /** Max transcript lines to scan backwards when locating the turn (default: 50) */
    transcriptScanLimit?: number
}

/** Shape of the JSON Antigravity writes to a hook's stdin. Fields are optional because they vary by event. */
export interface AntigravityHookInput {
    hook_event_name?: string
    session_id?: string
    /** Path to the session transcript log (both spellings observed across builds). */
    transcript_path?: string
    transcriptPath?: string
    cwd?: string
}

/** Hook response Antigravity accepts on stdout (flat — no legacy hookSpecificOutput wrapper). */
export interface AntigravityHookOutput {
    additionalContext?: string
}

export class AntigravityAdapter extends StdinHookAdapter {
    // PreInvocation is Antigravity's context-injection point; UserPromptSubmit is a Claude-compatible alias.
    protected readonly injectEvents = ['PreInvocation', 'UserPromptSubmit'] as const
    // Stop / PostInvocation mark turn completion.
    protected readonly stopEvents = ['Stop', 'PostInvocation'] as const
    protected readonly defaultConversationId = 'antigravity-session'

    private readonly transcriptScanLimit: number

    constructor(config: AntigravityAdapterConfig) {
        super(config)
        this.transcriptScanLimit = config.transcriptScanLimit ?? 50
    }

    private transcriptPath(input: HookInput): string {
        if (typeof input.transcript_path === 'string' && input.transcript_path) return input.transcript_path
        if (typeof input.transcriptPath === 'string' && input.transcriptPath) return input.transcriptPath
        return ''
    }

    /** Antigravity has no `prompt` field; read the latest user message from the transcript. */
    protected override async extractUserMessage(input: HookInput): Promise<string> {
        const path = this.transcriptPath(input)
        if (!path) return ''
        return readLatestUserMessage(path, this.transcriptScanLimit)
    }

    /** Antigravity has no `last_assistant_message` field; read the last turn from the transcript. */
    protected async extractTurn(input: HookInput): Promise<HookTurn | null> {
        const path = this.transcriptPath(input)
        if (!path) return null
        return readLastTurn(path, this.transcriptScanLimit)
    }

    protected buildInjectOutput(_eventName: string, text?: string): AntigravityHookOutput {
        // Flat output only — a nested hookSpecificOutput copy fails Antigravity schema validation.
        return text ? { additionalContext: text } : {}
    }
}
