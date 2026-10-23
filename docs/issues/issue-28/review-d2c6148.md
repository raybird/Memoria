# 審查報告
- 範圍：完整 PR（Issue 28 完整交付範圍 `BASE..HEAD`）
- Reviewed BASE SHA：`50c2eb7d01167192ad03fcd7801b18942126f234`
- Reviewed HEAD SHA：`d2c61483285cfb29ab785876a6f2a8ec980829b3`
- Reviewed patch-id：`2cdf79b92fad40e8124cc200eafff216ef8ee830`
- 獨立 reviewer：Independent Reviewer Subagent（conversation `b1224d4d-5006-4811-bf30-ddd53afa2e6e`）
- Review artifact：`docs/issues/issue-28/review-d2c6148.md`

## 問題與風險

### MUST FIX
- 無

### SHOULD FIX
- 無（前次報告 `review-d05980c.md` 所列之 `S-1` 與 `S-2` 已於 `d2c6148` 完整修復：`src/cli/runtime.ts:401-422` 匯出 `runChild` 並由 `src/cli/setup-plan.ts:330-350` 共用、移除重複的 `runNodeScript`；`src/cli/commands/setup.ts:377-415, 470-473` 抽取 `persistOnboardingSettings(vectorReady: boolean)` 統一兩階段設定保存，並將巢狀三元運算子改寫為明確的 `if/else` 分支。）

### NICE TO HAVE
- 無（前次報告所列之 `N-1` 已於 `scripts/test-setup-onboarding.sh:235-248` 補上外層跨資料根切換時 `vector recall: not enabled (LIBSQL_URL unset)` 的子程序隔離斷言。）

---

## 已查核維度

### 1. 規格修訂與核准基線查核
- 執行 `git diff 741ba85 d2c61483285cfb29ab785876a6f2a8ec980829b3 -- docs/issues/issue-28/README.md` 查核：
  - `SCN-001`～`SCN-014` 之 Gherkin 驗收劇本與 `TBD-1`～`TBD-5` 決策內容與核准基線 commit `741ba85` **逐字完全一致（0 變更）**。
  - 差異僅為依 `acceptance.md` 規則回填核准 commit SHA `741ba85`、新增 Timeline 完成紀錄與更新狀態為「已實作（待審查）」。

### 2. 驗收與證據（`SCN-001`～`SCN-014`）
所有 14 項 Scenario 皆具備真實、非同義反覆（non-tautological）的斷言，且在 `docs/issues/issue-28/implementation-plan.md` 具備完整的四段紅綠重構證據（或合規說明的單迴圈合併／不改變可觀察行為之等價靜態檢查）：

