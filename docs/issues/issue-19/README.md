# Issue 19 - vector-ingest 一次 embed 整份語料，記憶體隨語料量膨脹到被 OOM kill (Small)

## 概述

`vector-ingest.mjs` 把 payload 的全部實體一次交給 `embedTexts`，`embedLocal` 再整批丟進 transformers pipeline。batch 內每列 padding 到最長的那筆，中間張量隨筆數與長度一起成長，峰值記憶體跟著語料總量膨脹。本 issue 讓 `embedLocal` 分批呼叫 pipeline，消除 OOM；增量 ingest 不在範圍內。

實測（2026-10-20，維護者機器）：

| 語料 | 結果 |
| --- | --- |
| 396 筆 | 成功 |
| 771 筆 | `Out of memory: Killed process (node) anon-rss:21921728kB`——單一 node 行程 21.9GB |
| 同 771 筆，外部切成每批 32 筆分次呼叫 | 成功，峰值 RSS 1.4GB，全量 5 分 19 秒 |

先前成功只是機器剛好有足夠空閒記憶體。目前本機以 `~/.claude/skills/memoria/ingest-vectors.sh` 在外部切批繞過（[project.md](../../agents/project.md) 地雷 M-1）。

設計決策：

| # | 決策 | 理由 |
| --- | --- | --- |
| D1 | 分批放在 `embedLocal` 內 | ingest 與 recall 共用一處，呼叫端不需知道批次存在 |
| D2 | 只做分批，不做增量 | 使用者 2026-10-20 選定；速度問題另開 issue |
| D3 | 批次大小可用 `MEMORIA_EMBED_BATCH` 覆寫，預設 32 | 32 筆實測峰值 1.4GB；覆寫只為低記憶體機器保留調整空間，不新增 CLI 旗標 |

## 涉及檔案

- `skills/memoria-vector/embed.mjs` - `embedLocal` 分批
- `scripts/test-pure-functions.sh` - 分批的呼叫次數與順序斷言
- `skills/memoria-vector/README.md` - 記載 `MEMORIA_EMBED_BATCH`

## 驗收條件

1. **AC-1**：`embedLocal` 對 pipeline 的每次呼叫最多處理一個批次，回傳向量的筆數與順序和輸入一致 — 檢查方式：以可注入的假 pipeline 執行 70 筆、批次 32，斷言呼叫 3 次、每次長度 32／32／6，輸出第 i 筆對應輸入第 i 筆
   - 失敗路徑：呼叫次數為 1（未分批）、任何一次長度超過批次、或輸出順序錯位，即判定失敗
2. **AC-2**：`vector-recall.mjs` 的單筆查詢行為不變 — 檢查方式：`bash scripts/test-pure-functions.sh` 的查詢路徑斷言（`embedTexts(['q'], 'query')` 只呼叫 pipeline 一次、輸入為字面值 `["query: q"]`；`MEMORIA_EMBED_BATCH` 為非法值時單筆查詢照常回傳一個向量），以及 `bash scripts/test-vector-recall.sh` 全數通過
   - 失敗路徑：查詢被拆成多次呼叫、送進模型的字串與改動前不同、或 ingest 專用的設定讓查詢丟錯，即判定失敗。`test-vector-recall.sh` 全程用 stub provider、不經過 `embedLocal`，只負責查詢路徑其餘部分（id 映射、融合、降級矩陣）不受影響
   - 修訂（2026-10-20）：原檢查方式只有 `test-vector-recall.sh`，獨立審查 S-1 指出它測不到被改的程式；依 TBD-3 改為上列
3. **AC-3**：直接執行 `vector-ingest.mjs`（不經外部切批）處理至少 771 筆實體成功，`doctor` 的 vector coverage 為 `missing=0` — 檢查方式：維護者機器上以 `/usr/bin/time -v` 量峰值 RSS，數值回寫本文件（CI 不跑 local provider，這條是手動證據）
   - 失敗路徑：行程被 kill、`missing>0`、或峰值 RSS 隨筆數線性成長

- **核准日期**: 2026-10-20
- **核准來源**: 範圍決策——使用者 2026-10-20 對「issue-19 的範圍要多大？」選擇「只做分批 embed」。AC-1～AC-3 與 D3 由規劃推導，使用者 2026-10-20 回覆「照建議」核准（建議內容：預設每批 32 筆、可用 `MEMORIA_EMBED_BATCH` 覆寫；AC-3 門檻為實機 ≥771 筆且 `missing=0`）。AC-2 的檢查方式於 2026-10-20 依獨立審查 S-1 修訂，使用者「一律都照建議」視為接受建議答案（TBD-3）；行為門檻「單筆查詢行為不變」未變
- **核准 commit**: a79d3be

