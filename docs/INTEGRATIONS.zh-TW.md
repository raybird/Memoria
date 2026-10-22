# SDK 與 Agent 整合

[English](INTEGRATIONS.md) ｜ **繁體中文** · [README](../README.zh-TW.md)

最後驗證：2026-10-23，對照 v1.31.1 原始碼、CLI help 與文件檢查。

以 deployed skill 使用記憶不需要 server，設定方式見 [安裝指南](INSTALL.md)。以下 SDK 範例假設從 repository checkout 載入原始碼；npm 套件提供 CLI，未提供 SDK export。SDK 與 hook adapter 需要 HTTP server。

## Node.js SDK

```typescript
import { MemoriaClient } from '../src/sdk.js'

const client = new MemoriaClient()         // default http://localhost:3917
await client.waitUntilReady()              // poll /v1/health 直到就緒

const r = await client.remember(sessionData)
const hits = await client.recall({ query: 'migration', top_k: 3, scope: 'project:Memoria' })
const telemetry = await client.recallTelemetry({ window: 'P7D', limit: 50 })
const summary = await client.summarizeSession('session_abc')

// 效用回饋（UFL）：回報這次召回實際有沒有幫上忙
const recallId = hits.meta.recall_id!
await client.recordRecallOutcome(recallId, { signal: 'reuse', utility_score: 0.8 })   // proxy 訊號
await client.markRecallUseful(recallId, true, hits.data!.map(h => h.id))              // 明確回饋（高保真）
```

## Agent Adapter

```typescript
import { OpenCodeAdapter } from '../src/adapter/index.js'

const adapter = new OpenCodeAdapter({ client, project: 'my-project' })

// Before prompt: 注入歷史記憶
const context = await adapter.beforePrompt({ userMessage, conversationId })

// After response: 儲存記憶（自動 throttle + dedupe + fail-open）
await adapter.afterResponse({ response, conversationId, userMessage })
```

參考實作：[src/adapter/antigravity-adapter.ts](../src/adapter/antigravity-adapter.ts)、[src/adapter/codex-adapter.ts](../src/adapter/codex-adapter.ts)、[src/adapter/opencode-adapter.ts](../src/adapter/opencode-adapter.ts)、[src/adapter/claude-code-adapter.ts](../src/adapter/claude-code-adapter.ts)

Claude Code、Codex CLI、Antigravity CLI 都提供**零程式碼 hook 整合**——一行 CLI 指令同時處理 recall 注入與回合寫回。三者都 fail-open，Memoria 故障不會打斷 agent；都需要 `memoria serve` 在 `localhost:3917`（可用 `--server` 或 `MEMORIA_SERVER_URL` 覆寫）。

### Claude Code（透過 hook 零程式碼整合）

把 Memoria 接到 Claude Code 完全不用寫程式，只需 CLI：

```jsonc
// ~/.claude/settings.json（或專案的 .claude/settings.json）
{
  "hooks": {
    "UserPromptSubmit": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "memoria adapter claude-code" }] }
    ],
    "Stop": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "memoria adapter claude-code" }] }
    ]
  }
}
```

`UserPromptSubmit` 會把相關過往記憶以 `additionalContext` 注入；`Stop` 會把剛完成的這一輪寫回 Memoria。兩者都 fail-open，Memoria 故障不會打斷 Claude Code session。需要 `memoria serve` 在 `localhost:3917`（可用 `--server` 或 `MEMORIA_SERVER_URL` 覆寫）。

### Codex CLI（透過 hook 零程式碼整合）

Codex CLI 的 hook 系統與 Claude Code 相同（stdin 收 JSON、stdout 回 JSON）。接進 Codex 設定旁的 `hooks.json`，或 `~/.codex/config.toml` 內的 `[hooks]` 表：

```jsonc
// ~/.codex/hooks.json
{
  "hooks": {
    "UserPromptSubmit": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "memoria adapter codex" }] }
    ],
    "Stop": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "memoria adapter codex" }] }
    ]
  }
}
```

`UserPromptSubmit` 把 recall 到的記憶以 `additionalContext`（額外 developer context）注入；`Stop` 用 payload 的 `last_assistant_message` 寫回這一輪。

### Antigravity CLI（透過 hook 零程式碼整合）

Antigravity CLI（`agy`）提供 agent 生命週期 hook（stdin/stdout 走 JSON）。在客製目錄的 `hooks.json` 註冊 handler：

```jsonc
// .agents/hooks/hooks.json（或 settings.json 的 "hooks"）
{
  "memoria": {
    "PreInvocation": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "memoria adapter antigravity", "timeout": 30 }] }
    ],
    "Stop": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "memoria adapter antigravity", "timeout": 30 }] }
    ]
  }
}
```

`PreInvocation` 在模型執行前 recall 並注入記憶，輸出為**扁平**的 top-level `additionalContext`（Antigravity 的輸出 schema 會拒絕巢狀 `hookSpecificOutput` 包裝）；`Stop` 寫回完成的這一輪。Antigravity 透過 `transcript_path` 傳遞對話（而非 payload 欄位），因此 adapter 改讀 transcript（如同 Claude Code）。transcript 行格式假設與 Claude Code 的 JSONL 相同——設 `MEMORIA_ADAPTER_DEBUG=<file>` 擷取你 `agy` 版本的真實 payload 來確認。
