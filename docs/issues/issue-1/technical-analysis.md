# Technical Analysis — Git-Aware Memory v1

- Issue: [issue-1](README.md)
- 日期: 2026-07-13
- 基準: `main` @ 609df85（v1.18.0 之後）

## 1. 現況架構探查結果

以下為 2026-07-13 對 `src/`（56 個 TS 檔、約 7,944 行）的探查結論，是本 issue 所有技術判斷的依據。

### 1.1 資料庫與 migration

- Schema 集中在 `src/core/db/schema.ts`：基底表以 `CREATE TABLE IF NOT EXISTS` 建立（`initDatabase()`），增量變更走 `MIGRATIONS` 陣列 + `schema_migrations` ledger（versioned migration，單 transaction 套用），migration 內部再以 `PRAGMA table_info` 欄位存在性防衛 `ALTER TABLE`。
- 既有 15 張表：`sessions`、`events`、`skills`、`memory_nodes`、`memory_node_sources`、`memory_sync_state`、`recall_telemetry`、`memory_utility`、`sources`、`wiki_pages`、`wiki_page_sources`、`wiki_page_links`、`wiki_lint_runs`、`wiki_lint_findings`、`wiki_query_artifacts`，外加 FTS5 虛擬表 `recall_fts`。
- **結論**：規格 §9 的 11 張新表可用一個新 migration 落地，向後相容模式現成。

### 1.2 記憶模型與 recall

- `memory_nodes` 是由 `sessions` + `events` **衍生**的三層樹（project→topic→session），由 `buildMemoryIndex`（`src/core/db/recall.ts`）重建；決策/技能記憶實際是 `events` 表中 `event_type IN ('DecisionMade','SkillLearned')` 的列。
- `recallKeyword` 走 `recall_fts`（FTS5/bm25）索引，索引來源是 `sessions`/`events`；`recallTree` 走 `memory_nodes` + `memory_node_sources`。
- `RecallHit`（`src/core/types.ts`）欄位：`type`/`id`/`session_id`/`timestamp`/`project`/`snippet`/`score`/`relevance`（+ optional `node_id`/`reasoning_path`）。**無 per-hit source 欄位**；來源歸屬只有 envelope 層 `meta.evidence[]`。

### 1.3 摘要與 LLM

- 程式碼**從不呼叫任何 LLM**。既有「摘要」全 deterministic：`summarizeText`（取前 3 行、截 220 字）、prune consolidate（字串串接）。
- 唯一的外部模型是 vector recall 的本地 embedding，跑在 out-of-process helper：`core/recall-vector.ts` 以 `child_process.spawn` 執行 `skills/memoria-vector/vector-recall.mjs`，stdin/stdout JSON 契約、4 秒 timeout、fail-open、`LIBSQL_URL` gated。

### 1.4 對外介面

- CLI：`src/cli.ts` 呼叫各 `register<Name>Command(program, ...)`；子命令模式見 `src/cli/commands/source.ts`（`program.command('source')` → `.command('add')`...）。
- HTTP：`src/server.ts` 為 raw `node:http` 手寫 method+pathname if-chain，body 用 Zod 驗證（`readValidatedBody`），參數化路由用 regex。現有 12 個 endpoints（`/v1/health`、`/v1/recall`、`/v1/recall/:id/outcome` 等）。
- **無 MCP server**：`test-mcp-e2e.sh` 測的是 Memoria 當 client、將記憶樹推入外部 `mcp-memory-libsql` server 的 bridge scripts（`skills/memoria-memory-sync/`）。

### 1.5 設定

- **無 config 檔解析**。`MEMORIA_CONFIG_PATH` 指向目錄，僅被 mkdir/存在檢查/列印。所有 runtime 設定為環境變數（`MEMORIA_HOME`、`LIBSQL_URL`、`MEMORIA_PORT` 等）。

### 1.6 Prune

- `runPrune`（`src/core/db/prune-export.ts`）為五個硬編碼 target（exports/checkpoints/dedupe/consolidate/stale），**新表不會自動納入**；需新增 target 函式 + option gate + dispatch。

### 1.7 Git

- `src/` 無任何 git 呼叫或 repo 掃描；`child_process` 僅用於 preflight（pnpm）、setup（pnpm install）、vector helper。**本功能為 greenfield**。

## 2. 相關模組與資料流

```text
CLI repo 命令 (src/cli/commands/repo.ts, 新)
HTTP /v1/repos/* (src/server.ts, 擴充)          ← D2 定案：取代 MCP tools
        │
        ▼
MemoriaCore 新方法 (src/core/memoria.ts, 擴充)
        │
        ▼
src/core/git/ (新)                              ← 唯讀 git 執行層
├── git-exec.ts        spawn git、白名單命令、timeout、錯誤分類
├── scanner.ts         identity / refs / commits / worktree 掃描
├── change-detector.ts 前後快照差異 → events
├── range-planner.ts   commit 分組 + trivial filter（deterministic）
└── secret-filter.ts   sensitivePaths 排除 + pattern 遮罩
        │
        ▼
src/core/db/git-repo.ts / git-scan.ts / git-summary.ts (新)
├── repositories / repository_instances / git_worktrees
├── git_commits / git_refs / git_scan_runs / git_events
├── git_summary_ranges / git_summaries
└── memory_checkpoints / memory_sources
        │
        ▼ promotion
events 表 (既有)  →  recall_fts (既有)  →  recall() 附 Git 來源
```

