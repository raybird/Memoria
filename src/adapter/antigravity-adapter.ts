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
// `PreInvocation` recalls memory and injects it before the model runs (buffering
// the prompt); `Stop` persists the completed turn. Antigravity's context-injection
// field is `additionalContext`; some builds expect it at the top level and some
// nested under hookSpecificOutput (Claude Code compatible), so we emit both.

import { StdinHookAdapter } from './stdin-hook-adapter.js'
import type { HookInput, HookTurn } from './stdin-hook-adapter.js'
import type { MemoriaAdapterConfig } from './adapter.js'

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

export class AntigravityAdapter extends StdinHookAdapter {
    // PreInvocation is Antigravity's context-injection point; UserPromptSubmit is the Claude-compatible alias.
    protected readonly injectEvents = ['PreInvocation', 'UserPromptSubmit'] as const
    // Stop / PostInvocation mark turn completion.
    protected readonly stopEvents = ['Stop', 'PostInvocation'] as const
    protected readonly defaultConversationId = 'antigravity-session'

    protected extractTurn(input: HookInput, conversationId: string): HookTurn | null {
        const assistant = (typeof input.last_assistant_message === 'string' ? input.last_assistant_message : '').trim()
        if (!assistant) return null
        return { user: this.takeUserPrompt(conversationId), assistant }
    }

    protected buildInjectOutput(eventName: string, text?: string): AntigravityHookOutput {
        if (!text) return {}
        return {
            additionalContext: text,
            hookSpecificOutput: { hookEventName: eventName, additionalContext: text }
        }
    }
}
