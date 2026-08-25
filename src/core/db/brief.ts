// Memory brief (docs/issues/issue-4 Phase 2).
//
// Compiles the high-value slice of memory into one derived view: recent decisions, memories that
// proved useful (UFL), and per-repository state. Purpose is context injection WITHOUT hooks — the
// caller writes it to knowledge/BRIEF.md and CLAUDE.md pulls it in with `@knowledge/BRIEF.md`, so
// every session starts with memory loaded at zero execution cost.
//
// Read-only. Every optional table (memory_utility, the git_* family) is probed before use, so this
// works unchanged on a DB that predates UFL or Git-Aware Memory.

import type Database from 'better-sqlite3'
import { withDb } from './connection.js'
import { effectiveUtility, maybeParseJson } from '../utils.js'
import { parseDecisionEvent, parseSkillEvent } from '../extract.js'
import { truncateText } from './mappers.js'
import type { BriefData, BriefDecision, BriefMemory, BriefPinned, BriefRepository } from '../types.js'

function tableExists(db: Database.Database, name: string): boolean {
    return Boolean(db.prepare(`SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1`).get(name))
}

export type BriefOptions = {
    project?: string
    days?: number
    topK?: number
}

/** A CLI note occupies two refs — its session and its event — and both get marked or attributed.
 *  The shared content fingerprint is what identifies the note itself. */
function noteFingerprintOf(ref: string): string | null {
    return ref.startsWith('note-') ? ref.slice('note-'.length)
        : ref.startsWith('noteev-') ? ref.slice('noteev-'.length)
            : null
}

/** Human-readable text + project for a mixed batch of session and event refs. Event content is a
 *  JSON string, so the readable field is surfaced rather than the raw blob. */
function resolveRefTexts(
    db: Database.Database,
    ids: string[]
): Map<string, { text: string; project: string }> {
    const texts = new Map<string, { text: string; project: string }>()
    if (ids.length === 0) return texts
    const placeholders = ids.map(() => '?').join(',')
    for (const row of db.prepare(`
      SELECT id, summary AS text, project FROM sessions WHERE id IN (${placeholders})
    `).all(...ids) as Array<{ id: string; text: string; project: string }>) {
        texts.set(row.id, { text: row.text ?? '', project: row.project })
    }
    for (const row of db.prepare(`
      SELECT e.id, e.content AS text, e.event_type, s.project
      FROM events e JOIN sessions s ON s.id = e.session_id WHERE e.id IN (${placeholders})
    `).all(...ids) as Array<{ id: string; text: string; event_type: string; project: string }>) {
        const parsed = maybeParseJson(row.text ?? '')
        const readable = row.event_type === 'DecisionMade'
            ? parseDecisionEvent(parsed).decision
            : row.event_type === 'SkillLearned'
                ? parseSkillEvent(parsed).skill_name
                : String(row.text ?? '')
        texts.set(row.id, { text: readable || String(row.text ?? ''), project: row.project })
    }
    return texts
}

/** Keep one entry per note (preferring the session half, whose text is plain rather than JSON) and
 *  every non-note ref as-is. Without this the same note is listed twice. */
function collapseNotePairs(refs: string[]): string[] {
    const sessionRefs = new Set(refs.filter((ref) => ref.startsWith('note-')))
    const seen = new Set<string>()
    const kept: string[] = []
    for (const ref of refs) {
        const fingerprint = noteFingerprintOf(ref)
        if (fingerprint !== null) {
            if (ref.startsWith('noteev-') && sessionRefs.has(`note-${fingerprint}`)) continue
            if (seen.has(fingerprint)) continue
            seen.add(fingerprint)
        }
        kept.push(ref)
    }
    return kept
}

