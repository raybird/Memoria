// OpenCode Adapter (reference implementation)
// Phase 2: Shows how to integrate Memoria into the OpenCode AI agent
//
// OpenCode uses a tool-call / message-based architecture.
// Integration pattern:
//
//   1. Register a "memoria_context" tool that OpenCode calls before responding
//   2. After each response, OpenCode calls "memoria_write" tool
//
// For shell-based integration (no SDK):
//
//   # Before prompt: inject context via CLI
//   CONTEXT=$(MEMORIA_PROJECT=myproj ./cli recall --query "$USER_MSG" --json 2>/dev/null)
//
//   # After response: write session via HTTP API
//   curl -sf -X POST http://localhost:3917/v1/remember \
//     -H 'Content-Type: application/json' \
//     -d '{"project":"myproj","summary":"...","events":[...]}'
//
// For TypeScript / Node.js integration (this file):
//
//   import { OpenCodeAdapter } from './src/adapter/opencode-adapter.js'
//   const adapter = new OpenCodeAdapter({ client, project: 'opencode-project' })

import { BaseAdapter } from './adapter.js'
import type { MemoriaAdapterConfig, AdapterResponse } from './adapter.js'
import type { RecallHit } from '../core/types.js'

export interface OpenCodeAdapterConfig extends MemoriaAdapterConfig {
    /**
     * Label for the agent's "role" in session events.
     * Default: 'opencode'
     */
    agentLabel?: string
    /**
     * If true, extract lines starting with "Decision:" or "I decided" as DecisionMade events.
     * Default: true
     */
    extractDecisions?: boolean
    /**
     * If true, extract lines starting with "Skill:" or "I learned" as SkillLearned events.
     * Default: true
     */
    extractSkills?: boolean
}

// OpenCode tool call result shape (minimal, no dep on OpenCode internals)
export interface OpenCodeToolResult {
    type: 'tool_result'
    content: string
}

export class OpenCodeAdapter extends BaseAdapter {
    private readonly agentLabel: string
    private readonly extractDecisions: boolean
    private readonly extractSkills: boolean

    constructor(config: OpenCodeAdapterConfig) {
        super(config)
        this.agentLabel = config.agentLabel ?? 'opencode'
        this.extractDecisions = config.extractDecisions ?? true
        this.extractSkills = config.extractSkills ?? true
    }

    /**
     * Returns a tool result object for OpenCode's tool_call response format.
     * Use as the response to the "memoria_context" tool call.
     */
    async getContextToolResult(
        userMessage: string,
        conversationId: string
    ): Promise<OpenCodeToolResult> {
        const injected = await this.beforePrompt({ userMessage, conversationId })
        return {
            type: 'tool_result',
            content: injected || '(No relevant Memoria context found)'
        }
    }

    /**
     * Write memory after an OpenCode session turn.
     * Automatically extracts decisions and skills from the response text.
     */
    override async afterResponse(response: AdapterResponse): Promise<void> {
        try {
            if (!this.shouldWrite(response.conversationId)) return

            const events = this.extractEvents(response.response)

            const sessionData = {
                timestamp: new Date().toISOString(),
                project: response.project ?? this.config.project,
                summary: response.response.slice(0, 200),
                events: [
                    {
                        event_type: 'ConversationTurn',
                        timestamp: new Date().toISOString(),
                        content: {
                            agent: this.agentLabel,
                            user: response.userMessage ?? '',
                            assistant: response.response
                        }
                    },
                    ...events
                ]
            }

            await this.client.remember(sessionData)
            this.markWritten(response.conversationId)
        } catch (error) {
            if (!this.config.failOpen) throw error
        }
    }

    /**
     * Extract structured events from response text.
     * Pattern-matches "Decision: ..." and "Skill: ..." lines.
     */
    private extractEvents(text: string): Array<{
        event_type: string
        timestamp: string
        content: Record<string, string>
    }> {
        const events: Array<{ event_type: string; timestamp: string; content: Record<string, string> }> = []
        const ts = new Date().toISOString()
        const lines = text.split('\n')

        if (this.extractDecisions) {
            for (const line of lines) {
                const match =
                    /^(?:Decision:|I decided(?: to)?:?)\s+(.+)/i.exec(line.trim())
                if (match) {
                    events.push({
                        event_type: 'DecisionMade',
                        timestamp: ts,
                        content: {
                            decision: match[1].trim(),
                            rationale: '(extracted from agent response)',
                            impact_level: 'medium'
                        }
                    })
                }
            }
        }

        if (this.extractSkills) {
            for (const line of lines) {
                const match =
                    /^(?:Skill:|I learned(?: that)?:?)\s+(.+)/i.exec(line.trim())
                if (match) {
                    events.push({
                        event_type: 'SkillLearned',
                        timestamp: ts,
                        content: {
                            skill_name: match[1].trim().slice(0, 80),
                            category: 'agent-extracted',
                            pattern: match[1].trim()
                        }
                    })
                }
            }
        }

        return events
    }

    protected override formatRecallText(hits: RecallHit[]): string {
        if (hits.length === 0) return ''

        const items = hits.map((h) => {
            const date = h.timestamp.slice(0, 10)
            return `• [${h.type}/${h.project}/${date}] ${h.snippet}`
        })

        return [
            '<memoria_context>',
            `Retrieved ${hits.length} relevant memory item(s):`,
            ...items,
            '</memoria_context>'
        ].join('\n')
    }

}
