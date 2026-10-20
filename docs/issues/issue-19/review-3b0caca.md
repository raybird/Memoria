# Review — issue-19 embedLocal 分批（第二輪，3b0caca）

- **報告位置**：`docs/issues/issue-19/review-3b0caca.md`
- **審查日期**：2026-10-20
- **Reviewed BASE SHA**：`ac76109`（docs(issue-19～22): 回填核准紀錄的核准 commit）
- **Reviewed HEAD SHA**：`3b0caca`（分支 `issue-19-embed-batching`；BASE..HEAD 為 `b968c23`、`64c6cfd`、`3b0caca` 三個提交）
- **Reviewed patch-id**：`1fa1b910baeec5d16da82f6ddfd577846d4d028e`（`git diff ac76109 3b0caca | git patch-id --stable`）
- **獨立 reviewer 識別**：Claude subagent（general-purpose，未參與實作）
- **判定**：`PASS`

## 審查範圍與風險

完整範圍 `ac76109..3b0caca` 改了 5 個檔案，+223／−16：

| 檔案 | 本輪（`b968c23..3b0caca`）的變化 |
| --- | --- |
| `skills/memoria-vector/embed.mjs` | `const batchSize = texts.length > 1 ? resolveBatchSize() : 1`，並改寫註解裡的峰值數字（S-2、S-4） |
| `scripts/pure-fn-driver.mts` | 加入記錄 pipeline 輸入的陣列，新增 4 條查詢路徑斷言（S-1、S-2） |
| `skills/memoria-vector/README.md` | `MEMORIA_EMBED_BATCH` 說明改成單一行程約 2.5GB，並註明單筆查詢不讀這個變數（S-4） |
| `docs/issues/issue-19/README.md` | 修訂 AC-2 的檢查方式與核准來源，新增 TBD-3，更正 AC-3 的論證（S-3），補 Timeline |
| `docs/issues/issue-19/review-b968c23.md` | 新增上一輪報告（`64c6cfd`，只有文件） |

`git diff --stat ac76109 3b0caca -- src scripts/*.sh .github package.json skills/memoria-vector/package.json` 是空的。TS 原始碼、測試腳本、CI 與依賴都沒有動。

這輪的主要風險是查詢路徑（`vector-recall.mjs` → `embedTexts([query], 'query')`）。單筆分支一旦改錯，語意召回可能靜默降級，或把錯的字串送進模型。reviewer 重跑 GitNexus `impact(embedLocal, upstream)`，結果是 LOW：d=1 只有 `embedTexts`，d=2 是 `vector-recall.mjs` 和 `vector-ingest.mjs`，受影響的流程 0 條，和前輪一致。

## 證據（reviewer 重跑）

全部在 `3b0caca` 的 detached worktree 內執行。repo 根目錄的 `node_modules` 以 symlink 接到既有安裝；真實模型那一步臨時把 helper 的 `node_modules` symlink 到既有安裝，跑完就還原。worktree 用完已 `worktree remove --force`。整個過程沒有寫入任何向量庫：真實模型那一步只呼叫 `embedTexts`，不跑 ingest，而且清除了 `LIBSQL_URL`。`~/.memoria` 也沒有碰。主工作區審查前後的 `git status` 相同。

| # | 命令／操作 | 結果 |
| --- | --- | --- |
| E1 | `env -u LIBSQL_URL -u MEMORIA_HOME pnpm run check` | exit 0 |
| E2 | `pnpm run build`；`node dist/cli.mjs --help` | `✓ Built dist/cli.mjs`，help 正常 |
| E3 | `env -u LIBSQL_URL -u MEMORIA_HOME bash scripts/test-pure-functions.sh` | `[pure] embedLocal batching` 11 條 ✓（AC-1 的 7 條加上查詢路徑 4 條），`[pure] ok`，exit 0 |
| E4 | `env -u LIBSQL_URL -u MEMORIA_HOME bash scripts/test-vector-recall.sh` | `[vector] ok`，exit 0 |
| E5 | 變異檢查（每次只改 `embed.mjs` 一處，跑 E3 後還原） | 見下表 |
| E6 | 邊界探針（假 pipeline，`MEMORIA_EMBED_PROVIDER=local`） | 見失敗面表 |
| E7 | 真實模型（`systemd-run --user --scope -p MemoryMax=6G`，不設 `LIBSQL_URL`）：同一句中文 query，分別用 `ac76109` 版 `embed.mjs`（未設 env）和 HEAD 版（`MEMORIA_EMBED_BATCH=abc`）embed | 兩邊都是 384 維，cosine 1.000000；在 HEAD 上，兩筆 passage 配 `abc` 會丟出 `MEMORIA_EMBED_BATCH must be a positive integer, got 'abc'`；exit 0 |

E5 變異結果：

