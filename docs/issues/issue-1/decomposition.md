# Implementation Plan Decomposition

- Issue: [issue-1](README.md) — Git-Aware Memory v1
- 依據: [implementation-plan.md](implementation-plan.md)（2026-07-13 已確認版，D1–D4 定案）
- 日期: 2026-07-13
- 里程碑原則: 每個 Phase 對應一個 PR，Phase 內 Task 依序執行；Task 粒度以 1–3 小時為準。

## 全局依賴圖

```text
Phase 0 (基礎設施)
   └→ Phase 1 (Registry)
         └→ Phase 2 (Incremental Scan)
               └→ Phase 3 (Events + Dry-run)
                     └→ Phase 4 (Summary Pipeline)
                           └→ Phase 5 (Memoria Integration)
                                 └→ Phase 6 (Hardening)
```

---

## Phase 0 — 基礎設施前置

### Goal

建立後續所有 Phase 依賴的三項地基：git 唯讀執行層、config loader、host 身份。

### Deliverables

* `src/core/git/git-exec.ts`（白名單強制的唯讀 git 執行層）
* `src/core/config.ts`（`config.json` + Zod loader）
* host_id 一次性 UUID 機制
* `scripts/test-repo-git-exec.sh`

### Dependencies

* 無（可立即開工）

### Tasks

#### Task 0.1 — git 唯讀執行層

* 任務說明：以 `child_process.spawn('git', ...)` 實作 `runGit()`：**白名單命令強制**（`rev-parse/rev-list/log/show/diff/merge-base/for-each-ref/tag/patch-id/status`，其餘一律丟錯）、`LC_ALL=C`、`-z`/`--format` 明確輸出格式、timeout（預設沿用 vector helper 的 4s 模式、可調）、錯誤分類對應規格 §24 error codes（`not_a_git_repository`/`git_command_failed`/`detached_head`/`unborn_branch`/`shallow_clone` 等）。
* 預期輸出：`runGit(cwd, args, opts)` + `GitExecError` 型別；黑名單命令（`commit`/`push`/`config`…）100% 拒絕。
* 涉及模組或檔案：`src/core/git/git-exec.ts`（新）、`src/core/types.ts`（error code 型別，如需要）。

#### Task 0.2 — config loader

* 任務說明：實作 `loadConfig()`：讀取 `<MEMORIA_CONFIG_PATH>/config.json`，Zod schema 僅涵蓋 `git.*` 區塊（§27 全部預設值：`summarization.minimumCommits=2`、`promoteImportanceThreshold=0.7`、`filters.excludePaths`、`sensitivePaths` 等）；檔案不存在或缺鍵時回傳全預設、不報錯；解析失敗回明確錯誤。
* 預期輸出：`loadConfig(): MemoriaConfig`（含型別）+ 預設值常數。
* 涉及模組或檔案：`src/core/config.ts`（新）、`src/core/paths.ts`（只讀用，不改既有行為）。

#### Task 0.3 — host_id 機制

* 任務說明：於 `MEMORIA_HOME` 生成並保存一次性 host UUID（如 `<home>/host-id`），存在則讀取、不存在則以 `crypto.randomUUID()` 建立；不可使用 hostname。
* 預期輸出：`getHostId(): string`（冪等）。
* 涉及模組或檔案：`src/core/paths.ts` 或 `src/core/git/host.ts`（新，二擇一，以不污染 paths.ts 為準）。

#### Task 0.4 — Phase 0 驗證腳本

* 任務說明：建立 `scripts/test-repo-git-exec.sh`：以 `tsx` 驅動 git-exec，斷言（a）白名單命令可執行、（b）黑名單命令被拒絕、（c）非 git 目錄回 `not_a_git_repository`、（d）config 檔缺失時 loadConfig 回預設值。掛入 `.github/workflows/ci.yml`。
* 預期輸出：測試腳本 + CI 條目；`pnpm run check`、`pnpm run build`、`bash -n` 全過。
* 涉及模組或檔案：`scripts/test-repo-git-exec.sh`（新）、`.github/workflows/ci.yml`。

---

## Phase 1 — Repository Registry

### Goal

Repository 可加入、列出、查狀態、重新綁定、移除，身份以 fingerprint 去重（D4：`root_commit_sha` 為主成分）。