## 風險與首要驗證

- **最大風險**：`embedTexts` 同時是查詢路徑；分批若改變輸出順序或維度，語意召回會靜默錯配
- **風險等級與理由**：Medium——改動小，但失敗沒有錯誤訊息，只會讓排序悄悄變差
- **首要驗證**：先寫 AC-1 的假 pipeline 斷言（紅），再改 `embedLocal`
- **選擇理由**：順序錯位是唯一會靜默的失敗形態，假 pipeline 能逐筆比對而不需要模型
- **完成證據**：AC-1 斷言紅→綠、`test-vector-recall.sh` 全綠、AC-3 實機數值

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
| --- | --- | --- | --- |
| TBD-1 | AC-1～AC-3 與 D3（`MEMORIA_EMBED_BATCH`，預設 32）需使用者核准 | 已解決 | 2026-10-20 使用者回覆「照建議」，全部核准 |
| TBD-2 | 增量 ingest（跳過 text 未變的實體）；目前直接呼叫 `vector-ingest.mjs` 時不提交 `memory_sync_state` 游標，每次全量重算 | 待確認 | 不影響本 issue 的 AC；另開 issue |
| TBD-3 | 審查 S-2（`需決策`）：`MEMORIA_EMBED_BATCH` 非法時是否影響查詢。(a) 維持並註明；(b) 只有多筆輸入才解析；(c) 警告並退回 32。連帶 S-1：AC-2 的檢查方式測不到被改的程式 | 已解決 | 2026-10-20 使用者「一律都照建議」，採 reviewer 建議 (b)：單筆輸入不讀此變數，ingest 端非法值照樣報錯；AC-2 檢查方式補上查詢路徑斷言 |

## 實作與驗證步驟

1. ✅ **AC-1：分批呼叫 pipeline** — 驗證方式：AC-1 的假 pipeline 斷言
   - 完成證據（2026-10-20）：
     - 先只加測試注入點 `setLocalPipelineForTest`，不改行為。
     - 紅燈：`bash scripts/test-pure-functions.sh` → exit 1，`✗ 70 texts at the default batch of 32 → 3 pipeline calls: expected 3, got 1`、`✗ batch sizes are 32/32/6: expected 32/32/6, got 70`，以及 env 覆寫與非法值兩條失敗——整份語料一次送進 pipeline。
     - 最小實作：`embedLocal` 依 `MEMORIA_EMBED_BATCH`（預設 32）逐批呼叫，非正整數直接報錯並點名變數。
     - 綠燈：`[pure] embedLocal batching` 七條 ✓、exit 0。假 pipeline 把輸入編號寫進輸出列的第 0 格，期望值是字面值 0..69，與實作不共用計算（不是同義反覆）。順序斷言在紅燈時也是綠的：它防的是分批後錯位這種回歸，不是本次的紅燈來源。
     - 單迴圈合併：注入點直接換掉 transformers pipeline，斷言走的就是 `embedTexts`→`embedLocal` 的真實路徑，沒有另外的整合層；真實模型的整合由 AC-3 承擔。
2. ✅ **AC-2：查詢路徑不變** — 驗證方式：`test-pure-functions.sh` 的查詢路徑斷言與 `bash scripts/test-vector-recall.sh`
   - 完成證據（2026-10-20）：`env -u LIBSQL_URL -u MEMORIA_HOME bash scripts/test-vector-recall.sh` → `[vector] ok`、exit 0，既有斷言未改（stub provider，覆蓋 `embedLocal` 以外的查詢路徑）。
   - 審查退回修正（[review-b968c23](./review-b968c23.md) S-1、S-2，依 TBD-3）：紅燈 `bash scripts/test-pure-functions.sh` → `✗ an invalid MEMORIA_EMBED_BATCH does not break a single query: … got Error: MEMORIA_EMBED_BATCH must be a positive integer, got 'abc'`、`✗ the query still yields one vector: expected 1, got 0`；`a query is one pipeline call` 與字面值 `["query: q"]` 兩條在改動前就綠（它們是釘住既有行為的特徵測試）。實作：`embedLocal` 只在輸入超過一筆時才呼叫 `resolveBatchSize()`。綠燈：批次區塊 11 條 ✓。變異檢查：把 query 前綴改成 `'query:'` → `✗ the query reaches the model as the literal ["query: q"]: … got ["query:q"]`，還原後綠。回歸：CI 全套 34 支全數 PASS（被測為 `64c6cfd` 加上本次修正的工作區，2026-10-20；`test-no-clone-install` 首跑因新 worktree 尚無 `release:package` 產物而缺檔，依 `ci.yml` 先執行 `pnpm run release:package` 後重跑通過）。GitNexus：改動仍只在 `embedLocal` 內，沿用先前 impact（LOW，唯一呼叫端 `embedTexts`）；本次在獨立 worktree 修改，`detect_changes` 只能對主工作區索引執行，未對這次提交另跑，照實記錄。
