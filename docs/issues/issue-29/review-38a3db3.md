# Issue 29 交付審查報告
- 範圍：完整交付 diff（issue 分支相對 main），重點是 e478053 之後的修正（7ff53f9、4fbab3f、9b7fb60、2e8b35c、38a3db3）
- Reviewed BASE SHA：a21ba4fa881f53b8586d6e4e64b9eb1e58b8bd50
- Reviewed HEAD SHA：38a3db37c4244572d252b6847f5d52cd0390fe24
- Reviewed patch-id：804845615e868cb7b5f4f883d262a152d7862498
- 獨立 reviewer：Claude 獨立 subagent（非實作者）
- Review artifact：docs/issues/issue-29/review-38a3db3.md
- 審查日期：2026-10-28

## 問題與風險

### MUST FIX

無。

### SHOULD FIX

無。

### NICE TO HAVE

- **N-A 包含判定沿用字面上的上層路徑往上找，不是真正的上層目錄；經別名「指進 canonical 子目錄」的 host 不會被重合檢查抓到**
  - 位置：`src/cli/runtime.ts:314-320`（`locateSkillPath` 以 `path.dirname` 逐層往上，對每一層做 `stat`）。
  - 實測：`CODEX_HOME=<link>`，其中 `<link>` 是 symlink，指向 `<canonical>/sub`。`skillPathsOverlap` 回 `false`，因為這條上層鏈裡只有 `<canonical>/sub` 的身分，沒有 canonical 本身。
  - 端對端：同一個情境下，`setup --agent codex` 被祖先 symlink 規則攔下（exit 1，訊息是「ancestor … exists and is not a directory」），資料根目錄沒有任何寫入。所以這個案例有既有規則兜底，不是缺陷。
  - 殘餘：換成 bind mount 指進 canonical 的子目錄時，既不是 symlink，往上找也找不到 canonical，任何依祖先鏈的做法都偵測不到。這個設定必須先在 canonical 裡自建子目錄再 bind 出去，非常刻意；後果是 `deployAgentSkill` 重建 canonical 時出現怪錯誤，不會刪到 canonical 之外的東西。
  - 文件：`DEPLOYED_REFERENCE.md:26` 把「compared by device and inode, so a bind mount … counts too」寫在包含判定的同一句裡，讀起來像包含關係也涵蓋 bind mount。實際上 bind mount 只能保證「同一個目錄」判得到。建議把那半句限縮成「同一個目錄」。
- **N-B dev:ino 用 Number 字串化**
  - 位置：`src/cli/runtime.ts:320`。
  - 影響：NTFS 的 64-bit file ID（以及少數 64-bit inode 的檔案系統）超過 2^53 後會失去精度，兩個不同目錄可能被判成同一個。只會造成誤拒（fail-closed），不會誤放。Windows 本來就列為未實機驗證。
  - 建議：改用 `fs.stat(p, { bigint: true })`，成本極低。
- **N-C 「寫入前拒絕」在兩份文件寫法不一致**
  - 位置：`DEPLOYED_REFERENCE.md:26`。
  - `docs/INSTALL.md:87` 已說明：預檢時還不存在的目錄只能比對路徑，要到部署刪除前才以實際目錄確認。也就是說，全新資料根目錄在不分大小寫檔案系統上的大小寫別名，會在初始化寫入之後才被拒絕。這個限制實作者已在 implementation-plan 揭露，但 DEPLOYED_REFERENCE 仍寫「before writing anything」。建議補上同樣的但書，或只在 INSTALL 保留細節、把 REFERENCE 的措辭放寬。
- **N-D N-3 測試在中斷時清不乾淨**
  - 位置：`scripts/test-setup-onboarding.sh:666-680`。
  - 正常流程沒有問題：`chmod 555` 與恢復之間只有被 `if` 包住的 `setup29`，失敗不會觸發 `set -e` 跳出；恢復權限的 `chmod -R u+w` 一定會執行，實測後 `locked/` 已回到可寫。只有在這段被外部中斷（Ctrl-C、逾時）時，trap 的 `rm -rf` 才會在唯讀目錄上失敗，留下暫存。若要更穩，可以在 `cleanup()` 裡先 `chmod -R u+w "$TMP_DIR"`。root 執行時跳過並印出原因，是合理的揭露。

## 已查核維度

### 驗收與證據

被測版本：HEAD `38a3db3`（`pnpm run build` 後執行）。紅燈另在 `e478053` 的暫時 worktree（`/tmp/claude-1000/i29-prev-wt`，已移除）重現，做法是放入 HEAD 的測試檔並建置；`e478053` 與 `4fbab3f` 的程式完全相同，所以這就是實作者所說的紅燈基線。

