# Memoria

[English](README.md) ｜ **繁體中文**

讓 AI Agent 擁有跨會話、可追溯、可自託管的持久記憶。

## 30 秒導讀

- **問題**：LLM Agent 每次對話都從零開始 — 上次的決定、踩過的雷、學到的技能，全都丟掉。
- **解法**：把 session 寫進本機 SQLite，需要時用 keyword / tree / hybrid recall 撈回相關片段；可選 markdown 衍生視圖（compiled wiki）供人類審閱。
- **形狀**：Node.js CLI（`./cli`）+ HTTP API（`:3917`）+ Node SDK（`MemoriaClient`）共用同一個 core；agent adapter（Gemini / OpenCode）開箱即用。
- **依賴**：runtime 只用三個 npm 套件（`better-sqlite3` / `commander` / `zod`），HTTP 走 `node:http`，全離線可跑。
- **擴充**：MCP/libSQL 跨節點語意圖譜為 optional，由 `LIBSQL_URL` env 啟用。

## 🤖 AI Agent Quick Install

> **Agent 看到這裡就夠了。** 先走 no-clone 安裝；開發者再走 repo mode。

### Self-Hosted Without Clone

```bash
# 1. 下載 installer 與 Linux x64 release artifact
curl -fsSL -o install.sh https://raw.githubusercontent.com/raybird/Memoria/main/install.sh
curl -fsSL -o memoria-linux-x64-v1.8.0.tar.gz \
  https://github.com/raybird/Memoria/releases/download/v1.8.0/memoria-linux-x64-v1.8.0.tar.gz

# 2. 安裝 runtime
bash install.sh \
  --artifact ./memoria-linux-x64-v1.8.0.tar.gz \
  --install-dir "$HOME/.local/share/memoria"

# 3. 啟動 bootstrap（資料預設寫到目前目錄的 ./memoria）
$HOME/.local/share/memoria/bin/memoria setup --serve --json
# 或顯式指定資料目錄
$HOME/.local/share/memoria/bin/memoria setup --memoria-home "$(pwd)/memoria" --serve --json
```

`setup` 也會把內建 agent skill 部署到 `<memoria-home>/.agents/memoria-memory-sync/`，其中包含 runtime-safe 的 `SKILL.md`、`REFERENCE.md`、helper scripts 與本地 `bin/memoria` wrapper，讓 agent 安裝後即可直接發現並使用對應 skill。

安裝後若要讓 agent 直接走 deployed skill，可優先讀：

```text
<memoria-home>/.agents/memoria-memory-sync/SKILL.md
<memoria-home>/.agents/memoria-memory-sync/REFERENCE.md
```

這兩份文件是 deployed runtime 的入口，不需要假設 repo 已 clone 到本機。

輸出 JSON lines，每步一行：

```json
{"step":"preflight","ok":true,"ms":120,"mode":"installed"}
{"step":"install","ok":true,"ms":0,"skipped":true,"reason":"installed runtime already packaged"}
{"step":"init","ok":true,"ms":85}
{"step":"verify","ok":true,"ms":42}
{"step":"serve","ok":true,"port":3917}
```

確認就緒：

```bash
curl -sf http://localhost:3917/v1/health
```

### Developer Setup From Repo

```bash
# 1. Clone
git clone https://github.com/raybird/Memoria && cd Memoria

# 2. 一鍵安裝（preflight → install → init → verify → serve）
./cli setup --serve --json

# 3. 確認就緒
curl -sf http://localhost:3917/v1/health
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

**no-clone 前置需求**：Node.js ≥ 18、下載 release artifact 的能力、Linux x64。

**repo mode 前置需求**：Node.js ≥ 18、pnpm（檢查：`./cli preflight --json`）

**完整 Agent 整合指南**：[AGENTS.md](AGENTS.md)（含 Core Architecture / HTTP API / Bootstrap 章節）

---

## 能力地圖

| 領域 | 能力 |
|------|------|
| **入口** | CLI（init/sync/stats/doctor/verify/index/source/wiki/govern/prune/export/serve/preflight/setup）｜HTTP API（11 端點 @ port 3917）｜Node.js SDK（`MemoriaClient`）｜Agent Adapter（Gemini / OpenCode 參考實作）｜所有指令支援 `--json` 機器可讀輸出 |
| **儲存** | SQLite + markdown 雙軌持久化｜時間衰減評分（halfLife 90 天）+ 合併 + 過期清理｜backward-compatible schema 自動升級 |
| **檢索** | `keyword / tree / hybrid` 三種 recall｜adaptive gate 跳過 trivial query｜Lightweight scope isolation（`global / project / agent / user`）｜Recall 路由 telemetry（`stats` + API） |
| **Wiki 工作流** | Raw source 匯入（markdown/text）｜Compiled wiki special pages（`index / log / overview`）｜Query file-back（`synthesis / comparison`）｜Wiki governance lint |
| **治理** | Governance review（重複 decisions/skills 候選檢查）｜Import guardrails（低價值 summary 修正 + duplicate event suppression） |
| **Bootstrap** | `./cli setup --serve --json` 一鍵安裝｜no-clone release artifact 安裝路徑｜deployed skill 自動部署到 `<memoria-home>/.agents/` |
| **Optional** | MCP/libSQL 跨系統語意圖譜（由 `LIBSQL_URL` 啟用） |
| **Planned** | Policy 引擎（PII 過濾 / 讀寫策略 / 多租戶規則） |

## Memoria vs MCP/libSQL

`mcp-memory-libsql` 是 **optional enhancement**，不是必需依賴。

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
| `POST` | `/v1/sources` | 匯入 markdown/text source |
| `GET`  | `/v1/sources` | 列出 raw sources |
| `POST` | `/v1/wiki/build` | 重建 compiled wiki special pages |
| `POST` | `/v1/wiki/file-query` | 將高價值 query 回寫成 wiki page |
| `POST` | `/v1/wiki/lint` | 執行 wiki governance lint |
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
./cli source add notes/research.md   # 匯入 markdown/text source
./cli source list --json             # 列出 raw sources
./cli wiki build --json              # 重建 compiled wiki
./cli wiki file-query --query "TS CLI migration" --title "TS CLI Migration Brief" --kind synthesis --scope project:Memoria
./cli wiki lint --json               # 產生 durable wiki governance findings
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
src/
  cli.ts        # Commander 薄殼（~350 行）
  server.ts     # HTTP API Server（node:http，零外部依賴）
  sdk.ts        # MemoriaClient SDK
  core/         # 所有業務邏輯（types / paths / utils / db / memoria / source-import / wiki-*）
  adapter/      # BaseAdapter + Gemini / OpenCode 參考實作
scripts/        # bash 端對端測試（test-*.sh）+ release 打包
skills/         # memoria-memory-sync agent skill
examples/       # session.sample.json
```

完整目錄與檔案職責請見 [AGENTS.md](AGENTS.md) 與 [CLAUDE.md](CLAUDE.md)。

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