3. ✅ **AC-3：實機 ingest** — 驗證方式：`/usr/bin/time -v node skills/memoria-vector/vector-ingest.mjs <payload>`，接著跑 `doctor`
   - 完成證據（2026-10-20，維護者機器，30GB RAM）：
     - 判準：被 kill 或 `missing>0` 即失敗。為避免回歸時拖垮整台機器，兩次執行都在 `systemd-run --user --scope -p MemoryMax=6G` 內。
     - 對照組（先驗證判準本身）：同一份 payload、改動前的 `embed.mjs`（`git show main:skills/memoria-vector/embed.mjs`，寫入另一個暫存向量庫）→ 5 秒內 `The kernel OOM killer killed some processes in this unit`，scope 峰值 6G，exit 143。判準確實能區分失敗。
     - 本次：`build-mcp-bridge-payload.mjs` 產出的 payload 共 1310 筆實體，其中 530 筆不可 embed、被略過，實際送進模型的是 780 筆（門檻 771）。直接執行一次 `vector-ingest.mjs`（不經外部切批）→ `{"ok":true,"embedded":780,"skipped":530}`、exit 0，`Maximum resident set size` 2531328 kB（約 2.5GB），耗時 1:01.80。
     - `node dist/cli.mjs doctor` → `vector coverage: embedded=780 expected=780 missing=0`。
     - 回歸：`pnpm run check` 無錯；CI 全套（依 `ci.yml` 順序逐支執行 34 支，清除 `LIBSQL_URL`／`MEMORIA_HOME` 等開發者環境變數，`pnpm run build` 後執行）全數 PASS、exit 0，被測為 `ac76109` 加上本次提交內容的工作區，2026-10-20T21:02。
     - GitNexus：`embedLocal` 的 impact 在改動之後才補跑（流程疏漏，照實記錄）——LOW，唯一呼叫端 `embedTexts`，再上層是 `vector-recall.mjs` 與 `vector-ingest.mjs`，兩者分別由 AC-2 與 AC-3 覆蓋；提交前 `detect_changes` 為 low、受影響流程 0。
     - 精煉：code-simplify no-op——分批迴圈與 `resolveBatchSize` 各只有一處用途，沒有可再收斂的重複。
     - 峰值不隨筆數線性成長：以同一版程式在不同筆數下的量測為據——獨立審查 E9（合成 payload、暫存向量庫、`MemoryMax=6G`）400／800／1600 筆的峰值為 2534336／2556952／2556552 kB，持平；改動前 800 筆被 OOM kill（E10）。實機 780 筆的 2.5GB 與之一致。（審查 S-3 更正：原寫「1310 筆是 771 筆的 1.7 倍」，把未 embed 的 530 筆算進去了。）外部切批（每批各起一個行程）時量到的 1.4GB 不是本實作的數值；`embed.mjs` 註解與 helper README 已改為單一行程的約 2.5GB（S-4）。
4. 📝 **新版發布後移除本機繞道**（相依：含本修正的版本發布；不屬本 repo 交付內容）— 驗證方式：`~/.claude/skills/memoria/ingest-vectors.sh` 改為直接呼叫一次 `vector-ingest.mjs`，project.md 地雷 M-1 標註失效日期
   - 完成證據：（發布後回寫）

## Timeline

| 日期 | 異動 | 負責人 |
| --- | --- | --- |
| 2026-10-20 | 建立；範圍決策「只做分批 embed」 | - |
| 2026-10-20 | AC-1～AC-3 與 D3 核准（「照建議」） | - |
| 2026-10-20 | 獨立審查 PASS（`b968c23`，[報告](./review-b968c23.md)），附 S-2 `需決策` | - |
| 2026-10-20 | 依 TBD-3（「一律都照建議」）修正 S-1～S-4，AC-2 檢查方式修訂；待重新審查 | - |
| 2026-10-20 | 合併進 main（rebase 後 fast-forward，`274f58d`）；剩發版後移除本機繞道一步，狀態改為等待外部驗收窗——窗口：含本修正的下一個 npm 版本發布；判準：該步驟的驗證方式完成並回寫證據 | - |

---
**建立日期**: 2026-10-20  
**分級**: Small  
**風險**: Medium\
**狀態**: 等待外部驗收窗
