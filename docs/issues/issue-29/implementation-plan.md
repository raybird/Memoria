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

1. ✅ **步驟 1 — 建立安全邊界與遷移的回歸保護網**
   - 產出：更新 `scripts/setup-onboarding-driver.mts`、`scripts/test-setup-onboarding.sh`、`scripts/test-bootstrap.sh`。
   - 相依：無。
   - 驗收編號：SCN-001～SCN-008。
   - 完成判準：
     - 主要實作前先驗證 SCN-003 的辨識矩陣及 SCN-005 的重合拒絕，涵蓋不存在與既有 canonical 的重合狀態；拒絕前資料根、設定、host 與外部內容均無寫入。
     - 既有負向案例保持綠燈；新部署、重連、空目錄轉換、斷鏈修復、舊實體副本遷移及不帶 `--agent` 更新，取得與缺少行為直接相關的紅燈。
     - 備份案例使用獨立建立的舊版實體目錄與自訂檔案，逐位元組比對備份；不把首次部署後的 symlink 當成舊實體 fixture 修改。
     - 內圈驗預檢判定，外圈驗 CLI 零寫入／連結／備份／launcher，分別記錄命令、結果與驗收編號；既有拒絕行為不要求人造紅燈。

2. ✅ **步驟 2 — 實作預檢、連結與舊版遷移**
   - 產出：`src/cli/runtime.ts`、`src/cli/setup-plan.ts`。
   - 相依：步驟 1 的風險保護測試已建立，且新行為紅燈原因已確認。
   - 驗收編號：SCN-001～SCN-008。
   - 完成判準：
     - 預檢與部署一致套用設計方案第 2 節，不放寬 canonical 的實體目錄要求。
     - 重合時在寫入前拒絕，空目錄能成功轉換，舊實體副本先完整備份；重連不新增備份、不修改舊 canonical。
     - SCN-001～SCN-008 的內外圈斷言全綠；完成範圍內精煉並記錄最終驗證，無需精煉則記 no-op 理由。

3. ✅ **步驟 3 — 常青文件與回歸驗證**
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

- [x] SCN-001～SCN-008 的核准來源已記於 README；修訂版核准 commit 已回填為 `a60c52a`
- [x] 步驟 1 安全保護網與新行為紅燈證據已建立
- [x] 各驗收具有效綠燈與精煉／no-op 證據
- [x] 修改 symbol 前跑 GitNexus impact，提交前跑 detect_changes
- [x] 常青文件與部署主模板已同步並通過驗證

## 本次規劃修訂查核

2026-10-23，基於 HEAD `4f96a47` 的未提交文件修訂：`git diff --check` exit 0；以 Python 靜態擷取確認 SCN-001～SCN-008 各出現一次，README 核准表與本檔測試表集合完全相等，風險為 High 且兩份文件均列入 DEPLOYED_SKILL.md。此處僅驗證文件一致性，未執行產品測試；原 `review-4f96a47.md` 保留對舊版本的審查結論，不作為本次修訂已通過獨立覆核的證據。

## 執行紀錄（2026-10-28）

被測基線：`main` `a21ba4f` 上的 `issue-29-host-skill-symlink` 分支工作區；Linux（Node 22），隔離 HOME／XDG／CODEX_HOME。

### 步驟 1 — 紅燈（實作前，`pnpm run build` 後以既有程式執行）

