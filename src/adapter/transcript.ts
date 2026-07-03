// Shared JSONL transcript parsing for hook adapters whose host CLI delivers the
// conversation via a `transcript_path` rather than payload fields (Claude Code and
// Antigravity). Each transcript line is a message envelope like:
//   {"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]}}
//
// NOTE: The Claude Code transcript format is confirmed. The Antigravity (`agy`)
// transcript line format is assumed to match this shape and is the one remaining
// item to verify against a real payload (capture with MEMORIA_ADAPTER_DEBUG).

import { readFile } from 'node:fs/promises'
import type { HookTurn } from './stdin-hook-adapter.js'

const DEFAULT_SCAN_LIMIT = 50

async function readLines(transcriptPath: string, scanLimit: number): Promise<string[]> {
    const raw = await readFile(transcriptPath, 'utf8').catch(() => '')
    if (!raw) return []
    return raw.split('\n').filter(Boolean).slice(-scanLimit)
}

/** The most recent user/assistant pair in the transcript, or null if incomplete. */
export async function readLastTurn(transcriptPath: string, scanLimit = DEFAULT_SCAN_LIMIT): Promise<HookTurn | null> {
    const lines = await readLines(transcriptPath, scanLimit)
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

/** The most recent user message text in the transcript ('' if none). */
export async function readLatestUserMessage(transcriptPath: string, scanLimit = DEFAULT_SCAN_LIMIT): Promise<string> {
    const lines = await readLines(transcriptPath, scanLimit)
    for (let i = lines.length - 1; i >= 0; i--) {
        if (extractRoleFromTranscriptLine(lines[i]) === 'user') {
            const text = extractTextFromTranscriptLine(lines[i])
            if (text) return text
        }
    }
    return ''
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
