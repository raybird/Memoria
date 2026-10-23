# Issue 28 - 實作計畫

## 狀態與唯一工作清單

本檔為已核准的唯一工作清單（2026-10-23 完成 `decompose`）。[README.md](./README.md) 的 `SCN-001`～`SCN-014` 與 `TBD-1`～`TBD-5` 均已核准。

設計與流程依 [technical-analysis.md](./technical-analysis.md)，需求現況依 [requirement-analysis.md](./requirement-analysis.md)；風險與首要驗證僅以 [README.md](./README.md#風險與首要驗證) 為準。

## 設計流程

讀有效設定／判斷互動模式 → 收集選擇 → 預檢全部目標與顯示變更 → 使用者確認 → 初始化與安全寫入 → 部署 host → 可選模型／索引 → 產生 brief／接線 → 真實 readiness 驗證 → 保存／回報狀態。

可預知衝突在套用前全部收集；執行期失敗沿用可恢復步驟，不把多檔案與外部下載假裝成一個 atomic transaction。完整成功必須符合所選能力，未選能力是 skipped，未知 coverage 不是 ready。

## 驗收與責任 Task 對照

| Scenario / 項目 | 責任 Task | 支援 Task |
| --- | --- | --- |
| 首要驗證（最大風險保護與路徑 characterization） | Task 1.1 | Task 1.2, Task 2.1 |
| SCN-001 一般使用者在終端完成引導 | Task 3.1 | Task 2.1, Task 4.1 |
| SCN-002 全域資料選擇在新程序中仍有效 | Task 1.2 | Task 3.1 |
| SCN-003 專案記憶與既有明確路徑保持隔離 | Task 1.1 | Task 1.2 |
| SCN-004 所選 host 可發現相同記憶 skill | Task 2.1 | Task 3.1 |
| SCN-005 共用規範與 brief 接線保留原有內容 | Task 2.1 | Task 3.1 |
| SCN-006 選擇本地語意召回即完成向量啟用 | Task 4.1 | Task 1.2, Task 3.1 |
| SCN-007 基本模式與空記憶庫也有誠實的完成判定 | Task 4.1 | Task 3.1, Task 5.1 |
| SCN-008 重跑或升級後刷新設定不重複或遺失資料 | Task 2.1 | Task 3.1, Task 5.1 |
| SCN-009 衝突或不安全寫入在開始修改前被攔下 | Task 1.1 | Task 2.1, Task 3.1 |
| SCN-010 安裝或索引失敗可以辨認與重試 | Task 4.1 | Task 3.1 |
| SCN-011 自動化命令不等待問答 | Task 3.1 | Task 5.1 |
| SCN-012 環境覆寫不被保存設定悄悄替換 | Task 1.1 | Task 1.2, Task 4.1 |
| SCN-013 完成驗證不污染使用者記憶 | Task 4.1 | Task 3.1, Task 5.1 |
| SCN-014 既有部署與未選擇的整合維持原行為 | Task 5.1 | Task 1.1, Task 3.1 |
| 常青文件、雙語指南與 deployed skill 同步 | Task 5.2 | — |

---

## Phase 1 — 首要驗證：路徑優先序、安裝設定保存與環境覆寫保護

### Task 1.1 — 首要驗證與安裝設定／路徑優先序負向保護（SCN-003、SCN-009、SCN-012）
- 產出與範圍：
  - 新增 `src/core/install-settings.ts`（Zod 驗證的使用者層級 `install.json` 讀寫、平台設定路徑解析 `XDG_CONFIG_HOME`／macOS `Application Support`／Windows `APPDATA` 與 `MEMORIA_USER_CONFIG_PATH` 測試覆寫、原子寫入、禁止寫入認證 token）。
  - 修改 `src/core/paths.ts` 與 `src/core/index.ts`（擴充 `MemoriaHomeSource` 加入 `'global-config'`，優先序：`memoriaHomeOverride` > `MEMORIA_HOME` > `cwd` 本地 `.memory`/`knowledge` 或 `cwd/memoria` > 保存的全域 `dataRoot` > `fallback`；提供有效本地向量設定推導 helper，使向量庫跟隨有效 `dataRoot`，`LIBSQL_URL` 與 `MEMORIA_EMBED_PROVIDER` 環境覆寫保持優先；檢查 `MEMORIA_DB_PATH` 與 ingest 資料根不符時的阻擋判定）。
  - 新增 `scripts/test-setup-onboarding.sh`（建立隔離 HOME／XDG 與雙資料根 fixtures，測試專案本地記憶優先於全域設定、環境變數覆寫優先、不存 token、`MEMORIA_DB_PATH` 不符阻擋，以及手寫 skill／symlink／不可寫目標的多目標預檢基礎負向案例）。
- 相依：無（High 風險首要驗證，排在第一項執行）
- 驗收編號：SCN-003（責任）、SCN-009（責任）、SCN-012（責任）
- 完成判準：
  - `resolveMemoriaHomeInfo()` 與安裝設定讀寫在隔離環境下滿足「明確參數／環境 > 本地既有記憶 > 保存的全域預設 > fallback」。
  - 資料根切換時，未明確指定 `LIBSQL_URL` 的本地向量路徑自動跟隨有效資料根，不混用其他資料根的向量庫。
  - `MEMORIA_DB_PATH` 指到非 `<dataRoot>/.memory/sessions.db` 時，明確判定不可執行向量 ingest。
  - 預檢遇到不安全目標時拒絕寫入，既有檔案與 DB 逐位元組不變。
- 驗證：雙迴圈 — 外層以 `scripts/test-setup-onboarding.sh` 子程序驗證跨目錄 CLI 行為，內層以 `scripts/setup-onboarding-driver.mts` 斷言驗證優先序、Windows/macOS/Linux 路徑計算與 token 過濾。
- 狀態：✅ 已完成
- 證據：
  - 外迴圈紅燈（SCN-003、SCN-009、SCN-012）：在實作 `--scope` 與預檢前，對既有 CLI 執行 `./cli setup --scope global --yes` 因 `error: unknown option '--scope'`（exit 1）紅燈；對 `MEMORIA_DB_PATH=/tmp/other.db ./cli setup --vector --json` 則未阻擋 DB 路徑不符而退回 exit 0。
  - 單元測試紅燈（SCN-003、SCN-009、SCN-012）：對尚未接上 `global-config` 與 token 過濾的基準邏輯執行 `npx tsx scripts/setup-onboarding-driver.mts` 斷言，`resolveMemoriaHomeInfo()` 在無本地記憶時回傳 `source: 'fallback'`（非預期的 `'global-config'`），AssertionError（exit 1）。
  - 最小實作後全綠：完成 `src/core/install-settings.ts` 與 `src/core/paths.ts` 後，`npx tsx scripts/setup-onboarding-driver.mts`（exit 0，輸出 `✓ [inner-loop] all unit assertions passed`）與 `bash scripts/test-setup-onboarding.sh`（exit 0，通過 SCN-003、SCN-009、SCN-012）全綠。
  - 重構後全綠：將有效向量環境解析收斂為 `resolveEffectiveVectorEnv()` 與 `applyEffectiveVectorEnv()`，重跑 `npx tsx scripts/setup-onboarding-driver.mts` 與 `bash scripts/test-setup-onboarding.sh` 皆 exit 0。

### Task 1.2 — 新程序自動套用全域設定與 `doctor` 來源診斷（SCN-002）
- 產出與範圍：
  - 修改 `src/cli.ts`（啟動時載入有效安裝設定，當該有效 `dataRoot` 已啟用本地向量且環境未顯式指定 `LIBSQL_URL`／`MEMORIA_EMBED_PROVIDER` 時自動套用對應的本地 `file:<dataRoot>/.memory/vectors.db` 與 provider，讓 `recall`、`doctor` 等命令在新程序直接生效，無須 `export` 或 `source`）。
  - 修改 `src/cli/commands/doctor.ts`（顯示有效資料位置與來源 `global-config`／`detected`／`env`／`fallback`、設定檔路徑，以及 core／agent／vector readiness 狀態）。
- 相依：Task 1.1
- 驗收編號：SCN-002（責任）
- 完成判準：
  - 完成全域設定後，在無本地記憶的任意其他目錄啟動新 CLI 程序（未設定 `MEMORIA_HOME`），`doctor`、`remember`、`recall`、`brief` 皆讀寫保存的同一全域資料根。
  - `doctor`（一般輸出與 `--json`）顯示有效資料根位置與 `homeSource: "global-config"`。
- 驗證：單迴圈合併於 `scripts/test-setup-onboarding.sh`（CLI 子程序在空環境與不同 `cwd` 下執行 `remember`、`recall`、`brief`、`doctor --json`，外層 CLI 輸出與底層 `paths` 傳遞完全同構，無獨立內層邏輯遺漏）。
- 狀態：✅ 已完成
- 證據：
  - 單迴圈紅燈（SCN-002）：未在 `src/cli.ts` 啟動時呼叫 `applyEffectiveVectorEnv()` 且未接上 `global-config` 前，於空目錄執行 `bash scripts/test-setup-onboarding.sh` 的 SCN-002 段，`doctor --json` 回傳 `homeSource: "fallback"` 且 `vector recall: not enabled`（AssertionError，exit 1）。（外層 CLI 啟動子程序直接驅動 `src/cli.ts` 與 `doctor.ts`，與底層完全同層故合併單迴圈。）
  - 最小實作後全綠：修改 `src/cli.ts` 與 `src/cli/commands/doctor.ts` 後，`bash scripts/test-setup-onboarding.sh` 的 SCN-002 段通過（exit 0，`homeSource: "global-config"`，跨目錄新程序不帶 `MEMORIA_HOME` 完成 `remember`、`recall`、`brief`）。
  - 重構後全綠：`code-simplify` 檢視 `src/cli.ts` 與 `src/cli/commands/doctor.ts` 為最小直線邏輯（no-op），沿用同一份綠燈證據（exit 0）。

---

## Phase 2 — Host Skill 多目標部署與 AGENTS.md / CLAUDE.md 受管理接線

### Task 2.1 — Codex／Claude Code 發現路徑、受管理規範區塊、備份與重跑冪等（SCN-004、SCN-005、SCN-008）
- 產出與範圍：
  - 修改 `src/cli/runtime.ts`（擴充 `HOST_AGENTS` 支援 `'claude-code'` 與 `'codex'`，支援解析 `--agent claude-code`、`--agent codex`、`--agent both`、`--agent none` 或多次 `--agent`；Codex 標準發現路徑 `~/.codex/skills/memoria` 或 `$CODEX_HOME/skills/memoria`，Claude Code `~/.claude/skills/memoria`；多目標同時預檢 `assertHostSkillTarget`）。
  - 新增 `src/cli/agent-integration.ts`（管理共用 `AGENTS.md` 與 `CLAUDE.md` 的受管理區塊 `<!-- memoria:managed:start -->` ... `<!-- memoria:managed:end -->`、修改前備份至 `<dataRoot>/.agents/instruction-backups/`、保留區塊外所有原始 bytes、重跑去重與原地刷新、處理全域與專案範圍及含空白路徑的 `@` import）。
- 相依：Task 1.1
- 驗收編號：SCN-004（責任）、SCN-005（責任）、SCN-008（責任）、支援 SCN-009
- 完成判準：
  - 選擇 Codex、Claude Code 或兩者時，標準 skill 位置皆有可執行 `bin/memoria` launcher 且 `DATA_ROOT` 綁定所選資料根。
  - 既有 `AGENTS.md` 與 `CLAUDE.md` 的手寫內容完整保留，修改前產生可定位備份，共用 `AGENTS.md` 含 brief 讀取指令，`CLAUDE.md` 含 `@AGENTS.md` 與對應 brief 的 `@` import（含空白路徑跳脫）。
  - 以相同選擇重跑或升級後刷新，受管理區塊不重複堆疊，手寫內容與真實記憶完整保留。
  - 任一目標（skill 或規範檔）為來源不明的 symlink、非目錄衝突或不可寫時，在寫入任何目標前全部攔下並以非 0 結束。
- 驗證：雙迴圈 — 內層測試受管理區塊替換／備份／衝突預檢函式，外層於 `scripts/test-setup-onboarding.sh` 以隔離 `HOME` 驗證雙 host 部署、launcher 執行、規範檔前後 bytes 對照與重跑冪等。
- 狀態：✅ 已完成
- 證據：
  - 外迴圈紅燈（SCN-004、SCN-005、SCN-008）：實作前執行 `./cli setup --agent both` 或 `./cli setup --agent codex` 輸出 `unknown --agent 'both'; valid values: claude-code`（exit 1），且 `~/.codex/skills/memoria` 與規範檔受管理區塊不存在。
  - 單元測試紅燈（SCN-004、SCN-005、SCN-008）：實作前 `parseAgentFlag('both')` 拋出 `unknown --agent 'both'`（exit 1）。
  - 最小實作後全綠：完成 `src/cli/runtime.ts` 與 `src/cli/agent-integration.ts` 後，`npx tsx scripts/setup-onboarding-driver.mts`（exit 0，驗證 `parseAgentFlag`、`upsertManagedBlock` 保留手寫內容、重跑冪等、空白路徑 `escapeClaudeImportPath`、symlink 阻擋）與 `bash scripts/test-setup-onboarding.sh`（exit 0，驗證 SCN-004、SCN-005、SCN-008）全綠。
  - 重構後全綠：將 host skill 與規範檔的預檢統一收進 `assertSetupPlanSafe()`，重跑 `npx tsx scripts/setup-onboarding-driver.mts` 與 `bash scripts/test-setup-onboarding.sh` 皆 exit 0。

---

## Phase 3 — 互動引導、變更計畫預覽與非互動旗標編排

### Task 3.1 — `memoria setup` 互動問答、預覽確認／取消與非互動完整選項（SCN-001、SCN-011）
- 產出與範圍：
  - 新增 `src/cli/setup-plan.ts`（收集選擇 `scope: global | project`、`hosts: ('claude-code' | 'codex')[]`、`vector: boolean`、`wireInstructions: boolean`；計算完整 `SetupPlan` 預覽：資料根、設定檔、預計建立／更新／備份的 skill 與規範檔、是否需下載向量模型；提供 `readline/promises` 互動問答與確認）。
  - 修改 `src/cli/commands/setup.ts`（整合互動模式與非互動旗標 `--scope <global|project>`、`--global`、`--project`、`--agent <name>`、`--vector`、`--no-vector`、`--yes`、`--interactive`；維持既有 `--json`、無 TTY、`--memoria-home`、`--serve` 不等待問答的自動化契約；互斥或無效旗標以非 0 與可定位錯誤結束；確認取消時 0 寫入退出）。
- 相依：Task 1.2, Task 2.1
- 驗收編號：SCN-001（責任）、SCN-011（責任）
- 完成判準：
  - 在互動終端（或 `--interactive`）執行 `memoria setup` 時，可依序選擇全域／專案、host（Codex／Claude Code／both／none）、是否啟用本地語意召回，寫入前顯示實際路徑、預計修改檔案與是否下載模型。
  - 取消確認（輸入 `n` 或 EOF）時不改寫任何既有資料或使用者設定。
  - 既有 `--json`、無 TTY 或明確參數呼叫不卡住等待輸入，JSON Lines 契約維持相容；新非互動旗標可一次完成全部選擇，互斥選項（如同時傳 `--global` 與 `--project`）以非 0 報錯。
- 驗證：單迴圈於 `scripts/test-setup-onboarding.sh` 與 `scripts/test-bootstrap.sh`（透過餵入 stdin 測試互動問答確認與取消零變更、無 TTY 與 `--json` 附 timeout 防卡死、互斥旗標非 0 退出）。
- 狀態：✅ 已完成
- 證據：
  - 單迴圈紅燈（SCN-001、SCN-011）：以 piped stdin 執行 `printf '1\n1\n2\ny\n' | ./cli setup --interactive`，初次 `readline.question` 在非 TTY 流一次讀完多行導致第二個 `question` 收到 EOF 而取消退出，`install.json` 未建立（exit 1）。（互動 I/O 與 CLI flag 解析直接發生在 CLI 入口層，因此採單迴圈。）
  - 最小實作後全綠：在 `promptSetupChoices` 改以 line buffer 佇列承接 `rl.on('line')` 與 `close` 事件後，互動確認（`1\n1\n2\ny\n`）、互動取消（`1\n1\n1\nn\n`，驗證零檔案寫入）、非互動 `--json`、以及互斥旗標（`--global --project`、`--vector --no-vector`、`--interactive --json`）於 `bash scripts/test-setup-onboarding.sh` 與 `bash scripts/test-bootstrap.sh` 全數通過（exit 0）。
  - 重構後全綠：將預覽印出與實際執行計畫分離為 `buildSetupPlan()` 與 `printSetupPlanPreview()`，重跑 `bash scripts/test-setup-onboarding.sh` 與 `bash scripts/test-bootstrap.sh` 皆 exit 0。

---

## Phase 4 — 本地語意召回一次到位、隔離驗證與失敗恢復

### Task 4.1 — 向量模型安裝／暖機、樹狀索引與全量 ingest、coverage 與隔離語意路由實測（SCN-006、SCN-007、SCN-010、SCN-013）
- 產出與範圍：
  - 修改 `src/cli/setup-plan.ts`、`src/cli/commands/setup.ts` 與 `src/cli/runtime.ts`（當選擇啟用本地語意召回時：檢查 `MEMORIA_DB_PATH` 一致性 → 安裝／重用 vector 依賴與模型暖機 → 保存本地向量設定 → 執行 `buildMemoryIndex` 補齊樹狀索引 → 以專用 `--sync-target memoria-setup-full --payload-mode full` 匯出完整語料並執行 `vector-ingest.mjs` → 檢查 `inspectVectorLayer` 確認 `missing === 0` → 驗證語意召回路由）。
  - 實作空庫與非空庫的誠實完成驗證：
    - 非空庫：對真實語料執行驗證查詢（或在隔離探測庫驗證向量鏈路＋真實庫驗證 coverage `embedded === expected && missing === 0` 與實際語意查詢 `route_mode` 為 `vector` 或 `hybrid_vector` 且 `fallback_used === false`），不在真實資料庫留下測試記憶或測試 feedback。
    - 空庫：`expected === 0` 時不因無命中判失敗，也不偽稱已驗證真實語料查詢；自動在隔離暫存目錄與暫存向量庫寫入合成記憶、ingest 並驗證 `route_mode` 為 `vector`／`hybrid_vector` 且 `fallback_used === false`，驗證後完整刪除暫存目錄，真實記憶庫保持 0 筆測試殘留。
    - 基本模式（未選向量）：不下載模型，明示 `core: ready`、`vector: skipped (basic mode)`。
    - 失敗與重試：依賴下載、暖機、ingest 或驗證任一步失敗時以非 0 結束，分開顯示 `core`、`agent`、`vector` 狀態與重試命令；重跑時沿用已成功的 core／依賴快取並補齊失敗步驟。
- 相依：Task 3.1
- 驗收編號：SCN-006（責任）、SCN-007（責任）、SCN-010（責任）、SCN-013（責任）、支援 SCN-008／SCN-012
- 完成判準：
  - 選擇語意召回後一次完成模型暖機、樹狀索引、全量向量 ingest（不受舊 sync 游標影響）、`doctor` `embedded === expected` 且 `missing === 0`，且語意改述查詢驗證 `route_mode` 為 `vector` 或 `hybrid_vector`、`fallback_used === false`。
  - 未選向量不下載模型；空庫以隔離暫存探測驗證鏈路並清理，真實記憶庫無任何合成筆記或 feedback 殘留。
  - 注入 npm／暖機／ingest 失敗時 setup 以非 0 退出，清楚區分 `core: ready` 與 `vector: failed`，重跑可恢復至完成。
- 驗證：
  - 自動化 E2E：`scripts/test-setup-onboarding.sh`（使用 stub provider + 真實 libSQL + 故障注入驗證非空庫舊游標全量補齊、空庫隔離探測零殘留、基本模式不裝模型、失敗非 0 與重試恢復）。
  - 維護者實機手動證據（依 `project.md`）：以 `MEMORIA_EMBED_PROVIDER=local` 在隔離資料根執行完整 setup，記錄模型與依賴快取 hash、空／非空語料 coverage、跨語言／改述查詢 `route_mode` 與延遲。
- 狀態：✅ 已完成
- 證據：
  - 單迴圈紅燈（SCN-006、SCN-007、SCN-010、SCN-013）：舊版 `setup --vector` 僅安裝依賴與暖機，不執行 `buildMemoryIndex` 與 `vector-ingest.mjs` 且不保存 `LIBSQL_URL`，導致既有記憶庫執行後 `doctor --json` 的 `vector coverage` 仍為 `missing > 0`（exit 1）；且在 `LIBSQL_URL="file:/nonexistent/dir/vec.db"` 下驗證失敗時以 exit 1 報 `core: ready, vector: failed`。（向量 ingest 與隔離探測跨越 child process helper 與 SQLite/libSQL，單迴圈整合測試直接覆蓋完整鏈路。）
  - 最小實作後全綠（自動化 E2E）：`bash scripts/test-setup-onboarding.sh`（exit 0）驗證舊 `memory_sync_state` 游標已存在時仍以唯一 `--sync-target` 全量補齊 `missing=0`（SCN-006）、空庫隔離探測後真實 DB `sessions=0` 與基本模式 `vector: skipped`（SCN-007、SCN-013）、以及失敗後重跑恢復至 `vector: ready`（SCN-010）。
  - 重構後全綠：`code-simplify` 檢視 `runFullVectorIngest()` 與 `verifyVectorReadiness()` 之暫存目錄清理（`try/finally`）無多餘抽象（no-op），重跑 `bash scripts/test-setup-onboarding.sh` 為 exit 0。
  - 實機 `MEMORIA_EMBED_PROVIDER=local` 測試數據（packed npm install `@raybird.chen/memoria@1.31.2`，模型 `Xenova/multilingual-e5-small` q8，快取目錄 `~/.cache/memoria/vector/690ebce65e137374`）：
    1. 空記憶庫一次 setup（`memoria setup --scope global --agent both --vector --yes --json`）：`vector-deps` `reused: true, warmedUp: true`，`vector-ingest` `embedded: 0, expected: 0, missing: 0`（耗時 `263 ms`），`vector-verify` `isolatedProbeVerified: true, corpusVerified: false, routeMode: "hybrid_vector"`（耗時 `6220 ms`），真實 DB 維持 `sessions: 0, events: 0`。
    2. 非空記憶庫（寫入中文決策記憶後重跑 `setup --scope global --agent both --vector --yes`）：樹狀索引與向量 ingest 完成 `coverage=5/5 (missing=0)`，`isolatedProbeVerified: true, corpusVerified: true`（總耗時 `8553 ms`）；新程序無環境變數執行 `doctor --json` 顯示 `homeSource: "global-config"`、`vector coverage: embedded=5 expected=5 missing=0`。
    3. 跨語言改述召回（英文查詢 `"persist global setup configuration in json so new shells share the same memory root"` 對中文記憶）：`route_mode: "hybrid_vector"`, `fallback_used: false`, `latency_ms: 1860`。
    4. 零字面重疊跨語言純向量召回（英文查詢 `"share historical decisions across terminal windows via a common directory"` 對兩筆分別位於專案 `α`／`β` 的純中文記憶，完全無共同字元）：`route_mode: "vector"`, `fallback_used: false`, `confidence: null`, `confidence_basis: "unavailable"`, `latency_ms: 1787`，且語意相關記憶（`noteev-dcf18d6c4f098635`, score `0.01639`）排在無關記憶（`noteev-e16a62954281b1b1`, score `0.01587`）之前。

---

## Phase 5 — 打包安裝回歸、CI 矩陣與雙語常青文件同步

### Task 5.1 — Packed npm、no-clone tarball、Node 18 與跨平台路徑回歸驗證（SCN-014）
- 產出與範圍：
  - 修改 `scripts/test-npm-install.sh`（在 packed npm 安裝環境驗證一次 setup 後，跨目錄新程序不帶 `MEMORIA_HOME` 即可透過保存設定執行 `remember`、`recall`、`doctor` 與 deployed launcher）。
  - 修改 `scripts/test-bootstrap.sh`、`scripts/test-no-clone-install.sh`、`.github/workflows/ci.yml`（將 `scripts/test-setup-onboarding.sh` 加入 CI 測試矩陣，驗證 Windows／macOS／Linux 平台路徑解析與既有契約相容性）。
- 相依：Task 4.1
- 驗收編號：SCN-014（責任）
- 完成判準：
  - `pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`、`bash -n` 全部通過。
  - `test-setup-onboarding.sh`、`test-bootstrap.sh`、`test-npm-install.sh`、`test-no-clone-install.sh`、`test-vector-recall.sh`、`test-brief-scope.sh` 等相關測試全綠。
  - 未選擇的 host 不被修改，不自動安裝 service 或 hooks，helper 路徑與 stdin/stdout 契約維持不變。
- 驗證：執行打包與完整回歸腳本，記錄命令與結果。
- 狀態：✅ 已完成
- 證據：
  - 單迴圈紅燈（SCN-014）：在未更新 `dist/cli.mjs` 打包產物時對 packed npm 套件執行 `test-npm-install.sh` 新增之 `--scope global --agent both --no-vector --yes` 斷言，因舊 bundle 無 `--scope` 與 `codex` host 支援而失敗（exit 1）。（打包產物與安裝腳本屬單一交付層。）
  - 最小實作後全綠：重新 `pnpm run build` 後，`pnpm run check`、`node dist/cli.mjs --help`、`bash -n install.sh scripts/test-setup-onboarding.sh`、`bash scripts/test-setup-onboarding.sh`、`bash scripts/test-bootstrap.sh`、`bash scripts/test-npm-install.sh`、`bash scripts/test-vector-recall.sh`、`pnpm run release:package && bash scripts/test-no-clone-install.sh`、`bash scripts/test-smoke.sh`、`bash scripts/test-cli-memory.sh`、`bash scripts/test-brief-scope.sh` 全部 exit 0。
  - 重構後全綠：測試腳本與 CI workflow 結構精簡無多餘變更（no-op），全套腳本維持 exit 0。
  - 第三方審查（`review-f38ce84.md`）7 項 MUST FIX 修復與雙迴圈迴歸驗證：
    1. **MUST FIX #1（跨資料根 `process.env.LIBSQL_URL` 污染）**：於 `src/core/install-settings.ts` 追蹤 `applyEffectiveVectorEnv` 自動注入的環境變數並提供 `getExplicitVectorEnv()`，使 `setup` 在設定第二個資料根 `B` 時不會把啟動階段自動注入的 `A/.memory/vectors.db` 誤判為使用者明確傳入的 `LIBSQL_URL`。
    2. **MUST FIX #2（Pre-check 祖先路徑檢查）**：於 `src/cli/runtime.ts` 新增 `checkWritableAncestorDir`／`assertWritableAncestorDir` 並接入 `checkHostSkillTarget` 與 `assertSetupPlanSafe`，確保當 `~/.codex/skills` 或 `install.json` 父目錄被一般檔案、symlink 或不可寫目錄佔用時，在建立任何目錄或資料庫前即失敗退出。
    3. **MUST FIX #3（`coverage === null` 時語料計數與驗證）**：於 `src/cli/setup-plan.ts` 的 `runFullVectorIngest` 直接以 `countEmbeddableEntities(paths.dbPath)` 計算應嵌入筆數，並在 ingest 後及 `verifyVectorReadiness` 中拒絕 `coverage === null`（例如空白檔案或無法度量的 store），不再將 `null` 當作 `0/0` 跳過。
    4. **MUST FIX #4（互動預覽與確認路徑一致）**：將 `requestedHome` 傳入 `promptSetupChoices`，在顯示預覽與詢問確認前即套用 `--memoria-home`／`MEMORIA_HOME`。
    5. **MUST FIX #5（既有專案 `.memory`／`knowledge` 偵測）**：於 `src/core/paths.ts` 抽出 `detectLocalMemoriaRoot(cwd)`，使 `memoria setup --scope project` 在已具備 `./.memory` 或 `./knowledge` 的專案目錄中直接以 `cwd` 為目標（與 `doctor`／`recall` 一致）。
    6. **MUST FIX #6 & #7（單一資料根 `--no-vector` 停用與多根隔離）**：統一以 `vector.roots` 判斷各資料根是否啟用向量召回，移除 `resolveEffectiveVectorEnv` 中對 `defaultDataRoot` 的無條件放行，並確保非互動 `setup --scope project --no-vector` 與 `setup --scope global --no-vector` 皆只從 `vector.roots` 移除當前資料根而不誤關其他已啟用資料根。
    7. **Sandbox 相容性**：`scripts/test-setup-onboarding.sh` 改用 `node --import tsx scripts/setup-onboarding-driver.mts`，避免 `tsx` CLI IPC pipe 在受限沙盒中觸發 `EPERM`。
  - 後續獨立複審（`review-62075c8-followup.md`）3 項 MUST FIX（`F-1`～`F-3`）修復與紅綠重構驗證：
    1. **紅燈驗證（Red）**：於 `scripts/setup-onboarding-driver.mts` 與 `scripts/test-setup-onboarding.sh` 新增 `F-1a`（`<dataRoot>/.agents/skills` 為一般檔案）、`F-1b`（`<dataRoot>/.agents/skills/memoria/SKILL.md` 為無部署標記的手寫 skill）、`F-1c`（`<dataRoot>/.memory` 為 symlink）、`F-2a/b`（`<HOME>/.codex` 為指向已含 `skills/` 與 `AGENTS.md` 之外部目錄的 symlink）及 `F-3a/b`（空語料 `expected === 0` 且 `<dataRoot>/.memory/vectors.db` 預先為 0-byte 空檔），執行 `node --import tsx scripts/setup-onboarding-driver.mts` 觀察到 `F-1a`、`F-1b`、`F-1c`、`F-2a`、`F-2b`、`F-3b` 共 6 項預期紅燈失敗。
    2. **最小修復（Green）**：
       - **`F-1`**：於 `src/cli/setup-plan.ts` 的 `assertSetupPlanSafe()` 預先檢查 data root 內所有寫入目標目錄（`.memory`、`sessions`、`sources`、`checkpoints`、`exports`、`knowledge` 及子目錄、`configs`、`.agents`、`.agents/skills`、`.agents/skill-backups`、`.agents/instruction-backups`）、內部檔案目標（`dbPath`、`briefPath`、local `vectors.db`）與 `<dataRoot>/.agents/skills/memoria`（透過 `assertHostSkillTarget`），並於 `deployAgentSkill` 套用 `assertHostSkillTarget` 保護，避免手寫 skill 被覆寫或在 `init()` 寫入 DB 後才失敗。
       - **`F-2`**：於 `src/cli/runtime.ts` 的 `checkWritableAncestorDir()` 在確認最近既有祖先目錄可寫後，繼續向上檢查所有祖先目錄至根目錄是否為真實目錄（僅排除已知 macOS 系統頂層 alias `/tmp`、`/var`、`/etc`，不再設 4 層深度上限），並於 `src/cli/agent-integration.ts` 的 `assertInstructionTargetsSafe()` 對既有指令檔同樣執行 `assertWritableAncestorDir(target.path, 'modify')`，防止既有子目錄或檔案（包含任意深度的 `CODEX_HOME=<fixture>/link/a/b/c/d/e`）遮蔽上層的使用者 symlink 祖先（`review-a02c01c.md`）。
       - **`F-3`**：於 `src/cli/setup-plan.ts` 的 `runFullVectorIngest()` 當 `expected === 0` 且 local `file:` 向量檔已存在但 `inspectVectorLayer(paths.dbPath).coverage === null`（如 0-byte 空檔尚無 `memoria_vectors` 表）時，初始化空的 `memoria_vectors` 表與 vector index，使 `verifyVectorReadiness()` 與 `memoria doctor` 可正確量測 `0/0 (missing=0)`。
    3. **綠燈與重構（Refactor）**：`pnpm run check`、`pnpm run build`、`node --import tsx scripts/setup-onboarding-driver.mts`、`bash scripts/test-setup-onboarding.sh`、`bash scripts/test-bootstrap.sh`、`bash scripts/test-smoke.sh`、`bash scripts/test-vector-recall.sh`、`pnpm run release:docs-check` 全部 exit 0。

### Task 5.2 — 雙語文件、部署版 Skill 與架構規範更新（不改變可觀察行為）
- 產出與範圍：
  - 更新 `README.md`、`README.zh-TW.md`、`docs/INSTALL.md`、`docs/CLI.md`、`docs/CLI.zh-TW.md`、`docs/INTEGRATIONS.md`、`docs/INTEGRATIONS.zh-TW.md`、`docs/OPERATIONS.md`、`AGENTS.md`、`docs/agents/architecture.md`、`docs/HANDOVER.md`。
  - 更新 `skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md` 與 `DEPLOYED_REFERENCE.md`（說明保存的安裝設定與 `DATA_ROOT`／`MEMORIA_HOME` 優先序及一次 setup 流程，同時維持 `test-bootstrap.sh` 檢查的關鍵條款）。
- 相依：Task 5.1
- 驗收編號：支援 SCN-001～SCN-014（常青文件責任）
- 完成判準：
  - 中英文文件、`AGENTS.md` 測試清單與 deployed skill 同步反映已實作的 `memoria setup` 互動／非互動流程與設定優先序。
  - `pnpm run release:docs-check` 與 `test-bootstrap.sh` 的 deployed skill 檢查通過，且公開版控文件不含本機帳號或外部私有專案名。
- 驗證：靜態檢查 `pnpm run release:docs-check`、`bash scripts/test-bootstrap.sh` 與 `git diff --check`。
- 狀態：✅ 已完成
- 證據（不改變可觀察行為之等價靜態與契約檢查）：
  - `pnpm run release:docs-check`（exit 0，輸出 `Release doc sync check passed for v1.31.2`）。
  - `bash scripts/test-bootstrap.sh`（exit 0，通過所有 deployed skill 條款與觸發詞檢查）。
  - `git diff --check`（exit 0，無空白或格式錯誤）。

---

## 使用方式對照

目前：npm 安裝 → 選 data root → `setup --agent` → 補另一個 host → 環境／規範接線 → `brief` → `setup --vector` → `index`／`ingest` → `doctor` → `recall`。

目標：npm 安裝 → 一次 `memoria setup` 選擇與確認（或非互動 `memoria setup --scope global --agent both --vector --yes`）→ 直接在新終端或所選 agent 使用記憶。既有明確旗標與 `--json` 自動化命令保持相容。

## 測試策略與 Readiness 反向驗證

沿用 shell 整合測試與現有 TypeScript 靜態檢查，不新增測試框架。fixture 使用暫存 `HOME`／`XDG_CONFIG_HOME`／`XDG_CACHE_HOME`／`APPDATA`，明確 `unset` 繼承的 Memoria 與 libSQL 環境變數，禁止指到維護者真實資料。

| 可能假成功 | 實作驗證對照 |
| --- | --- |
| `doctor ok` 只是 vector 未啟用 | 對比未啟用（`skipped`）／要求 local 但缺模型（`failed`）／已啟用且完成（`ready`）三種狀態 |
| ingest ok 但漏 corpus | 已知缺失 id、已推進的舊 sync cursor、部分 vectors fixture；驗 `missing === 0` 與實際命中 |
| recall 有 hit 但只走 lexical | 不包含 fixture 關鍵字的語意查詢；assert `route_mode` 為 `vector` 或 `hybrid_vector` 且 `fallback_used === false` |
| 空庫被誤稱完成 corpus 驗證 | 空庫與非空庫對照，隔離 probe 回傳分開；真實 corpus 不留下任何合成測試資料 |
| launcher 存在但不可用／root 錯 | 啟動新子程序，從 fixture 中取出唯一已知 id；另一 root 放干擾項確認沒有串庫 |
| 重跑看似成功但覆蓋原文 | 事先寫入獨特手寫規則、區塊外 bytes 與不可覆寫 skill，檢查保留與拒絕副作用 |

## 檢查清單

- [x] 有可追溯的現況基線、需求來源與最小邊界。
- [x] Large 的兩份分析各有觸發理由：現況需閱讀跨模組程式、持久設定與接線方案有實質取捨。
- [x] Scenario ID、核准表與待確認事項相符，全部 `SCN-001`～`SCN-014` 與 `TBD-1`～`TBD-5` 已於 2026-10-23 核准。
- [x] 保護優先於互動流程實作（Phase 1 Task 1.1 首要驗證先行），風險只在 README 維護。
- [x] `decompose` 已在同一份計畫細化 Phase 1～5 與 Task 1.1～5.2，每個已核准 Scenario 皆有唯一責任 Task。
- [x] 完成所有 Task 實作、紅綠重構證據與實機 local 模型驗證。
- [x] 完成常青文件更新與程式提交；各輪審查修復已提交至 `0de3683`。
- [ ] 完成發版前完整交付複查、合併與版本發布。

## 發版前乾淨 CI 修正（2026-10-23）

- 紅燈：main CI [39902809662](https://github.com/raybird/Memoria/actions/runs/39902809662)，core job `120248053124` 在 onboarding Step 1 的 F-3 初始化報 `ERR_MODULE_NOT_FOUND: @libsql/client`。這是測試依賴準備順序，並非產品行為紅燈；既有安裝區塊在 Step 5，晚於新增的真實 libSQL 測試。
- 最小修正：只將原有 helper 依賴安裝移至 Step 1 前；不改產品、fixture 或 assertion。shell 頂層搬移不涉及函式 symbol。
- 綠燈：`bash -n scripts/test-setup-onboarding.sh` exit 0；`bash scripts/test-setup-onboarding.sh` 在 sandbox 外 exit 0，完整 Step 1–7、原始七項與 F-1／F-2 深層祖先／F-3 回歸全過。本機 helper 依賴既存，乾淨環境另由後續完整 CI 驗證。sandbox 內首次執行因向量隔離探測受限失敗，未作通過證據。
- 精煉 no-op：單一既有安裝區塊搬移已是最小修改，無可簡化內容；沿用同份綠燈。
