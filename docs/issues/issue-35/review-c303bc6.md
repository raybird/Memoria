# 審查報告
- 範圍：完整交付範圍（925d272..c303bc6）；分級 Medium、風險 Medium
- 增量覆審：上一份 review-c57fa47.md，增量範圍 b083dcf..c303bc6
- Reviewed BASE SHA：925d27202317134ea8cf8d89db424be9fdf292dd
- Reviewed HEAD SHA：c303bc6686a30589d612f62ca8b4de5315cb55be
- Reviewed patch-id：40d819249b3932147ecef5a1bf76def9bb1d40b2（`git diff 925d272 c303bc6 | git patch-id --stable`）
- 獨立 reviewer：Claude Code 隔離 subagent（不是原實作者，也不是前兩份報告的 reviewer 對話）
- 核准基線：README `**核准 commit**` 是 fec4368。在 c303bc6 重跑推導命令（最後一個修改 `- **核准來源**` 行的提交）仍得到 fec43685891593f5449b16766f4ae177951dbdb6；`git diff fec4368 c303bc6 -- docs/issues/issue-35/README.md` 只有 `## 現況`、`**核准 commit**` 的值、`## 待確認事項` 與 Timeline，Gherkin 劇本與核准紀錄沒有變動，原核准仍有效。
- 增量覆審的前提：c57fa47 是 c303bc6 的祖先，925d272..c303bc6 沒有 merge 提交，也沒有改寫歷史；`git merge-base main c303bc6` 仍是 925d272。b083dcf 只保存上一份報告與記帳；c303bc6 只處理使用者選了修正的 N1、N2（TBD-9、TBD-10），沒有夾帶其他修改，所以照流程契約 2.8：新建議只限增量引入的問題。

## 問題與風險

### MUST FIX
無。

### SHOULD FIX
無。

### NICE TO HAVE
1. **新文件只列了 `vector`，漏了 `hybrid_vector` 也會配 `vector_hits: 0`**（`AGENTS.md:255-256`、`docs/CLI.md:60`、`docs/CLI.zh-TW.md:60`；`docs/API.md:69-72`、`docs/API.zh-TW.md:66-69`）。這是這次增量引入的。`route_mode` 在 `runRoutes` 裡依 `v.rows.length` 和 `keywordRaw.length` 決定（`src/core/memoria.ts:756-761`），扣掉被取代的記憶是之後才做（`:877-880`）。所以語意命中全部被取代、但有字面命中時，結果是 `hybrid_vector` 配 `vector_hits: 0`，不只 `vector`。上一份報告 N1 也寫了這一點（「有字面命中時是 `hybrid_vector`」）。我用 HEAD 原始碼（tsx）實測：1 則只在語意索引命中的筆記，加 1 則字面命中的筆記，取代前 `route=hybrid_vector data=2 vh=1`，取代後 `route=hybrid_vector data=1 vh=0`，人讀輸出印「語意查詢有執行，沒有命中；列出的是字面查詢的結果」。這行說明是對的。問題在 AGENTS.md 與兩份 CLI 文件寫成「通常是 `keyword`，或者 `vector`」，看起來像只有這兩種值。兩份 API 文件用的是「can also read `vector`」，沒有說只有這兩種，但同樣沒提 `hybrid_vector`。可以改成「`vector` 或 `hybrid_vector`」。另外兩個小地方可以一起處理：API.md 寫「can read `keyword`」，zh-TW 寫「會顯示 `keyword`」，語氣不完全對等；`docs/agents/architecture.md:57` 仍寫「`0` tells "semantic ran, matched nothing"」，被取代的情況其實是有命中、只是沒有提供記憶。這兩處都沒有寫錯 `route_mode`。
2. **計畫步驟 2 對被取代那條斷言的新說明不正確，測試註解還留著一句互相矛盾的話**（`docs/issues/issue-35/implementation-plan.md:20`、`scripts/test-vector-recall.sh:871-873`）。這也是這次增量引入的，正好落在 N2 要修的地方。
   - 計畫寫「review-c57fa47 的 probe 測到 4、4、4、4，剛好等於預期，所以這條在舊程式碼上不會紅」。但上一份報告的「4、4、4、4」是 probe 在舊程式碼上跑四種情況各一次（補位、被取代、`--include-superseded`、全部被取代），不是被取代那條跑了四次。被取代那條只測過一次，得到 4。
   - 結論也不成立。舊程式碼的計數是 `collapseNoteHits(vectorOutcome.rows)`（14b4625 `memoria.ts:909`），`rows` 是 helper 排序的前 top_k 列（`recall-vector.ts:398`），不會扣掉被取代的記憶。所以舊值是前 5 列裡有幾則不同的筆記，可能是 3、4 或 5，只有剛好是 4 時才會綠燈。實作者原本記錄的「被取代時為 5」就是一次紅燈。正確寫法是「依排序而定，可能紅也可能綠」。
   - 測試註解保留了「a note's rows sit side by side」，接著又說前 5 列通常有 3 或 4 則筆記。如果同一則筆記的兩列一定相鄰，前 5 列就固定是 3 則，兩句互相矛盾。我用 stub embedding 算了這 5 則筆記的索引文字（`pangolin night survey 1`～`5`）和查詢的 cosine 距離，5 則全部是 0.076239569297。也就是說，10 列全部同距離，同分時誰先誰後不固定，才會出現 3、4、5 則。計畫的「同一則筆記的兩列距離相同」只說對了一半，可以改成「10 列全部同距離」。
   - 註解記的觀察值「3, 4 and 4 over three runs」和上一份報告的重現結果相符。「usually 3 or 4」與「failed most runs rather than every one」也和 10 列隨機排序的機率相符（3 則約 24%、4 則約 63%、5 則約 13%）。這些都不用改。
   - 這一項不影響測試的真偽。上一份報告的變異測試（拿掉 `applyMemoryAttributes` 後每次都是 5）仍然證明這條斷言抓得到缺陷，計畫也照實引用了這個結果。

