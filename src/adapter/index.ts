// Adapter module public API

export { BaseAdapter } from './adapter.js'
export type {
    MemoriaAdapterConfig,
    AdapterContext,
    AdapterResponse,
    RecallContext
} from './adapter.js'

export { AntigravityAdapter } from './antigravity-adapter.js'
export type { AntigravityAdapterConfig, AntigravityHookInput, AntigravityHookOutput } from './antigravity-adapter.js'

export { CodexAdapter } from './codex-adapter.js'
export type { CodexAdapterConfig, CodexHookInput, CodexHookOutput } from './codex-adapter.js'

export { OpenCodeAdapter } from './opencode-adapter.js'
export type { OpenCodeAdapterConfig, OpenCodeToolResult } from './opencode-adapter.js'

export { ClaudeCodeAdapter } from './claude-code-adapter.js'
export type { ClaudeCodeAdapterConfig, ClaudeCodeHookInput, ClaudeCodeHookOutput } from './claude-code-adapter.js'
