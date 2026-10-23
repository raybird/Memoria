# 審查報告
- 範圍：完整 PR（Issue 28 完整交付範圍 `BASE..HEAD`，含 `f38ce84..62075c8` 針對 `review-f38ce84.md` 7 項 MUST FIX 之修復）
- Reviewed BASE SHA：`50c2eb7d01167192ad03fcd7801b18942126f234`
- Reviewed HEAD SHA：`62075c8aa9c430e0470b183735e09aa85b3579d3`
- Reviewed patch-id：`7ca39b49e6e214b744331b7c3b8167b97b605fd5`（`f38ce84..62075c8` patch-id：`d3372d92aa7858869ce4aaee6736f133bddf2663`）
- 獨立 reviewer：Independent Reviewer Subagent（conversation `b1224d4d-5006-4811-bf30-ddd53afa2e6e`）
- Review artifact：`docs/issues/issue-28/review-62075c8.md`

## 問題與風險

### MUST FIX
- 無（`docs/issues/issue-28/review-f38ce84.md` 所列之 7 項 MUST FIX 均已於 `62075c8` 徹底修復，並具備內層單元與外層 CLI E2E 雙迴圈測試覆蓋；詳見下方「第三方審查 7 項 MUST FIX 修復逐項核驗」。）

### SHOULD FIX
- 無

### NICE TO HAVE
- 無

---

## 第三方審查（`review-f38ce84.md`）7 項 MUST FIX 修復逐項核驗

