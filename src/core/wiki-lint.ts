import {
    getWikiLintRun,
    listSourceRecords,
    listWikiLintFindings,
    listWikiPageLinks,
    listWikiPages,
    listWikiPageSourceLinks,
    upsertWikiLintFinding,
    upsertWikiLintRun
} from './db.js'
import type { MemoriaPaths, WikiLintFinding, WikiLintOptions, WikiLintResult } from './types.js'
import { shortHash } from './utils.js'

function normalizeTitle(value: string): string {
    return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

export function runWikiLint(paths: MemoriaPaths, options: WikiLintOptions = {}): WikiLintResult {
    const createdAt = new Date().toISOString()
    const runId = `wlr_${shortHash(createdAt, 24)}`
    const staleDays = Number.isFinite(options.stale_days) ? Number(options.stale_days) : 30
    const limit = Math.min(500, Math.max(1, Math.floor(options.limit ?? 100)))

    const pages = listWikiPages(paths.dbPath, { limit: 1000 })
    const sources = listSourceRecords(paths.dbPath, { limit: 1000 })
    const pageSourceLinks = listWikiPageSourceLinks(paths.dbPath)
    const pageLinks = listWikiPageLinks(paths.dbPath)

    upsertWikiLintRun(paths.dbPath, {
        id: runId,
        status: 'completed',
        summary: `Wiki lint executed for ${pages.length} pages and ${sources.length} sources`,
        created_at: createdAt
    })

    const sourceIdsWithCompiledPages = new Set(pageSourceLinks.map((link) => link.source_id))
    const pageIdsWithSourceLinks = new Set(pageSourceLinks.map((link) => link.page_id))
    const pageIdsWithAnyLinks = new Set(pageLinks.flatMap((link) => [link.from_page_id, link.to_page_id]))
    const staleBefore = new Date(Date.now() - staleDays * 24 * 60 * 60 * 1000)

    const findings: WikiLintFinding[] = []

    for (const source of sources) {
      if (!sourceIdsWithCompiledPages.has(source.id)) {
        findings.push(upsertWikiLintFinding(paths.dbPath, {
          id: `wlf_${shortHash(`source-not-compiled:${source.id}`, 24)}`,
          run_id: runId,
          finding_type: 'source-not-compiled',
          severity: 'high',
          source_id: source.id,
          status: 'open',
          summary: `Source '${source.title}' is not linked to any compiled wiki page`,
          details: `Source ${source.id} has no wiki_page_sources link.`,
          created_at: createdAt
        }))
      }
    }

    const duplicateBuckets = new Map<string, typeof pages>()
    for (const page of pages) {
      const key = `${page.page_type}:${page.scope}:${normalizeTitle(page.title)}`
      const bucket = duplicateBuckets.get(key) ?? []
      bucket.push(page)
      duplicateBuckets.set(key, bucket)
    }
    for (const bucket of duplicateBuckets.values()) {
      if (bucket.length < 2) continue
      const [primary, ...duplicates] = bucket.sort((a, b) => a.slug.localeCompare(b.slug))
      for (const duplicate of duplicates) {
        findings.push(upsertWikiLintFinding(paths.dbPath, {
          id: `wlf_${shortHash(`duplicate:${duplicate.id}:${primary.id}`, 24)}`,
          run_id: runId,
          finding_type: 'duplicate-page',
          severity: 'medium',
          page_id: duplicate.id,
          related_page_id: primary.id,
          status: 'open',
          summary: `Duplicate wiki page title '${duplicate.title}' detected`,
          details: `Page ${duplicate.id} duplicates ${primary.id} within ${duplicate.page_type}/${duplicate.scope}.`,
          created_at: createdAt
        }))
      }
    }

    for (const page of pages) {
      const lastTouchedIso = page.last_reviewed_at ?? page.last_built_at
      const metadata = page.metadata ?? {}
      const hasSourceLinks = pageIdsWithSourceLinks.has(page.id)
      const hasPageLinks = pageIdsWithAnyLinks.has(page.id)

      if (
        page.page_type !== 'index-meta' &&
        page.page_type !== 'source-summary' &&
        !hasSourceLinks &&
        !hasPageLinks &&
        metadata.filed_from_query !== true
      ) {
        findings.push(upsertWikiLintFinding(paths.dbPath, {
          id: `wlf_${shortHash(`orphan:${page.id}`, 24)}`,
          run_id: runId,
          finding_type: 'orphan-page',
          severity: 'medium',
          page_id: page.id,
          status: 'open',
          summary: `Wiki page '${page.title}' is orphaned`,
          details: `Page ${page.id} has no source provenance or page links.`,
          created_at: createdAt
        }))
      }

      if (
        ['entity', 'concept', 'synthesis', 'comparison', 'question'].includes(page.page_type) &&
        !hasSourceLinks &&
        metadata.filed_from_query !== true
      ) {
        findings.push(upsertWikiLintFinding(paths.dbPath, {
          id: `wlf_${shortHash(`low-provenance:${page.id}`, 24)}`,
          run_id: runId,
          finding_type: 'low-provenance',
          severity: 'high',
          page_id: page.id,
          status: 'open',
          summary: `Wiki page '${page.title}' has no source provenance links`,
          details: `Page ${page.id} is a ${page.page_type} page without wiki_page_sources support.`,
          created_at: createdAt
        }))
      }

      if (lastTouchedIso) {
        const lastTouched = new Date(lastTouchedIso)
        if (!Number.isNaN(lastTouched.getTime()) && lastTouched < staleBefore && page.status === 'active' && page.page_type !== 'index-meta') {
          findings.push(upsertWikiLintFinding(paths.dbPath, {
            id: `wlf_${shortHash(`stale:${page.id}:${staleDays}`, 24)}`,
            run_id: runId,
            finding_type: 'stale-page',
            severity: 'medium',
            page_id: page.id,
            status: 'open',
            summary: `Wiki page '${page.title}' is older than ${staleDays} day(s)`,
            details: `Last touched at ${lastTouchedIso}.`,
            created_at: createdAt
          }))
        }
      }
    }

    return {
        run: getWikiLintRun(paths.dbPath, runId) ?? { id: runId, status: 'completed', summary: 'Wiki lint run completed', created_at: createdAt },
        findings: listWikiLintFindings(paths.dbPath, { status: 'open', limit }).filter((finding) => finding.run_id === runId)
    }
}
