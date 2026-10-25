import type Database from 'better-sqlite3';
import { z } from 'zod';
import { withDb } from './connection.js';
import { parseDecisionEvent, parseSkillEvent } from '../extract.js';
import { maybeParseJson } from '../utils.js';
import type { MemoryFilter, MemoryPage, MemoryDetail, MemoryFacets, MemoryItem, MemoryKind, RecallHitSource } from '../types.js';
export const memoryFilterSchema = z.object({
    type: z.enum(['decision', 'skill', 'session']).default('decision'),
    project: z.string().min(1).optional(),
    environment: z.boolean().default(false),
    durable: z.boolean().default(false),
    include_superseded: z.boolean().default(false),
    page: z.number().int().min(1).max(1000000).default(1),
    page_size: z.number().int().min(1).max(50).default(50)
}).refine(v => !(v.project && v.environment), 'project and environment are mutually exclusive');
export const memorySearchSchema = z.object({
    query: z.string().trim().min(1).max(2000), mode: z.enum(['keyword', 'vector']).default('keyword'),
    project: z.string().min(1).optional(), environment: z.boolean().default(false), include_superseded: z.boolean().default(false)
}).refine(v => !(v.project && v.environment), 'project and environment are mutually exclusive');
function hasTable(db: Database.Database, name: string): boolean {
    return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
}
function repositories(db: Database.Database): string[] {
    if (!hasTable(db, 'repositories'))
        return [];
    return (db.prepare('SELECT DISTINCT name FROM repositories ORDER BY name').all() as {
        name: string;
    }[]).map(r => r.name);
}
export function queryMemoryFacets(dbPath: string): MemoryFacets {
    return withDb(dbPath, { readonly: true, fileMustExist: true }, db => {
        const registered = repositories(db);
        const projects = (db.prepare('SELECT DISTINCT project FROM sessions WHERE project IS NOT NULL ORDER BY project').all() as {
            project: string;
        }[]).map(r => r.project);
        return { repositories: registered, environment_projects: projects.filter(p => !registered.includes(p)) };
    });
}
function markerJoin(db: Database.Database): string {
    if (hasTable(db, 'memory_attributes'))
        return 'LEFT JOIN memory_attributes m ON m.ref_id = x.id';
    return 'LEFT JOIN (SELECT NULL AS ref_id, NULL AS retention, NULL AS sensitivity, NULL AS superseded_by, NULL AS note) m ON 0';
}
function sourceSql(kind: MemoryKind): string {
    if (kind === 'session')
        return 'SELECT id, id AS session_id, timestamp, project, scope, summary AS content FROM sessions';
    const event = kind === 'decision' ? 'DecisionMade' : 'SkillLearned';
    return `SELECT e.id, e.session_id, e.timestamp, COALESCE(s.project,'default') AS project, COALESCE(s.scope,'') AS scope, e.content FROM events e LEFT JOIN sessions s ON s.id=e.session_id WHERE e.event_type='${event}'`;
}
type Row = {
    id: string;
    session_id: string;
    timestamp: string;
    project: string;
    scope: string;
    content: string;
    retention: MemoryItem['retention'];
    sensitivity: MemoryItem['sensitivity'];
    superseded_by: string | null;
    note: string | null;
};
function fields(row: Row, kind: MemoryKind): {
    title: string;
    body: string;
    rationale: string;
} {
    if (kind === 'session')
        return { title: row.content?.trim() || '未命名 session', body: row.content ?? '', rationale: '' };
    if (kind === 'decision') {
        const parsed = parseDecisionEvent(row.content);
        return { title: parsed.decision || '未命名決策', body: parsed.decision || row.content || '', rationale: parsed.rationale };
    }
    const parsed = parseSkillEvent(row.content);
    return { title: parsed.skill_name || '未命名技能', body: parsed.pattern || row.content || '', rationale: '' };
}
function item(row: Row, kind: MemoryKind): MemoryItem {
    const parsed = fields(row, kind);
    return { id: row.id, type: kind, session_id: row.session_id, timestamp: row.timestamp, project: row.project,
        title: parsed.title.slice(0, 160), snippet: (parsed.rationale || parsed.body).slice(0, 220), retention: row.retention ?? null,
        sensitivity: row.sensitivity ?? null, superseded_by: row.superseded_by ?? null };
}
export function queryMemoryPage(dbPath: string, input: MemoryFilter = {}): MemoryPage {
    const filter = memoryFilterSchema.parse(input);
    return withDb(dbPath, { readonly: true, fileMustExist: true }, db => {
        const clauses: string[] = [];
        const params: (string | number)[] = [];
        if (filter.project) {
            clauses.push('x.project = ?');
            params.push(filter.project);
        }
        if (filter.environment) {
            const names = repositories(db);
            if (names.length) {
                clauses.push(`x.project NOT IN (${names.map(() => '?').join(',')})`);
                params.push(...names);
            }
        }
        if (filter.durable)
            clauses.push("m.retention='durable'");
        if (!filter.include_superseded)
            clauses.push('m.superseded_by IS NULL');
        const from = `FROM (${sourceSql(filter.type)}) x ${markerJoin(db)} ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}`;
        const total = (db.prepare(`SELECT COUNT(*) AS n ${from}`).get(...params) as {
            n: number;
        }).n;
        // Extract only the display fields in SQLite: long bodies/reasons never cross the list boundary.
        let preview = 'substr(x.content,1,220)';
        if (filter.type === 'decision')
            preview = "CASE WHEN json_valid(x.content) THEN json_object('decision',substr(json_extract(x.content,'$.decision'),1,220),'rationale',substr(json_extract(x.content,'$.rationale'),1,220)) ELSE substr(x.content,1,220) END";
        if (filter.type === 'skill')
            preview = "CASE WHEN json_valid(x.content) THEN json_object('skill_name',substr(json_extract(x.content,'$.skill_name'),1,160),'pattern',substr(json_extract(x.content,'$.pattern'),1,220)) ELSE substr(x.content,1,220) END";
        const rows = db.prepare(`SELECT x.id,x.session_id,x.timestamp,x.project,x.scope,${preview} AS content,m.retention,m.sensitivity,m.superseded_by,m.note ${from} ORDER BY julianday(x.timestamp) DESC,x.id DESC LIMIT ? OFFSET ?`)
            .all(...params, filter.page_size, (filter.page - 1) * filter.page_size) as Row[];
        return { items: rows.map(row => item(row, filter.type)), total, page: filter.page, page_size: filter.page_size };
    });
}
function gitSource(db: Database.Database, ref: string): RecallHitSource | undefined {
    if (!['memory_sources', 'git_summaries', 'git_summary_ranges', 'repositories'].every(t => hasTable(db, t)))
        return undefined;
    const row = db.prepare(`SELECT ms.source_type AS type,ms.source_id AS summary_id,ms.base_sha,ms.head_sha,r.source_ref AS branch,r.tag_name AS tag,repo.name AS repository
        FROM memory_sources ms JOIN git_summaries s ON s.id=ms.source_id JOIN git_summary_ranges r ON r.id=s.summary_range_id JOIN repositories repo ON repo.id=ms.repository_id WHERE ms.memory_id=? LIMIT 1`).get(ref) as RecallHitSource | undefined;
    return row;
}
export function queryMemoryDetail(dbPath: string, ref: string, kind?: MemoryKind): MemoryDetail {
    if (!ref || ref.length > 1024)
        throw new Error('invalid memory reference');
    return withDb(dbPath, { readonly: true, fileMustExist: true }, db => {
        const kinds: MemoryKind[] = kind ? [z.enum(['decision', 'skill', 'session']).parse(kind)] : ['decision', 'skill', 'session'];
        for (const type of kinds) {
            const row = db.prepare(`SELECT x.*,m.retention,m.sensitivity,m.superseded_by,m.note FROM (${sourceSql(type)}) x ${markerJoin(db)} WHERE x.id=?`).get(ref) as Row | undefined;
            if (!row)
                continue;
            const parsed = fields(row, type);
            const parent = db.prepare('SELECT id,summary FROM sessions WHERE id=?').get(row.session_id) as {
                id: string;
                summary: string;
            } | undefined;
            const source = gitSource(db, row.id) ?? gitSource(db, row.session_id);
            const sourceMissing = !source && hasTable(db, 'memory_sources') && Boolean(db.prepare("SELECT 1 FROM memory_sources WHERE memory_id IN (?,?) AND source_type LIKE 'git_%' LIMIT 1").get(row.id, row.session_id));
            return { ...item(row, type), title: parsed.title, body: parsed.body, rationale: parsed.rationale,
                content: type === 'session' ? row.content : maybeParseJson(row.content), scope: row.scope,
                note: row.note, session: parent ?? null, source, source_missing: sourceMissing };
        }
        throw new Error('memory not found');
    });
}
