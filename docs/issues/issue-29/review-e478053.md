# Issue 29 交付審查報告
- 範圍：完整交付 diff（issue 分支相對 main）
- Reviewed BASE SHA：a21ba4fa881f53b8586d6e4e64b9eb1e58b8bd50
- Reviewed HEAD SHA：e478053f56e8fd09e2143fc8b0b41fc82f074af0
- Reviewed patch-id：20fca1420425f24725fa89ac1bef5b70b7d5dfcd
- 獨立 reviewer：Claude 獨立 subagent（非實作者）
- Review artifact：docs/issues/issue-29/review-e478053.md
- 審查日期：2026-10-28

## 問題與風險

### MUST FIX

無。

### SHOULD FIX

**S-1 重合護欄只比對路徑字串，路徑別名可繞過，並觸發本 issue 列為最大風險的「刪掉 canonical、建立自循環連結」**（`需決策`：要補護欄，或接受這個風險）
- 位置：`src/cli/runtime.ts:310`（`isSameSkillPath`）、`src/cli/runtime.ts:351`、`src/cli/runtime.ts:359-370`、`src/cli/setup-plan.ts:358`。
- 情境：host 路徑與 canonical 是同一個實體目錄，路徑字串卻不同。例如 Linux bind mount（容器裡把 `<dataRoot>/.agents` 另外掛到 `$CODEX_HOME`），或 macOS／Linux casefold 這類不分大小寫的檔案系統上設 `CODEX_HOME=<dataRoot>/.AGENTS`。`isSameSkillPath` 只對父目錄做 `realpath`，然後比對字串，bind mount 看不出來。大小寫是否被正規化取決於平台的 `realpath`，Windows 才有轉小寫。比對判為不同之後，host 的 `lstat` 會看到帶兩項標記的實體目錄（就是 canonical 本身），判成 `marked`，接著備份、`fs.rm` 刪掉 canonical，再在原位建立指向 canonical 路徑的 symlink，canonical 因此變成自我循環的連結。之後每次 `setup` 都會因為 canonical 是 symlink 而拒絕，必須手動清理。內容有備份，canonical 也能重新產生，所以不算使用者資料遺失。
- 現況：已核准的 SCN-005 與設計第 2 節只要求「正規化絕對路徑比對」，實作符合核准範圍，這是範圍外的殘餘風險。Linux 測試環境無法掛 bind mount（`unshare` 被拒），所以本次只以程式推理確認，沒有實機重現。
- 建議：`deployHostAgentSkill` 刪除前（必要時預檢也一樣），在兩者都存在時多比對一次 `fs.stat` 的 `dev`＋`ino`，相同就丟 `skillPathOverlapError`，約 3～5 行，會擋下所有別名。不補的話，請在 README `## 待確認事項` 記下接受這個風險。

**S-2 文件沒有告知「透過 host 路徑做的修改會被之後的 `setup` 無備份覆蓋」**
- 位置：`docs/INSTALL.md:89`、`skills/memoria-memory-sync/deployed/DEPLOYED_REFERENCE.md:7`；行為來源是 `src/cli/runtime.ts:375`（`writeSkillCopy` 先 `rm -rf` canonical）。
- 情境：issue-29 之前，使用者在 `~/.claude/skills/memoria/SKILL.md` 加上自己的觸發筆記，不帶 `--agent` 的 `setup` 不會碰到它，`setup --agent` 也會先備份（review 81bb75d M-1 的用意）。現在 host 是連結，同樣的修改其實寫進 canonical，之後對同一個資料根目錄跑任何 `setup`（包含不帶 `--agent`）都會直接覆蓋，不留備份。
- 判定：SCN-007 明確核准「更新 canonical 時不新增備份」，所以這不是程式缺陷。但文件只寫了「host 透過連結讀到新內容」，沒有寫反面後果，使用者無從得知自己的修改會消失。
- 建議：INSTALL.md 與 DEPLOYED_REFERENCE.md 各加一句：host 目錄是連結，透過它做的修改會在下一次 `setup` 時被覆蓋；自訂內容請放在別的 skill。若要改成「canonical 被改過時先備份」，那是修改 SCN-007，屬 `需決策`，reviewer 不建議在本 issue 擴大範圍。

### NICE TO HAVE