## 已查核維度

### 增量只動文件與註解
- `git diff b083dcf c303bc6` 的 8 個檔案逐行看過：5 份文件、`scripts/test-vector-recall.sh` 的 3 行註解（`#` 開頭，不影響執行）、issue-35 的 README 與 implementation-plan.md。沒有任何會改變執行結果的行，`src/` 完全沒變。
- `bash -n scripts/test-vector-recall.sh` 結果為 0，`pnpm run release:docs-check` 結果為 0（「Release doc sync check passed for v1.39.0」）。程式沒有變，所以沒有重跑整套測試，上一份報告在 c57fa47 的測試結果適用於 c303bc6。

### 上一份報告的建議逐項確認
- **N1（TBD-9）大致修好。** 五份文件都不再寫「`0` 就是 `keyword`」，改成「0 表示有執行但沒有提供記憶」，API 文件也寫明了原因：`route_mode` 是在扣掉被取代的記憶之前決定的。這和 `memoria.ts:756-761` 與 `:877-880` 的順序一致。中英兩份的內容對等，語氣差異見 NICE TO HAVE 1。漏了 `hybrid_vector`，見 NICE TO HAVE 1。
- **其他地方有沒有殘留單向的說法**：`src/cli/commands/recall.ts:61-63` 的註解寫「route_mode stays `keyword` when the semantic route ran and matched nothing」，`CHANGELOG.md:8` 寫「`0` in that case」，兩處都只說「keyword 時是 0」，這個方向本來就成立。`src/core/types.ts:223-227` 沒有提到 `route_mode`。`docs/agents/architecture.md:57` 見 NICE TO HAVE 1。
- **N2（TBD-10）一部分修好。** 測試註解的觀察值與上一份報告相符，計畫「補位那條實際為 3 或 4」「重現 3 次為 3、4、4」都正確。被取代那條的說明與「side by side」見 NICE TO HAVE 2。

### 增量範圍內每個檔案的結論
| 檔案 | 結論 |
|---|---|
| `AGENTS.md` | 和實作一致，只是沒列 `hybrid_vector`（NICE TO HAVE 1） |
| `docs/API.md`、`docs/API.zh-TW.md` | 原因寫對，和實作一致，中英內容對等；沒提 `hybrid_vector`，語氣差異見 NICE TO HAVE 1 |
| `docs/CLI.md`、`docs/CLI.zh-TW.md` | 兩份內容相同，說明行的意思寫對；`route_mode` 只列了兩種值（NICE TO HAVE 1） |
| `scripts/test-vector-recall.sh` | 只改註解，語法檢查通過；觀察值正確，「side by side」和後文矛盾（NICE TO HAVE 2） |
| `docs/issues/issue-35/implementation-plan.md` | 補位那條的證據正確；被取代那條的說明不正確（NICE TO HAVE 2）。任務狀態沒有變動 |
| `docs/issues/issue-35/README.md` | 只新增 TBD-9、TBD-10 與一列 Timeline。狀態都是合法的 `已解決`，結論、日期與去向都寫在狀態欄，影響欄只寫驗收編號。整節沒有 `<`，每一行的行首都是 `\|`。Gherkin 與核准紀錄沒有動 |

### 公開 repo 檢查
增量 diff 裡沒有個人路徑、使用者名稱，也沒有外部專案的真名。

### 受影響之處
程式沒有變，沒有呼叫端或測試前提受到影響。文件描述有沒有和實作對上，已經在上面逐處核對。

其餘沿用 review-c57fa47.md。

### 限制
- NICE TO HAVE 1 的 `hybrid_vector` 情況是用 HEAD 原始碼（`pnpm exec tsx src/cli.ts`）在 scratchpad 隔離資料根跑的一次性 probe，沒有加進測試。
- NICE TO HAVE 2 說舊程式碼上「可能是 3 或 5」，是從 14b4625 的程式碼推論的，這輪沒有重建舊 bundle 重跑。

## 流程判定
PASS

PASS 只適用於上列 Reviewed HEAD SHA；之後提交 README 記帳區段與本報告以外的檔案會讓它失效，提交前先告知使用者（review-evidence.md「審查之後的提交」）。
