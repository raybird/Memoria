// Core module public API
// Import from here when consuming MemoriaCore in CLI, HTTP server, or SDK.

export { MemoriaCore } from './memoria.js'
export { resolveMemoriaPaths, getMemoriaHome, resolveMemoriaHomeInfo, existsSync } from './paths.js'
export type { MemoriaHomeSource, MemoriaHomeResolution } from './paths.js'
export { importSourceFile } from './source-import.js'
export { loadMemoriaConfig, defaultMemoriaConfig, CONFIG_FILE_NAME } from './config.js'
export type { MemoriaConfig, MemoriaGitConfig } from './config.js'
export { buildCompiledWiki } from './wiki-build.js'
export { fileQueryResult } from './wiki-query.js'
export { runWikiLint } from './wiki-lint.js'
export {
    wikiPageTypes,
    wikiPageStatuses,
    wikiLintFindingTypes,
    wikiLintSeverities,
    isWikiPageType,
    isWikiPageStatus,
    isWikiLintFindingType,
    isWikiLintSeverity
} from './wiki.js'
export {
    initDatabase,
    importSession,
    syncDailyNote,
    extractDecisions,
    extractSkills,
    queryStats,
    queryRecallTelemetry,
    queryGovernanceReview,
    logRecallTelemetry,
    recordRecallOutcome,
    runVerify,
    runPrune,
    exportMemory,
    upsertSourceRecord,
    listSourceRecords,
    listRecentSessions,
    upsertWikiPage,
    getWikiPageBySlug,
    listWikiPages,
    listWikiPageSourceLinks,
    listWikiPageLinks,
    queryWikiBuildResult,
    upsertWikiPageSourceLink,
    upsertWikiPageLink,
    upsertWikiLintRun,
    getWikiLintRun,
    upsertWikiLintFinding,
    listWikiLintFindings,
    upsertWikiQueryArtifact,
    buildMemoryIndex,
    recallTree,
    recallKeyword,
    querySessionSummary,
    registerRepository,
    listRepositories,
    findRepository,
    relocateRepositoryInstance,
    removeRepository,
    closeAllConnections
} from './db/index.js'
export { resolveRepositoryIdentity, normalizeRemoteUrl } from './git/identity.js'
export { getHostId } from './git/host.js'
export { runGit, GitExecError } from './git/git-exec.js'
export { parseGitSummaryPayload, gitSummaryPayloadSchema } from './git/summary-schema.js'
export {
    runSummaryPipeline,
    summarizeBranch,
    summarizeExplicitRange,
    summarizeMergeCommit,
    summarizeTag,
    RELEASE_TAG_PATTERN
} from './git/summary-pipeline.js'
export {
    safeDate, slugify, stableStringify, shortHash, deriveScope,
    resolveSessionId, resolveEventId,
    getEventType, getEventContentObject,
    maybeParseJson, normalizeSkillKey,
    parseDaysOption, parseBoundaryDate,
    inDateRange, parseCreatedAt,
    isLowValueMemoryText, sanitizeSessionDataForImport
} from './utils.js'
export type {
    Json, SourceType, SourceStatus, SourceRecord, SessionEvent, SessionData, MemoriaPaths,
    WikiPageType, WikiPageStatus, WikiPage, WikiPageSourceLink, WikiPageLink,
    WikiLintFindingType, WikiLintSeverity, WikiLintFindingStatus, WikiLintFinding, WikiLintRun,
    RecentSessionRecord, WikiBuildResult, WikiQueryArtifactKind, WikiQueryArtifact,
    WikiLintResult, WikiLintOptions,
    VerifyStatus, VerifyCheck,
    ExportType, ExportFormat, ExportDecision, ExportSkill, ExportOptions,
    PruneOptions, MemoriaResult, RecallFilter, RecallHit, RecallHitSource,
    SessionSummary, HealthStatus, StatsData,
    RecallTelemetryPoint, RecallTelemetryData,
    GovernanceReviewOptions, GovernanceReviewItem, GovernanceReviewData,
    MemoryIndexBuildOptions, MemoryIndexBuildResult,
    UpsertSourceInput, UpsertWikiPageInput, UpsertWikiPageSourceLinkInput,
    UpsertWikiPageLinkInput, UpsertWikiLintRunInput, UpsertWikiLintFindingInput,
    UpsertWikiQueryArtifactInput, ImportSourceInput, ImportedSourceData,
    FileQueryInput, FiledQueryData,
    RepositoryStatus, RepositoryRecord, RepositoryInstanceRecord, GitWorktreeRecord,
    RepoAddInput, RepoRegistrationData, RepoListItem, RepoLiveStatus, RepoStatusData,
    RepoRemoveOptions, RepoRemoveData, RepoSyncOptions, RepoSyncData,
    GitSummaryType, GitSummaryStatus, GitSummaryContent, GitSummaryRangeRecord, GitSummaryRecord,
    RepoSummarizeOptions, RepoSummarizeData, PendingSummaryRequest, PendingSummariesData
} from './types.js'