- **SCN-001、002、004、006、007、008**：這次只動到 N-3 失敗訊息與祖先檢查的順序，主流程沒變。HEAD 上 Step 6 全過，bootstrap 也全過，結論維持 [review-e478053](./review-e478053.md)：有效。
- **SCN-003**：新增兩項斷言。canonical 為 symlink 時，拒絕訊息必須點名路徑；ENOTDIR 祖先必須用「is not a directory」的祖先原因。後者在 e478053 是紅燈（舊訊息是「ENOTDIR: not a directory」，不含「is not a directory」），前者是既有行為，維持綠燈。結論：有效。
- **SCN-005（含 TBD-1 的範圍：dev＋inode 與互相包含）**：
  - 內圈：新增「拒絕來自重合護欄」的原因斷言（處理前次 N-4），以及 host 位於 canonical 之內的兩種狀態。後者在 e478053 是紅燈，已重現。
  - 外圈：host 在 canonical 之內，canonical 不存在時斷言資料根目錄未建立，已部署時斷言整個資料根目錄的快照不變。e478053 下 3 項失敗，已重現，含「nested-host run wrote into the data root」。
  - helper 的 8 個案例：在 e478053 上都因為函式尚未匯出而失敗，不能算行為證據，實作者的說明正確。我另外用舊的 `isSameSkillPath` 直接跑同樣 8 案，結果是 3 案錯誤（host 在已存在的 canonical 之內、host 在不存在的 canonical 之內、canonical 在 host 之內），其餘 5 案（經 symlink 祖先的同目錄兩案、host 連結、名稱前綴相同的兄弟目錄、無關目錄）舊邏輯本來就判對。「3 個行為紅燈、5 個回歸保護」的說法成立。
  - dev:ino 這條路徑（bind mount、大小寫別名）沒有紅燈，實作者已揭露無法以非特權建立；只能以程式推理確認。依 verification.md，揭露不構成缺失。
  - 結論：有效。
- **N-3（前次）**：外圈以 555 唯讀子目錄觸發刪除失敗，斷言錯誤訊息含備份路徑。e478053 下紅燈已重現。結論：有效，持久力見 N-D。

### `skillPathsOverlap` 正確性（重點 1）

以 18 個案例實測 HEAD 版本：8 個是實作者的 driver 案例，10 個是我另加的探針。除 N-A 之外全部符合預期。

| 情境 | 結果 |
| --- | --- |
| 兩邊都存在：相同、host 在 canonical 之內、canonical 在 host 之內 | 判為重合 ✔ |
| canonical 不存在：相同路徑、host 在其下、host 是它的不存在祖先 | 判為重合 ✔（以缺少的路徑元件比對前綴） |
| canonical 不存在：名稱前綴相同的兄弟目錄（`memoria2`） | 不重合 ✔（逐元件比對，不是字串前綴） |
| host 是指向 canonical 的 symlink，或 host 就是那個連結本身 | 不重合 ✔（最後一個元件用 `lstat`，正常情況不會誤判） |
| host 經 symlink 祖先指到 canonical 本身（`CODEX_HOME`→canonical） | 重合 ✔（`stat` 會跟隨，比對身分） |
| host 經 symlink 祖先指到 canonical 的子目錄 | 未判出（N-A），由祖先 symlink 規則兜底，端對端 exit 1 且零寫入 |
| host 為 `/`，或 `CODEX_HOME=/` | `/` 判為重合 ✔；`/skills/memoria` 不重合 ✔ |
| host 路徑中途被一般檔案擋住 | 不重合 ✔，之後由祖先規則拒絕 |
| 結尾斜線或 `.` | 判為重合 ✔（`path.resolve` 正規化） |
| Windows | 只有缺少的路徑元件轉小寫，已存在部分用身分比對，方向正確；未實機驗證（已揭露），另見 N-B |

部署時（`deployHostAgentSkill`）canonical 已經存在。bind mount 或大小寫別名讓 host 成為 canonical 本身時，`lstat` 回傳的身分相同，會在 `rm` 之前就丟出重合錯誤，前次 S-1 的核心風險已處理。

### 相關失敗面

| 輸入／狀態 | 預期 | 覆蓋 | 判定 |
| --- | --- | --- | --- |
| host 等於 canonical 或互相包含（字面路徑） | 寫入前拒絕 | 內外圈 | 通過 |
| host 是 canonical 的別名（bind mount、大小寫），canonical 已存在 | 刪除前拒絕 | 程式推理（無法非特權重現，已揭露） | 通過 |
| 同上，但全新資料根目錄 | 部署刪除前拒絕（初始化寫入之後） | 已揭露 | 可接受，文件見 N-C |
| 經別名指進 canonical 子目錄 | 拒絕 | symlink 由祖先規則兜底（實測）；bind mount 無法偵測 | N-A |
| 祖先位置是一般檔案 | 寫入前拒絕，訊息講祖先 | 內圈（N-2） | 通過 |
| 備份後刪除失敗 | 錯誤訊息附備份路徑 | 外圈（N-3） | 通過 |
| 正常 host 連結重跑、斷鏈修復、首次遷移 | 不被新的重合判定誤擋 | Step 6、bootstrap 全過 | 通過 |

