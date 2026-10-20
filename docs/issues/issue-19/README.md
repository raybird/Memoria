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
2. **AC-2**：`vector-recall.mjs` 的單筆查詢行為不變 — 檢查方式：`bash scripts/test-vector-recall.sh` 全數通過
   - 失敗路徑：任一既有斷言失敗；查詢路徑錯配會讓語意召回靜默回錯結果，這條覆蓋最大風險
3. **AC-3**：直接執行 `vector-ingest.mjs`（不經外部切批）處理至少 771 筆實體成功，`doctor` 的 vector coverage 為 `missing=0` — 檢查方式：維護者機器上以 `/usr/bin/time -v` 量峰值 RSS，數值回寫本文件（CI 不跑 local provider，這條是手動證據）
   - 失敗路徑：行程被 kill、`missing>0`、或峰值 RSS 隨筆數線性成長

- **核准日期**: 2026-10-20
- **核准來源**: 範圍決策——使用者 2026-10-20 對「issue-19 的範圍要多大？」選擇「只做分批 embed」。AC-1～AC-3 與 D3 由規劃推導，使用者 2026-10-20 回覆「照建議」核准（建議內容：預設每批 32 筆、可用 `MEMORIA_EMBED_BATCH` 覆寫；AC-3 門檻為實機 ≥771 筆且 `missing=0`）
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

## 實作與驗證步驟

1. ✅ **AC-1：分批呼叫 pipeline** — 驗證方式：AC-1 的假 pipeline 斷言
   - 完成證據（2026-10-20）：
     - 先只加測試注入點 `setLocalPipelineForTest`，不改行為。
     - 紅燈：`bash scripts/test-pure-functions.sh` → exit 1，`✗ 70 texts at the default batch of 32 → 3 pipeline calls: expected 3, got 1`、`✗ batch sizes are 32/32/6: expected 32/32/6, got 70`，以及 env 覆寫與非法值兩條失敗——整份語料一次送進 pipeline。
     - 最小實作：`embedLocal` 依 `MEMORIA_EMBED_BATCH`（預設 32）逐批呼叫，非正整數直接報錯並點名變數。
     - 綠燈：`[pure] embedLocal batching` 七條 ✓、exit 0。假 pipeline 把輸入編號寫進輸出列的第 0 格，期望值是字面值 0..69，與實作不共用計算（不是同義反覆）。順序斷言在紅燈時也是綠的：它防的是分批後錯位這種回歸，不是本次的紅燈來源。
     - 單迴圈合併：注入點直接換掉 transformers pipeline，斷言走的就是 `embedTexts`→`embedLocal` 的真實路徑，沒有另外的整合層；真實模型的整合由 AC-3 承擔。
2. ✅ **AC-2：查詢路徑不變** — 驗證方式：`bash scripts/test-vector-recall.sh`
   - 完成證據（2026-10-20）：`env -u LIBSQL_URL -u MEMORIA_HOME bash scripts/test-vector-recall.sh` → `[vector] ok`、exit 0，既有斷言未改。查詢每次只送一筆，分批後仍是一次呼叫。
3. ✅ **AC-3：實機 ingest** — 驗證方式：`/usr/bin/time -v node skills/memoria-vector/vector-ingest.mjs <payload>`，接著跑 `doctor`
   - 完成證據（2026-10-20，維護者機器，30GB RAM）：
     - 判準：被 kill 或 `missing>0` 即失敗。為避免回歸時拖垮整台機器，兩次執行都在 `systemd-run --user --scope -p MemoryMax=6G` 內。
     - 對照組（先驗證判準本身）：同一份 payload、改動前的 `embed.mjs`（`git show main:skills/memoria-vector/embed.mjs`，寫入另一個暫存向量庫）→ 5 秒內 `The kernel OOM killer killed some processes in this unit`，scope 峰值 6G，exit 143。判準確實能區分失敗。
     - 本次：`build-mcp-bridge-payload.mjs` 產出 1310 筆實體（門檻 771），直接執行一次 `vector-ingest.mjs`（不經外部切批）→ `{"ok":true,"embedded":780,"skipped":530}`、exit 0，`Maximum resident set size` 2531328 kB（約 2.5GB），耗時 1:01.80。
     - `node dist/cli.mjs doctor` → `vector coverage: embedded=780 expected=780 missing=0`。
     - 回歸：`pnpm run check` 無錯；CI 全套（依 `ci.yml` 順序逐支執行 34 支，清除 `LIBSQL_URL`／`MEMORIA_HOME` 等開發者環境變數，`pnpm run build` 後執行）全數 PASS、exit 0，被測為 `ac76109` 加上本次提交內容的工作區，2026-10-20T21:02。
     - GitNexus：`embedLocal` 的 impact 在改動之後才補跑（流程疏漏，照實記錄）——LOW，唯一呼叫端 `embedTexts`，再上層是 `vector-recall.mjs` 與 `vector-ingest.mjs`，兩者分別由 AC-2 與 AC-3 覆蓋；提交前 `detect_changes` 為 low、受影響流程 0。
     - 精煉：code-simplify no-op——分批迴圈與 `resolveBatchSize` 各只有一處用途，沒有可再收斂的重複。
     - 峰值不隨筆數線性成長：1310 筆是 771 筆的 1.7 倍，峰值卻從 21.9GB 降到 2.5GB。外部切批（每批各起一個行程）時量到 1.4GB，單一行程多出的部分未另行拆解。
4. 📝 **新版發布後移除本機繞道**（相依：含本修正的版本發布；不屬本 repo 交付內容）— 驗證方式：`~/.claude/skills/memoria/ingest-vectors.sh` 改為直接呼叫一次 `vector-ingest.mjs`，project.md 地雷 M-1 標註失效日期
   - 完成證據：（發布後回寫）

## Timeline

| 日期 | 異動 | 負責人 |
| --- | --- | --- |
| 2026-10-20 | 建立；範圍決策「只做分批 embed」 | - |
| 2026-10-20 | AC-1～AC-3 與 D3 核准（「照建議」） | - |

---
**建立日期**: 2026-10-20  
**分級**: Small  
**風險**: Medium\
**狀態**: 待審查