| 變異 | 結果 |
| --- | --- |
| M1 拿掉 `texts.length > 1` 條件（一律 `resolveBatchSize()`） | ✗ 2 條：`an invalid MEMORIA_EMBED_BATCH does not break a single query`、`the query still yields one vector: expected 1, got 0` |
| M2 條件改成 `>= 1` | 同 M1，✗ 2 條 |
| M3 query 前綴改成 `'query:'` | ✗ `the query reaches the model as the literal ["query: q"] … got ["query:q"]` |
| M4 query 改用 `'passage: '` 前綴 | ✗ 同一條，`got ["passage: q"]` |
| M5 查詢多呼叫一次 pipeline（模擬查詢被拆成多次呼叫） | ✗ `a query is one pipeline call: expected 1, got 2` |
| M6 查詢文字逐字元切開，每塊各呼叫一次 | **全綠（抓不到）**：測試用的 query 是單一字元 `'q'`，逐字元切開仍是一塊（N-2） |
| M7 `embed.mjs` 換回 `b968c23` 版本（修正前） | ✗ 2 條，和 README 記的紅燈訊息相同 |

## 失敗面

| 失敗面 | 輸入／狀態 | 預期 | 實測（E6／E7） | 結論 |
| --- | --- | --- | --- | --- |
| 0 筆 | `[]`，env 為 `abc` 或未設 | 回 `[]`，0 次呼叫，不丟錯 | `0 vectors, 0 calls` | 通過。修正前非法值會在 0 筆時丟錯，現在不會；`vector-ingest.mjs` 遇到 0 筆實體本來就提早 `exit 0`，呼叫端行為不變 |
| 1 筆 query | env 未設、`-3`、`abc` | 1 次呼叫，輸入 `["query: …"]` | 每種都是 `1 vectors, 1 calls`；真實模型 cosine 1.000000 | 通過。查詢路徑與 `ac76109` 等價，也恢復了 AC-2 的字面門檻（改動前查詢不讀這個變數） |
| 1 筆 passage（ingest 只有 1 個可 embed 的實體） | env 為 `abc` 或 `0` | （設計上的取捨，見下段） | `1 vectors, 1 calls`，不報錯 | 可接受，但 TBD-3 結論的措辭講過頭了（N-1） |
| 多筆 passage，env 非法 | 2 筆配 `abc` | 點名變數丟錯 | 丟錯（假 pipeline 與真實模型都是） | 通過，ingest 端仍會大聲失敗 |
| 多筆 passage，合法值 | 2 筆配 `1`、33 筆未設、70 筆配 32／50 | 依批次切分，順序不變 | `[1,1]`、`[32,1]`、`32/32/6`、`50/20` | 通過，AC-1 沒有被破壞 |

**ingest 只有 1 筆時忽略非法值，可以接受嗎？** 可以。批次大小只決定怎麼切輸入，而 1 筆輸入在任何批次大小下都只會呼叫一次、產生完全相同的向量，所以忽略這個值不會導致任何錯誤結果或靜默錯配。代價只是設定錯誤晚一點才會被發現：`run-sync-with-enhancement.sh` 每次 sync 的 payload 可能很小，非法值可能連續幾次都沒有被發現，直到出現 ≥2 筆實體時才報錯。報錯時會點名變數，屬於延遲的大聲失敗，不是靜默變差。和 S-2 想排除的「查詢靜默降級」相比，這個取捨合理，也就是 reviewer 上一輪建議的 (b)。要做到「ingest 端一律驗證」，可以改用 `kind === 'passage' || texts.length > 1` 當條件，但這不在 TBD-3 的核准範圍內，只列為 NICE TO HAVE。

## 驗收核對（`3b0caca:docs/agents/acceptance.md`）

- **AC-2 檢查方式的修訂**：原檢查方式只有 `test-vector-recall.sh`。修訂後加上 `test-pure-functions.sh` 的查詢路徑斷言，原本那支腳本仍保留，並註明它只負責 `embedLocal` 以外的部分。檢查變嚴、範圍變大，沒有放寬。
- **行為門檻有沒有改**：門檻仍是「`vector-recall.mjs` 的單筆查詢行為不變」。失敗路徑新增「ingest 專用的設定讓查詢丟錯」，但這不是新門檻：`ac76109` 的查詢完全不讀 `MEMORIA_EMBED_BATCH`，「非法值不影響查詢」本來就包含在「行為不變」的字面意思裡。反過來看，`b968c23` 其實違反了這條門檻，上一輪 S-2 已經指出。所以這次修訂把檢查方式補齊到門檻本來就要求的範圍，沒有增刪條件。依 acceptance.md 的〈規格修訂的查核〉，原核准仍然有效。
- **核准來源與 TBD-3**：acceptance.md 規定回答「照建議」就是接受該題的建議答案，核准來源要記原話、日期、題號、建議內容與對應驗收編號。README 都記了：原話「一律都照建議」、2026-10-20、TBD-3、建議 (b)、AC-2。TBD-3 的三個選項沿用上一輪報告的 (a)/(b)/(c)，狀態是「已解決」，結論與日期齊全，核准來源那一行也補了修訂說明，Timeline 有兩筆紀錄。**合規**。原話本身出自對話，reviewer 無法直接驗證，這裡以 README 的紀錄為準。
- **核准 commit**：仍是 `a79d3be`。修訂不屬於實質改變，所以不必更新基線。不過之後跑 `git diff a79d3be -- README.md` 時會看到 AC-2 的文字差異，查核者得讀修訂註記才知道它已核准。註記裡補上修訂所在的提交會更好（N-3）。

