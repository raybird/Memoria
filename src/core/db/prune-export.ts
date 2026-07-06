import fs from 'node:fs/promises'
import path from 'node:path'
import { existsSync } from '../paths.js'
import { withDb } from './connection.js'
import { slugify, maybeParseJson, parseDaysOption, parseBoundaryDate, inDateRange, normalizeSkillKey, parseCreatedAt } from '../utils.js'
import { initDatabase } from './schema.js'
import { truncateText } from './mappers.js'
import type { Json, MemoriaPaths, PruneOptions, ExportDecision, ExportSkill, ExportOptions, ExportType, ExportFormat } from '../types.js'

async function collectFilesRecursively(dirPath: string): Promise<string[]> {
    if (!existsSync(dirPath)) return []
    const entries = await fs.readdir(dirPath, { withFileTypes: true })
    const files: string[] = []
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name)
        if (entry.isDirectory()) {
            files.push(...(await collectFilesRecursively(fullPath)))
        } else if (entry.isFile()) {
            files.push(fullPath)
        }
    }
    return files
}

async function pruneFilesByAge(
    label: string,
    dirPath: string,
    olderThanDays: number,
    dryRun: boolean
): Promise<{ label: string; matched: number; removed: number; bytes: number }> {
    const cutoffMs = Date.now() - olderThanDays * 24 * 60 * 60 * 1000
    const files = await collectFilesRecursively(dirPath)
    let matched = 0, removed = 0, bytes = 0

    for (const filePath of files) {
        const stat = await fs.stat(filePath)
        if (stat.mtimeMs >= cutoffMs) continue
        matched += 1
        bytes += stat.size
        if (!dryRun) {
            await fs.unlink(filePath)
            removed += 1
        }
    }

    return { label, matched, removed: dryRun ? 0 : removed, bytes }
}

function pruneSkillsDuplicates(dbPath: string, dryRun: boolean): { duplicateGroups: number; removed: number } {
    if (!existsSync(dbPath)) return { duplicateGroups: 0, removed: 0 }

    return withDb(dbPath, (db) => {
        const rows = db
            .prepare('SELECT id, name, created_date, use_count FROM skills')
            .all() as { id: string; name: string; created_date: string; use_count: number }[]

        const groups = new Map<string, { id: string; name: string; created_date: string; use_count: number }[]>()
        for (const row of rows) {
            const key = normalizeSkillKey(row.name)
            const list = groups.get(key) ?? []
            list.push(row)
            groups.set(key, list)
        }

        const deleteIds: string[] = []
        let duplicateGroups = 0

        for (const [, list] of groups) {
            if (list.length <= 1) continue
            duplicateGroups += 1
            list.sort((a, b) => {
                const tDiff = parseCreatedAt(b.created_date) - parseCreatedAt(a.created_date)
                if (tDiff !== 0) return tDiff
                const uDiff = (b.use_count ?? 0) - (a.use_count ?? 0)
                if (uDiff !== 0) return uDiff
                return a.id.localeCompare(b.id)
            })
            for (const row of list.slice(1)) deleteIds.push(row.id)
        }

        if (!dryRun && deleteIds.length > 0) {
            const del = db.prepare('DELETE FROM skills WHERE id = ?')
            const tx = db.transaction((ids: string[]) => { for (const id of ids) del.run(id) })
            tx(deleteIds)
        }

        return { duplicateGroups, removed: dryRun ? 0 : deleteIds.length }
    })
}