| 編號 | 原報問題摘要 | 修復實作位置與機制 | 雙迴圈測試覆蓋位置與判定 |
| --- | --- | --- | --- |
| **#1** (P1) | CLI 啟動時 `applyEffectiveVectorEnv` 將預設根 A 的 `LIBSQL_URL` 寫入 `process.env`，隨後執行 `setup --memoria-home B --vector` 時誤將其當作使用者明確覆寫，把 B 的語料寫入 A 的 `vectors.db`。 | `src/core/install-settings.ts:179-193, 236-266` 記錄自動注入的 `appliedLibsqlUrl`／`appliedEmbedProvider` 並匯出 `getExplicitVectorEnv()`；`src/cli/setup-plan.ts:254-256` 與 `src/cli/commands/setup.ts:388, 429-432` 改用 `getExplicitVectorEnv(process.env)`，使非使用者明確設定的 `LIBSQL_URL` 重新依目標 `setupPaths.memoriaHome` 推導。 | 內層：`scripts/setup-onboarding-driver.mts:196-221`；外層：`scripts/test-setup-onboarding.sh:331-357`（驗證對 `PROJ_VEC_B` 執行 `--vector` 時建立 `PROJ_VEC_B/.memory/vectors.db`，且 `POP_ROOT/.memory/vectors.db` 筆數前後完全不變）— **已徹底解決** |
| **#2** (P1) | Host skill 預檢與 `install.json` 預檢未檢查祖先目錄：當第二個 host 的 `~/.codex/skills` 或設定檔父目錄是一般檔案時，預檢放行，導致第一個 host 與 DB 已寫入後才 `ENOTDIR` 失敗。 | `src/cli/runtime.ts:170-197, 209-217` 新增 `checkWritableAncestorDir`／`assertWritableAncestorDir` 並納入 `checkHostSkillTarget`；`src/cli/setup-plan.ts:273-311` 於 `assertSetupPlanSafe` 一併檢查 `memoriaHome`、所有 host skills、規範檔與 `settingsPath` 的既有祖先是否為可寫真實目錄。 | 內層：`scripts/setup-onboarding-driver.mts:361-401`；外層：`scripts/test-setup-onboarding.sh:267-277`（驗證 `~/.codex/skills` 為一般檔案時 pre-check 失敗退出，且 `~/.claude` 與 `~/.memoria` 完全未建立）— **已徹底解決** |
| **#3** (P2) | `runFullVectorIngest` 以 `beforeReport.coverage?.expected ?? 0` 判斷空庫；當 `LIBSQL_URL` 指向尚未建立 `memoria_vectors` 表的新檔案或遠端 URL 時，`coverage` 為 `null` 被當成 `0` 跳過 ingest 且宣稱成功。 | `src/core/recall-vector.ts:107` 匯出 `countEmbeddableEntities`；`src/cli/setup-plan.ts:342, 396-400, 434-443` 改由 SQLite 直接計算應嵌入筆數，且 ingest 後與 `verifyVectorReadiness` 若 `coverage === null` 立即拋錯拒絕，不再將 `null` 當成 `0/0`。 | 內層：`scripts/setup-onboarding-driver.mts:408-421`；外層：`scripts/test-setup-onboarding.sh:307-324`（預先建立 0 byte 空白檔作為 `LIBSQL_URL`，驗證非空庫仍完整執行 ingest 並達成 `corpusVerified === true`）— **已徹底解決** |
| **#4** (P2) | 互動模式在預覽與確認之後才套用 `requestedHome`（`--memoria-home`／`MEMORIA_HOME`），導致預覽顯示的路徑與實際寫入路徑不一致。 | `src/cli/setup-plan.ts:65-71, 117-138` 與 `src/cli/commands/setup.ts:173-179` 將 `requestedHome` 傳入 `promptSetupChoices`，在顯示選單、建構 `SetupPlan` 預覽與詢問確認前即套用 `requestedHome`。 | 外層：`scripts/test-setup-onboarding.sh:279-290`（驗證 `--interactive --memoria-home "$CUSTOM_MF4"` 在確認前輸出的預覽即顯示 `Data root: ...$CUSTOM_MF4`）— **已徹底解決** |
| **#5** (P2) | 在已存在 `./.memory` 或 `./knowledge` 的目錄執行 `setup --scope project` 時忽略既有本地根而另建 `./memoria`，導致與 `doctor`／`recall` 解析到的本地根不一致。 | `src/core/paths.ts:29-40` 抽出 `detectLocalMemoriaRoot(cwd)`；`src/cli/commands/setup.ts:133-135` 在 `isFullOnboarding` 下優先採用 `detectLocalMemoriaRoot(process.cwd()) ?? path.join(process.cwd(), 'memoria')`（同時保留舊版非 onboarding 呼叫的相容性）。 | 內層：`scripts/setup-onboarding-driver.mts:403-406`；外層：`scripts/test-setup-onboarding.sh:292-305`（驗證在含 `./.memory` 的目錄執行 `setup --scope project` 直接初始化 `cwd/.memory/sessions.db`，不產生重複的 `cwd/memoria/.memory`）— **已徹底解決** |
| **#6** (P2) | 非互動 `setup --scope project --no-vector` 因 `saveSettings` 為 `false` 未更新 `install.json`，導致原先已啟用向量的專案根無法透過 `--no-vector` 停用。 | `src/cli/commands/setup.ts:201-209, 393-396, 473-475` 檢查 `rootWasInVectorRoots`，當目標根原本在 `vector.roots` 中時 `saveSettings = true`，將該根從 `vector.roots` 移除而保留 `defaultDataRoot` 不變。 | 外層：`scripts/test-setup-onboarding.sh:359-377`（驗證對 `PROJ_VEC_B` 執行 `--scope project --no-vector --yes` 後，`PROJ_VEC_B` 的 `doctor` 顯示 `not enabled`，而全域根 `A` 仍維持 `enabled`）— **已徹底解決** |
| **#7** (P2) | 對全域根執行 `--scope global --no-vector` 時將共用的 `vector.enabled` 設為 `false`，連帶把 `vector.roots` 中其他已啟用向量的專案一併停用；且 `resolveEffectiveVectorEnv` 只要 `vector.enabled` 為真就無條件對 `defaultDataRoot` 啟用向量。 | `src/core/install-settings.ts:213-219` 改為當 `vector.roots` 存在時嚴格以 `roots.includes(rootResolved)` 判定；`src/cli/commands/setup.ts:393-396` 以 `nextRoots.length > 0` 決定 `vector.enabled`，使單一資料根停用只從 `vector.roots` 移除自身，不影響其他已啟用根。 | 內層：`scripts/setup-onboarding-driver.mts:180-193`；外層：`scripts/test-setup-onboarding.sh:379-399`（驗證對全域根 `A` 執行 `--scope global --no-vector --yes` 後，`A` 變為 `not enabled`，而專案 `B` 仍維持 `enabled`）— **已徹底解決** |

---

## 已查核維度

### 1. 規格修訂與核准基線查核
- 執行 `git diff 741ba85 62075c8 -- docs/issues/issue-28/README.md` 查核：
  - `SCN-001`～`SCN-014` 之 Gherkin 驗收劇本與 `TBD-1`～`TBD-5` 決策內容與核准基線 commit `741ba85` **逐字完全一致（0 變更）**。

