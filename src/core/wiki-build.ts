import fs from 'node:fs/promises'
import path from 'node:path'
import {
    getWikiPageBySlug,
    listRecentSessions,
    listSourceRecords,
    listWikiPages,
    queryStats,
    queryWikiBuildResult,
    upsertWikiPage
} from './db.js'
import type { MemoriaPaths, WikiBuildResult, WikiPageType } from './types.js'
import {
    renderWikiIndexPage,
    renderWikiLogPage,
    renderWikiOverviewPage
} from './wiki.js'
import { shortHash, slugify } from './utils.js'

async function ensureWikiDirectories(knowledgeDir: string): Promise<void> {
    await Promise.all([
        path.join(knowledgeDir, 'Daily'),
        path.join(knowledgeDir, 'Decisions'),
        path.join(knowledgeDir, 'Skills'),
        path.join(knowledgeDir, 'Sources')
    ].map((dir) => fs.mkdir(dir, { recursive: true })))
}

function inferWikiPageType(dirName: string): WikiPageType | undefined {
    if (dirName === 'Sources') return 'source-summary'
    if (dirName === 'Daily') return 'index-meta'
    if (dirName === 'Decisions') return 'comparison'
    if (dirName === 'Skills') return 'concept'
    return undefined
}

async function syncFilesystemPages(paths: MemoriaPaths): Promise<number> {
    const subdirs = ['Daily', 'Decisions', 'Skills', 'Sources'] as const
    let synced = 0

    for (const subdir of subdirs) {
        const absDir = path.join(paths.knowledgeDir, subdir)
        const entries = await fs.readdir(absDir, { withFileTypes: true })
        for (const entry of entries) {
            if (!entry.isFile() || !entry.name.endsWith('.md')) continue
            const filepath = path.join(absDir, entry.name)
            const content = await fs.readFile(filepath, 'utf8')
            const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(entry.name, '.md')
            const summary = content
                .replace(/^#.*$/m, '')
                .split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
                .slice(0, 2)
                .join(' ')
                .slice(0, 220) || `${title} page`
            const slug = slugify(path.basename(entry.name, '.md')).toLowerCase() || shortHash(filepath, 8)
            const pageType = inferWikiPageType(subdir)
            if (!pageType) continue
            const existingPage = getWikiPageBySlug(paths.dbPath, slug)

            upsertWikiPage(paths.dbPath, {
                id: existingPage?.id ?? `page_${shortHash(filepath, 24)}`,
                slug,
                title,
                page_type: pageType,
                scope: 'global',
                summary,
                filepath,
                status: 'active',
                last_built_at: new Date().toISOString(),
                metadata: {
                    source_directory: subdir,
                    synced_from_filesystem: true
                }
            })
            synced += 1
        }
    }

    return synced
}

export async function buildCompiledWiki(paths: MemoriaPaths): Promise<WikiBuildResult> {
    await ensureWikiDirectories(paths.knowledgeDir)
    const pagesSynced = await syncFilesystemPages(paths)
    const sources = listSourceRecords(paths.dbPath, { limit: 100 })
    const pages = listWikiPages(paths.dbPath, { limit: 500 })
    const sessions = listRecentSessions(paths.dbPath, 20)
    const buildSummary = queryWikiBuildResult(paths.dbPath)
    const stats = queryStats(paths.dbPath)

    const specialPages = {
        index: path.join(paths.knowledgeDir, 'index.md'),
        log: path.join(paths.knowledgeDir, 'log.md'),
        overview: path.join(paths.knowledgeDir, 'overview.md')
    }

    await fs.writeFile(specialPages.index, renderWikiIndexPage({ pages, pageTypeCounts: buildSummary.pageTypeCounts }), 'utf8')
    await fs.writeFile(specialPages.log, renderWikiLogPage({ sources, sessions }), 'utf8')
    await fs.writeFile(specialPages.overview, renderWikiOverviewPage({
        build: { pagesSynced, sourceCount: buildSummary.sourceCount, pageCount: buildSummary.pageCount, specialPages },
        stats,
        pageTypeCounts: buildSummary.pageTypeCounts
    }), 'utf8')

    return {
        pagesSynced,
        sourceCount: buildSummary.sourceCount,
        pageCount: buildSummary.pageCount,
        specialPages
    }
}