function pruneConsolidate(
    dbPath: string,
    cutoffDays: number,
    dryRun: boolean
): { groupsFound: number; sessionsConsolidated: number; nodesRemoved: number } {
    if (!existsSync(dbPath)) return { groupsFound: 0, sessionsConsolidated: 0, nodesRemoved: 0 }

    return withDb(dbPath, (db) => {
        const cutoff = new Date(Date.now() - cutoffDays * 24 * 60 * 60 * 1000).toISOString()

        const topicGroups = db.prepare(`
          SELECT parent.id AS topic_id, parent.title AS topic_title, parent.summary AS topic_summary,
                 COUNT(child.id) AS child_count
          FROM memory_nodes parent
          JOIN memory_nodes child ON child.parent_id = parent.id AND child.level = 2
          WHERE parent.level = 1
            AND child.updated_at < ?
          GROUP BY parent.id
          HAVING COUNT(child.id) >= 3
        `).all(cutoff) as { topic_id: string; topic_title: string; topic_summary: string; child_count: number }[]

        if (topicGroups.length === 0) return { groupsFound: 0, sessionsConsolidated: 0, nodesRemoved: 0 }

        let totalConsolidated = 0
        let totalRemoved = 0

        if (!dryRun) {
            db.transaction(() => {
                for (const group of topicGroups) {
                    const children = db.prepare(`
                      SELECT id, title, summary, updated_at
                      FROM memory_nodes
                      WHERE parent_id = ? AND level = 2 AND updated_at < ?
                      ORDER BY updated_at DESC
                    `).all(group.topic_id, cutoff) as { id: string; title: string; summary: string; updated_at: string }[]

                    if (children.length < 3) continue

                    const toRemove = children.slice(1)
                    const summaries = toRemove.map((c) => c.summary || c.title).filter(Boolean)

                    if (summaries.length > 0) {
                        const merged = `${group.topic_summary ? group.topic_summary + ' | ' : ''}Consolidated: ${summaries.slice(0, 5).join('; ')}`
                        db.prepare('UPDATE memory_nodes SET summary = ?, updated_at = ? WHERE id = ?')
                            .run(truncateText(merged, 500), new Date().toISOString(), group.topic_id)
                    }

                    const delSources = db.prepare('DELETE FROM memory_node_sources WHERE node_id = ?')
                    const delNode = db.prepare('DELETE FROM memory_nodes WHERE id = ?')
                    for (const child of toRemove) {
                        delSources.run(child.id)
                        delNode.run(child.id)
                    }

                    totalConsolidated += toRemove.length
                    totalRemoved += toRemove.length
                }
            })()
        } else {
            for (const group of topicGroups) {
                const children = db.prepare(`
                  SELECT id FROM memory_nodes
                  WHERE parent_id = ? AND level = 2 AND updated_at < ?
                `).all(group.topic_id, cutoff) as { id: string }[]
                if (children.length >= 3) {
                    totalConsolidated += children.length - 1
                    totalRemoved += children.length - 1
                }
            }
        }

        return { groupsFound: topicGroups.length, sessionsConsolidated: totalConsolidated, nodesRemoved: totalRemoved }
    })
}

function pruneStaleMemory(
    dbPath: string,
    cutoffDays: number,
    dryRun: boolean
): { staleNodes: number; staleSessions: number; removedNodes: number; removedSessions: number } {
    if (!existsSync(dbPath)) return { staleNodes: 0, staleSessions: 0, removedNodes: 0, removedSessions: 0 }

    return withDb(dbPath, (db) => {
        const cutoff = new Date(Date.now() - cutoffDays * 24 * 60 * 60 * 1000).toISOString()

        const staleNodes = db.prepare(`
          SELECT id FROM memory_nodes
          WHERE level = 2
            AND last_synced_at IS NULL
            AND updated_at < ?
        `).all(cutoff) as { id: string }[]

        const staleSessions = db.prepare(`
          SELECT s.id FROM sessions s
          LEFT JOIN memory_node_sources mns ON mns.session_id = s.id
          WHERE mns.session_id IS NULL
            AND s.timestamp < ?
        `).all(cutoff) as { id: string }[]

        if (!dryRun) {
            db.transaction(() => {
                const delSources = db.prepare('DELETE FROM memory_node_sources WHERE node_id = ?')
                const delNode = db.prepare('DELETE FROM memory_nodes WHERE id = ?')
                for (const node of staleNodes) {
                    delSources.run(node.id)
                    delNode.run(node.id)
                }

                const delEvents = db.prepare('DELETE FROM events WHERE session_id = ?')
                const delSession = db.prepare('DELETE FROM sessions WHERE id = ?')
                for (const session of staleSessions) {
                    delEvents.run(session.id)
                    delSession.run(session.id)
                }
            })()
        }

        return {
            staleNodes: staleNodes.length,
            staleSessions: staleSessions.length,
            removedNodes: dryRun ? 0 : staleNodes.length,
            removedSessions: dryRun ? 0 : staleSessions.length
        }
    })
}

