import fs from 'node:fs/promises'
import path from 'node:path'
import Database from 'better-sqlite3'
import { existsSync } from '../paths.js'
import { safeDate, slugify } from '../utils.js'
import type { Json } from '../types.js'

export async function syncDailyNote(memoriaHome: string, dbPath: string, sessionId: string): Promise<void> {
    const db = new Database(dbPath, { readonly: true })
    try {
        const row = db
            .prepare('SELECT timestamp, project, event_count, summary FROM sessions WHERE id = ?')
            .get(sessionId) as { timestamp: string; project: string; event_count: number; summary: string } | undefined

        if (!row) return

        const d = safeDate(row.timestamp)
        const date = d.toISOString().slice(0, 10)
        const time = d.toISOString().slice(11, 16)
        const notePath = path.join(memoriaHome, 'knowledge', 'Daily', `${date}.md`)

        const newEntry = `\n## ${time} - ${row.project}\n\n${row.summary ?? ''}\n\n事件數: ${row.event_count} | Session ID: \`${sessionId}\`\n`

        let content = `# ${date}\n\n${newEntry}`
        if (existsSync(notePath)) {
            const oldContent = await fs.readFile(notePath, 'utf8')
            content = `${oldContent}${newEntry}`
        }

        await fs.writeFile(notePath, content, 'utf8')
    } finally {
        db.close()
    }
}

export async function extractDecisions(memoriaHome: string, dbPath: string, sessionId: string): Promise<void> {
    const db = new Database(dbPath, { readonly: true })
    try {
        const rows = db
            .prepare(`
        SELECT id, timestamp, content
        FROM events
        WHERE session_id = ? AND event_type = 'DecisionMade'
      `)
            .all(sessionId) as { id: string; timestamp: string; content: string }[]

        for (const row of rows) {
            let contentData: Json = {}
            try {
                contentData = JSON.parse(row.content) as Json
            } catch {
                contentData = {}
            }

            const decisionTitle =
                typeof contentData.decision === 'string' && contentData.decision.trim()
                    ? contentData.decision.trim()
                    : 'Untitled Decision'

            const date = safeDate(row.timestamp).toISOString().slice(0, 10)
            const filename = `${date}_${slugify(decisionTitle).slice(0, 40)}_${slugify(row.id).slice(0, 8)}.md`
            const filePath = path.join(memoriaHome, 'knowledge', 'Decisions', filename)

            const alternatives = Array.isArray(contentData.alternatives_considered)
                ? (contentData.alternatives_considered as unknown[])
                    .map((a) => `- ${String(a)}`)
                    .join('\n')
                : '- (none)'

            const decisionDoc = `# ${decisionTitle}

## 元數據
- **日期**: ${row.timestamp}
- **Session ID**: \`${sessionId}\`

## 決策內容
${typeof contentData.decision === 'string' ? contentData.decision : ''}

## 理由
${typeof contentData.rationale === 'string' ? contentData.rationale : ''}

## 考慮的替代方案
${alternatives}

## 影響等級
${typeof contentData.impact_level === 'string' ? contentData.impact_level : 'medium'}

## 相關連結
[[${date}]]
`

            await fs.writeFile(filePath, decisionDoc, 'utf8')
        }
    } finally {
        db.close()
    }
}

export async function extractSkills(memoriaHome: string, dbPath: string, sessionId: string): Promise<void> {
    const db = new Database(dbPath)
    try {
        const rows = db
            .prepare(`
        SELECT id, timestamp, content
        FROM events
        WHERE session_id = ? AND event_type = 'SkillLearned'
      `)
            .all(sessionId) as { id: string; timestamp: string; content: string }[]

        const upsertSkill = db.prepare(`
      INSERT OR REPLACE INTO skills
      (id, name, category, created_date, success_rate, use_count, filepath)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

        for (const row of rows) {
            let contentData: Json = {}
            try {
                contentData = JSON.parse(row.content) as Json
            } catch {
                contentData = {}
            }

            const skillName =
                typeof contentData.skill_name === 'string' && contentData.skill_name.trim()
                    ? contentData.skill_name.trim()
                    : 'Untitled Skill'
            const successRateRaw =
                typeof contentData.success_rate === 'number' ? contentData.success_rate : Number(contentData.success_rate ?? 0)
            const successRate = Number.isFinite(successRateRaw) ? successRateRaw : 0
            const category = typeof contentData.category === 'string' ? contentData.category : 'general'
            const date = safeDate(row.timestamp).toISOString().slice(0, 10)

            const filename = `${slugify(skillName)}.md`
            const filePath = path.join(memoriaHome, 'knowledge', 'Skills', filename)

            const examples = Array.isArray(contentData.examples)
                ? (contentData.examples as unknown[]).map((e) => `- ${String(e)}`).join('\n')
                : '- (none)'

            const skillDoc = `# ${skillName}

## 元數據
- **創建日期**: ${row.timestamp}
- **類別**: ${category}
- **成功率**: ${(successRate * 100).toFixed(1)}%
- **使用次數**: 1

## 模式描述
${typeof contentData.pattern === 'string' ? contentData.pattern : ''}

## 實際案例
${examples}

## 版本歷史
- v1.0 (${date}): 初始版本
`

            await fs.writeFile(filePath, skillDoc, 'utf8')

            upsertSkill.run(
                slugify(skillName).toLowerCase(),
                skillName,
                category,
                row.timestamp,
                successRate,
                1,
                filePath
            )
        }
    } finally {
        db.close()
    }
}
