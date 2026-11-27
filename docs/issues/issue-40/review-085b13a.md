# 審查報告
- 範圍：完整交付範圍
- Reviewed BASE SHA：3b2a32c4bba74f02cd8723fdb2b37121dcd3cc73
- Reviewed HEAD SHA：085b13ad753c9fdfde4705236479a434d5c8d691
- Reviewed patch-id：f34f92566dcd30f06a81ed3d53bd950d1c09fc01
- 獨立 reviewer：Claude Code 隔離 subagent（Claude Opus 5.5），未參與 issue-40 實作，也不是 review-095652d 的作者
- 增量覆審：上一份報告 review-095652d.md，增量範圍 `095652d..085b13a`（處理 PASS 建議後的增量覆審）

## 問題與風險

MUST FIX：無

SHOULD FIX：
- S1 `docs/issues/issue-40/README.md:62`：review-095652d S4 只修了一部分。S4 點名的三行裡，步驟 2（`:65`）與步驟 3（`:68`）補上了命令、exit code 與精煉結果，步驟 1 的紅燈證據（`:62`）仍然只有腳本名稱與結果摘要，沒有實際命令與 exit code。這次新增的兩個斷言（consolidate、AC-1 反方向）的紅燈也只在 TBD-3 寫了「兩者以舊程式都失敗」，沒寫怎麼跑、在哪個提交上跑。reviewer 已獨立重現兩者的紅燈（見「驗收與證據」），所以不算缺證據，只是寫法還不完整，屬 issue 文件的寫法問題。建議在步驟 1 補上命令與 exit code，並加一句新斷言紅燈的跑法。要注意的是：新斷言前面還有 issue-40 的其他斷言，在舊程式上會先失敗，整支腳本跑不到新段落。所以證據要寫成「只跑該段」或「跳過前段」的形式，否則 exit 1 證明不了新斷言本身會紅。

NICE TO HAVE：
- N1 `docs/issues/issue-40/README.md:77`：TBD-4 寫使用者回「照建議」、S3 修正。但 review-095652d 對 S3 建議的是 (a)，也就是記在記帳區段。實際做的是 (b)：在 `## 驗收條件` 補上 `**核准 commit**`。這樣做本身沒問題：N5 要改的也是凍結章節，本來就要重審，(b) 的缺點已經不存在，而且欄位放在 acceptance.md 規定的位置。只是讀者對照上一份報告時會覺得兩邊對不上。可以補半句說明：因為 N5 本來就要重審，所以改採 (b)。

## 已查核維度

- 驗收與證據：
  - 上一份報告選了修正的建議，逐項確認結果：
    - S1：已修好。`scripts/test-prune.sh:235-262` 新增 consolidate 段，`CHANGELOG.md:8` 補上 consolidate 的行為改變。
    - S2：已修好。`scripts/test-utility-ranking.sh` (E) 補上反方向，做法是把 session 時間調早一年，讓 recall 留下 `noteev-`，再只對 `note-` 回報 0。前提檢查涵蓋三件事：調早確實寫入、留下的是 `noteev-`、回報後留下的那一半不變。
    - S3：已修好，`README.md:47` 補上 `**核准 commit**: dc1f192`（做法說明見 N1）。
    - S4：部分修好，見本報告 S1。
    - N1：已修好。`scripts/test-cli-memory.sh:438` 的失敗訊息改成以時間戳說明。
    - N4：已修好。`CHANGELOG.md:11` 補上依欄位相加、explicit 覆蓋兩半、brief 只算 explicit 次數這三點。reviewer 對照 `src/core/utils.ts:164` 的 `effectiveUtility`，以及 `src/core/db/brief.ts:253` 的 `observationsOf`，描述都與程式相符。
    - N5：已修好，`README.md:56` 改為指向步驟 1。
    - N2 照使用者決定不修，N3 照使用者決定記入 TBD-5，兩者都不在本輪查核範圍。
  - 新斷言抓不抓得到錯誤：reviewer 在暫時的 detached worktree（BASE 3b2a32c）放入 HEAD 的兩支測試腳本，build 之後以 `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME` 前綴執行。
    - 整支 `test-prune.sh` 會在既有的 issue-40 stale 段先 exit 1，跑不到新段。另外只取檔頭加 consolidate 段單獨執行，結果 exit 1，輸出「consolidate 應留下效用記在 noteev-nold 的 node:nold，實得 ["node:nnew"]」，與 CHANGELOG「留最新那則」的描述一致。
    - `test-utility-ranking.sh` 先把 (E) 原 AC-1 與 AC-4 兩個斷言的 `exit 1` 改成繼續執行，再跑反方向。舊程式上 AC-4 段也會失敗，原因是舊的收合會改留另一半。反方向的三個前提都成立，斷言 exit 1，比值 0.6011253171 → 0.6011253009（約 1.0），輸出「AC-1 反方向：效用記在 note- 時，留下的 noteev-… 沒有被加權」。
    - 結論：兩個新斷言在舊程式上都會失敗，而且失敗的是目標行為本身，不是前提。
  - 錯誤注入：reviewer 在 HEAD 的暫時 worktree 把 `mergeNoteUtility` 改成只往 `note-` 方向傳（`src/core/utils.ts:207` 的 `notePairOf(row.ref_id)` 換成 `keyOf(row.ref_id)`）。`test-utility-ranking.sh` exit 1，在 (E) 的 AC-4 段就失敗了。所以合併只做單一方向時，(E) 段抓得到。
  - 在 HEAD 執行（前綴同上），以下都 exit 0：`pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`、`pnpm run release:docs-check`；`test-prune`、`test-utility-ranking`、`test-cli-memory`、`test-pure-functions`、`test-brief-scope`。HEAD 上的輸出包括「consolidate 留下效用記在 event 那一半的最舊子節點 node:nold」，以及「反方向留下 noteev-18cbbc189e31f592 時同樣乘 0.5」。