### Deliverables

* Migration：`repositories`、`repository_instances`、`git_worktrees`
* `MemoriaCore.repoAdd/repoList/repoStatus/repoRelocate/repoRemove`
* CLI `repo add/list/status/relocate/remove`
* `scripts/test-repo-registry.sh`

### Dependencies

* Phase 0（git-exec、host_id）

### Tasks

#### Task 1.1 — Registry 三表 migration

* 任務說明：在 `MIGRATIONS` 新增條目建立 `repositories`（§9.1，`UNIQUE(fingerprint)`）、`repository_instances`（§9.2，`UNIQUE(host_id, local_path)`）、`git_worktrees`（§9.3）及必要索引；遵循既有 ledger + `IF NOT EXISTS` 模式。
* 預期輸出：migration 條目；`scripts/test-migrations.sh` 於舊 DB 上仍通過。
* 涉及模組或檔案：`src/core/db/schema.ts`。

#### Task 1.2 — Repository identity 模組

* 任務說明：實作 fingerprint 計算：`SHA-256(root_commit_sha [+ repository_name])` 為主；shallow clone fallback `remote_url + earliest_available_commit` 並標記 `limited_history`（§25）；worktree 辨識（`rev-parse --git-common-dir` / `--show-toplevel`）、remote URL 正規化（去 credentials、統一 ssh/https 形式，僅作 metadata）。
* 預期輸出：`resolveRepositoryIdentity(path)` → `{fingerprint, rootCommitSha, remoteUrl, gitCommonDir, isShallow, worktreePath}`。
* 涉及模組或檔案：`src/core/git/identity.ts`（新），依賴 `git-exec.ts`。

#### Task 1.3 — Registry DB 層

* 任務說明：實作 `src/core/db/git-repo.ts`：repository upsert（fingerprint 撞到既有列 → 併入同一邏輯 repository）、instance/worktree upsert、list（含 last sync / pending 統計欄位預留）、relocate（更新 instance path，比對 fingerprint 一致才允許）、remove（預設僅停用 + 保留資料；`--delete-*` 各自獨立刪除）。所有函式走 `withDb`／`try/finally` 慣例。
* 預期輸出：`upsertRepository`、`listRepositories`、`getRepositoryStatus`、`relocateRepository`、`removeRepository` 等函式 + `mappers.ts` 對應 row mapper。
* 涉及模組或檔案：`src/core/db/git-repo.ts`（新）、`src/core/db/mappers.ts`、`src/core/db/index.ts`（barrel）。

#### Task 1.4 — MemoriaCore 公開方法

* 任務說明：在 `MemoriaCore` 增加 `repoAdd(opts)`、`repoList()`、`repoStatus(idOrPath)`、`repoRelocate(id, newPath)`、`repoRemove(id, opts)`，全部回傳 `MemoriaResult<T>`（`evidence[]`/`confidence`/`latency_ms`）；`repoAdd` 串 identity → registry → 初次 metadata 掃描（不摘要歷史，§28）。
* 預期輸出：五個 core 方法 + `core/types.ts` 對應輸入/輸出型別。
* 涉及模組或檔案：`src/core/memoria.ts`、`src/core/types.ts`、`src/core/index.ts`。

#### Task 1.5 — CLI `repo` 命令（registry 子集）

* 任務說明：新增 `registerRepoCommand(program, core)`：`repo add <path>`（`--name/--scan-history/--history-limit/--default-branch`）、`repo list`、`repo status <repository>`、`repo relocate <repository> <new-path>`、`repo remove <repository>`（`--delete-observations/--delete-summaries/--delete-memories`，刪 memory 必須明確旗標，§19.7）；比照既有命令提供 `--json`。於 `src/cli.ts` 註冊。
* 預期輸出：`repo` 命令可用，輸出格式與既有 CLI UX 一致。
* 涉及模組或檔案：`src/cli/commands/repo.ts`（新）、`src/cli.ts`。

#### Task 1.6 — Registry e2e 測試

* 任務說明：`scripts/test-repo-registry.sh`：mktemp 建 fixture git repo → 驗證新增成功、非 git 路徑拒絕、同 repo 複製到第二路徑不重複建立邏輯 repository、relocate 後 status 正常、remove 保留摘要/記憶、全程受管理 repo `git status` 乾淨。掛入 CI。
* 預期輸出：測試腳本綠燈；規格 §29「Repository 管理」四項驗收對應斷言。
* 涉及模組或檔案：`scripts/test-repo-registry.sh`（新）、`.github/workflows/ci.yml`。