export async function runPrune(
    paths: MemoriaPaths,
    options: PruneOptions
): Promise<{
    exports?: { matched: number; removed: number; bytes: number }
    checkpoints?: { matched: number; removed: number; bytes: number }
    dedupe?: { duplicateGroups: number; removed: number }
    consolidate?: { groupsFound: number; sessionsConsolidated: number; nodesRemoved: number }
    stale?: { staleNodes: number; staleSessions: number; removedNodes: number; removedSessions: number }
}> {
    const dryRun = Boolean(options.dryRun)
    const all = Boolean(options.all)

    const exportsDays = parseDaysOption(options.exportsDays, '--exports-days') ?? (all ? 30 : undefined)
    const checkpointsDays = parseDaysOption(options.checkpointsDays, '--checkpoints-days') ?? (all ? 30 : undefined)
    const dedupeSkills = Boolean(options.dedupeSkills) || all
    const consolidateDays = parseDaysOption(options.consolidateDays, '--consolidate-days') ?? (all ? 90 : undefined)
    const staleDays = parseDaysOption(options.staleDays, '--stale-days') ?? (all ? 180 : undefined)

    if (exportsDays === undefined && checkpointsDays === undefined && !dedupeSkills && consolidateDays === undefined && staleDays === undefined) {
        throw new Error('No prune target specified. Use --all or one of: --exports-days, --checkpoints-days, --dedupe-skills, --consolidate-days, --stale-days')
    }

    const result: ReturnType<typeof runPrune> extends Promise<infer R> ? R : never = {}

    if (exportsDays !== undefined) {
        const r = await pruneFilesByAge('exports', path.join(paths.memoryDir, 'exports'), exportsDays, dryRun)
        result.exports = { matched: r.matched, removed: r.removed, bytes: r.bytes }
    }
    if (checkpointsDays !== undefined) {
        const r = await pruneFilesByAge('checkpoints', path.join(paths.memoryDir, 'checkpoints'), checkpointsDays, dryRun)
        result.checkpoints = { matched: r.matched, removed: r.removed, bytes: r.bytes }
    }
    if (dedupeSkills) {
        result.dedupe = pruneSkillsDuplicates(paths.dbPath, dryRun)
    }
    if (consolidateDays !== undefined) {
        result.consolidate = pruneConsolidate(paths.dbPath, consolidateDays, dryRun)
    }
    if (staleDays !== undefined) {
        result.stale = pruneStaleMemory(paths.dbPath, staleDays, dryRun)
    }

    return result
}