- 相關失敗面：
  - consolidate 段的 fixture 有三個子節點，沒有效用時會留最新的 `nnew`。效用 explicit 0.9 只記在最舊那則的 `noteev-nold`，經「節點 → `memory_node_sources` 的 `note-nold` → pair」的路徑才查得到。測試直接斷言留下的子節點集合等於 `['node:nold']`，留錯或多留都會失敗。
  - 反方向段用 `note-${FIRST#*-}` 取得 session id，指紋是十六進位、不含 `-`，這樣取沒有問題。前提不成立時（例如首筆不是筆記、調早沒有寫入）會以「前提」訊息失敗，不會變成假綠燈。
  - test-cli-memory.sh 只改了失敗訊息，斷言沒變。
- 需求、架構、安全、品質：
  - 增量沒有改 `src/`，所以 review-095652d 對程式的結論都不受影響。
  - README `**核准 commit**: dc1f192` 是新增的欄位行，`## 驗收條件` 的 AC-1～4 內文沒變。`git diff dc1f192..085b13a` 裡，這一節只多了這一行。依 acceptance.md 的推導（最後一個修改 `**核准來源**` 行的提交），基線也是 dc1f192，所以核准沒有失效。`## 現況` 位在 `## 概述` 之後，這是 8b908bc 的記帳提交加的。
  - `docs/OPERATIONS.md:58` 補上「stale 豁免與 consolidate 保留都用相加後的效用」，與 `orderChildrenForRetention` 經 `loadUtilityMeans` 的路徑相符。
  - `git diff 095652d..085b13a` 裡沒有個人絕對路徑或外部專案真名。
- 本輪重新查核的項目與理由：增量變動的 7 個檔案都已逐一給結論，包括已保存的舊報告 review-095652d.md（記帳，內容未改）。另外重新查核兩件事：新斷言在舊程式上會不會紅，以及 CHANGELOG 與 OPERATIONS 的新描述和程式是否相符，因為它們都是本輪新增的說法。增量沒有改程式，AC-1～4 的實作結論、失敗面分析與其餘回歸沿用 review-095652d.md。
- 豁免、待確認與限制（只寫本輪新增的）：
  - 沒有新增的 Gate 豁免。TBD-3～5 是使用者對上一份建議的結論，已列在 README。
  - 限制：在舊程式上驗證新斷言時，必須跳過前面會先失敗的斷言，所以「新斷言會紅」是在改過的腳本副本上證明的，分支上的腳本沒有這種單段執行的入口。本輪沒有重跑五組 CI 的其餘腳本，因為增量沒有改程式，沿用上一份報告與 README 步驟 3 的紀錄。
  - 兩個暫時 worktree 都已移除，工作分支的檔案與提交沒有動。最後在 HEAD 上重新 `pnpm run build`，`dist/` 與 HEAD 原始碼一致。
  - 保存本報告的提交，要把 README `## 現況` 的 `**現行 review**` 改成 review-085b13a.md。

## 流程判定
PASS

PASS 只適用於上列 Reviewed HEAD SHA；之後提交 README 記帳區段與本報告以外的檔案會讓它失效，提交前先告知使用者（review-evidence.md「審查之後的提交」）。
