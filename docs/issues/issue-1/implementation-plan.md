# Implementation Plan — Git-Aware Memory v1

- Issue: [issue-1](README.md)
- 日期: 2026-07-13
- 狀態: **已確認**（2026-07-13 D1–D4 與範圍事項定案）— 可進行 decompose
- 前置閱讀: [requirement-analysis.md](requirement-analysis.md)、[technical-analysis.md](technical-analysis.md)

## 0. 分析概要

- 功能為 greenfield（`src/` 無任何 git 程式碼），落點：`src/core/git/`（唯讀執行層）、`src/core/db/git-*.ts`（11 張新表的 DB 層）、`src/cli/commands/repo.ts`、`src/server.ts` 擴充。
- Promotion 走既有 `events` → `recall_fts` 路徑，不建平行記憶體系；provenance 由 `memory_sources` 回鏈。
- 每個 Phase 一個 PR；Phase 之間可獨立驗收。規格 §31 的六階段切分予以沿用，並加入 Phase 0。

## 已決議事項（2026-07-13 定案）

| # | 決策 | 決議 |
|---|---|---|
| D1 | LLM 摘要生成者 | Host agent 驅動回寫 + deterministic fallback |
| D2 | MCP tools vs HTTP endpoints | v1 走 HTTP `/v1/repos/*`，MCP 延 v1.1 |
| D3 | config 檔機制 | `config.json` + Zod，Phase 0 獨立工作項 |
| D4 | fingerprint 身份策略 | `root_commit_sha` 為主要成分，remote 為 metadata |

範圍決議：fast-forward 推斷（§12.2）與 Agent session 整合（§22）延至 v1.1；測試採 bash e2e 腳本（`scripts/test-repo-*.sh`）。

---

## Phase 0: 基礎設施前置

**目標**：後續 Phase 的共用地基。

- [ ] git 唯讀執行層 `src/core/git/git-exec.ts`：`spawn('git', ...)`、**白名單命令強制**（§5）、`LC_ALL=C`、`-z`/`--format` 輸出、timeout、錯誤分類（§24 error codes）。
- [ ] config loader（D3 已定案）：`<MEMORIA_CONFIG_PATH>/config.json` + Zod schema，`git.*` 區塊（§27 預設值），檔案不存在時全預設、不報錯。
- [ ] `host_id`：`MEMORIA_HOME` 內一次性 UUID 生成與讀取。
- [ ] 測試：`bash -n` + git-exec 白名單拒絕非唯讀命令的 e2e 斷言。

**DoD**：`pnpm run check`、`pnpm run build` 通過；git-exec 對黑名單命令（`commit`/`push`/`config` 等）一律拒絕。

## Phase 1: Repository Registry（規格 §31 Phase 1）

**目標**：repo 可加入、列出、查狀態、移除、重新綁定。

- [ ] Migration：`repositories`、`repository_instances`、`git_worktrees`（§9.1–9.3；fingerprint 依 D4）。
- [ ] `src/core/db/git-repo.ts`：CRUD + `UNIQUE(fingerprint)`、`UNIQUE(host_id, local_path)`。
- [ ] Identity：fingerprint 計算（root_commit_sha 主成分；shallow fallback §25）、worktree 辨識（`git rev-parse --git-common-dir`）。
- [ ] `MemoriaCore` 新方法：`repoAdd/repoList/repoStatus/repoRelocate/repoRemove`（`MemoriaResult<T>` envelope）。
- [ ] CLI：`registerRepoCommand` — `repo add`（`--name/--scan-history/--history-limit/--default-branch`）、`repo list`、`repo status`、`repo relocate`、`repo remove`（`--delete-observations/--delete-summaries/--delete-memories`，刪 memory 必須明確指定，§19.7）。
- [ ] 測試：`scripts/test-repo-registry.sh` — 新增/拒絕非 git 路徑/同 repo 不同路徑去重/relocate/remove 保留記憶。

**DoD**：§29「Repository 管理」四項驗收全過；`repo add` 後受管理 repo 的 `git status` 乾淨。

## Phase 2: Git Incremental Scan（§31 Phase 2）

**目標**：增量掃描 commits / refs / tags，idempotent。

- [ ] Migration：`git_commits`（`PRIMARY KEY(repository_id, commit_sha)`、`patch_id` 允許 NULL）、`git_refs`、`git_scan_runs`（§9.4、9.5、9.7）。
- [ ] Scanner：HEAD/branch/refs/tags 快照、`rev-list <last>..<head>` 增量 commit 擷取、merge commit（parent ≥ 2）標記、working tree clean/dirty。
- [ ] Idempotency：重複 sync 零新列（§18 唯一鍵）。
- [ ] 降級：detached HEAD、unborn branch、shallow clone（`limited_history`）。
- [ ] CLI：`repo sync`（本階段僅 metadata scan，`--no-summary` 為預設行為）。
- [ ] 測試：`scripts/test-repo-sync.sh` — 於 mktemp 建 fixture repo，驗證新 commit/merge/tag/parent 關係/重複同步無重複資料。

**DoD**：§29「Git 掃描」六項驗收全過；無新 commit 時 sync 快速完成（§26）。

## Phase 3: Git Events（§31 Phase 3）

**目標**：快照差異 → 事件；dry-run；可恢復。

- [ ] Migration：`git_events`（§9.6，status: pending/processed/ignored/failed）。
- [ ] Change detector：§7.3 全事件類型；history rewrite 偵測（舊 HEAD 非現 HEAD ancestor → `history_rewritten`，受影響 commits lazy 計算 patch_id，舊 observation 標記不可達、不刪除，§11.2）。
- [ ] `repo sync --dry-run`：只輸出將新增的 commits/events/summaries，零寫入（§19.4）。
- [ ] Scan recovery：scan run 失敗保存原因，重跑從上次成功狀態續作（§24、§26）。
- ~~fast-forward 推斷 §12.2~~ — 已決議延至 v1.1，本 Phase 不實作。
- [ ] 測試：`scripts/test-repo-events.sh` — 事件生成、rewrite、dry-run 零寫入、失敗恢復。