---

## Phase 2 — Git Incremental Scan

### Goal

增量掃描 commits / refs / tags 並冪等入庫；重複 sync 零新列；無新 commit 時快速完成。

### Deliverables

* Migration：`git_commits`、`git_refs`、`git_scan_runs`
* Scanner（快照 + 增量 commit 擷取）
* CLI `repo sync`（metadata-only 版本）
* `scripts/test-repo-sync.sh`

### Dependencies

* Phase 1（registry、identity）

### Tasks

#### Task 2.1 — Scan 三表 migration

* 任務說明：建立 `git_commits`（§9.4，`PRIMARY KEY(repository_id, commit_sha)`，`patch_id` 允許 NULL）、`git_refs`（§9.5，observed 快照列）、`git_scan_runs`（§9.7）及索引。
* 預期輸出：migration 條目；`test-migrations.sh` 通過。
* 涉及模組或檔案：`src/core/db/schema.ts`。

#### Task 2.2 — Ref/tag/worktree 快照掃描

* 任務說明：以 `for-each-ref`（`--format` 含 objectname/refname/type）與 `status --porcelain` 讀取 local/remote branch、tags、HEAD、當前 branch、working tree clean/dirty；輸出結構化快照物件；降級情境（detached HEAD、unborn branch、shallow）以標記回報而非丟錯。
* 預期輸出：`scanSnapshot(repo)` → `{head, branch, refs[], tags[], workingTree, flags}`。
* 涉及模組或檔案：`src/core/git/scanner.ts`（新）。

#### Task 2.3 — 增量 commit 擷取與入庫

* 任務說明：以 `rev-list <lastHead>..<head>`（首次掃描依 `--history-limit`）+ `log --format` 批次讀取 commit metadata（parents、author/committer、message、is_merge=parent≥2），`INSERT OR IGNORE` 冪等寫入 `git_commits`，更新 `first_seen_at`/`last_seen_at`；同 transaction 寫入本次 `git_refs` 觀察列。
* 預期輸出：`ingestNewCommits(repo, snapshot)`；重複執行零新列。
* 涉及模組或檔案：`src/core/git/scanner.ts`、`src/core/db/git-scan.ts`（新）。

#### Task 2.4 — Scan run 生命週期

* 任務說明：每次 sync 建立 `git_scan_runs` 列（started → completed/failed + 統計 new_commit_count/new_ref_count/new_tag_count），失敗保存 error_message、不回滾已入庫 commits（§24）；更新 repository/worktree 的 last_scanned 與 last observed HEAD。metadata 掃描與後續摘要規劃分離（§26，不放同一長 transaction）。
* 預期輸出：`beginScanRun`/`completeScanRun`/`failScanRun`；中斷後重跑可從上次成功狀態續作。
* 涉及模組或檔案：`src/core/db/git-scan.ts`、`src/core/memoria.ts`（`repoSync` 骨架）。

#### Task 2.5 — CLI `repo sync`（metadata-only）

* 任務說明：`repo sync <repository>` 接上 core `repoSync`（本 Phase 僅 metadata：掃描、入庫、scan run；`--no-summary` 行為即預設）；輸出 previous/current HEAD、new commits/refs/tags 統計。
* 預期輸出：命令可用，`MemoriaResult` JSON 與人讀輸出。
* 涉及模組或檔案：`src/cli/commands/repo.ts`。

#### Task 2.6 — Scan e2e 測試

* 任務說明：`scripts/test-repo-sync.sh`：fixture repo 內產生 commits/merge/tag → sync → 斷言 commit 列數、parent JSON、is_merge、tag ref；再次 sync 斷言零新列且耗時輸出正常；特殊字元 commit message（引號、換行、中文）正確入庫。掛入 CI。
* 預期輸出：規格 §29「Git 掃描」六項驗收對應斷言全綠。
* 涉及模組或檔案：`scripts/test-repo-sync.sh`（新）、`.github/workflows/ci.yml`。

---

## Phase 3 — Git Events

