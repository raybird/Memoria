// Boundary validation for agent summary write-back (decision D1, docs/issues/issue-1 Phase 4).
// Shared by the CLI (`repo summarize --submit`) and the HTTP endpoint (Phase 5): unknown JSON in,
// validated §7.5 payload out.

import { z } from 'zod'

export const gitSummaryPayloadSchema = z.object({
    title: z.string().min(1).max(200),
    summary: z.string().min(1).max(4000),
    key_changes: z.array(z.string().min(1)).default([]),
    decisions: z.array(z.object({
        decision: z.string().min(1),
        reason: z.string().optional()
    })).default([]),
    known_limitations: z.array(z.string().min(1)).default([]),
    risks: z.array(z.string().min(1)).default([]),
    affected_domains: z.array(z.string().min(1)).default([]),
    importance: z.number().min(0).max(1),
    confidence: z.number().min(0).max(1),
    generator_version: z.string().max(100).optional(),
    prompt_version: z.string().max(50).optional()
})

export type GitSummaryPayload = z.infer<typeof gitSummaryPayloadSchema>

export function parseGitSummaryPayload(input: unknown): GitSummaryPayload {
    const result = gitSummaryPayloadSchema.safeParse(input)
    if (!result.success) {
        const detail = result.error.issues
            .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
            .join('; ')
        throw new Error(`invalid summary payload: ${detail}`)
    }
    return result.data
}