**DoD**：dry-run 前後 DB byte-identical；rewrite 情境不產生重複記憶。

## Phase 4: Summary Pipeline（§31 Phase 4）

**目標**：range 分組 → trivial filter → 結構化摘要（range/branch/merge/release）。

- [ ] Migration：`git_summary_ranges`（`range_fingerprint` 唯一鍵，§9.8）、`git_summaries`（§9.9）。
- [ ] Range planner（全 deterministic）：§15 分組/切割規則（merge、tag、24h 間隔、domain 路徑前綴變化）；§16 trivial filter + 重要檔案例外清單。
- [ ] 摘要輸入裁剪：§17 優先序（messages → file list → diffstat → 選定 hunks）、§27 `maxDiffBytes`、排除 generated/lockfiles。
- [ ] Secret filter：sensitivePaths 排除、pattern 遮罩、summary metadata warning（§23）。
- [ ] Deterministic fallback summary：commit messages + diffstat 組裝 §7.5 結構化骨架（`generator: 'deterministic'`）。
- [ ] 語義摘要 generator 介面（D1 已定案：host agent 驅動回寫）：`repo sync` 產出 pending summary request（已裁剪 context），agent 生成後經 CLI/HTTP 回寫；`generator`/`generator_version`/`prompt_version` 記錄。
- [ ] Branch summary（§13 觸發條件、`merge-base..head` 範圍）、merge summary（§12.1）、release summary（§14 tag 命名規則與範圍）。
- [ ] CLI：`repo summarize`（`--branch/--range/--merge/--tag/--type/--promote`）；`repo sync` 接上 planner（`--no-summary`/`--force-summary`/`--from`/`--to`）。
- [ ] 測試：`scripts/test-repo-summary.sh` — 分組、trivial 過濾、三種摘要、range_fingerprint 去重、secret 遮罩。

**DoD**：§29「摘要」五項驗收全過；同一範圍重複 sync 不重複生成。

## Phase 5: Memoria Integration（§31 Phase 5）

**目標**：promotion 進 recall、來源附帶、機器介面。

- [ ] Migration：`memory_checkpoints`（§9.10）、`memory_sources`（§9.11，`UNIQUE(memory_id, source_type, source_id)`）。
- [ ] Promotion：§7.6 升級/不升級條件 + `promoteImportanceThreshold`；寫入既有 `events` 表（進 FTS）+ `memory_sources` 回鏈；同一 summary 不重複 promotion。
- [ ] Recall 來源附帶：`RecallHit` 加 optional `source` 物件（§21 形狀），recall 組裝時 join `memory_sources` → `git_summaries`。
- [ ] HTTP endpoints（D2 已定案，取代 MCP tools）：`POST /v1/repos`、`GET /v1/repos`、`GET /v1/repos/:id/status`、`POST /v1/repos/:id/sync`（回傳 §20 repo_sync 輸出形狀）、`POST /v1/repos/:id/summarize` 等。
- ~~session start/end auto-sync（§22）~~ — 已決議延至 v1.1，本 Phase 不實作。
- [ ] 測試：`scripts/test-repo-promotion.sh` — promotion → recall 可搜 → 來源正確 → 不重複 promotion；HTTP 契約併入 `test-http-api.sh` 或獨立腳本。

**DoD**：§29「記憶整合」四項驗收全過。

## Phase 6: Hardening（§31 Phase 6）

- [ ] Prune target：`pruneGitObservations`（`git_refs`/`git_events`/`git_scan_runs` retention），掛入 `prune --all`，預設門檻寫入文件。
- [ ] 併發防護：per-repository in-process mutex（HTTP + CLI 並用情境）。
- [ ] 邊界情境補測：shallow clone、detached HEAD、多 worktree、relocate 後 sync、大 diff 裁剪、特殊字元 commit message。
- [ ] 非侵入性總驗收腳本：完整流程後斷言 `git status`/config/hooks/refs 零變化（§29）。
- [ ] 文件：README / AGENTS.md / CHANGELOG 對齊；`repo sync` 與既有 `sync` 的區分說明。

**DoD**：CI 全綠（含全部新測試腳本）；§29 全項驗收通過。

---

## 交付項目對照（規格 §30 → 實際）

| 規格交付 | 實際落點 |
|---|---|
| Repository Registry / Scanner / Change Detector / Event Store | `src/core/git/` + `src/core/db/git-*.ts` |
| Summary Planner / Semantic Summarizer | `src/core/git/range-planner.ts` + generator 介面（D1） |
| Memory Promotion Adapter | promotion → `events` + `memory_sources` |
| CLI Commands | `src/cli/commands/repo.ts` |
| MCP Tools | （D2 定案）v1 改為 HTTP `/v1/repos/*`，MCP 延 v1.1 |
| Database Migration | `schema.ts` MIGRATIONS 新條目 |
| Configuration Schema | （D3 定案）config loader + Zod |
| Unit Tests / Integration Tests | （X1 定案）`scripts/test-repo-*.sh` bash e2e |
| Documentation | README / AGENTS.md / CHANGELOG |

## Changelog

- 2026-07-13: 初版（草稿，待 D1–D4 與範圍確認）。
- 2026-07-13: D1–D4 與範圍事項定案（全數採建議方案），狀態轉為已確認；FF 推斷與 session 整合明確標記延至 v1.1。