| 驗收編號 | 實作位置 | 測試與證據位置 | 測試真偽與結論 |
| --- | --- | --- | --- |
| `SCN-001` | `src/cli/setup-plan.ts:63-167, 220-247`、`src/cli/commands/setup.ts:163-178` | `scripts/test-setup-onboarding.sh:107-129`、`docs/issues/issue-28/implementation-plan.md:115-118` | **通過**。以獨立檔案系統狀態斷言：取消（`1\n3\n2\nn\n`）驗證 `install.json`、`~/.memoria`、`~/.claude`、`~/.codex` 皆不存在；確認（`1\n3\n2\ny\n`）驗證設定檔、雙 host launcher 可執行檔與規範檔皆落地。 |
| `SCN-002` | `src/core/install-settings.ts:66-170`、`src/core/paths.ts:36-57`、`src/cli.ts:45-46`、`src/cli/commands/doctor.ts:178-215` | `scripts/test-setup-onboarding.sh:43-61`、`scripts/test-npm-install.sh:105-128`、`docs/issues/issue-28/implementation-plan.md:70-74` | **通過**。於無本地記憶的 `OTHER_CWD` 且 `unset MEMORIA_HOME` 下啟動新 CLI 程序，驗證 `doctor --json` 回傳 `homeSource === "global-config"` 且 `remember`／`recall` 跨程序讀寫同一全域資料根。 |
| `SCN-003` | `src/core/paths.ts:36-57`、`src/cli/commands/setup.ts:189-201, 377-415` | `scripts/setup-onboarding-driver.mts:97-130`、`scripts/test-setup-onboarding.sh:63-83`、`docs/issues/issue-28/implementation-plan.md:54-58` | **通過**。驗證本地 `.memory`／`knowledge` 優先於 `global-config`（`homeSource === "detected"`），且執行 `--scope project` 後回到 `OTHER_CWD` 仍維持原全域資料根，不覆寫全域設定。 |
| `SCN-004` | `src/cli/runtime.ts:102-164, 198-245` | `scripts/setup-onboarding-driver.mts:178-190`、`scripts/test-setup-onboarding.sh:125-126`、`scripts/test-npm-install.sh:111-127`、`docs/issues/issue-28/implementation-plan.md:93-97` | **通過**。驗證 `~/.claude/skills/memoria/bin/memoria` 與 `~/.codex/skills/memoria/bin/memoria`（及 `$CODEX_HOME`）皆可執行、綁定相同 `DATA_ROOT`，且在 packed npm 環境實際透過 host launcher 執行 `doctor` 與 `recall`。 |
| `SCN-005` | `src/cli/agent-integration.ts:21-232` | `scripts/setup-onboarding-driver.mts:191-263`、`scripts/test-setup-onboarding.sh:127, 156-164`、`docs/issues/issue-28/implementation-plan.md:93-97` | **通過**。以已知字面字串驗證修改前產生 `.agents/instruction-backups/` 備份、保留原有規則、寫入 `AGENTS.md` brief 讀取指令與 `CLAUDE.md` `@AGENTS.md` 及含空白路徑跳脫（`\ `）的 `@` import。 |
| `SCN-006` | `src/cli/setup-plan.ts:295-369, 380-462`、`src/cli/commands/setup.ts:419-468` | `scripts/test-setup-onboarding.sh:195-248`、`docs/issues/issue-28/implementation-plan.md:142-150` | **通過**。刻意將預設 `mcp-memory-libsql` 游標推至 `2099-12-31`，驗證 `setup --vector` 仍以獨立 `--sync-target` 完整索引語料使 `doctor` `missing=0`，且新程序不帶 `LIBSQL_URL` 執行 `recall --mode vector` 取得 `route_mode` 為 `vector`/`hybrid_vector` 且 `fallback_used === false`；另附實機 `MEMORIA_EMBED_PROVIDER=local` 跨語言召回量測數據。 |
| `SCN-007` | `src/cli/setup-plan.ts:303-307, 380-462`、`src/cli/commands/setup.ts:232-235, 442-449` | `scripts/test-setup-onboarding.sh:173-193`、`docs/issues/issue-28/implementation-plan.md:142-147` | **通過**。驗證基本模式不下載模型（`vector.status === "skipped"`）；空庫啟用向量時以隔離暫存庫完成探測（`isolatedProbeVerified === true`、`corpusVerified === false`），且真實庫 `stats --json` 維持 `sessions === 0, events === 0`。 |
| `SCN-008` | `src/cli/agent-integration.ts:39-59, 202-232`、`src/cli/runtime.ts:289-313` | `scripts/setup-onboarding-driver.mts:230-242`、`scripts/test-setup-onboarding.sh:156-164`、`scripts/test-bootstrap.sh:296-302` | **通過**。驗證重跑後 `AGENTS.md`／`CLAUDE.md` 逐位元組冪等、`grep -c 'memoria:managed:start'` 為 `1`、真實記憶仍可召回，且向量依賴快取 `reused === true`。 |
| `SCN-009` | `src/cli/setup-plan.ts:252-277`、`src/cli/agent-integration.ts:158-200`、`src/cli/runtime.ts:171-190` | `scripts/setup-onboarding-driver.mts:265-284`、`scripts/test-setup-onboarding.sh:139-154`、`scripts/test-bootstrap.sh:89-98, 151-172` | **通過**。於第二個 host（Codex）放置手寫 skill、第一個 host（Claude）保持乾淨，驗證 `setup --agent both` 在寫入任何目標前以非 0 退出，Codex 手寫檔 `cmp -s` 逐位元組不變，且 `~/.claude` 與 `~/.memoria` 完全未被建立。 |
| `SCN-010` | `src/cli/commands/setup.ts:237-253, 377-415, 459-467`、`src/cli/runtime.ts:314-320` | `scripts/test-setup-onboarding.sh:250-264`、`scripts/test-bootstrap.sh:304-317, 408-426` | **通過**。驗證向量步驟失敗時以非 0 結束、輸出同時明示 `core: ready` 與 `vector: failed`、未完成快取不留下 `.complete`、且後續重跑可沿用 core 並恢復至完成。 |
| `SCN-011` | `src/cli/commands/setup.ts:69-126` | `scripts/test-setup-onboarding.sh:130-137`、`scripts/test-bootstrap.sh:24-43` | **通過**。驗證既有 `--json`／明確參數呼叫不進入互動問答，且 `--global --project`、`--vector --no-vector`、`--interactive --json`、`--scope invalid` 立即以非 0 退出。 |
| `SCN-012` | `src/core/install-settings.ts:146-248`、`src/cli/setup-plan.ts:253-256` | `scripts/setup-onboarding-driver.mts:67-95, 131-177`、`scripts/test-setup-onboarding.sh:85-106, 235-248` | **通過**。驗證明確環境覆寫優先、`LIBSQL_AUTH_TOKEN` 絕不寫入 `install.json`、資料根切換時不串接全域向量庫，且 `MEMORIA_DB_PATH` 不符時在 ingest 前阻擋退出。 |
| `SCN-013` | `src/cli/setup-plan.ts:404-461` | `scripts/test-setup-onboarding.sh:173-193`、`docs/issues/issue-28/implementation-plan.md:142-148` | **通過**。合成探測記憶與查詢全在 `os.tmpdir()` 下的 `memoria-vec-probe-*` 執行並於 `finally` 清除，驗證後真實記憶庫 `sessions === 0, events === 0`。 |
| `SCN-014` | `src/core/install-settings.ts:66-114`、`src/cli/commands/setup.ts:112-126` | `scripts/setup-onboarding-driver.mts:40-65`、`scripts/test-npm-install.sh:105-128`、`scripts/test-no-clone-install.sh`、`scripts/test-bootstrap.sh` | **通過**。驗證 Linux／macOS／Windows 路徑解析、packed npm 與 no-clone tarball 相容、未選 host 不被修改、無自動安裝 service 或 hooks。 |