export function queryBrief(dbPath: string, options: BriefOptions = {}): BriefData {
    const days = options.days && options.days > 0 ? options.days : 30
    const topK = options.topK && options.topK > 0 ? options.topK : 10
    const project = options.project?.trim() || null
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

    return withDb(dbPath, { readonly: true }, (db) => {
        const projectClause = project ? 'AND s.project = ?' : ''
        const projectParams = project ? [project] : []

        // Superseded memories must not reach the brief. `recall` has excluded them
        // since memory attributes shipped, but the brief did not — so a correction
        // written with `--supersedes` left the replaced claim sitting in the one
        // artifact that gets loaded into every session, next to its own correction.
        // The marker is written against both halves of a CLI note (its session and
        // its event), so matching on the event id here is enough.
        const hasAttributes = tableExists(db, 'memory_attributes')
        const supersededJoin = hasAttributes
            ? 'LEFT JOIN memory_attributes ma ON ma.ref_id = e.id'
            : ''
        // Filtered in SQL rather than after the fact so LIMIT still yields topK
        // live decisions instead of topK minus however many were replaced.
        const supersededClause = hasAttributes ? 'AND ma.superseded_by IS NULL' : ''

        // issue-17: memories marked durable are pinned — they leave the recency rotation entirely.
        // Ordered by created_at so the block is stable across runs; no LIMIT, by design (SCN-003).
        const durableRefs = hasAttributes
            ? (db.prepare(`
                SELECT ref_id FROM memory_attributes
                WHERE retention = 'durable' AND superseded_by IS NULL
                ORDER BY created_at ASC, ref_id ASC
              `).all() as Array<{ ref_id: string }>).map((row) => row.ref_id)
            : []

        // A pinned memory must not also consume a recent-decisions slot (SCN-004). Filtered in SQL
        // for the same reason the superseded filter is: LIMIT must still yield topK live rows.
        const pinnedClause = durableRefs.length > 0
            ? `AND e.id NOT IN (${durableRefs.map(() => '?').join(',')})`
            : ''

        const decisionRows = db.prepare(`
          SELECT e.id, e.timestamp, e.content, s.project
          FROM events e JOIN sessions s ON s.id = e.session_id
          ${supersededJoin}
          WHERE e.event_type = 'DecisionMade' AND e.timestamp >= ? ${projectClause}
          ${supersededClause}
          ${pinnedClause}
          ORDER BY e.timestamp DESC LIMIT ?
        `).all(since, ...projectParams, ...durableRefs, topK) as Array<{ id: string; timestamp: string; content: string; project: string }>

        const decisions: BriefDecision[] = decisionRows.map((row) => {
            const parsed = parseDecisionEvent(maybeParseJson(row.content))
            return {
                id: row.id,
                timestamp: row.timestamp,
                project: row.project,
                decision: truncateText(parsed.decision || parsed.title),
                rationale: truncateText(parsed.rationale, 120)
            }
        })

        const pinned: BriefPinned[] = []
        if (durableRefs.length > 0) {
            const texts = resolveRefTexts(db, durableRefs)
            for (const ref of collapseNotePairs(durableRefs)) {
                const found = texts.get(ref)
                if (!found) continue
                if (project && found.project !== project) continue
                pinned.push({ ref_id: ref, project: found.project, snippet: truncateText(found.text) })
            }
        }

        // Memories with an accrued utility signal — what actually earned its keep (UFL Phase 3).
        const high_utility: BriefMemory[] = []
        if (tableExists(db, 'memory_utility')) {
            const rows = db.prepare(`
              SELECT ref_id, observations, utility_sum, explicit_observations, explicit_sum
              FROM memory_utility
            `).all() as Array<{ ref_id: string; observations: number; utility_sum: number; explicit_observations: number; explicit_sum: number }>

            // Same exclusion as the decision list: a memory that earned utility
            // before being replaced must not come back through this section.
            // Filtered before the slice so a replaced entry does not consume a
            // topK slot.
            const supersededRefs = hasAttributes
                ? new Set((db.prepare(
                    `SELECT ref_id FROM memory_attributes WHERE superseded_by IS NOT NULL`
                  ).all() as Array<{ ref_id: string }>).map((r) => r.ref_id))
                : new Set<string>()

            const scored = rows
                .map((row) => ({ ref_id: row.ref_id, utility: effectiveUtility(row), row }))
                .filter((entry): entry is { ref_id: string; utility: number; row: typeof rows[number] } => entry.utility !== null)
                .filter((entry) => !supersededRefs.has(entry.ref_id))
                .sort((a, b) => b.utility - a.utility)
                .slice(0, topK)

            if (scored.length > 0) {
                const texts = resolveRefTexts(db, scored.map((entry) => entry.ref_id))
                const keptRefs = new Set(collapseNotePairs(scored.map((entry) => entry.ref_id)))

                for (const entry of scored) {
                    const found = texts.get(entry.ref_id)
                    if (!found) continue
                    if (project && found.project !== project) continue

                    if (!keptRefs.has(entry.ref_id)) continue
                    high_utility.push({
                        ref_id: entry.ref_id,
                        project: found.project,
                        utility: Number(entry.utility.toFixed(3)),
                        observations: entry.row.explicit_observations > 0 ? entry.row.explicit_observations : entry.row.observations,
                        signal: entry.row.explicit_observations > 0 ? 'explicit' : 'reuse',
                        snippet: truncateText(found.text)
                    })
                }
            }
        }

        const repositories: BriefRepository[] = []
        if (tableExists(db, 'repositories') && tableExists(db, 'git_summaries')) {
            const repoRows = db.prepare(`
              SELECT id, name, default_branch FROM repositories ORDER BY name ASC
            `).all() as Array<{ id: string; name: string; default_branch: string | null }>

            for (const repo of repoRows) {
                if (project && repo.name !== project) continue
                const latest = db.prepare(`
                  SELECT s.id, s.title, s.summary_type, s.created_at
                  FROM git_summaries s JOIN git_summary_ranges r ON r.id = s.summary_range_id
                  WHERE r.repository_id = ? AND s.status = 'enriched'
                  ORDER BY s.created_at DESC LIMIT 1
                `).get(repo.id) as { id: string; title: string; summary_type: string; created_at: string } | undefined
                const pending = Number((db.prepare(`
                  SELECT COUNT(*) AS c FROM git_summaries s JOIN git_summary_ranges r ON r.id = s.summary_range_id
                  WHERE r.repository_id = ? AND s.status = 'pending'
                `).get(repo.id) as { c: number }).c)

                repositories.push({
                    repository: repo.name,
                    default_branch: repo.default_branch,
                    latest_summary: latest ? { id: latest.id, title: truncateText(latest.title, 120), type: latest.summary_type, created_at: latest.created_at } : null,
                    pending_summaries: pending
                })
            }
        }

        const sessionsTotal = Number((db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number }).c)

        return {
            generated_at: new Date().toISOString(),
            project,
            days,
            pinned,
            decisions,
            high_utility,
            repositories,
            totals: {
                sessions: sessionsTotal,
                decisions_in_window: decisions.length,
                pending_summaries: repositories.reduce((sum, repo) => sum + repo.pending_summaries, 0)
            }
        }
    })
}

