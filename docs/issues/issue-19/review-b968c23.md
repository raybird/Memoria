# Review — issue-19 embedLocal 分批（b968c23）

- **報告位置**：`docs/issues/issue-19/review-b968c23.md`
- **審查日期**：2026-10-20
- **Reviewed BASE SHA**：`ac76109`（ac76109 docs(issue-19～22): 回填核准紀錄的核准 commit）
- **Reviewed HEAD SHA**：`b968c23`（分支 `issue-19-embed-batching`，BASE..HEAD 只有這一個提交）
- **Reviewed patch-id**：`24391a02ef5cb8e3e20ee63cff34b7308135d263`（`git diff ac76109 b968c23 | git patch-id --stable`）
- **獨立 reviewer 識別**：Claude subagent（general-purpose，未參與實作）
- **判定**：`PASS`

## 審查範圍與風險

變更 4 個檔案、+92／−13：

| 檔案 | 內容 |
| --- | --- |
| `skills/memoria-vector/embed.mjs` | `embedLocal` 依批次逐次呼叫 pipeline；新增 `resolveBatchSize()`（`MEMORIA_EMBED_BATCH`，預設 32）與測試注入點 `setLocalPipelineForTest` |
| `scripts/pure-fn-driver.mts` | 新增 `[pure] embedLocal batching` 七條斷言（AC-1） |
| `skills/memoria-vector/README.md` | Env 清單補 `MEMORIA_EMBED_BATCH` |
| `docs/issues/issue-19/README.md` | 步驟 1～3 回填證據、步驟 4 註明相依，狀態改「待審查」 |

規格依據：`b968c23:docs/issues/issue-19/README.md`（Small、風險 Medium、核准 commit `a79d3be`）。`git diff ac76109 b968c23 -- docs/issues/issue-19/README.md` 只動了「實作與驗證步驟」與狀態，`## 驗收條件` 與核准紀錄沒有改，原核准有效。

最大風險和 issue 寫的一樣：`embedTexts` 也是查詢路徑，分批要是弄錯順序或維度，語意召回會錯配而且不報錯。GitNexus 的 `impact(embedLocal, upstream)` 由 reviewer 重跑一次：LOW，d=1 只有 `embedTexts`，d=2 是 `vector-recall.mjs`、`vector-ingest.mjs`，受影響流程 0。`git grep` 查過，`setLocalPipelineForTest` 只有 `scripts/pure-fn-driver.mts` 在用。

## 證據（reviewer 重跑）

全部在 `b968c23` 的 detached worktree 內執行，`node_modules` 以 symlink 接到既有安裝，用完已 `worktree remove --force`。使用者的 `~/.memoria` 和 `$LIBSQL_URL` 指向的向量庫都沒有碰。

| # | 命令／操作 | 結果 |
| --- | --- | --- |
| E1 | `pnpm run check` | exit 0 |
| E2 | `pnpm run build`；`node dist/cli.mjs --help` | 建置成功、help 正常 |
| E3 | `bash scripts/test-pure-functions.sh` | `[pure] embedLocal batching` 七條 ✓，`[pure] ok`，exit 0 |
| E4 | `env -u LIBSQL_URL -u MEMORIA_HOME bash scripts/test-vector-recall.sh` | `[vector] ok`，exit 0 |
| E5 | 紅燈重現：`embed.mjs` 換回 `ac76109` 版本，只加回 `setLocalPipelineForTest` | exit 1，4 條 ✗：`expected 3, got 1`、`expected 32/32/6, got 70`、`expected 50/20, got 70`、拒絕非法值那條 `expected true, got false`。順序、筆數、維度三條在紅燈時仍綠，和 README 的揭露相符 |
| E6 | 突變測試（改 HEAD 版 `embed.mjs` 後跑 E3） | 批次倒序 → 順序斷言 ✗；最後一批少一列 → `expected 70, got 69` ✗；slice 多取一筆 → 4 條 ✗；**query 前綴改壞 → 全綠（抓不到）** |
| E7 | 邊界探針（假 pipeline，`MEMORIA_EMBED_PROVIDER=local`，70 筆） | 見下方失敗面表 |
| E8 | 真實模型等價性：改動前（一次整批）與改動後（32 一批）各 embed 同一組 70 筆合成文本與一筆 query，`MemoryMax=6G` | 同 index 的 cosine 最小值 0.998126；每列新向量的最近鄰都是舊向量的同一列（錯位 0）；query cosine 1.000000 |
| E9 | 真實模型記憶體量測（合成 payload，暫存 `LIBSQL_URL=file:<scratchpad>`，`systemd-run --user --scope -p MemoryMax=6G /usr/bin/time -v`），改動後 | 400 筆：2534336 kB、0:33；800 筆：2556952 kB、1:04；1600 筆：2556552 kB、2:14，三次 `ok:true`、exit 0 |
| E10 | 對照組：同一份 800 筆 payload，用改動前的 `embed.mjs` | 約 30 秒後 journal 出現 `The kernel OOM killer killed some processes in this unit`、`Failed with result 'oom-kill'`、`6G memory peak, 10.2G memory swap peak`，exit 143。同版本 70 筆是成功的（2654112 kB） |