### Goal

快照差異推斷為事件流；history rewrite 偵測；`--dry-run` 零寫入。

### Deliverables

* Migration：`git_events`
* Change detector（含 rewrite 偵測、patch_id lazy 計算）
* `repo sync --dry-run`
* `scripts/test-repo-events.sh`

### Dependencies

* Phase 2（快照與 scan run）

### Tasks

#### Task 3.1 — `git_events` migration

* 任務說明：建立 `git_events`（§9.6，status: pending/processed/ignored/failed）+ 索引（repository_id+status、detected_at）。
* 預期輸出：migration 條目。
* 涉及模組或檔案：`src/core/db/schema.ts`。

#### Task 3.2 — Change detector

* 任務說明：比較上次與本次快照（`git_refs` 最近觀察 vs 新快照），產生 §7.3 事件：`head_changed`、`commit_discovered`、`merge_commit_discovered`、`branch_discovered/branch_head_moved/branch_disappeared`、`tag_discovered`、`working_tree_dirty/clean`、`repository_relocated`、`scan_completed/failed`；事件語義為「觀察差異推斷」（兩次掃描間塌縮為已知限制）。冪等：同狀態重跑不重複建事件（§18）。
* 預期輸出：`detectChanges(prev, curr)` → 事件列表 + 入庫。
* 涉及模組或檔案：`src/core/git/change-detector.ts`（新）、`src/core/db/git-scan.ts`。

#### Task 3.3 — History rewrite 偵測

* 任務說明：舊 HEAD 非現 HEAD ancestor（`merge-base --is-ancestor` 失敗）→ 建 `history_rewritten` 事件；僅此時對受影響 commits lazy 計算 `patch-id` 並回填 `git_commits.patch_id`，以 patch-id 對應等價 commit、避免重複記憶；舊 commit observation 標記主線不可達、不刪除（§11.2）。
* 預期輸出：rewrite 情境下事件正確、patch_id 僅於必要時計算（一般路徑零 patch-id 呼叫）。
* 涉及模組或檔案：`src/core/git/change-detector.ts`、`src/core/db/git-scan.ts`。

#### Task 3.4 — `--dry-run`

* 任務說明：`repo sync --dry-run` 走完掃描與 detector 的純計算路徑，輸出將新增的 commits/events/（Phase 4 後含 summaries）清單，**零 DB 寫入**（§19.4）。
* 預期輸出：dry-run 前後 DB 檔案 byte-identical（以測試斷言）。
* 涉及模組或檔案：`src/core/memoria.ts`、`src/cli/commands/repo.ts`。

#### Task 3.5 — Events e2e 測試

* 任務說明：`scripts/test-repo-events.sh`：branch 建立/前進/刪除、tag、merge、`commit --amend`（rewrite）、dry-run 零寫入、同步中斷（kill）後重跑續作。掛入 CI。
* 預期輸出：全事件類型有對應斷言；rewrite 不產生重複資料。
* 涉及模組或檔案：`scripts/test-repo-events.sh`（新）、`.github/workflows/ci.yml`。

---

## Phase 4 — Summary Pipeline

### Goal

commit 分組 → trivial 過濾 → 結構化摘要（range/branch/merge/release），deterministic 保底 + agent 回寫增強（D1）。

### Deliverables

* Migration：`git_summary_ranges`、`git_summaries`
* Range planner + trivial filter + secret filter（全 deterministic）
* Deterministic fallback generator + agent 回寫介面
* CLI `repo summarize`、`repo sync` 摘要選項
* `scripts/test-repo-summary.sh`

### Dependencies

* Phase 3（事件流）
* Phase 0 Task 0.2（config：summarization/filters 區塊）

### Tasks

#### Task 4.1 — Summary 兩表 migration

* 任務說明：建立 `git_summary_ranges`（§9.8，`UNIQUE(range_fingerprint)`）、`git_summaries`（§9.9，含 generator/generator_version/prompt_version）。
* 預期輸出：migration 條目。
* 涉及模組或檔案：`src/core/db/schema.ts`。

#### Task 4.2 — Commit range planner

