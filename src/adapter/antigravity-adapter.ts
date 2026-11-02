// Antigravity CLI Adapter
//
// Integrates Memoria into Google's Antigravity CLI (`agy`) via its lifecycle hooks.
// Hooks receive one JSON object on stdin and return JSON on stdout. Wire the adapter
// into `<project>/.agents/hooks.json` or `~/.gemini/config/hooks.json`; the top-level
// key is an arbitrary hook name:
//
//   {
//     "memoria": {
//       "PreInvocation": [{ "type": "command", "command": "memoria adapter antigravity", "timeout": 30 }],
//       "Stop": [{ "type": "command", "command": "memoria adapter antigravity", "timeout": 30 }]
//     }
//   }
//
// Handlers sit directly under these two events. The `matcher`/`hooks` group belongs to
// the tool events only, and one invalid entry makes agy drop the whole file.
//
// Contract, verified against agy 1.4.4 runs and the hook reference it embeds (2026-11-02):
//   - The payload names no event, so it is inferred: `terminationReason` marks Stop and
//     `invocationNum` marks PreInvocation. PostInvocation carries the same payload as
//     PreInvocation, so wire only the two events above.
//   - PreInvocation fires before EVERY model call in a turn; `invocationNum` restarts at
//     0 for each user message, so recall runs once per user message.
//   - Keys are camelCase. The prompt arrives as `lastUserInput`; the assistant text
//     comes from `transcriptPath`, whose lines are agy steps rather than Claude messages.
//   - Context goes out through `injectSteps`. A `systemMessage` step lasts through the
//     tool loop, whereas an `ephemeralMessage` step is gone by the next model call and
//     a flat `additionalContext` is ignored.

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { StdinHookAdapter } from './stdin-hook-adapter.js'
import type { HookInput, HookTurn } from './stdin-hook-adapter.js'
import type { MemoriaAdapterConfig } from './adapter.js'

const DEFAULT_SCAN_LIMIT = 200

export interface AntigravityAdapterConfig extends MemoriaAdapterConfig {
    /** Max transcript steps to scan backwards when locating the answer (default: 200) */
    transcriptScanLimit?: number
}

/** The agy fields this adapter reads. Which ones are present depends on the event. */
export interface AntigravityHookInput {
    conversationId?: string
    transcriptPath?: string
    lastUserInput?: string
    /** PreInvocation / PostInvocation only. */
    invocationNum?: number
    /** Stop only. */
    terminationReason?: string
}

/** Hook response agy accepts on stdout for a PreInvocation hook. */
export interface AntigravityHookOutput {
    injectSteps?: Array<{ systemMessage: { systemMessage: string } }>
}

interface TranscriptStep {
    step_index?: number
    type?: string
    content?: unknown
    truncated_fields?: unknown
}

async function readSteps(path: string): Promise<TranscriptStep[]> {
    const raw = await readFile(path, 'utf8').catch(() => '')
    const steps: TranscriptStep[] = []
    for (const line of raw.split('\n')) {
        if (!line) continue
        try {
            steps.push(JSON.parse(line) as TranscriptStep)
        } catch {
            // A line still being written: the rest of the transcript remains usable.
        }
    }
    return steps
}

function stepText(step: TranscriptStep | undefined): string {
    return typeof step?.content === 'string' ? step.content.trim() : ''
}

/**
 * The model's final text in the latest turn ('' if it produced none).
 *
 * The scan stops at USER_INPUT so a turn that ended without an answer, such as one that
 * failed, is never paired with the previous turn's reply. `transcript.jsonl` cuts long
 * answers at about 3000 characters with no marker in the text, so a step flagged as
 * truncated is read back from `transcript_full.jsonl` beside it.
 */
async function readLatestAnswer(transcriptPath: string, scanLimit: number): Promise<string> {
    const steps = (await readSteps(transcriptPath)).slice(-scanLimit)
    for (let i = steps.length - 1; i >= 0; i--) {
        const step = steps[i]
        if (step.type === 'USER_INPUT') return ''
        if (step.type !== 'PLANNER_RESPONSE') continue
        const text = stepText(step)
        if (!text) continue
        if (!Array.isArray(step.truncated_fields) || !step.truncated_fields.includes('content')) return text
        const full = await readSteps(join(dirname(transcriptPath), 'transcript_full.jsonl'))
        return stepText(full.find((candidate) => candidate.step_index === step.step_index)) || text
    }
    return ''
}

function inferEvent(input: HookInput): string {
    if (typeof input.terminationReason === 'string') return 'Stop'
    if (typeof input.invocationNum === 'number') return 'PreInvocation'
    return ''
}

function lastUserInput(input: HookInput): string {
    return typeof input.lastUserInput === 'string' ? input.lastUserInput : ''
}

export class AntigravityAdapter extends StdinHookAdapter {
    protected readonly injectEvents = ['PreInvocation'] as const
    protected readonly stopEvents = ['Stop'] as const
    protected readonly defaultConversationId = 'antigravity-session'

    private readonly transcriptScanLimit: number

    constructor(config: AntigravityAdapterConfig) {
        super(config)
        this.transcriptScanLimit = config.transcriptScanLimit ?? DEFAULT_SCAN_LIMIT
    }

    override handleHookEvent(input: HookInput): Promise<unknown> {
        return super.handleHookEvent({ ...input, hook_event_name: inferEvent(input) })
    }

    protected override conversationId(input: HookInput): string {
        return (typeof input.conversationId === 'string' && input.conversationId.trim()) || this.defaultConversationId
    }

    protected override extractUserMessage(input: HookInput): string {
        return lastUserInput(input)
    }

    /** The injected step lasts for the rest of the conversation, so later model calls need no new recall. */
    protected override async handleInject(input: HookInput, event: string): Promise<unknown> {
        if (input.invocationNum !== 0) return this.buildInjectOutput(event)
        return super.handleInject(input, event)
    }

    protected async extractTurn(input: HookInput): Promise<HookTurn | null> {
        const user = lastUserInput(input)
        const path = typeof input.transcriptPath === 'string' ? input.transcriptPath : ''
        if (!user || !path) return null
        const assistant = await readLatestAnswer(path, this.transcriptScanLimit)
        return assistant ? { user, assistant } : null
    }

    protected buildInjectOutput(_eventName: string, text?: string): AntigravityHookOutput {
        return text ? { injectSteps: [{ systemMessage: { systemMessage: text } }] } : {}
    }
}