### 3. 相關失敗面
| 失敗面／邊界情境 | 輸入／狀態 | 預期行為 | 現有覆蓋位置與判定 |
| --- | --- | --- | --- |
| 多目標預檢中後段目標衝突 | `--agent both`，Claude 目標乾淨，但 Codex 目標存在手寫 `SKILL.md`（無部署標記）或 `CLAUDE.md` 為 symlink | 開始寫入前全部攔下，exit 非 0，Claude 目錄與資料根皆不被建立，原手寫檔逐位元組不變 | `src/cli/setup-plan.ts:252-277`、`scripts/test-setup-onboarding.sh:139-154`、`scripts/setup-onboarding-driver.mts:265-284` — **已覆蓋且通過** |
| 規範檔祖先路徑被一般檔案或 symlink 佔用 | `AGENTS.md` 或 `CLAUDE.md` 尚不存在，但其父目錄為 symlink、非目錄或無寫入權限 | `assertInstructionTargetsSafe` 向上走訪祖先目錄並拒絕寫入 | `src/cli/agent-integration.ts:178-198` — **已覆蓋且邏輯正確** |
| `install.json` 位置本身被 symlink 或目錄佔用 | 使用者設定檔路徑為 symlink 或目錄 | `assertSetupPlanSafe` 在步驟 4 拒絕覆寫並以非 0 退出 | `src/cli/setup-plan.ts:267-276` — **已覆蓋且邏輯正確** |
| `MEMORIA_DB_PATH` 指到非 `<dataRoot>/.memory/sessions.db` 時執行向量 ingest | 設定 `MEMORIA_DB_PATH=/tmp/elsewhere.db` 並執行 `setup --vector` | `assertIngestDbPathMatchesRoot` 在預檢與 ingest 入口阻擋，防止嵌入錯誤 corpus | `src/core/install-settings.ts:239-248`、`scripts/test-setup-onboarding.sh:96-105` — **已覆蓋且通過** |
| 既有資料庫曾跑過 MCP 增量同步，游標已在未來或最新 | `memory_sync_state` 的 `mcp-memory-libsql` 游標為 `2099-12-31` | `runFullVectorIngest` 使用唯一 `--sync-target memoria-setup-full-<ts>-<pid>` 與 `--payload-mode full`，不受既有游標遮蔽，完整嵌入所有實體 | `src/cli/setup-plan.ts:327-350`、`scripts/test-setup-onboarding.sh:202-235` — **已覆蓋且通過** |
| 空記憶庫（`expected === 0`）啟用本地語意召回 | 新初始化的空資料根執行 `setup --vector` | 不因真實庫 0 筆而讓 bridge script 報 `No session found` 失敗；自動建立隔離暫存庫驗證模型＋libSQL＋recall 鏈路，回報 `isolatedProbeVerified: true, corpusVerified: false`，且真實庫 0 殘留 | `src/cli/setup-plan.ts:303-307, 404-461`、`scripts/test-setup-onboarding.sh:173-193` — **已覆蓋且通過** |
| 互動模式於非 TTY 管線輸入多行或中途 EOF／取消 | `printf '1\n3\n2\nn\n' \| memoria setup --interactive` | 自建 `lineQueue` 逐行消費不掉行；收到 `n` 或 `EOF` 時印出取消且不寫入任何檔案或資料庫 | `src/cli/setup-plan.ts:69-167`、`scripts/test-setup-onboarding.sh:113-128` — **已覆蓋且通過** |
| 認證 Token 洩漏風險 | 環境存在 `LIBSQL_AUTH_TOKEN` 時執行 `setup` | `installSettingsSchema` 嚴格限定欄位，不讀取也不持久化任何 token | `src/core/install-settings.ts:25-39, 146-164`、`scripts/setup-onboarding-driver.mts:73-91` — **已覆蓋且通過** |