### 需求、架構、安全、品質

- **需求**：TBD-1、TBD-2 的決策已記入 README `## 待確認事項`，實作與文件都照決策執行，SCN 文字沒有改動。
- **安全**：前次 S-1 的核心風險（別名 host 等於 canonical 時，canonical 被刪並形成自循環）在刪除前就會被擋下。新的包含判定只會讓 setup 拒絕更多情況，不會放寬任何既有拒絕；所有刪除仍只作用在 host 本身。
- **前次範圍有沒有被弄壞（重點 5）**：
  - 祖先檢查移到 `lstat` 之前（`runtime.ts:262`），canonical 模式與 host 模式的拒絕集合不變，只有 ENOTDIR 的訊息變了。
  - 舊的 `isSameSkillPath` 整個被取代，沒有殘留兩套重合判定。
  - `setup.ts` 改用 `canonicalSkillDir`，值與原本相同（`memoriaHome` 已是絕對路徑）。
  - 全部相關測試在 HEAD 都通過。
- **文件（重點 4）**：
  - INSTALL.md 與 DEPLOYED_REFERENCE.md 新增 S-2 提醒，與行為一致：經 host 路徑做的修改會寫進 canonical，下次 setup 不備份直接覆蓋，自訂內容請另建 skill。
  - 重合說明涵蓋互相包含，與實作一致；INSTALL.md 也已寫明預檢的限制。
  - 措辭小瑕疵見 N-A、N-C。
  - diff 中沒有外部專案名稱。
- **品質**：`SkillTargetMode` 型別與 `canonicalSkillDir` 的共用已處理前次 N-5。新 helper 約 25 行，責任單一，沒有過度設計。

### 豁免、待確認與限制

- 實作者已揭露（不構成缺失）：bind mount 與不分大小寫的別名無法以非特權建立，dev:ino 那條路徑只有程式推理；全新資料根目錄的大小寫別名要到初始化寫入後才被攔下；Windows junction 與大小寫比對、macOS `/tmp` 別名、真實宿主經 symlink 探索 skill，皆未實機驗證。
- 待確認事項：TBD-1、TBD-2 均已解決，沒有新的 `需決策`。

### 本次實際執行的命令（皆在 HEAD `38a3db3`，Linux、Node 22）

- `pnpm run check`：exit 0
- `pnpm run build`：exit 0
- `node dist/cli.mjs --help`：exit 0
- `bash -n scripts/test-setup-onboarding.sh`、`bash -n scripts/test-bootstrap.sh`：exit 0
- `node --import tsx scripts/setup-onboarding-driver.mts`：exit 0（0 項失敗，新增的 SCN-005、SCN-003 斷言全過）
- `bash scripts/test-setup-onboarding.sh`：exit 0（Step 6 全過，N-3 有執行）
- `bash scripts/test-bootstrap.sh`：exit 0
- `bash scripts/test-smoke.sh`：exit 0
- `bash scripts/test-npm-install.sh`：exit 0
- `pnpm run release:docs-check`：exit 0
- e478053 暫時 worktree 跑 HEAD 的 driver：exit 1，11 項失敗，與實作者紀錄一致（巢狀 2 項、未匯出 8 項、N-2 1 項）
- e478053 建置後只跑 HEAD 的 Step 6：exit 1，4 項失敗，與實作者紀錄一致
- 用探針腳本對舊 `isSameSkillPath` 與新 `skillPathsOverlap` 跑 8＋10 個案例：舊版 8 案中錯 3 案；新版只有 N-A 一案不符
- 隔離 HOME／MEMORIA_HOME 的端對端實驗（`CODEX_HOME` 是 symlink，指向 canonical 子目錄）：exit 1，資料根目錄零寫入
- 實驗目錄與 worktree 已清除

## 流程判定

PASS

沒有 MUST FIX 或 SHOULD FIX。前次的 S-1、S-2 依使用者決策處理完成，N-1～N-5 也都已處理。新增測試的紅燈與實作者說法一致，已在 e478053 獨立重現；SCN-001～SCN-008 與每個重要失敗面都有結論。剩下的 N-A～N-D 屬建議層級，不阻擋判定。