- **N-1 host 路徑在 canonical 之內時不拒絕，會在 canonical 裡建立自循環連結**。位置：`src/cli/runtime.ts:310`、`src/cli/setup-plan.ts:358`。實測 `CODEX_HOME=<root>/.agents/skills/memoria`：`setup --agent codex` exit 0，結果是 `<canonical>/skills/memoria -> <canonical>`。下一次不帶 `--agent` 的 `setup` 會把 canonical 整個重建，連結跟著消失，Codex 的 skill 就無聲失效，和 INSTALL.md「不會建立指向自己的連結」的說法有出入。設定本身很不自然，也沒有資料遺失。建議在重合判定中，把「一方是另一方的祖先」也當成重合。反方向（資料根目錄位於 host 目錄之內）實測會在寫入後才被 host 模式拒絕，exit 1，沒有刪除任何東西。
- **N-2 host 父路徑被一般檔案擋住時，錯誤訊息變差**。位置：`src/cli/runtime.ts:259`。`lstatIfExists` 在祖先檢查之前執行，`~/.codex/skills` 是檔案時會得到 `ENOTDIR`，訊息因此從 BASE 的「ancestor …/.codex/skills exists and is not a directory」變成「it cannot be inspected (ENOTDIR …)」。仍然在寫入前拒絕，只差在可讀性。建議先做祖先檢查再 `lstat`，或在 `ENOTDIR` 時改走祖先檢查的訊息。
- **N-3 備份完成後才刪除失敗，錯誤訊息沒有交代備份位置**。位置：`src/cli/runtime.ts:359-370`。實測舊實體目錄含唯讀子目錄時，備份完整，`fs.rm` 卻只刪掉一部分，接著丟出 EACCES。輸出只有錯誤，沒有備份路徑，留在原處的半刪目錄缺 SKILL.md，下次會被當成手寫目錄拒絕。這不是迴歸（BASE 的 `writeSkillCopy` 也是先 rm），但備份後的失敗訊息可以附上 `backup` 路徑。`link` 狀態下的 unlink 和 symlink 之間也有同樣的短暫窗口。
- **N-4 SCN-005 的斷言只檢查訊息裡有 canonical 路徑**。位置：`scripts/setup-onboarding-driver.mts:647`；外圈 `test-setup-onboarding.sh` 的 SCN-005 grep 也一樣。由於 host 路徑等於 canonical 路徑，任何一種 host 拒絕都會帶出這個路徑，斷言分不出拒絕的原因。目前不是假綠燈：BASE 下沒有任何錯誤，紅燈為真，而且外圈的「資料根目錄不存在」與完整快照比對能擋住寫入。這屬於證據持久力不足，建議改成也比對 `data root's own skill directory` 等原因字樣。另外，`refuse-canon` 案例（`scripts/test-setup-onboarding.sh:606`）沒有斷言輸出點名衝突路徑，SCN-003 的 Then 要求「印出衝突路徑與原因」。
- **N-5 小幅重複**：`src/cli/commands/setup.ts:221` 仍自行拼 `.agents/skills/memoria`，可改用 `canonicalSkillDir`（未改動的檔案，不必在本 issue 處理）；`'canonical' | 'host'` 型別字面值出現兩次。實作者把精煉判為 no-op 是合理的，以上都不影響正確性。

## 已查核維度

### 驗收與證據

被測版本：HEAD `e478053`（`pnpm run build` 後執行）。紅燈另在 BASE `a21ba4f` 的暫時 worktree（`/tmp/claude-1000/i29-base-wt`，已移除）重現，做法是放入 HEAD 的測試檔並建置 BASE。

