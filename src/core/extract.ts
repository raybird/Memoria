// Shared extraction of Decision / Skill fields from a memory event's content.
//
// `DecisionMade` and `SkillLearned` events store their payload as JSON in the event
// `content` column. Reading those fields (title, rationale, skill name, success rate, …)
// was duplicated across sync (markdown generation), recall (tree indexing), and telemetry
// (governance review). These pure helpers are the single source of truth for that shape,
// so adding a field or hardening the heuristic happens in one place.
//
// (The standalone MCP bridge script under skills/ runs in a separate Node runtime and
// cannot import this module; keep it in sync manually if the fields change.)

import { maybeParseJson } from './utils.js'

export interface DecisionFields {
    /** Raw `decision` string ('' when absent); use `title` for display. */
    decision: string
    /** Trimmed decision, or 'Untitled Decision' when absent. */
    title: string
    rationale: string
    alternatives: string[]
    /** Impact level, defaulting to 'medium'. */
    impact_level: string
}

export interface SkillFields {
    /** Raw `skill_name` string ('' when absent); use `title` for display. */
    skill_name: string
    /** Trimmed skill name, or 'Untitled Skill' when absent. */
    title: string
    category: string
    success_rate: number
    pattern: string
    examples: string[]
}

function asObject(content: unknown): Record<string, unknown> {
    const parsed = typeof content === 'string' ? maybeParseJson(content) : content
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
}

function asString(value: unknown): string {
    return typeof value === 'string' ? value : ''
}

function asStringList(value: unknown): string[] {
    return Array.isArray(value) ? value.map((item) => String(item)) : []
}

/** Parse a `DecisionMade` event's content (JSON string or object) into normalized fields. */
export function parseDecisionEvent(content: unknown): DecisionFields {
    const obj = asObject(content)
    const decision = asString(obj.decision)
    return {
        decision,
        title: decision.trim() || 'Untitled Decision',
        rationale: asString(obj.rationale),
        alternatives: asStringList(obj.alternatives_considered),
        impact_level: asString(obj.impact_level) || 'medium'
    }
}

/** Parse a `SkillLearned` event's content (JSON string or object) into normalized fields. */
export function parseSkillEvent(content: unknown): SkillFields {
    const obj = asObject(content)
    const skillName = asString(obj.skill_name)
    const rate = typeof obj.success_rate === 'number' ? obj.success_rate : Number(obj.success_rate ?? 0)
    return {
        skill_name: skillName,
        title: skillName.trim() || 'Untitled Skill',
        category: asString(obj.category) || 'general',
        success_rate: Number.isFinite(rate) ? rate : 0,
        pattern: asString(obj.pattern),
        examples: asStringList(obj.examples)
    }
}