* 任務說明：依 §15 deterministic 規則分組：同 branch、24h 時間窗、路徑 top-level 目錄前綴（domain 代理）、changed files 重疊；切割點：merge commit、new tag、超過 24h 無 commit、domain 明顯改變。range_fingerprint 依 §9.8 公式計算。
* 預期輸出：`planRanges(newCommits, events, config)` → range 列表；同輸入同輸出（純函式）。
* 涉及模組或檔案：`src/core/git/range-planner.ts`（新）。

#### Task 4.3 — Trivial filter 與重要檔案例外

* 任務說明：依 §16 過濾：純 whitespace/formatting、lockfile、generated、snapshot、typo、低於 `minimumChangedLines` 門檻；重要檔案例外清單（schema/migration/auth/security/deploy/API contract）即使行數少也提升重要度。以 diffstat + 路徑規則實作，不呼叫模型。
* 預期輸出：`classifyTriviality(range)` → keep/skip + 理由；單獨可測。
* 涉及模組或檔案：`src/core/git/range-planner.ts` 或獨立 `trivial-filter.ts`。

#### Task 4.4 — 摘要輸入裁剪 + secret filter

* 任務說明：依 §17 優先序組裝摘要 context（messages → changed files → diffstat → 選定 hunks），`maxDiffBytes` 裁剪、排除 excludePaths/generated/lockfiles；§23 secret 防護：sensitivePaths 檔案完全排除、diff 內 pattern 偵測（token/private key/password/connection string）→ 遮罩 + summary metadata warning，不保存原始 secret 與完整 diff。
* 預期輸出：`buildSummaryContext(range, config)` → 結構化 context + warnings。
* 涉及模組或檔案：`src/core/git/summary-context.ts`（新）、`src/core/git/secret-filter.ts`（新）。

#### Task 4.5 — Deterministic fallback generator

* 任務說明：從 commit messages + diffstat 組裝 §7.5 結構化輸出骨架（title/summary/key_changes/affected_domains/importance/confidence；decisions/limitations/risks 留空陣列），`generator='deterministic'`；寫入 `git_summaries`，冪等鍵 `repository_id + range_fingerprint + prompt_version`（§18）。
* 預期輸出：無 agent 情境下 sync 也能產出可追溯摘要。
* 涉及模組或檔案：`src/core/git/summary-generator.ts`（新）、`src/core/db/git-summary.ts`（新）。

#### Task 4.6 — Agent 回寫介面（D1）

* 任務說明：`repo sync` 對非 trivial range 產出 pending summary request（含裁剪後 context，狀態掛 `git_events`/summary 列）；提供回寫入口：CLI `repo summarize --range <base>..<head>`（讀 stdin/`--file` JSON）與 core 方法 `submitRepoSummary`，Zod 驗證 §7.5 輸出格式，覆蓋 deterministic 摘要（同 range 同 prompt_version 冪等更新），記錄 `generator='agent'`/`generator_version`/`prompt_version`。
* 預期輸出：agent 可查 pending、可回寫；重複回寫不產生重複列。
* 涉及模組或檔案：`src/core/memoria.ts`、`src/core/db/git-summary.ts`、`src/cli/commands/repo.ts`。

#### Task 4.7 — Branch / merge / release 摘要規則

* 任務說明：branch summary（§13 觸發條件、`merge-base(default,branch)..head` 範圍）、merge summary（§12.1，merge base + 雙 parent + combined files）、release summary（§14 tag 命名 `v1.2.0/1.2.0/release-1.2.0`、`prev_tag..curr_tag`，無前版則 `root..tag`），各自產 summary_range（summary_type 區分）交給 generator 管線。
* 預期輸出：三種 summary type 端到端可生成、可追溯 base/head SHA。
* 涉及模組或檔案：`src/core/git/range-planner.ts`、`src/core/git/summary-generator.ts`。

#### Task 4.8 — CLI 摘要面收尾

* 任務說明：`repo summarize <repository>`（`--branch/--range/--merge/--tag/--type/--promote` 完整選項，`--promote` 先預留旗標、Phase 5 接通）；`repo sync` 加 `--no-summary/--force-summary/--from/--to`；dry-run 輸出補「將生成哪些 summaries」。
* 預期輸出：§19.4、§19.5 CLI 契約完整。
* 涉及模組或檔案：`src/cli/commands/repo.ts`。

#### Task 4.9 — Summary e2e 測試

