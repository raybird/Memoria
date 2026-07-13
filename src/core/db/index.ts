export { initDatabase } from './schema.js'
export { importSession, listRecentSessions, querySessionSummary } from './session.js'
export { upsertSourceRecord, listSourceRecords } from './source.js'
export {
    upsertWikiPage,
    getWikiPageBySlug,
    listWikiPages,
    queryWikiBuildResult,
    upsertWikiPageSourceLink,
    listWikiPageSourceLinks,
    upsertWikiPageLink,
    listWikiPageLinks,
    upsertWikiQueryArtifact
} from './wiki.js'
export { upsertWikiLintRun, getWikiLintRun, upsertWikiLintFinding, listWikiLintFindings } from './lint.js'
export { syncDailyNote, extractDecisions, extractSkills } from './sync.js'
export { logRecallTelemetry, recordRecallOutcome, queryStats, queryRecallTelemetry, queryGovernanceReview } from './telemetry.js'
export { runVerify } from './verify.js'
export { runPrune, exportMemory } from './prune-export.js'
export { buildMemoryIndex, recallTree, recallKeyword, applyUtilityWeighting } from './recall.js'
export {
    registerRepository,
    listRepositories,
    findRepository,
    relocateRepositoryInstance,
    removeRepository
} from './git-repo.js'
export {
    getCurrentRefObservations,
    insertCommits,
    applyRefSnapshot,
    beginScanRun,
    completeScanRun,
    failScanRun,
    updateWorktreeScanState,
    insertGitEvents
} from './git-scan.js'
export { closeAllConnections } from './connection.js'