- **內圈**：`node --import tsx scripts/setup-onboarding-driver.mts` exit 1，issue-29 段 6 項失敗，原因都是缺少的新行為：SCN-002（絕對／相對 Memoria 連結）與 SCN-008（絕對／相對斷鏈）被既有規則以 symlink 一律拒絕（`expected false, got true`）；SCN-005 兩項（canonical 不存在／已部署）`assertSetupPlanSafe` 未偵測 host 與 canonical 重合。同段 SCN-003 七項拒絕（尾端不符的帶標記目標、尾端相符但無標記／一般檔案／另一層 symlink、`not.agents` 元件邊界、尾端不符的斷鏈、canonical 本身為 symlink）與 SCN-006 空目錄放行為既有行為，維持綠燈，未要求人造紅燈。
- **外圈**：`test-setup-onboarding.sh` 新增 Step 6（每案自建 Given 狀態、累計失敗後一次結束），單獨執行 exit 1，16 項失敗：SCN-001 三處（含自訂 CODEX_HOME）host 不是 symlink；SCN-002 重跑與切換 root 皆因 `refusing to overwrite …: it exists and is not a directory` 失敗；SCN-004 遷移後 host 不是 symlink（備份內容比對既有行為已通過）；SCN-005 兩種狀態都被接受且寫入資料根；SCN-006 兩 host 不是 symlink；SCN-007 host 讀不到 canonical 的舊內容（非連結）且更新後仍非連結；SCN-008 斷鏈被拒絕。SCN-003 六種外部連結與 canonical symlink 拒絕全數維持綠燈，且目標、外部內容逐位元組不變、資料根未建立。
- **bootstrap**：`bash scripts/test-bootstrap.sh` exit 1，停在 `✗ SCN-004: ~/.claude/skills/memoria is not a symlink to …/data-scn4/.agents/skills/memoria`；之前的 issue-22 SCN-006 手寫拒絕、SCN-003 不帶 `--agent` 不碰 host 維持綠燈。
- 備份案例使用獨立手建的舊版實體目錄（帶兩項標記的 SKILL.md 加自訂行、舊 DATA_ROOT、launcher、NOTES.md、內部相對 symlink），以快照（路徑、連結內容、SHA-256）與 `diff -r --no-dereference` 比對備份；不改首次部署後的連結當 fixture。

### 步驟 2 — 綠燈與精煉

- GitNexus impact：`assertHostSkillTarget`、`checkHostSkillTarget` 為 HIGH（上游為 `deployAgentSkill`、`deployHostAgentSkill`、`assertSetupPlanSafe` → `registerSetupCommand`，即 setup 全流程），`deployHostAgentSkill` 為 LOW；與本 issue 已核准的 High 風險範圍一致。canonical 預設模式規則不放寬，host 規則以獨立 `host` 模式加入。
- 實作：`src/cli/runtime.ts` 新增 `canonicalSkillDir`、`host` 模式（`checkManagedSkillLink` 依連結所在父目錄解析、三個路徑元件尾端比對、目標須為帶標記實體目錄或 ENOENT）、`lstatIfExists`（僅 ENOENT 視為不存在，其他錯誤回報 `cannot be inspected`）、`isSameSkillPath`（不跟隨最後一個元件，父路徑經最近既存祖先 realpath，Windows 比對忽略大小寫）；`deployHostAgentSkill` 刪除前重驗重合與 host 模式，依狀態 unlink／rmdir／完整備份後 rm，再以 `dir`（Windows `junction`）建立連結，JSON 步驟多回報 `link`。`src/cli/setup-plan.ts` 在寫入前拒絕 host 與 canonical 重合，host 以 `host` 模式預檢。
- 綠燈：driver exit 0（issue-29 段 14 項全過）；Step 6 單獨 exit 0；`test-bootstrap.sh`、`test-setup-onboarding.sh`、`test-smoke.sh` exit 0。手動確認拒絕訊息含路徑與原因（尾端不符：`it is a symlink to …, which is not a <data root>/.agents/skills/memoria directory`；重合：`refusing to deploy the codex skill to …: it is the data root's own skill directory …`）。
- 精煉：檢視 diff 後為 no-op——各 helper 單一用途；剩下的候選只有兩處重複的 mode 型別字面值與一個可內聯的區域變數，改了也不更清楚。沿用同一份綠燈證據。

### 步驟 3 — 常青文件與最終驗證

- 更新 `README.md`、`README.zh-TW.md`、`docs/INSTALL.md`、`DEPLOYED_SKILL.md`、`DEPLOYED_REFERENCE.md`：canonical／host 分工、首次實體副本遷移備份、重連與斷鏈修復不備份、空目錄、拒絕清單與路徑重合、不帶 `--agent` 更新同步。`docs/CLI.md`、`docs/CLI.zh-TW.md`、`docs/INTEGRATIONS.md`、`docs/INTEGRATIONS.zh-TW.md` 經查沒有描述 host skill 的部署形態（只有泛稱的 agent skills／deployed skill），不需修改。
- 依序執行（文件更新後重跑）：`pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`、`bash -n scripts/test-setup-onboarding.sh`、`bash -n scripts/test-bootstrap.sh`、`bash scripts/test-smoke.sh`、`bash scripts/test-bootstrap.sh`、`bash scripts/test-setup-onboarding.sh`、`bash scripts/test-npm-install.sh`、`pnpm run release:docs-check`，全部 exit 0。
- 限制：結果來自 Linux；Windows junction 與大小寫比對未實機驗證，macOS `/tmp` 別名的重合判定只有 source 層推理。真實宿主（Claude Code／Codex）經 symlink 探索 skill 未實機驗證。