* 任務說明：`scripts/test-repo-summary.sh`：分組正確（時間窗/merge 邊界切割）、trivial 過濾（lockfile-only commit 不生成）、重要檔案例外（migration 小改動仍生成）、三種摘要類型、range_fingerprint 去重、secret 遮罩（fixture 塞假 token 斷言不出現在摘要與 DB）、agent 回寫覆蓋 deterministic。掛入 CI。
* 預期輸出：規格 §29「摘要」五項驗收對應斷言全綠。
* 涉及模組或檔案：`scripts/test-repo-summary.sh`（新）、`.github/workflows/ci.yml`。

---

## Phase 5 — Memoria Integration

### Goal

高價值摘要 promotion 進既有 recall 路徑（events → FTS），recall 附 Git 來源，HTTP 介面（D2）。

### Deliverables

* Migration：`memory_checkpoints`、`memory_sources`
* Promotion（含 checkpoint、冪等）
* `RecallHit.source` 來源附帶
* HTTP `/v1/repos/*` endpoints
* `scripts/test-repo-promotion.sh`

### Dependencies

* Phase 4（摘要管線）

### Tasks

#### Task 5.1 — Promotion 兩表 migration

* 任務說明：建立 `memory_checkpoints`（§9.10，冪等鍵 `repository_id + checkpoint_type + base_sha + head_sha`）、`memory_sources`（§9.11，`UNIQUE(memory_id, source_type, source_id)`）。
* 預期輸出：migration 條目。
* 涉及模組或檔案：`src/core/db/schema.ts`。

#### Task 5.2 — Memory promotion

* 任務說明：依 §7.6 條件 + `promoteImportanceThreshold` 判定升級；將 summary 的 decisions/limitations/risks 寫入既有 `events` 表（新 event_type，如 `GitDecision`/`GitLimitation`，自動進 `recall_fts` 觸發器路徑）+ `memory_sources` 回鏈 summary/range；同時建立 `memory_checkpoints`；同一 summary 不重複 promotion（§18）；promotion 失敗不刪 summary（§24）。
* 預期輸出：`promoteSummary(summaryId)` core 方法 + sync 管線自動評估 + `repo summarize --promote` 接通。
* 涉及模組或檔案：`src/core/db/git-summary.ts`、`src/core/db/schema.ts`（FTS 觸發器涵蓋新 event_type 確認）、`src/core/memoria.ts`。

#### Task 5.3 — Recall 來源附帶

* 任務說明：`RecallHit` 加 optional `source` 物件（§21 形狀：type/repository/branch/base_sha/head_sha/summary_id）；recall 組裝時對 git 來源的 hit join `memory_sources` → `git_summaries`/`repositories` 填入；keyword 與 tree 兩路徑都涵蓋；不影響既有 hit 形狀（向後相容加法）。
* 預期輸出：recall git-promoted 記憶時回應含完整 Git 來源。
* 涉及模組或檔案：`src/core/types.ts`、`src/core/db/recall.ts`。

#### Task 5.4 — HTTP endpoints（D2）

* 任務說明：`src/server.ts` 新增：`POST /v1/repos`（add）、`GET /v1/repos`（list）、`GET /v1/repos/:id/status`、`POST /v1/repos/:id/sync`（body：`generate_summaries/dry_run`，回應對齊 §20 repo_sync 輸出形狀）、`POST /v1/repos/:id/summarize`、`POST /v1/repos/:id/summaries/:rangeId`（agent 回寫）；Zod body 驗證、regex 路由比照既有模式；更新 server.ts 頂部 endpoint 文件註解。
* 預期輸出：HTTP 契約完整、`test-http-api.sh` 模式可測。
* 涉及模組或檔案：`src/server.ts`、`src/sdk.ts`（`MemoriaClient` 對應方法）。

#### Task 5.5 — Promotion e2e 測試

* 任務說明：`scripts/test-repo-promotion.sh`：高 importance 摘要 promotion → `recall` 可搜到 → hit.source 欄位正確 → 重複 sync/summarize 不重複 promotion → checkpoint 建立；HTTP endpoints 契約斷言（沿用 `test-http-api.sh` 手法或併入該腳本）。掛入 CI。
* 預期輸出：規格 §29「記憶整合」四項驗收對應斷言全綠。
* 涉及模組或檔案：`scripts/test-repo-promotion.sh`（新）、`scripts/test-http-api.sh`（如併入）、`.github/workflows/ci.yml`。