E9 和 E10 是 reviewer 自己用合成資料重新取的對照組，不是重跑實作者的實機證據。規則禁止對使用者真實語料跑 ingest，所以 AC-3 的實機數值只審查可信度（見 AC-3 一節）。

## 失敗面

| 失敗面 | 具體輸入／狀態 | 預期 | 覆蓋 | 結論 |
| --- | --- | --- | --- | --- |
| 未分批 | 70 筆、未設 env | 3 次呼叫，長度 32/32/6 | E3、E5 紅燈 | 通過 |
| 輸出錯位／筆數不符 | 批次倒序、最後一批掉一列、slice 重疊 | 斷言失敗 | E6 三種突變都抓到 | 通過，期望值是字面值 0..69，和實作不共用計算，不是同義反覆 |
| 最後一批不足 | 70 筆配 32 或 50；`71`→70；`70`→70；`1`→70 次單筆 | 筆數與順序正確 | E3、E7 | 通過 |
| 空輸入 | `embedTexts([], 'passage')` | 回 `[]`、0 次呼叫 | E7 | 通過，比舊版直接把 `[]` 丟給 pipeline 安全；`vector-ingest.mjs` 本來就會提早退出 |
| `dims` 驗證 | 每批都檢查 `dim !== DIM` | 維度錯就丟錯 | 程式碼審閱；假 pipeline 一律回 DIM，沒有測到這條 | 和改動前一致；`out.dims[0] !== batch.length` 仍然不檢查（N-1） |
| env 解析 | `''`、`'   '`→32；`' 50 '`→50；`'1.5'`、`'-3'`、`'abc'`、`'1e400'`、`'0'`→點名變數丟錯；`'1e2'`→100；`'0x20'`→32；`'5.0'`→5 | 只接受正整數 | E7 | 主要情況都正確。科學記號與十六進位會被接受（N-2） |
| query 路徑（合法 env） | `embedTexts(['hello'], 'query')` | 1 次呼叫，輸入 `["query: hello"]`，384 維 | E7、E8（真實模型 query cosine 1.0） | 行為不變。但這是 reviewer 補的證據，AC-2 的命令覆蓋不到（S-1） |
| query 路徑（非法 env） | `MEMORIA_EMBED_BATCH=abc` 時查詢 | 改動前：查詢正常；改動後：`vector-recall.mjs` 丟錯 → fail-open 降級 | E7 確認會丟錯 | 新增的回歸面（S-2，需決策） |
| 注入點外洩 | `setLocalPipelineForTest` 是正式模組的 export | 只有測試會呼叫 | `git grep` 只有 driver 用到 | 正式路徑沒有呼叫端。driver 結束時沒有把 pipeline 設回 `null`，但它是最後一個區塊、process 隨即退出，不影響後續斷言（N-3） |
| 測試 env 外洩 | driver 改 `MEMORIA_EMBED_PROVIDER`／`MEMORIA_EMBED_BATCH` | 結束時還原 | 程式碼審閱：有保存並還原（`undefined` 會 `delete`） | 通過。開發者 shell 裡原本設的 `MEMORIA_EMBED_BATCH` 會先被 `delete`，不會干擾預設值斷言 |
| 峰值隨語料成長 | 400／800／1600 筆 | 峰值持平 | E9：約 2.53～2.56GB 持平；E10：改動前 800 筆被 OOM kill | 通過，reviewer 獨立確認 |

## AC 對照

