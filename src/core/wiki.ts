import type {
    RecentSessionRecord,
    SourceRecord,
    StatsData,
    WikiBuildResult,
    WikiLintFindingType,
    WikiLintSeverity,
    WikiPage,
    WikiPageStatus,
    WikiPageType
} from './types.js'

export const wikiPageTypes = [
    'source-summary',
    'entity',
    'concept',
    'synthesis',
    'comparison',
    'question',
    'index-meta'
] as const satisfies readonly WikiPageType[]

export const wikiPageStatuses = ['draft', 'active', 'archived'] as const satisfies readonly WikiPageStatus[]

export const wikiLintFindingTypes = [
    'orphan-page',
    'stale-page',
    'missing-page',
    'missing-link',
    'contradiction',
    'low-provenance',
    'duplicate-page',
    'source-not-compiled'
] as const satisfies readonly WikiLintFindingType[]

export const wikiLintSeverities = ['high', 'medium', 'low'] as const satisfies readonly WikiLintSeverity[]

export function isWikiPageType(value: string): value is WikiPageType {
    return (wikiPageTypes as readonly string[]).includes(value)
}

export function isWikiPageStatus(value: string): value is WikiPageStatus {
    return (wikiPageStatuses as readonly string[]).includes(value)
}

export function isWikiLintFindingType(value: string): value is WikiLintFindingType {
    return (wikiLintFindingTypes as readonly string[]).includes(value)
}

export function isWikiLintSeverity(value: string): value is WikiLintSeverity {
    return (wikiLintSeverities as readonly string[]).includes(value)
}

function renderMetadataLines(entries: Array<[string, string | number | undefined]>): string {
    return entries
        .filter(([, value]) => value !== undefined && value !== '')
        .map(([label, value]) => `- ${label}: ${value}`)
        .join('\n')
}

export function renderSourceSummaryPage(input: {
    title: string
    sourceId: string
    type: string
    scope: string
    importedAt: string
    checksum: string
    originPath: string
    summary: string
}): string {
    return `# ${input.title}

## Metadata
${renderMetadataLines([
        ['Source ID', `\`${input.sourceId}\``],
        ['Type', input.type],
        ['Scope', input.scope],
        ['Imported At', input.importedAt],
        ['Checksum', `\`${input.checksum}\``],
        ['Origin Path', `\`${input.originPath}\``]
    ])}

## Summary
${input.summary}
`
}

export function renderWikiIndexPage(input: { pages: WikiPage[]; pageTypeCounts: Record<string, number> }): string {
    const grouped = new Map<string, WikiPage[]>()
    for (const page of input.pages) {
        const bucket = grouped.get(page.page_type) ?? []
        bucket.push(page)
        grouped.set(page.page_type, bucket)
    }

    const sections = [...grouped.entries()].map(([pageType, pages]) => {
        const items = pages
            .sort((a, b) => a.title.localeCompare(b.title))
            .map((page) => `- [[${page.filepath ? page.filepath.split('/').slice(-2).join('/').replace(/\.md$/, '') : page.slug}|${page.title}]] - ${page.summary}`)
            .join('\n')
        return `## ${pageType} (${input.pageTypeCounts[pageType] ?? pages.length})\n${items}`
    })

    return `# Knowledge Index

## Summary
${Object.entries(input.pageTypeCounts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([pageType, count]) => `- ${pageType}: ${count}`)
        .join('\n')}

${sections.join('\n\n')}
`
}

export function renderWikiLogPage(input: { sources: SourceRecord[]; sessions: RecentSessionRecord[] }): string {
    const sourceEntries = input.sources.map((source) => `## [${source.imported_at.slice(0, 10)}] source | ${source.title}

- id: \`${source.id}\`
- type: ${source.type}
- scope: ${source.scope}`)

    const sessionEntries = input.sessions.map((session) => `## [${session.timestamp.slice(0, 10)}] session | ${session.id}

- project: ${session.project}
- scope: ${session.scope}
- summary: ${session.summary || '(none)'}`)

    const entries = [...sourceEntries, ...sessionEntries].join('\n\n')
    return `# Knowledge Log

${entries || 'No log entries yet.'}
`
}

export function renderWikiOverviewPage(input: {
    build: WikiBuildResult
    stats: StatsData
    pageTypeCounts: Record<string, number>
}): string {
    return `# Knowledge Overview

## Runtime Summary
${renderMetadataLines([
        ['Source Count', input.build.sourceCount],
        ['Wiki Page Count', input.build.pageCount],
        ['Session Count', input.stats.sessions],
        ['Event Count', input.stats.events],
        ['Skill Count', input.stats.skills]
    ])}

## Wiki Page Types
${Object.entries(input.pageTypeCounts)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([pageType, count]) => `- ${pageType}: ${count}`)
        .join('\n') || '- (none)'}

## Last Session
${input.stats.lastSession ? `- ${input.stats.lastSession.id} (${input.stats.lastSession.project}, ${input.stats.lastSession.timestamp})` : '- (none)'}
`
}
