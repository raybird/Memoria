# Memoria

讓 AI Agent 擁有跨會話、可追溯、可自託管的持久記憶。

## 🤖 AI Agent Quick Install

> **Agent 看到這裡就夠了。** 三步完成安裝與啟動：

```bash
# 1. Clone
git clone https://github.com/raybird/Memoria && cd Memoria

# 2. 一鍵安裝（preflight → install → init → verify → serve）
./cli setup --serve --json
# 輸出 JSON lines，每步一行：
# {"step":"preflight","ok":true,"ms":120}
# {"step":"install","ok":true,"ms":3400}
# {"step":"init","ok":true,"ms":85}
# {"step":"verify","ok":true,"ms":42}
# {"step":"serve","ok":true,"port":3917}

# 3. 確認就緒
curl -sf http://localhost:3917/v1/health
# → {"ok":true,"data":{"ok":true,"db":"ok","dirs":"ok",...}}
```

安裝成功後即可透過 HTTP API 使用：

```bash
# 寫入記憶
curl -X POST http://localhost:3917/v1/remember \
  -H 'Content-Type: application/json' \
  -d @examples/session.sample.json

# 檢索記憶
curl -X POST http://localhost:3917/v1/recall \
  -H 'Content-Type: application/json' \
  -d '{"query":"SQLite migration","top_k":5}'

# 查看統計
curl http://localhost:3917/v1/stats
```

**前置需求**：Node.js ≥ 18、pnpm（檢查：`./cli preflight --json`）

**完整 Agent 整合指南**：[AGENTS.md](AGENTS.md)（含 Core Architecture / HTTP API / Bootstrap 章節）

---

## 功能概覽

| 功能 | 狀態 |
|------|------|
| CLI（init/sync/stats/doctor/verify/index/prune/export） | ✅ Implemented |
| Core 模組 API（remember/recall/summarizeSession/health/stats） | ✅ Implemented |
| HTTP API Server（6 端點，port 3917） | ✅ Implemented |
| Node.js SDK（`MemoriaClient`） | ✅ Implemented |
| Agent Adapter（Gemini / OpenCode 參考實作） | ✅ Implemented |
| Bootstrap 指令（preflight/setup）| ✅ Implemented |
| 所有指令 `--json` 機器可讀輸出 | ✅ Implemented |
| SQLite + Markdown 持久化 | ✅ Implemented |
| MCP/libSQL 語意增強（optional） | ✅ Implemented |
| Tree 目錄索引（無向量）與 hybrid recall | ✅ Implemented |
| Adaptive retrieval gate（略過無需 recall 的 query） | ✅ Implemented |
| Import guardrails（低價值 summary 修正 + duplicate event suppression） | ✅ Implemented |
| Lightweight scope isolation（`global/project/agent/user` style） | ✅ Implemented |
| Governance review（重複 decisions/skills 候選檢查） | ✅ Implemented |
| 記憶品質衰減防止（時間衰減評分 + 合併 + 過期清理）| ✅ Implemented |
| Recall 路由 telemetry（stats + API） | ✅ Implemented |
| Policy 引擎（PII 過濾 / 讀寫策略） | 🔜 Planned |
| 高階 Policy 可配置化（多租戶/規則引擎） | 🔜 Planned |

## Memoria vs MCP/libSQL

`mcp-memory-libsql` 在 v1.5.0 仍是 **optional enhancement**，不是必需依賴。

| 能力 | Memoria 單獨可用 | Memoria + MCP/libSQL |
|------|------------------|------------------------|
| 本地持久記憶（SQLite + markdown） | ✅ | ✅ |
| `recall`（keyword/tree/hybrid） | ✅ | ✅ |
| Recall telemetry（`stats` + API） | ✅ | ✅ |
| 跨系統圖譜投射/增量同步 | ➖ | ✅ |
| 多 Agent 共用外部語意圖譜 | ➖ | ✅ |

結論：

- 要「完整可用」：Memoria 單獨就足夠。
- 要「跨系統/多節點語意增強」：再加 MCP/libSQL。

快速決策（3 行）：

- 先上 Memoria-only（最小維運成本，功能已完整）。
- 需要跨 Agent/跨節點語意圖譜時，再加 MCP/libSQL。
- 無論哪種模式，都以 Memoria SQLite 為 source-of-truth。

## HTTP API

啟動：`./cli serve` (port 3917，可用 `MEMORIA_PORT` 覆寫)

