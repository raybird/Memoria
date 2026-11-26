# 審查報告
- 範圍：完整交付範圍（925d272..880740c）；分級 Medium、風險 Medium
- 增量覆審：上一份 review-c303bc6.md，增量範圍 7d57c95..880740c
- Reviewed BASE SHA：925d27202317134ea8cf8d89db424be9fdf292dd
- Reviewed HEAD SHA：880740ca56d2cd488d8dd1e6a0f6271137eea6eb
- Reviewed patch-id：c1c44a3c9919a5152906804650b3b6e1ea5ecfcd（`git diff 925d272 HEAD | git patch-id --stable`）
- 獨立 reviewer：Claude Code 隔離 subagent（不是原實作者，也不是前三份報告的 reviewer 對話）
- 核准基線：README `**核准 commit**` 是 fec4368。在 880740c 重跑推導命令（最後一個修改 `- **核准來源**` 行的提交）仍得到 fec43685891593f5449b16766f4ae177951dbdb6；`git diff fec4368 880740c -- docs/issues/issue-35/README.md` 只有 `## 現況`、`**核准 commit**` 的值、`**狀態**`、`## 待確認事項` 與 Timeline，Gherkin 劇本與核准紀錄沒有變動，原核准仍有效。
- 增量覆審的前提：c303bc6 是 880740c 的祖先，925d272..880740c 沒有 merge 提交，也沒有改寫歷史；`git merge-base main 880740c` 仍是 925d272。7d57c95 只保存上一份報告；880740c 只處理使用者選了修正的 N1、N2（TBD-11、TBD-12），沒有夾帶其他修改，所以照流程契約 2.8：新建議只限增量引入或增量改動到的內容。

## 問題與風險

### MUST FIX
無。

### SHOULD FIX
無。

### NICE TO HAVE
1. **補位測試的距離描述與舊程式碼的紅燈紀錄仍不正確**（`scripts/test-vector-recall.sh:871-875`、`docs/issues/issue-35/implementation-plan.md:20`、README TBD-12 的結論欄）。這一輪改寫了這幾句，所以在範圍內。錯誤的源頭是上一份報告 review-c303bc6 N2：它算 cosine 距離時只用了 `text`，但 `vector-ingest.mjs:50` 嵌入的是 `name + "\n" + text`（`note i\npangolin night survey i`）。這輪照它的說法改寫，把錯誤帶了進來。
   - 實測距離：helper 回的 10 列是 2 列 0.2333、8 列 0.2454。距離較近的 2 列是 note 1 的兩半（stub embedding 的 trigram 雜湊碰撞），其餘 4 則筆記的 8 列同距離。HEAD 與 14b4625 的 helper 輸出相同。所以「all 10 rows sit at one distance」與計畫的「stub embedding 下 10 列和查詢的距離完全相同」不成立。
   - 推論：前 5 列固定是 note 1 的兩列，再加上 8 列同距離中的 3 列，所以前 5 列是 3 或 4 則筆記，不可能是 5 則。
   - 舊程式碼實測：用 14b4625 原始碼（tsx）在 scratchpad 隔離資料根照測試步驟跑 6 次，補位那條是 3、3、3、4、4、3（預期 5，6 次全紅），被取代那條是 3、4、3、3、3、4（預期 4，4 次紅、2 次綠）。
   - 所以有三處要改：
     - 測試註解的「usually hold 3 or 4」實際上是固定 3 或 4；「the old count failed most runs rather than every one」應為每次都紅。這句是 c303bc6 寫的，這一輪改寫時保留了下來。
     - 計畫的「前 5 列偶爾含 5 則筆記，所以不是每次都紅」不成立，補位那條在舊程式碼上每次都紅。
     - 計畫的「（3、4 或 5）」應為 3 或 4。「實作時第一次測到 5，是紅燈」不可能是 14b4625 程式碼的結果。這個 5 和變異測試（計 `2 × top_k` 但不扣被取代的記憶）的值相同，可能來自實作途中的版本，這輪無法查證。被取代那條在舊程式碼上紅燈是出現 3 的時候。
     - README TBD-12 的結論欄也重述了「10 列同距離」「一次為 5 是紅燈」。
   - 影響：不影響測試真偽。HEAD 的斷言值正確，2 次 probe 都是補位 5、被取代 4。被取代那條的保護力以變異測試為準，這個說法仍成立。補位那條的紅燈證據其實比紀錄寫的更強。建議改法：不再描述距離是否全部相同，只寫「note 1 的兩列距離最近，其餘 8 列同距離，前 5 列固定是 3 或 4 則筆記，所以一定會補位，舊程式碼每次都紅」，並把被取代那條的舊值寫成「3 或 4，出現 3 時是紅燈」。

## 已查核維度