- **AC-1**：紅燈（E5）與綠燈（E3）都由目標行為驅動，突變測試（E6）證明順序與筆數斷言能抓到錯位。這裡採單迴圈合併有理由：注入點直接換掉 transformers pipeline，走的是真實的 `embedTexts`→`embedLocal`。重構是 no-op，有寫明理由。**成立。**
- **AC-2**：核准的檢查命令 `test-vector-recall.sh` 通過（E4）。不過這支腳本一開始就 `unset MEMORIA_EMBED_PROVIDER`，全程用 `stub`；`stub` 分支在 `embedTexts` 第一行就回傳，根本不會進 `embedLocal`。唯一碰到 local 的段落（issue-11）在缺依賴時就丟錯了，到不了分批迴圈。所以這條檢查和本次改動的失敗模式不相交：E6 把 query 前綴改壞，兩支腳本都還是綠的。README 說這條「覆蓋最大風險」是過度宣稱。實際行為由 reviewer 的 E7、E8 補上，查詢路徑確實沒變，所以本輪不阻擋。**成立，證據有缺口，見 S-1。**
- **AC-3**（觀測式，審查證據）：
  - *反向自檢*：判準是「被 kill 或 `missing>0`」。如果分批失效，行程會在 `MemoryMax=6G` 內被 OOM kill（E10 已重現），判準會轉紅，不會仍是綠的。實作者先用改動前的 `embed.mjs` 跑對照組再取數據，符合 verification.md 的「先驗證判準本身」。`main` 就是 `ac76109`，所以對照組用的 `git show main:…/embed.mjs` 確實是改動前的程式。
  - *`missing=0` 這條判準*：單獨看比較弱。實機向量庫先前已由外部切批補滿 780 筆，就算這次 ingest 一筆都沒寫，`missing` 也會是 0。真正把關的是 `{"ok":true,"embedded":780}`：這行在 upsert 迴圈跑完之後才印，迴圈裡寫入失敗會直接丟錯，所以 exit 0 加上這個輸出足以證明這次真的寫入了。結論成立，但 README 沒寫出這層推理（N-4）。
  - *門檻*：實際 embed 的是 780 筆（payload 1310 筆裡有 530 筆是 `project`／`skill_profile`，被 `EMBEDDABLE_TYPES` 濾掉）。780 ≥ 771，**AC-3 成立**。
  - *數據與結論不一致*：README 寫「1310 筆是 771 筆的 1.7 倍，峰值卻從 21.9GB 降到 2.5GB」，但真正進 pipeline 的是 780 筆，約 1.01 倍，「1.7 倍」不成立。而且這是拿不同程式碼比峰值，不能證明「不隨筆數線性成長」。這個結論本身是對的，E9 的 400／800／1600 持平已經獨立證實，但 README 的論證要改（S-3）。
  - 2.5GB 和外部切批的 1.4GB 之間的落差，README 已經誠實寫明「未另行拆解」，這不算缺失。E9 顯示單一行程的基線約 2.5GB，和筆數無關。

## 範圍與 gate

- 沒有新增依賴（`package.json` 和 `skills/memoria-vector/package.json` 都沒動）。
- commit 訊息格式是 `fix(vector): …`，沒有 AI 署名或 `Co-Authored-By`。
- 版控文件的新增內容沒有外部專案真名，也沒有本機絕對路徑（`/home/…`、`/tmp/…` 都不在 diff 裡）。`~/.claude/skills/memoria/ingest-vectors.sh` 在 BASE 就已存在，而且是相對家目錄的寫法，不在本次範圍。
- `skills/memoria-vector/README.md` 的「32 peaked at 1.4GB」和 `embed.mjs` 註解的「batches of 32 peaked at 1.4GB」是外部切批（每批各起一個行程）量到的數字，不是本次交付的單一行程實作（實作者量到 2.5GB，reviewer 量到約 2.55GB）。照著這份文件估算容量的人會低估約 1GB（S-4）。
- GitNexus impact 在改動之後才補跑：程序上違反 project.md「改 symbol 前跑」，但 README 照實記錄了。reviewer 重跑的結果相同（LOW、唯一 d=1 呼叫端），提交前 `detect_changes` 也有跑。這只影響程序，不影響判定：揭露不構成缺失，而且影響範圍已經獨立確認。
- 「涉及檔案」寫的是 `scripts/test-pure-functions.sh`，實際改的是它呼叫的 `scripts/pure-fn-driver.mts`。這只是文件精確度問題（N-5）。
- 審查結束時發現主工作區已切到 `issue-22-skill-deployment`，`scripts/test-bootstrap.sh` 有未提交修改。這不是 reviewer 造成的：reviewer 從頭到尾沒有寫入主工作區。在這裡記下來，免得被誤認為審查留下的狀態。

