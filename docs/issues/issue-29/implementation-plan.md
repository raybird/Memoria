# Issue 29 - 實作計畫

風險與首要驗證見 [README](./README.md#風險與首要驗證)。任務清單以本檔「實作步驟」為準。

## 設計方案

### 1. Canonical 目錄與 host 連結

- `deployAgentSkill` 寫入 `<memoriaHome>/.agents/skills/memoria` 的完整部署檔案；canonical 必須是實體目錄。
- `deployHostAgentSkill` 將所選 host 路徑連到 canonical 的絕對路徑，使用 `fs.symlink(canonicalSkillDir, targetDir, process.platform === 'win32' ? 'junction' : 'dir')`。
- 未指定 `--agent` 時仍更新 canonical，已連結的 host 透過原路徑取得更新；不重新部署 host、不新增備份。

### 2. 預檢與受管理連結辨識

`assertSetupPlanSafe` 在任何寫入前檢查 canonical 與所有 host。檢查與部署使用同一套規則；`assertHostSkillTarget` 明確區分 canonical 與 host 模式，預設維持 canonical 的嚴格模式。

1. 以正規化絕對路徑比對 host 與 canonical；相等時拒絕並列出衝突路徑。Windows 比對需依平台處理大小寫與 junction 路徑格式。部署 helper 在刪除前也保留重合護欄。
2. 對每個目標檢查完整祖先鏈，維持既有深層 symlink 拒絕與 macOS 根目錄系統別名例外。
3. 以 `lstat` 區分不存在、symlink、實體目錄與其他型態；僅 `ENOENT` 表示不存在，權限或其他讀取錯誤回報失敗。
4. canonical 本身為 symlink 時拒絕。host symlink 以 `readlink` 取得目標，按 host 所在父目錄解析相對路徑後，套用下列唯一辨識規則。
5. 實體目錄為空時放行；非空時，`SKILL.md` frontmatter 須同時含 `deployment_mode: installed` 與 `repository: Memoria` 才放行。一般檔案及其他型態拒絕。

host symlink 的解析目標**必須以三個完整路徑元件 `.agents/skills/memoria` 結尾**，再依目標狀態判斷：

| 解析目標狀態 | 結果 |
| --- | --- |
| 存在的實體目錄，SKILL.md frontmatter 具兩項部署標記 | 允許重連 |
| 不存在（ENOENT） | 允許修復斷鏈 |
| 存在但缺標記、為一般檔案、另一層 symlink 或其他型態 | 拒絕 |
| 無法判斷狀態或讀取標記 | 拒絕並回報原因 |

尾端不相符時一律拒絕，即使目標含部署標記。路徑與公開部署標記是受管理目標的辨識慣例，不能證明連結由 setup 建立。重連只移除 host link，不修改舊連結所指向的內容。

### 3. 部署與備份

1. 完成整體預檢；確認 canonical 與 host 路徑不重合，且 canonical 已由 `deployAgentSkill` 部署為可用實體目錄。helper 若需自行部署 canonical，先完成相同安全檢查。
2. 刪除前重新套用 host 模式預檢與重合護欄。
3. 依 host 現況處理：
   - 不存在：直接建立連結。
   - 符合辨識規則的 symlink：只移除 host link，不備份；斷鏈亦同。
   - 空實體目錄：移除空目錄，不備份，再建立連結。
   - 帶標記的非空實體目錄：先完整備份至 `<memoriaHome>/.agents/skill-backups/<agent>-<timestamp>`，保留其內部 symlink；備份成功才移除原目錄並建立連結。
4. 確保父目錄存在，再建立指向 canonical 的 symlink／junction；讀取與建立失敗應回報失敗，不輸出成功 readiness。

## 實作步驟

1. 📝 **步驟 1 — 建立安全邊界與遷移的回歸保護網**
   - 產出：更新 `scripts/setup-onboarding-driver.mts`、`scripts/test-setup-onboarding.sh`、`scripts/test-bootstrap.sh`。
   - 相依：無。
   - 驗收編號：SCN-001～SCN-008。
   - 完成判準：
     - 主要實作前先驗證 SCN-003 的辨識矩陣及 SCN-005 的重合拒絕，涵蓋不存在與既有 canonical 的重合狀態；拒絕前資料根、設定、host 與外部內容均無寫入。
     - 既有負向案例保持綠燈；新部署、重連、空目錄轉換、斷鏈修復、舊實體副本遷移及不帶 `--agent` 更新，取得與缺少行為直接相關的紅燈。
     - 備份案例使用獨立建立的舊版實體目錄與自訂檔案，逐位元組比對備份；不把首次部署後的 symlink 當成舊實體 fixture 修改。
     - 內圈驗預檢判定，外圈驗 CLI 零寫入／連結／備份／launcher，分別記錄命令、結果與驗收編號；既有拒絕行為不要求人造紅燈。

2. 📝 **步驟 2 — 實作預檢、連結與舊版遷移**
   - 產出：`src/cli/runtime.ts`、`src/cli/setup-plan.ts`。
   - 相依：步驟 1 的風險保護測試已建立，且新行為紅燈原因已確認。
   - 驗收編號：SCN-001～SCN-008。
   - 完成判準：
     - 預檢與部署一致套用設計方案第 2 節，不放寬 canonical 的實體目錄要求。
     - 重合時在寫入前拒絕，空目錄能成功轉換，舊實體副本先完整備份；重連不新增備份、不修改舊 canonical。
     - SCN-001～SCN-008 的內外圈斷言全綠；完成範圍內精煉並記錄最終驗證，無需精煉則記 no-op 理由。

3. 📝 **步驟 3 — 常青文件與回歸驗證**
   - 產出：`README.md`、`README.zh-TW.md`、`docs/INSTALL.md`、`docs/CLI.md`、`docs/CLI.zh-TW.md`、`docs/INTEGRATIONS.md`、`docs/INTEGRATIONS.zh-TW.md`、`skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md`、`skills/memoria-memory-sync/deployed/DEPLOYED_REFERENCE.md`。
   - 相依：步驟 2。
   - 驗收編號：SCN-001～SCN-008（文件與回歸）。
   - 完成判準：
     - 文件一致描述 canonical／host 分工、首次實體副本遷移備份、重連不備份、空目錄處理、重合拒絕及不帶 `--agent` 更新同步；主 skill 模板也採相同規則。
     - 依序執行 `pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`、`bash scripts/test-smoke.sh`、`bash scripts/test-bootstrap.sh`、`bash scripts/test-setup-onboarding.sh`、`bash scripts/test-npm-install.sh`、`pnpm run release:docs-check`，全部 exit 0；有修改 shell 時另執行對應 `bash -n`。
     - 記錄被測版本與實際結果；Linux／macOS 的結果不作為 Windows junction 實機驗證證據。

## 測試策略

| 驗收編號 | 層級與位置 | 必要案例與判準 |
| --- | --- | --- |
| SCN-001 | 外圈：onboarding、bootstrap | 兩 host 新部署；另覆蓋自訂 CODEX_HOME；canonical 為實體目錄、host 為正確連結、內容可讀且 launcher 可執行 |
| SCN-002 | 內圈 driver＋外圈 onboarding | 同 root 重跑、跨 root 重連；不新增備份，舊 root 內容不變 |
| SCN-003 | 內圈 driver＋外圈 onboarding、bootstrap | 相對／絕對連結；外部有標記但尾端不符、尾端相符但無標記／為檔案／另一層 symlink；手寫目錄、深層祖先 symlink、canonical symlink 均拒絕，拒絕前零寫入 |
| SCN-004 | 外圈 bootstrap、onboarding | 舊實體目錄含自訂檔案與內部 symlink；備份內容完整後才轉連結 |
| SCN-005 | 內圈 driver＋外圈 onboarding | CODEX_HOME=<dataRoot>/.agents；canonical 存在／不存在皆在寫入前拒絕，不產生自連結 |
| SCN-006 | 外圈 onboarding | 兩 host 分別預建空目錄；成功轉連結且不備份 |
| SCN-007 | 外圈 onboarding | 預置可辨識舊 SKILL.md／DATA_ROOT／launcher，無 --agent 更新後從兩 host 驗證正確內容與實際 launcher 執行；連結不變且不備份 |
| SCN-008 | 內圈 driver＋外圈 onboarding | canonical 尾端的相對／絕對斷鏈可重連；非 canonical 尾端斷鏈仍依 SCN-003 拒絕 |

## 檢查清單

- [x] SCN-001～SCN-008 的核准來源已記於 README；修訂版核准 commit 待提交後回填
- [ ] 步驟 1 安全保護網與新行為紅燈證據已建立
- [ ] 各驗收具有效綠燈與精煉／no-op 證據
- [ ] 修改 symbol 前跑 GitNexus impact，提交前跑 detect_changes
- [ ] 常青文件與部署主模板已同步並通過驗證

## 本次規劃修訂查核

2026-10-23，基於 HEAD `4f96a47` 的未提交文件修訂：`git diff --check` exit 0；以 Python 靜態擷取確認 SCN-001～SCN-008 各出現一次，README 核准表與本檔測試表集合完全相等，風險為 High 且兩份文件均列入 DEPLOYED_SKILL.md。此處僅驗證文件一致性，未執行產品測試；原 `review-4f96a47.md` 保留對舊版本的審查結論，不作為本次修訂已通過獨立覆核的證據。
