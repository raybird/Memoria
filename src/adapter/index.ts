// Adapter module public API

export { BaseAdapter } from './adapter.js'
export type {
    MemoriaAdapterConfig,
    AdapterContext,
    AdapterResponse,
    RecallContext
} from './adapter.js'

export { GeminiAdapter } from './gemini-adapter.js'
export type { GeminiAdapterConfig, GeminiContent } from './gemini-adapter.js'

export { OpenCodeAdapter } from './opencode-adapter.js'
export type { OpenCodeAdapterConfig, OpenCodeToolResult } from './opencode-adapter.js'

export { ClaudeCodeAdapter } from './claude-code-adapter.js'
export type { ClaudeCodeAdapterConfig, ClaudeCodeHookInput, ClaudeCodeHookOutput } from './claude-code-adapter.js'