### 增量只動文件與註解
- `git diff 7d57c95 880740c` 的 9 個檔案逐行看過：AGENTS.md、兩份 API、兩份 CLI、architecture.md、`scripts/test-vector-recall.sh` 的 5 行 `#` 註解、issue-35 的 README 與 implementation-plan.md。沒有任何會改變執行結果的行，`src/` 沒有變動。
- `bash -n scripts/test-vector-recall.sh` 結果為 0，`pnpm run release:docs-check` 結果為 0（「Release doc sync check passed for v1.39.0」）。程式沒有變，所以沒有重跑整套測試。

### 上一份報告的建議逐項確認
- **N1（TBD-11）已修好。** 
  - 五份文件都不再列舉標籤值，改寫成要看 `vector_hits`、不要看 `route_mode`，理由是路由標籤在扣掉被取代的記憶之前就決定了。這和 `src/core/memoria.ts:756-761`（標籤依 `v.rows.length`、`keywordRaw.length` 決定）與 `:877-880`（`vector_hits` 之後才經 `applyMemoryAttributes` 扣掉）的順序一致。
  - API 文件說「`0` 可能搭配任何一個不屬於降級的 vector 模式標籤」。對照實作，這些標籤是 `keyword`（`v.rows` 為空）、`vector` 與 `hybrid_vector`（語意命中全部被取代時），三種都可能配 `0`。`skipped` 不會帶這個欄位，緊接的段落已另外寫明，不會被誤讀成其中一種。
  - API.md 與 API.zh-TW.md、CLI.md 與 CLI.zh-TW.md 的意思與語氣對等，上一份指出的「can read」和「會顯示」的差異隨列舉一起拿掉了。
  - architecture.md 已改成「contributed nothing」，並補上 `route_mode` 分不出這個情況。
  - API.md 那一行比前後行長，Markdown 算繪結果不受影響，不列為發現。
- **其他地方有沒有殘留列舉或「matched nothing」**：`src/cli/commands/recall.ts:62`、`CHANGELOG.md:8`、`scripts/test-vector-recall.sh:772` 都只說「`route_mode` 是 keyword 時為 0」，這個方向成立，上一份已判定。`src/core/types.ts`、`src/core/memoria.ts` 沒有這類說法。人讀說明行「語意查詢有執行，沒有命中」是 Gherkin 核准的文字，不在本輪範圍內。
- **N2（TBD-12）一部分修好。** 計畫已不再把 4、4、4、4 誤讀成被取代那條跑了 4 次，「紅綠看排序而定」的結論正確，保護力改以變異測試為準也正確。測試註解拿掉了和後文矛盾的「side by side」。但改寫時採用了上一份報告錯誤的「10 列同距離」，並把實作者記的 5 當成舊程式碼的紅燈，見 NICE TO HAVE 1。

### 增量範圍內每個檔案的結論
| 檔案 | 結論 |
|---|---|
| `AGENTS.md` | 和實作一致，不再列舉 |
| `docs/API.md`、`docs/API.zh-TW.md` | 和實作一致，中英對等 |
| `docs/CLI.md`、`docs/CLI.zh-TW.md` | 和實作一致，兩份內容相同 |
| `docs/agents/architecture.md` | 已改成 contributed nothing，和實作一致 |
| `scripts/test-vector-recall.sh` | 只改註解，語法檢查通過；距離與舊值的描述不正確（NICE TO HAVE 1） |
| `docs/issues/issue-35/implementation-plan.md` | 4、4、4、4 的誤讀已改正；距離與舊值的描述不正確（NICE TO HAVE 1）。任務狀態沒有變動 |
| `docs/issues/issue-35/README.md` | 只新增 TBD-11、TBD-12 與一列 Timeline。狀態都是合法的 `已解決`，結論、日期與去向寫在狀態欄，影響欄只寫驗收編號；整節沒有 `<`，每一行的行首都是 `\|`。Gherkin 與核准紀錄沒有動。TBD-12 結論欄的事實描述見 NICE TO HAVE 1 |

### 公開 repo 檢查
增量 diff 的新增行用 grep 搜尋本機路徑、使用者名稱與外部專案真名，沒有命中。

### 受影響之處
程式沒有變，沒有呼叫端或測試前提受到影響。文件描述和實作的對照已在上面逐處核對。

其餘沿用 review-c303bc6.md。

### 限制
- NICE TO HAVE 1 的舊程式碼數值，是把 14b4625 用 `git archive` 解到 scratchpad、以 tsx 照測試步驟跑 6 次 probe 得到的，沒有加進測試。HEAD 的對照只跑了 2 次 probe。
- 實作者原本記的「被取代時為 5」出自哪個版本，這輪無法查證。

## 流程判定
PASS

PASS 只適用於上列 Reviewed HEAD SHA；之後提交 README 記帳區段與本報告以外的檔案會讓它失效，提交前先告知使用者（review-evidence.md「審查之後的提交」）。