export async function exportMemory(paths: MemoriaPaths, options: ExportOptions): Promise<{
    filePath: string
    decisions: ExportDecision[]
    skills: ExportSkill[]
}> {
    if (!existsSync(paths.dbPath)) {
        throw new Error(`sessions.db not found: ${paths.dbPath}. Run 'memoria init' first.`)
    }
    initDatabase(paths.dbPath)

    const from = parseBoundaryDate(options.from, '--from')
    const to = parseBoundaryDate(options.to, '--to')
    const projectFilter = options.project?.trim()
    const scopeFilter = options.scope?.trim()
    const type = (options.type ?? 'all') as ExportType
    const format = (options.format ?? 'json') as ExportFormat
    const outDir = options.out ? path.resolve(options.out) : path.join(paths.memoryDir, 'exports')

    return withDb(paths.dbPath, { readonly: true }, async (db) => {
        const decisionsRows =
            type === 'all' || type === 'decisions'
                ? (db.prepare(`
            SELECT e.id, e.session_id, e.timestamp, e.content, s.project, s.scope
            FROM events e JOIN sessions s ON s.id = e.session_id
            WHERE e.event_type = 'DecisionMade'
          `).all() as { id: string; session_id: string; timestamp: string; content: string; project: string; scope: string }[])
                : []

        const skillsRows =
            type === 'all' || type === 'skills'
                ? (db.prepare(`
            SELECT e.id, e.session_id, e.timestamp, e.content, s.project, s.scope
            FROM events e JOIN sessions s ON s.id = e.session_id
            WHERE e.event_type = 'SkillLearned'
          `).all() as { id: string; session_id: string; timestamp: string; content: string; project: string; scope: string }[])
                : []

        const decisions: ExportDecision[] = decisionsRows
            .filter((r) => (!projectFilter || r.project === projectFilter) && (!scopeFilter || (r as { scope?: string }).scope === scopeFilter) && inDateRange(r.timestamp, from, to))
            .map((r) => {
                const content = maybeParseJson(r.content)
                const c = content && typeof content === 'object' && !Array.isArray(content) ? (content as Json) : {}
                return {
                    id: r.id, session_id: r.session_id, timestamp: r.timestamp, project: r.project,
                    decision: String(c.decision ?? ''), rationale: String(c.rationale ?? ''),
                    impact_level: String(c.impact_level ?? 'medium')
                }
            })

        const skills: ExportSkill[] = skillsRows
            .filter((r) => (!projectFilter || r.project === projectFilter) && (!scopeFilter || (r as { scope?: string }).scope === scopeFilter) && inDateRange(r.timestamp, from, to))
            .map((r) => {
                const content = maybeParseJson(r.content)
                const c = content && typeof content === 'object' && !Array.isArray(content) ? (content as Json) : {}
                return {
                    id: r.id, session_id: r.session_id, timestamp: r.timestamp, project: r.project,
                    skill_name: String(c.skill_name ?? ''), category: String(c.category ?? 'general'),
                    pattern: String(c.pattern ?? '')
                }
            })

        await fs.mkdir(outDir, { recursive: true })
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        const projectPart = projectFilter ? `_${slugify(projectFilter).slice(0, 30)}` : ''
        const ext = format === 'json' ? 'json' : 'md'
        const filePath = path.join(outDir, `memoria-export_${type}${projectPart}_${stamp}.${ext}`)

        const payload = {
            generated_at: new Date().toISOString(),
            filters: { from: options.from ?? null, to: options.to ?? null, project: projectFilter ?? null, scope: scopeFilter ?? null, type, format },
            counts: { decisions: decisions.length, skills: skills.length },
            decisions, skills
        }

        if (format === 'json') {
            await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8')
        } else {
            const decisionBlock = decisions
                .map((d) => `- [${d.timestamp}] (${d.project}) ${d.decision || '(untitled)'} | impact=${d.impact_level} | session=${d.session_id}`)
                .join('\n')
            const skillBlock = skills
                .map((s) => `- [${s.timestamp}] (${s.project}) ${s.skill_name || '(untitled)'} | category=${s.category}`)
                .join('\n')
            const md = `# Memoria Export\n\nGenerated: ${payload.generated_at}\n\n## Filters\n- from: ${payload.filters.from ?? '(none)'}\n- to: ${payload.filters.to ?? '(none)'}\n- project: ${payload.filters.project ?? '(none)'}\n- scope: ${payload.filters.scope ?? '(none)'}\n- type: ${type}\n\n## Counts\n- decisions: ${decisions.length}\n- skills: ${skills.length}\n\n## Decisions\n${decisionBlock || '- (none)'}\n\n## Skills\n${skillBlock || '- (none)'}\n`
            await fs.writeFile(filePath, md, 'utf8')
        }

        return { filePath, decisions, skills }
    })
}