### 4. 需求、架構、安全、品質（含跨 Task 重複與過度設計）
- **需求與範圍**：完全符合 Issue 28 核准範圍，未引入背景 daemon/service、未自動綁定 hooks、未改變預設 recall 模式、未新增任何 runtime 套件依賴（維持 `better-sqlite3`、`commander`、`zod`）。
- **架構邊界**：
  - 使用者層級安裝設定（`src/core/install-settings.ts`）與資料根內的 `<dataRoot>/configs/config.json`（git 領域設定）清楚分離，解決了「必須先找到資料根才能讀設定」的啟動循環。
  - `src/core/paths.ts` 是路徑優先序的唯一真相來源（explicit override > `MEMORIA_HOME` > local cwd `.memory`/`knowledge` > saved `global-config` > runtime `fallback`），CLI、doctor 與 server 共用同一解析函式。
  - 向量 helper（`skills/memoria-vector/`）維持獨立子程序呼叫，未被 import 進核心模組。
- **安全與權限**：
  - `install.json` 與受管理規範檔（`AGENTS.md`、`CLAUDE.md`）皆採用同目錄 `.tmp-<pid>-<now>` 寫入後 `rename` 的原子替換策略。
  - 所有 host skill 與規範檔目標在任何磁碟修改或 DB 初始化前由 `assertSetupPlanSafe()` 一次完成預檢，拒絕 symlink、非一般檔案、手寫未標記 skill 與不可寫父目錄。
  - 修改既有規範檔或覆蓋既有部署版 skill 前，皆先備份至 `<dataRoot>/.agents/instruction-backups/` 或 `<dataRoot>/.agents/skill-backups/`（位於 host 掃描目錄之外，不會被當作第二個重複 skill 載入）。
- **程式碼品質與 `code-simplify` 查核**：
  - 前次指出的 `runChild`／`runNodeScript` 跨模組重複與 `saveInstallSettings` 兩階段組裝及巢狀三元運算子均已消除，整份 diff 乾淨、直線且無過度設計。
- **常青文件與版控衛生**：
  - 中英文文件及 `skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md`、`DEPLOYED_REFERENCE.md` 皆已同步更新。
  - 親自對 `d2c6148` 執行 `pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`、`bash -n install.sh scripts/test-setup-onboarding.sh`、`pnpm run release:docs-check` 與 `bash scripts/test-setup-onboarding.sh`，全數 exit 0 通過。

### 5. 豁免、待確認與限制
- **Gate 豁免**：無。
- **待確認事項**：`README.md` 中 `TBD-1`～`TBD-5` 皆已於 2026-10-23 解決並核准，無未決事項。
- **環境限制揭露**：依 `docs/agents/project.md` 規範，CI 使用 `MEMORIA_EMBED_PROVIDER=stub` 搭配真實 libSQL 驗證向量鏈路；真實本地模型（`MEMORIA_EMBED_PROVIDER=local`，`Xenova/multilingual-e5-small` q8）已由實作者於本機完成空庫、非空庫與跨語言零字面重疊查詢實測，並完整記錄量測值於 `docs/issues/issue-28/implementation-plan.md:146-150`。

## 流程判定
PASS