/** Deterministic markdown rendering — same data in, same bytes out apart from `generated_at`. */
export function renderBrief(data: BriefData): string {
    const lines: string[] = []
    const scope = data.project ? ` --project ${data.project}` : ''
    lines.push(`<!-- generated by: memoria brief${scope} --days ${data.days} at ${data.generated_at} -->`)
    lines.push('<!-- DERIVED VIEW — do not edit by hand; every run overwrites this file. -->')
    lines.push('')
    lines.push('# Memoria Brief')
    lines.push('')
    lines.push(`- 範圍: ${data.project ?? '(all projects)'} ｜ 近 ${data.days} 天`)
    lines.push(`- sessions: ${data.totals.sessions} ｜ 期間決策: ${data.totals.decisions_in_window} ｜ 待增強摘要: ${data.totals.pending_summaries}`)
    lines.push('')

    // Pinned first: these are the constraints that must survive rotation, so they must also survive
    // a reader who stops early. Emitted only when non-empty — a zero-marker database must render
    // byte-identically to its pre-issue-17 output (SCN-005), the discipline issue-5 set.
    if (data.pinned.length > 0) {
        lines.push('## 常駐約束（pinned）')
        lines.push('')
        for (const item of data.pinned) {
            lines.push(`- ${item.snippet} ｜ ${item.project}`)
        }
        lines.push('')
    }

    lines.push('## 近期決策')
    lines.push('')
    if (data.decisions.length === 0) {
        lines.push('_(無)_')
    } else {
        for (const decision of data.decisions) {
            lines.push(`- **${decision.decision}** — ${decision.project} ｜ ${decision.timestamp}`)
            if (decision.rationale) lines.push(`  - why: ${decision.rationale}`)
        }
    }
    lines.push('')

    lines.push('## 高效用記憶（UFL）')
    lines.push('')
    if (data.high_utility.length === 0) {
        lines.push('_(尚無效用觀測)_')
    } else {
        for (const memory of data.high_utility) {
            lines.push(`- [${memory.utility}] ${memory.snippet}`)
            lines.push(`  - ${memory.project} ｜ ${memory.signal} ×${memory.observations} ｜ id: \`${memory.ref_id}\``)
        }
    }
    lines.push('')

    if (data.repositories.length > 0) {
        lines.push('## Repository 狀態')
        lines.push('')
        for (const repo of data.repositories) {
            const branch = repo.default_branch ? ` (${repo.default_branch})` : ''
            lines.push(`- **${repo.repository}**${branch} ｜ 待增強: ${repo.pending_summaries}`)
            if (repo.latest_summary) {
                lines.push(`  - 最新摘要: ${repo.latest_summary.title} [${repo.latest_summary.type}] ｜ ${repo.latest_summary.created_at}`)
            }
        }
        lines.push('')
    }

    return `${lines.join('\n')}\n`
}