- **SCN-001**：外圈 `test-setup-onboarding.sh` Step 6 涵蓋 `--agent both` 與自訂 CODEX_HOME，`test-bootstrap.sh` SCN-004 涵蓋 claude-code。斷言包括 canonical 為實體目錄、host 為指向 canonical 的連結、透過連結讀到的 SKILL.md 與模板逐位元組相同、DATA_ROOT 正確、launcher 實際執行。BASE 紅燈 3 處已重現（host 不是 symlink）。結論：有效。
- **SCN-002**：內圈涵蓋絕對與相對連結；外圈在同一個 root 重跑（一個絕對、一個相對連結），以及切換 root（舊 canonical 前後快照相同、兩邊都沒有備份），bootstrap SCN-005 另驗重跑不備份。Given 是手建連結，符合劇本描述。BASE 紅燈已重現：內圈 2 項；外圈 2 項，原因是「exists and is not a directory」。結論：有效。
- **SCN-003**：內圈 7 項，外圈 6 種連結加上 canonical 本身為 symlink。手寫目錄、單一標記、標記只在正文、一般檔案，由 bootstrap issue-22 SCN-006 的 refuse_case 涵蓋；祖先 symlink 由既有外圈 F-2 與 F-2 deep 經 CLI 涵蓋，走的就是 host 模式。零寫入的判準是目標父目錄與外部內容的快照、資料根目錄不存在。這些都是既有拒絕行為，BASE 下本來就是綠燈，計畫已說明不要求人造紅燈，合乎 verification.md。缺口見 N-4（canonical symlink 的訊息沒有斷言）。結論：有效。
- **SCN-004**：bootstrap 與外圈各自手建舊版實體目錄：兩項標記加自訂行、舊 DATA_ROOT、launcher、NOTES.md、內部相對 symlink。用 `diff -r --no-dereference` 或快照（路徑、連結內容、SHA-256）逐位元組比對備份，確認只有一份備份，之後 host 變成連結；另驗文字輸出印出備份路徑。BASE 紅燈已重現（遷移後不是 symlink）。快照不比對檔案權限位元，屬持久力層級的小事。結論：有效。
- **SCN-005**：內圈涵蓋 canonical 不存在與已部署兩種狀態；外圈不存在時斷言資料根目錄未建立，已部署時斷言整個資料根目錄（含 DB）的快照不變、canonical 仍為實體目錄。BASE 紅燈已重現：內圈 2 項；外圈 3 項，含「overlap run wrote into the data root」。結論：有效，別名殘餘風險見 S-1。
- **SCN-006**：內圈驗預檢放行；外圈兩個 host 都預建空目錄，結果轉為連結且沒有備份。BASE 紅燈已重現。結論：有效。
- **SCN-007**：外圈先竄改 canonical 的 SKILL.md、DATA_ROOT，並放一個 exit 3 的 launcher，確認兩個 host 讀得到這些舊內容（證明是連結），再執行不帶 `--agent` 的 setup。之後驗證模板、DATA_ROOT 與 launcher 都恢復，`readlink` 不變，也沒有備份。BASE 紅燈已重現。結論：有效。
- **SCN-008**：內圈與外圈都涵蓋絕對與相對斷鏈，修復後連到新的 canonical 且沒有備份；尾端不是 canonical 的斷鏈，內外圈都確認拒絕。BASE 紅燈已重現。結論：有效。

實作者的紅燈紀錄（內圈 6 項、外圈 16 項、bootstrap 停在 SCN-004）與本次在 BASE 重現的結果完全一致。HEAD 上全部綠燈。重構以 no-op 記錄並說明理由，符合 verification.md。執行紀錄寫的被測版本是「分支工作區」，沒有固定 SHA；本次已在 HEAD `e478053` 重跑全部相關測試，所以不影響判定。

### 相關失敗面

| 輸入／狀態 | 預期 | 現有覆蓋 | 判定 |
| --- | --- | --- | --- |
| 連結目標尾端只部分相符（`not.agents/skills/memoria`） | 以完整元件比對，拒絕 | 內圈 SCN-003 | 通過 |
| 相對連結，按 host 父目錄解析 | 能解析、放行或修復 | 內外圈 SCN-002／008 | 通過 |
| 連結目標是另一層 symlink | 拒絕 | 內外圈 SCN-003 | 通過 |
| 連結目標的中間元件是 symlink，或文字含 `..` | 以字面解析取尾端；只對 host 連結做 unlink，不碰目標內容 | 程式推理 | 可接受，判定結果與核心解析可能不同，但沒有破壞性 |
| host 祖先是 symlink | 拒絕 | 既有外圈 F-2／F-2 deep 經 CLI（host 模式） | 通過 |
| canonical 是 symlink | 兩種模式都拒絕 | 內外圈 | 通過 |
| `lstat` 回傳 ENOENT 以外的錯誤（ENOTDIR、EACCES） | 拒絕並回報 | 實測 ENOTDIR 會拒絕且沒有寫入 | 通過，訊息見 N-2 |
| 連結目標存在但不可讀，或缺 SKILL.md | 拒絕 | 程式推理（`readFile` 失敗時判為無標記） | 通過 |
| host 等於 canonical（不存在或已存在） | 寫入前拒絕 | 內外圈 SCN-005 | 通過 |
| host 與 canonical 經別名重合（bind mount、大小寫） | 拒絕 | 無，只靠字串比對 | S-1 |
| host 在 canonical 之內 | 拒絕 | 無；實測建立了自循環連結 | N-1 |
| 資料根目錄在 host 之內 | 拒絕 | 實測在寫入後才拒絕（exit 1），沒有刪除 | 可接受 |
| 兩個 host 解析到同一路徑（`CODEX_HOME=~/.claude`） | 第二次只重連 | 實測兩次都成功、沒有備份 | 通過 |
| 備份時 `fs.cp` 失敗（不可讀檔案） | 原目錄不動 | 實測 EACCES、原目錄完整、exit 1 | 通過（沒有自動化測試） |
| 備份後 `fs.rm` 中途失敗 | 備份完整，回報清楚 | 實測備份完整、原目錄被刪掉一部分、訊息沒有備份路徑 | N-3（非迴歸） |
| 刪除路徑 unlink／rmdir／rm | 只刪 host 自身；rmdir 不會刪非空目錄；rm 不跟隨內部連結 | 程式檢視 | 通過 |
| 預檢與部署之間的 TOCTOU | 部署時重驗重合與 host 模式 | 程式檢視 | 本機 CLI 可接受 |
| JSON 步驟記錄多了 `link`，文字輸出 `previous copy backed up to` | 向後相容，只新增欄位 | bootstrap 解析 JSON 的 backup、grep 文字輸出 | 通過 |