---

## Phase 6 — Hardening

### Goal

留存治理、併發防護、邊界情境補強、非侵入性總驗收與文件對齊。

### Deliverables

* Prune target `git-observations`
* per-repository 併發防護
* 邊界情境測試 + 非侵入性總驗收腳本
* 文件（README/AGENTS.md/CHANGELOG）對齊

### Dependencies

* Phase 5（全功能就位）

### Tasks

#### Task 6.1 — Prune target

* 任務說明：`runPrune` 新增 `git-observations` target：依 retention 門檻清理過期 `git_refs` 觀察列、已 processed 的 `git_events`、老舊 `git_scan_runs`；不刪 `git_commits`/`git_summaries`/promotion 產物；掛入 `--all`（門檻可調、預設寫入文件），擴充 `PruneOptions` 與回傳型別。
* 預期輸出：prune 後 recall 與摘要追溯不受影響；`test-prune.sh` 擴充斷言通過。
* 涉及模組或檔案：`src/core/db/prune-export.ts`、`src/cli/commands/prune.ts`、`scripts/test-prune.sh`。

#### Task 6.2 — 併發防護

* 任務說明：per-repository in-process mutex（Promise chain map）防止 HTTP + CLI 或多 worktree 同時 sync 同一 repository 交錯寫入；文件明列跨 process 併發為 v1 已知限制（單使用者假設）。
* 預期輸出：同 process 併發 sync 序列化執行。
* 涉及模組或檔案：`src/core/memoria.ts` 或 `src/core/git/sync-lock.ts`（新）。

#### Task 6.3 — 邊界情境補測

* 任務說明：shallow clone（`limited_history` 狀態 + fingerprint fallback + 補齊歷史後就地升級）、detached HEAD、多 worktree 共享 identity、relocate 後 sync、大 diff（超過 `maxDiffBytes` 裁剪）等情境測試，併入既有 `test-repo-*.sh` 或獨立 `scripts/test-repo-edge.sh`。
* 預期輸出：§24/§25 降級行為全部有斷言。
* 涉及模組或檔案：`scripts/test-repo-edge.sh`（新）、`.github/workflows/ci.yml`。

#### Task 6.4 — 非侵入性總驗收

* 任務說明：總驗收腳本：對 fixture repo 跑完整流程（add → 開發操作 → sync → summarize → promote → prune），前後比對 `git status --porcelain` 輸出、`.git/config` 與 hooks/refs 目錄雜湊，斷言零變化（§29 非侵入性）。
* 預期輸出：`scripts/test-repo-noninvasive.sh` 綠燈並掛 CI。
* 涉及模組或檔案：`scripts/test-repo-noninvasive.sh`（新）、`.github/workflows/ci.yml`。

#### Task 6.5 — 文件對齊

* 任務說明：更新 `README.md`/`README.zh-TW.md`（repo 命令與流程）、`AGENTS.md`（HTTP API、repo sync 與既有 `sync` 的區分）、`CLAUDE.md`（新命令列入「不可改名」清單、新測試腳本列表）、`CHANGELOG.md`；確認 CI 腳本順序與文件一致。
* 預期輸出：文件與實作零落差；issue-1 README 狀態更新為完成。
* 涉及模組或檔案：`README.md`、`README.zh-TW.md`、`AGENTS.md`、`CLAUDE.md`、`CHANGELOG.md`、`docs/issues/issue-1/README.md`。

---

## 粒度與依賴檢核

* 共 7 個 Phase、36 個 Task；單 Task 皆為 1–3 小時粒度，無循環依賴，Phase 內 Task 依編號序執行即可（4.2/4.3/4.4 可並行，5.3/5.4 可並行）。
* 每個 Phase 結束時 CI 全綠（含該 Phase 新增測試腳本），符合 repo「Definition of Done」（`pnpm run check`、`pnpm run build`、相關 `test-*.sh`、`bash -n`、CLI UX 一致）。
* Migration 分散於各 Phase（1.1/2.1/3.1/4.1/5.1）而非一次到位，確保每個 PR 的 schema 變更與其功能同進退，且 `test-migrations.sh` 每階段驗證向後相容。
