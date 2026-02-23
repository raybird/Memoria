// Core module public API
// Import from here when consuming MemoriaCore in CLI, HTTP server, or SDK.

export { MemoriaCore } from './memoria.js'
export { resolveMemoriaPaths, getMemoriaHome, existsSync } from './paths.js'
export {
    initDatabase,
    importSession,
    syncDailyNote,
    extractDecisions,
    extractSkills,
    queryStats,
    runVerify,
    runPrune,
    exportMemory,
    recallKeyword,
    querySessionSummary
} from './db.js'
export {
    safeDate, slugify, stableStringify, shortHash,
    resolveSessionId, resolveEventId,
    getEventType, getEventContentObject,
    maybeParseJson, normalizeSkillKey,
    parseDaysOption, parseBoundaryDate,
    inDateRange, parseCreatedAt
} from './utils.js'
export type {
    Json, SessionEvent, SessionData, MemoriaPaths,
    VerifyStatus, VerifyCheck,
    ExportType, ExportFormat, ExportDecision, ExportSkill, ExportOptions,
    PruneOptions, MemoriaResult, RecallFilter, RecallHit,
    SessionSummary, HealthStatus, StatsData
} from './types.js'