### 需求、架構、安全、品質

- 需求：辨識規則（三個完整元件的尾端、目標必須是帶兩項標記的實體目錄或 ENOENT）、canonical 必須是實體目錄、只有 ENOENT 代表不存在、空目錄與帶標記目錄的處理、備份時保留內部 symlink，都與設計第 2、3 節一致。預檢（`assertSetupPlanSafe`）與部署（`deployHostAgentSkill`）共用同一個 `assertHostSkillTarget(…, 'host')` 與 `isSameSkillPath`，沒有雙重規則。
- 安全：所有刪除只作用在 host 路徑本身。`marked` 狀態先 `cp` 成功才 `rm`；連結狀態只 `unlink`，舊目標不動。殘餘風險見 S-1、N-1。
- 架構：改動侷限在 `src/cli/`，沒有碰 core；`setup.ts` 未修改就接得上新的回傳值。
- 文件：README、README.zh-TW、INSTALL、DEPLOYED_SKILL、DEPLOYED_REFERENCE 的描述與實作一致（重連不備份、空目錄、首次遷移備份、拒絕清單、重合拒絕、不帶 `--agent` 同步）。逐檔 grep `docs/CLI*.md`、`docs/INTEGRATIONS*.md`，只有一行泛稱的 `setup --agent both` 指令範例，沒有描述部署形態，計畫說不需修改是成立的。`docs/HANDOVER.md` 是版本歷史，不必改。缺少修改會被覆蓋的提醒，見 S-2。公開 repo 代稱規則：diff 中沒有外部專案名稱。
- 跨 Task 重複與過度設計：bootstrap 與 onboarding 都建了一份 SCN-004 的舊版 fixture，這是計畫測試策略明訂的雙層覆蓋，可以接受。helper 都只做一件事，沒有過度設計。重複項見 N-5。

### 豁免、待確認與限制

- 實作者已揭露的限制（不構成缺失）：Windows junction 與大小寫比對沒有實機驗證；macOS `/tmp` 別名的重合判定只有程式推理；真實宿主（Claude Code／Codex）透過 symlink 探索 skill 沒有實機驗證。
- 本次 reviewer 的限制：bind mount 別名無法在本機掛載（`unshare` 被拒），S-1 只以程式推理確認。macOS 的 `realpath` 是否正規化大小寫沒有實機確認。
- 待確認：S-1 要補 dev/ino 護欄，還是接受風險（`需決策`）。S-2 若要改成「canonical 被改過時先備份」需修改 SCN-007（`需決策`，reviewer 建議只補文件）。

### 本次實際執行的命令（皆在 HEAD `e478053`，Linux、Node 22）

- `pnpm run check`：exit 0
- `pnpm run build`：exit 0
- `node dist/cli.mjs --help`：exit 0
- `bash -n scripts/test-setup-onboarding.sh`、`bash -n scripts/test-bootstrap.sh`：exit 0
- `bash scripts/test-bootstrap.sh`：exit 0
- `bash scripts/test-setup-onboarding.sh`：exit 0（Step 6 全過）
- `node --import tsx scripts/setup-onboarding-driver.mts`：exit 0（issue-29 段 14 項全過）
- `bash scripts/test-smoke.sh`：exit 0
- `bash scripts/test-npm-install.sh`：exit 0
- `pnpm run release:docs-check`：exit 0
- BASE `a21ba4f` 暫時 worktree，放入 HEAD 的 driver：exit 1，issue-29 段 6 項失敗（SCN-002×2、SCN-008×2、SCN-005×2），與實作者紀錄一致
- BASE 建置後只跑 HEAD 的 Step 6：exit 1，16 項失敗，與實作者紀錄一致
- 隔離 HOME／MEMORIA_HOME 的手動實驗（ENOTDIR、host 在 canonical 之內、資料根目錄在 host 之內、兩個 host 同路徑、備份失敗、刪除中途失敗）：結果如上表，實驗目錄已清除

## 流程判定

PASS

沒有 MUST FIX；SCN-001～SCN-008 都有有效的紅燈與綠燈證據，紅燈已在 BASE 獨立重現；每個重要失敗面都有覆蓋結論。S-1、S-2 屬建議層級，其中 S-1 要補護欄或接受風險、S-2 若要改行為，都需要使用者決定（`需決策`），兩者都不阻擋本次判定。