## 發現

### MUST FIX

無。

### SHOULD FIX

- **S-1 AC-2 的檢查命令覆蓋不到被改的程式碼。** `test-vector-recall.sh` 全程用 `stub`，不會進 `embedLocal`。E6 把 query 前綴改壞，AC-1 和 AC-2 都還是綠的。建議在 `pure-fn-driver.mts` 的批次區塊補一條 query 斷言：`embedTexts(['q'], 'query')` 應該只呼叫一次，而且輸入等於字面值 `["query: q"]`。README 的 AC-2 證據改為引用這條斷言，並刪掉「這條覆蓋最大風險」的說法，或改寫成實際的覆蓋範圍。本輪的行為正確性已由 E7、E8 證實。
- **S-2 只為 ingest 設計的 env 現在可能讓查詢壞掉。** `需決策`。`resolveBatchSize()` 每次 `embedLocal` 都會執行，查詢也一樣。所以 `MEMORIA_EMBED_BATCH` 設成非法值（例如 `abc`）時，`vector-recall.mjs` 會丟錯。改動前查詢完全不讀這個變數。recall 端是 fail-open，會悄悄降級成 `vector_unavailable`／error，這正是 issue 列為最大風險的「靜默變差」。待決問題：非法值要不要影響查詢？可選做法：(a) 維持現狀，在 README 註明非法值也會停用語意召回；(b) 只有輸入超過一筆時才解析這個變數，單筆查詢不受影響；(c) 非法值時 stderr 警告並退回預設 32。reviewer 建議 **(b)**：它守住 AC-2「查詢行為不變」的字面意思，ingest 端照樣大聲報錯。
- **S-3 AC-3 證據的「1.7 倍」論證和數據不一致。** 真正進 pipeline 的是 780 筆，不是 1310 筆。建議改寫成「780 筆 embedded（payload 1310 筆，其中 530 筆不可 embed）」，「不隨筆數線性成長」改用同一版程式碼在不同筆數下的峰值支撐，例如引用本報告 E9（400／800／1600 筆約 2.53～2.56GB 持平）。
- **S-4 文件裡的峰值寫錯數字。** `skills/memoria-vector/README.md` 和 `embed.mjs` 註解寫「32 peaked at 1.4GB」，但本次交付的單一行程實作峰值約 2.5GB。建議改成單一行程實測的約 2.5GB，並註明 1.4GB 是每批各起一個行程時的數值。

### NICE TO HAVE

- **N-1** 檢查 `out.dims[0] === batch.length`，不相等就丟錯。舊版也沒有這道檢查，但分批後每批都會累加，少一列會讓之後所有列錯位。
- **N-2** `resolveBatchSize` 會接受 `'1e2'`、`'0x20'`、`'5.0'`。想要嚴格只收十進位整數，可以改用 `/^\d+$/`。
- **N-3** driver 結尾補上 `setLocalPipelineForTest(null)`，日後在後面加斷言時才不會吃到殘留的假 pipeline。
- **N-4** AC-3 證據補一句：`missing=0` 單獨不足以證明這次有寫入（向量庫先前已補滿），真正把關的是 `embedded:780` 加 exit 0。
- **N-5** 「涉及檔案」補上 `scripts/pure-fn-driver.mts`。另外 `MemoryMax` 不限制 swap（E10 用到 10.2G swap），對照組想更快、更乾淨地失敗，可以加 `-p MemorySwapMax=0`。

## 判定

**`PASS`** — 沒有 MUST FIX。AC-1～AC-3 都有可重現的紅綠證據，或已驗證判準的觀測證據。AC-2 的覆蓋缺口與 AC-3 的論證瑕疵，已由 reviewer 的 E7～E10 獨立補上行為證據，所以列為 SHOULD FIX，不阻擋本輪。S-2 需要使用者決定。若選 (b) 或 (c)，會變成新的提交，須重新審查。