### 2. 驗收與證據（`SCN-001`～`SCN-014`）
所有 14 項 Scenario 皆具備真實、非同義反覆（non-tautological）的斷言與完整四段紅綠重構證據：
- `SCN-001`（互動引導、預覽確認／取消零寫入，含 `--memoria-home` 預覽一致性）：`src/cli/setup-plan.ts:65-181`、`scripts/test-setup-onboarding.sh:107-129, 279-290` — **通過**。
- `SCN-002`（全域設定跨程序自動生效与 `doctor` `homeSource: "global-config"`）：`src/core/install-settings.ts:66-170`、`src/core/paths.ts:49-66`、`scripts/test-setup-onboarding.sh:43-61` — **通過**。
- `SCN-003`（專案記憶優先、既有 `./.memory` 偵測與全域預設隔離）：`src/core/paths.ts:29-66`、`src/cli/commands/setup.ts:133-135`、`scripts/test-setup-onboarding.sh:63-83, 292-305` — **通過**。
- `SCN-004`（Codex／Claude Code 雙 host skill 部署與 launcher 執行）：`src/cli/runtime.ts:102-164, 235-282`、`scripts/test-setup-onboarding.sh:125-126`、`scripts/test-npm-install.sh:105-128` — **通過**。
- `SCN-005`（`AGENTS.md`／`CLAUDE.md` 受管理區塊、備份、保留原有規則與空白路徑跳脫）：`src/cli/agent-integration.ts:21-232`、`scripts/setup-onboarding-driver.mts:266-338` — **通過**。
- `SCN-006`（本地語意召回一次到位、忽略舊增量游標、忽略預先存在之空向量檔並實測路由）：`src/cli/setup-plan.ts:330-408`、`scripts/test-setup-onboarding.sh:195-235, 307-324` — **通過**。
- `SCN-007`（基本模式不下載模型、空記憶庫隔離探測 `isolatedProbeVerified=true, corpusVerified=false`）：`src/cli/setup-plan.ts:342-345, 419-506`、`scripts/test-setup-onboarding.sh:173-193` — **通過**。
- `SCN-008`（重跑冪等、不重複受管理區塊、沿用快取）：`scripts/setup-onboarding-driver.mts:305-318`、`scripts/test-setup-onboarding.sh:156-164` — **通過**。
- `SCN-009`（多目標與祖先路徑安全預檢，衝突時 0 修改非 0 退出）：`src/cli/runtime.ts:170-227`、`src/cli/setup-plan.ts:267-312`、`scripts/test-setup-onboarding.sh:139-154, 267-277` — **通過**。
- `SCN-010`（向量失敗退出非 0、區分 `core: ready` 與 `vector: failed`、重跑恢復）：`src/cli/commands/setup.ts:413-415, 461-470`、`scripts/test-setup-onboarding.sh:250-264` — **通過**。
- `SCN-011`（自動化呼叫不等待問答、互斥或無效旗標非 0 退出）：`src/cli/commands/setup.ts:76-127`、`scripts/test-setup-onboarding.sh:130-137` — **通過**。
- `SCN-012`（環境覆寫優先、不存 token、跨根 `LIBSQL_URL` 不污染、單根 `--no-vector` 停用隔離、`MEMORIA_DB_PATH` 不符阻擋）：`src/core/install-settings.ts:179-281`、`scripts/test-setup-onboarding.sh:85-106, 235-248, 326-399` — **通過**。
- `SCN-013`（完成驗證不污染真實記憶庫）：`src/cli/setup-plan.ts:448-505`、`scripts/test-setup-onboarding.sh:186-193` — **通過**。
- `SCN-014`（跨平台路徑解析、packed npm／no-clone tarball 相容、`node --import tsx` 沙盒相容）：`scripts/setup-onboarding-driver.mts:40-65`、`scripts/test-setup-onboarding.sh:33`、`scripts/test-npm-install.sh:105-128` — **通過**。

### 3. 相關失敗面與架構／安全／品質查核
- **多目標與祖先目錄預檢完整性**：`assertSetupPlanSafe` 在執行任何 `init`、skill 複製或設定寫入前，完整驗證 `memoriaHome`、所有 `hostSkillTargets`、所有 `instructionPlan.targets` 與 `settingsPath` 本身及其最近既有祖先目錄的可寫性與型態（拒絕一般檔案與 symlink）。
- **跨資料根與環境變數隔離**：`getExplicitVectorEnv` 精確區分「程序啟動時由 `applyEffectiveVectorEnv` 自動帶入的預設根向量設定」與「使用者在 shell 明確傳入的環境變數」，徹底消除跨根 setup 時的向量庫串庫風險。
- **沙盒與測試執行穩定性**：`scripts/test-setup-onboarding.sh:33` 已改用 `node --import tsx scripts/setup-onboarding-driver.mts`，避免 `pnpm exec tsx` 建立 `/tmp/tsx-*` IPC pipe 在受限沙盒觸發 `EPERM`。
- **實測結果**：親自於本機執行 `pnpm run check && pnpm run build && node dist/cli.mjs --help >/dev/null && bash -n install.sh scripts/test-setup-onboarding.sh && pnpm run release:docs-check && bash scripts/test-setup-onboarding.sh`，全數 exit 0 通過（含新增之 Step 6 MUST FIX #1～#7 全部迴歸斷言）。

### 4. 豁免、待確認與限制
- 無豁免、無未決之待確認事項。

## 流程判定
PASS