資料流關鍵：**promotion 寫入既有 `events` 表**（新 event_type 或沿用 `DecisionMade`），使其自動進入 FTS 與 `buildMemoryIndex` 的既有路徑；`memory_sources` 表只負責 provenance 回鏈。不建立平行 recall 體系。

## 3. 變更邊界

### 3.1 可修改區域

- 新增：`src/core/git/`（整個目錄）、`src/core/db/git-*.ts`、`src/cli/commands/repo.ts`、`scripts/test-repo-*.sh`。
- 擴充（加法、不破壞既有行為）：
  - `src/core/db/schema.ts` — 新 migration（11 張表）。
  - `src/core/memoria.ts` — 新公開方法（維持 `MemoriaResult<T>` envelope）。
  - `src/cli.ts` — 註冊 `registerRepoCommand`。
  - `src/server.ts` — 新 `/v1/repos/*` endpoints（D2 已定案）。
  - `src/core/types.ts` — `RecallHit` 加 optional `source` 欄位（向後相容加法）。
  - `src/core/db/prune-export.ts` — 新 `pruneGitObservations` target。
  - `src/core/db/recall.ts` — recall 結果組裝時 join Git 來源。
  - `examples/` — 新測試 fixture（如需要）。

### 3.2 禁止修改區域

- 既有 CLI 命令名稱與行為（agent contract，CLAUDE.md 明文）。
- 既有資料表欄位語義與 `MemoriaResult<T>` envelope 結構。
- runtime 依賴清單（`better-sqlite3`、`commander`、`zod`）——D2 已定案不引入 MCP SDK，v1 不新增任何 runtime 依賴。
- `prune --all` 既有預設門檻。
- 受管理 Repository 的任何狀態（§5 非侵入黑名單）——git 執行層必須以白名單強制，僅允許唯讀命令。
- 既有 `sync`（session 匯入）命令——與 `repo sync` 並存，不得合併或改名。

## 4. 風險

| # | 風險 | 等級 | 緩解 |
|---|---|---|---|
| R1 | 大 repo 初次掃描效能（commit 全量 + patch-id） | 高 | `repo add` 預設不掃完整歷史（§28）；`--history-limit`；patch_id 允許 NULL、僅 rewrite 偵測時 lazy 計算 |
| R2 | Repository 身份斷裂（remote 變更 / shallow 補齊） | 高 | D4：root_commit_sha 為主要身份成分，remote 為 metadata；identity 演進走 UPDATE 而非新列 |
| R3 | `git_refs`/`git_events` 無限成長 | 中 | 新 prune target + 預設 retention，掛入 `prune --all` |
| R4 | 併發 sync 交錯寫入（多 worktree / HTTP + CLI 並用） | 中 | per-repository in-process mutex；v1 文件明列單使用者假設 |
| R5 | Secret 偵測漏網 | 中 | sensitivePaths 預設排除 + pattern 遮罩 + summary metadata warning；驗收寫明 best-effort |
| R6 | git 輸出解析脆弱（locale、換行、特殊字元 message） | 中 | 一律 `-z` / `--format` 明確格式、`LC_ALL=C`、以 e2e 測試覆蓋特殊字元 |
| R7 | 事件塌縮：兩次掃描間 branch 建立又刪除則完全不可見 | 低 | 設計即為快照差異推斷（§7.3），文件明列為已知限制 |
| R8 | Summary 語義品質依賴 D1 決策的 generator | 中 | deterministic fallback 摘要保底；`generator`/`prompt_version` 欄位支援日後重生成 |

## 5. 技術決議（2026-07-13 使用者核可，原建議全數採納）

1. **D1**：採 host-agent 驅動回寫（同 UFL `POST /v1/recall/:id/outcome` 模式）——`repo sync` 產出 pending summary request（已裁剪 context），agent 生成後回寫；helper-script 模式（同 `recall-vector.ts`）作為備選。任一方案都先落地 deterministic fallback（commit messages + diffstat 組裝結構化骨架），與 §17 相容。
2. **D2**：v1 以 HTTP endpoints 交付機器介面，MCP tools 延至 v1.1（避免新增 MCP SDK 依賴）。
3. **D3**：引入 `<MEMORIA_CONFIG_PATH>/config.json` + Zod schema，僅解析 `git.*` 區塊，其餘設定維持環境變數；config loader 為獨立工作項。
4. **D4**：fingerprint 以 `root_commit_sha` 為主；shallow clone 才 fallback `remote_url + earliest_available_commit` 並標記 `limited_history`，補齊歷史後就地升級 fingerprint（UPDATE，同列）。
5. `host_id`：於 `MEMORIA_HOME` 生成並保存一次性 UUID（hostname 不穩定）。
6. §15/§16 相似度規則全部 deterministic 化：路徑 top-level 目錄前綴、conventional commit type、24h 時間窗、merge/tag 邊界。
