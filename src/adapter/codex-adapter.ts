// Codex CLI Adapter
//
// Integrates Memoria into OpenAI's Codex CLI via its hook system. Codex hooks
// receive one JSON object on stdin and may return JSON on stdout to inject
// context or take action. Wire the adapter into a `hooks.json` next to your
// Codex config, or an inline `[hooks]` table in ~/.codex/config.toml:
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
// The same command handles both events; it dispatches on hook_event_name.
// `UserPromptSubmit` injects recalled memory via hookSpecificOutput.additionalContext
// (buffering the prompt); `Stop` persists the completed turn from the payload's
// last_assistant_message plus the buffered prompt.
//
// Contract (verified against Codex hook docs, July 2026): `hook_event_name`,
// `UserPromptSubmit`+`prompt`, `Stop`+`last_assistant_message` (string | null), and
// the `hookSpecificOutput.additionalContext` injection shape are all real Codex fields.

import { StdinHookAdapter } from './stdin-hook-adapter.js'
import type { HookInput, HookTurn } from './stdin-hook-adapter.js'
import type { MemoriaAdapterConfig } from './adapter.js'

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

export class CodexAdapter extends StdinHookAdapter {
    protected readonly injectEvents = ['UserPromptSubmit'] as const
    protected readonly stopEvents = ['Stop'] as const
    protected readonly defaultConversationId = 'codex-session'

    protected extractTurn(input: HookInput, conversationId: string): HookTurn | null {
        const assistant = (typeof input.last_assistant_message === 'string' ? input.last_assistant_message : '').trim()
        if (!assistant) return null
        return { user: this.takeUserPrompt(conversationId), assistant }
    }

    protected buildInjectOutput(eventName: string, text?: string): CodexHookOutput {
        const output: CodexHookOutput = { hookSpecificOutput: { hookEventName: eventName } }
        if (text !== undefined) output.hookSpecificOutput!.additionalContext = text
        return output
    }
}