| Method | Path | 說明 |
|--------|------|------|
| `GET`  | `/v1/health` | 健康檢查 |
| `GET`  | `/v1/stats` | 統計 |
| `GET`  | `/v1/telemetry/recall` | Recall 路由遙測（query: `window`, `limit`） |
| `POST` | `/v1/remember` | 寫入記憶 (body: SessionData; optional `scope`) |
| `POST` | `/v1/recall` | 檢索記憶 (body: `{query, top_k?, project?, scope?, mode?}`) |
| `GET`  | `/v1/sessions/:id/summary` | 會話摘要 |

所有回傳皆為 `MemoriaResult<T>` 信封格式（含 `evidence[]`、`confidence`、`latency_ms`）。

## CLI 常用命令

```bash
./cli init                           # 初始化 DB + 目錄
./cli sync <session.json>            # 匯入 session
./cli sync --dry-run <session.json>  # 預覽不寫入
./cli stats [--json]                 # 統計
./cli doctor [--json]                # 本地健康檢查
./cli verify [--json]                # 完整驗證
./cli index build [--json]           # 增量重建 tree index
./cli index build --scope agent:main # 只重建指定 scope
./cli govern review --json           # 檢查可提升成 rule/skill 的候選項
./cli prune --all --dry-run          # 清理預覽（含 consolidate 90d + stale 180d）
./cli prune --consolidate-days 90    # 合併同 topic 下的舊 session nodes
./cli prune --stale-days 180         # 移除從未被 recall 命中的過期記憶
./cli export --type all --format json # 匯出
./cli serve [--port 3917]            # HTTP API Server
./cli preflight [--json]             # 前置條件檢查
./cli setup [--serve] [--json]       # 一鍵安裝
```

## Node.js SDK

```typescript
import { MemoriaClient } from './src/sdk.js'

const client = new MemoriaClient()         // default http://localhost:3917
await client.waitUntilReady()              // poll /v1/health 直到就緒

const r = await client.remember(sessionData)
const hits = await client.recall({ query: 'migration', top_k: 3, scope: 'project:Memoria' })
const telemetry = await client.recallTelemetry({ window: 'P7D', limit: 50 })
const summary = await client.summarizeSession('session_abc')
```

## Agent Adapter

```typescript
import { GeminiAdapter } from './src/adapter/index.js'

const adapter = new GeminiAdapter({ client, project: 'my-project' })

// Before prompt: 注入歷史記憶
const context = await adapter.beforePrompt({ userMessage, conversationId })

// After response: 儲存記憶（自動 throttle + dedupe + fail-open）
await adapter.afterResponse({ response, conversationId, userMessage })
```

參考實作：`src/adapter/gemini-adapter.ts`、`src/adapter/opencode-adapter.ts`

## 專案結構

```text
.
├── src/
│   ├── cli.ts              # CLI 薄殼（~350 行）
│   ├── server.ts           # HTTP API Server (node:http)
│   ├── sdk.ts              # Node.js SDK client
│   ├── core/               # 核心模組
│   │   ├── types.ts        # MemoriaResult 等型別
│   │   ├── paths.ts        # 路徑解析
│   │   ├── utils.ts        # 工具函式
│   │   ├── db.ts           # SQLite 操作層
│   │   ├── memoria.ts      # MemoriaCore class
│   │   └── index.ts        # 統一匯出
│   └── adapter/            # Agent Adapter
│       ├── adapter.ts      # BaseAdapter 抽象基底
│       ├── gemini-adapter.ts
│       ├── opencode-adapter.ts
│       └── index.ts
├── scripts/
│   ├── test-smoke.sh       # CLI 全流程測試
│   ├── test-mcp-e2e.sh     # MCP 增量同步 E2E
│   └── test-bootstrap.sh   # Agent 自主安裝測試
├── skills/memoria-memory-sync/
├── examples/session.sample.json
├── AGENTS.md               # Agent 整合指南
├── SPEC.md                 # 已實作規格
└── RFC.md                  # 規劃 / 未來方向
```

## 文件導覽

| 文件 | 對象 | 說明 |
|------|------|------|
| [AGENTS.md](AGENTS.md) | AI Agent | 架構、API、Bootstrap、開發約定 |
| [RELEASE.md](RELEASE.md) | 維護者 | patch/minor/major 發版 SOP 與驗證流程 |
| [SPEC.md](SPEC.md) | 開發者 | 已落地功能規格 |
| [RFC.md](RFC.md) | 開發者 | 規劃與未來方向 |
| [docs/](docs/) | 維運 | 安裝、容器、MCP 整合等 |

## 授權

MIT