### 審查 e478053 修正（2026-10-28，回 execute-task）

依 README 待確認事項 TBD-1（S-1 補 dev＋inode 比對，含 N-1）與 TBD-2（S-2 只補文件），順帶處理 N-2～N-5。被測基線：`4fbab3f` 之上的工作區。

- **紅燈**（`pnpm run build` 後以 `4fbab3f` 的程式執行新測試）：
  - 內圈 driver exit 1，11 項失敗。行為紅燈：host 位於 canonical 之內（canonical 不存在／已部署）被 `assertSetupPlanSafe` 放行（2 項）；ENOTDIR 祖先的拒絕訊息不含 `is not a directory`（N-2）。`skillPathsOverlap` 8 項因尚未匯出而失敗，不算行為證據；同一組 8 案以舊的 `isSameSkillPath` 執行，錯在「host 在已存在／不存在的 canonical 之內」「canonical 在 host 之內」3 案，另 5 案（經 symlink 祖先的同目錄別名兩案、host 連結、名稱前綴相同的兄弟目錄、無關目錄）舊邏輯已正確，作為回歸保護。
  - 外圈 Step 6 單獨執行 exit 1，4 項失敗：nested host 兩種狀態被接受且寫入資料根（N-1）；舊實體副本備份後刪除失敗時，錯誤訊息未附備份路徑（N-3，以 555 唯讀子目錄觸發，root 執行時略過並印出原因）。canonical symlink 拒絕訊息點名路徑（N-4 補斷言）為既有行為，維持綠燈。
  - **無法重現的部分**：S-1 原始情境（bind mount、不分大小寫檔案系統）在本機與 CI 無法以非特權建立（`unshare -rm` 回 `write failed /proc/self/uid_map: Operation not permitted`，`kernel.apparmor_restrict_unprivileged_userns = 1`）；改以 symlink 祖先代表「同一目錄的兩種寫法」，該案舊邏輯本來就判對，因此 dev＋inode 路徑沒有對應紅燈，只有 source 層推理。
- **實作**：`runtime.ts` 以 `skillPathsOverlap` 取代 `isSameSkillPath`：沿路徑取最深既存目錄與其上各層的 dev:ino，不存在的部分保留為路徑元件（Windows 小寫），判定相同或互相包含；最後一個元件用 lstat，host 連結不會被當成 canonical 本身。預檢與部署刪除前都用它，錯誤訊息改為 overlaps …（the same directory, or one inside the other）。`checkHostSkillTarget` 先做祖先檢查再 lstat（N-2）；備份後刪除失敗時拋出含備份路徑的錯誤（N-3）；`SkillTargetMode` 型別、`setup.ts` 改用 `canonicalSkillDir`（N-5）。GitNexus impact：`registerSetupCommand` LOW，其餘符號沿用前次結果。
- **文件**：`docs/INSTALL.md`、`DEPLOYED_REFERENCE.md` 補上「經 host 路徑的修改會寫進資料根那一份、下次 setup 不備份覆蓋，自訂請另建 skill 目錄」（S-2），以及重合判定涵蓋互相包含、以裝置與 inode 比對、預檢對尚不存在的目錄只能比對路徑。
- **綠燈**：driver exit 0（新增 11 項全過）；Step 6 單獨 exit 0；依序 `pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`、兩支 `bash -n`、`test-smoke`、`test-bootstrap`、`test-setup-onboarding`、`test-npm-install`、`pnpm run release:docs-check` 全部 exit 0。
- **精煉**：`isSameSkillPath` 的 realpath 字串比對整個由 dev:ino 判定取代，沒有留下兩套重合邏輯；其餘 no-op。
- **限制**：不分大小寫檔案系統上、預檢時兩邊都還不存在的大小寫別名，只能比對路徑字串而漏判；部署刪除前 canonical 已存在，會以 dev＋inode 攔下，但此時資料根已初始化。
