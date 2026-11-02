# SDK 與 Agent 整合

[English](INTEGRATIONS.md) ｜ **繁體中文** · [README](../README.zh-TW.md)

最後驗證：2026-10-23，對照 v1.31.1 原始碼、CLI help 與文件檢查。

以 deployed skill 使用記憶不需要 server，設定方式見 [安裝指南](INSTALL.md)。以下 SDK 範例假設從 repository checkout 載入原始碼；npm 套件提供 CLI，未提供 SDK export。SDK 與 hook adapter 需要 HTTP server。

## 共用專案規範與 brief

共用規範維護在 `AGENTS.md`，`CLAUDE.md` 作為 Claude 的載入入口，以獨立一行的 `@AGENTS.md` 引入。Claude 專用設定放在 import 後方。

執行 `memoria setup`（互動式或指定 `--scope global|project`）會自動產生初始 brief，並在備份既有檔案到 `<data-root>/.agents/instruction-backups/` 後，將受管理區塊（`<!-- memoria:managed:start -->` ... `<!-- memoria:managed:end -->`）寫入 `AGENTS.md` 與 `CLAUDE.md`。

若在執行 `memoria brief` 後手動接線，將 `memoria brief` 印出的讀取指令加入 `AGENTS.md`，讓 agent 在尚未載入時讀取：

```markdown
Before starting work, read /absolute/path/to/knowledge/BRIEF.md if it is not already in context.
```

Claude 的 `CLAUDE.md` 可同時引入共用規範與產生的 brief，於啟動時展開：

```markdown
@AGENTS.md
@/absolute/path/to/knowledge/BRIEF.md
```

請替換為 `brief` 實際印出的路徑；檔案需先產生，路徑含空白時 `@` import 用反斜線跳脫空白。其他 agent 依 `AGENTS.md` 的讀取指令使用 brief；是否展開 `@` 取決於 host。記憶更新後重新產生 brief。Claude 的 import 載入方式見 [官方文件](https://code.claude.com/docs/en/memory#import-additional-files)。

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

Antigravity CLI（`agy`）提供 agent 生命週期 hook（stdin/stdout 走 JSON）。把 handler 註冊在 `<project>/.agents/hooks.json`，要套用到所有專案則放 `~/.gemini/config/hooks.json`：

```jsonc
{
  "memoria": {
    "PreInvocation": [
      { "type": "command", "command": "memoria adapter antigravity", "timeout": 30 }
    ],
    "Stop": [
      { "type": "command", "command": "memoria adapter antigravity", "timeout": 30 }
    ]
  }
}
```

handler 要直接列在這兩個事件底下：只要有一筆用了 `matcher`／`hooks` 群組，`agy` 就會丟棄整個檔案，而且只記在它自己的 `cli.log`。只接 `PreInvocation` 與 `Stop`，因為 `PostInvocation` 的 payload 與 `PreInvocation` 相同，adapter 無法分辨。

`PreInvocation` 在一輪裡的每次模型呼叫前都會觸發；adapter 只在每則使用者訊息的第一次呼叫 recall 一次，並以 `systemMessage` step 注入，整個工具迴圈都看得到。`Stop` 用 `lastUserInput` 與 transcript 裡模型的最後回答寫回這一輪。以上於 2026-11-02 對 `agy` 1.4.4 實測；之後的版本若行為不同，設 `MEMORIA_ADAPTER_DEBUG=<file>` 擷取 payload 比對。