## 上一輪發現的修正狀況

| 項目 | 狀態 | 依據 |
| --- | --- | --- |
| S-1 AC-2 的檢查命令測不到被改的程式 | **已修正** | 新斷言 `a query is one pipeline call`、字面值 `["query: q"]`；M3、M4、M5 都能抓到。README 也刪掉了「這條覆蓋最大風險」的過度宣稱 |
| S-2 非法 env 會讓查詢壞掉（`需決策`） | **已修正，依 TBD-3 採 (b)** | M1、M2、M7 會紅；E6 與 E7 證實單筆查詢不讀這個變數，多筆時照樣報錯 |
| S-3 AC-3 的「1.7 倍」論證錯誤 | **已修正** | 改成 payload 1310 筆、略過 530 筆、實際 embed 780 筆，「不隨筆數線性成長」改引 E9 的 2534336／2556952／2556552 kB，和上一輪 E9 的數字逐字相符 |
| S-4 峰值數字寫錯 | **已修正（helper README 與 `embed.mjs` 註解）** | 兩處都改成單一行程約 2.5GB、400～1600 筆持平，和 E9 一致。issue README 的 D3 理由欄還留著沒加限定的「32 筆實測峰值 1.4GB」（N-4） |

## 前輪通過部分與 gate

- AC-1 的 7 條斷言沒有改，仍然全綠（E3）。修正只改了 ≤1 筆時的 `batchSize`，多筆路徑和 `b968c23` 完全相同（`git diff b968c23 3b0caca -- skills/memoria-vector/embed.mjs` 只有那一行和註解）。
- AC-3 的實機數據沒有重新量測，也不需要：多筆路徑的程式沒有變，前輪 E8～E10 的結論仍然成立。
- 沒有新增依賴。commit 訊息 `fix(vector): …`、`docs(issue-19): …` 都沒有 AI 署名。新增的版控內容沒有本機絕對路徑：唯一命中 `/home/`、`/tmp/` 的是上一輪報告裡「這些路徑都不在 diff 裡」那句說明，用的是 `/home/…` 這種佔位寫法。
- **`detect_changes` 沒有對這次提交執行**：不影響判定。`git diff --stat b968c23 3b0caca` 顯示，程式碼的改動只有 `embed.mjs` 的 `embedLocal` 一行，另一處是測試 driver，其餘都是文件。reviewer 重跑 `impact(embedLocal)`，結果是 LOW、受影響流程 0。`detect_changes` 讀的是主工作區的索引，而主工作區目前在別的分支，在那裡執行也拿不到有意義的結果。README 照實揭露了這一點，揭露本身不構成缺失。這只是程序上的落差，結論由 diff 範圍加上 impact 重跑獨立補上。

## 發現

### MUST FIX

無。

### SHOULD FIX

無。

### NICE TO HAVE

- **N-1** TBD-3 的結論寫「ingest 端非法值照樣報錯」，但 ingest 只有 1 個可 embed 的實體時不會報錯（E6）。建議把措辭改成「多筆輸入時非法值照樣報錯」。若希望 ingest 一律驗證，可以改用 `kind === 'passage' || texts.length > 1` 當條件；這超出 TBD-3 的範圍，要做須另行確認。
- **N-2** 查詢斷言用的是單一字元 `'q'`，「文字被切塊、每塊各呼叫一次」這類變異抓不到（M6）。改用多字元、多詞的字面值（例如 `'hello world'`，期望 `["query: hello world"]`）就能補上，幾乎不增加成本。
- **N-3** 在核准來源的 AC-2 修訂註記補上修訂所在的提交（`3b0caca`），之後拿 `a79d3be` 比對時，不用讀內文也能定位修訂。
- **N-4** issue README D3 的理由欄「32 筆實測峰值 1.4GB」改成「外部切批每批各起一個行程時 1.4GB；單一行程約 2.5GB」，和概述表格及 AC-3 證據一致。
- **N-5** 上一輪的 N-1（檢查 `out.dims[0] === batch.length`）、N-2（`resolveBatchSize` 接受 `1e2`、`0x20`）、N-3（driver 結尾 `setLocalPipelineForTest(null)`）、N-5（「涉及檔案」漏列 `scripts/pure-fn-driver.mts`）都還沒處理，仍然只是建議。

## 判定

**`PASS`**：沒有 MUST FIX，也沒有 SHOULD FIX。S-1～S-4 都已修正。S-2 依使用者的 TBD-3 決策採 (b)，紅燈、綠燈與變異證據齊全，真實模型的查詢向量和 BASE 完全相同（cosine 1.000000）。AC-2 的檢查方式修訂合規，沒有改變已核准的行為門檻。前輪通過的 AC-1、AC-3 沒有被破壞。
