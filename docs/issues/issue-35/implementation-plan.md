# Issue 35 實作計畫

風險與首要驗證見 [README](./README.md#風險與首要驗證)。

## 設計方案

- **`vector_hits`**：只在 `mode === 'vector'` 且 helper 回 `ok` 時放進 meta，值為 `collapseNoteHits(vectorOutcome.rows).length`（融合前的語意命中，一則筆記的 session 與 event 兩列算一則）。2026-11-26 實作時修訂：原寫 `vectorOutcome.rows.length`，但每則筆記在語意索引裡有兩列，基準資料中回 2 則筆記時這個值是 4；issue-34 已定「一則筆記佔一格」，所以改成和 `data` 同一單位。helper 降級（`vector_unavailable`／`vector_timeout`）時沒有這個欄位，因為那時 `route_mode` 已經說明了原因。
- **`project_known`**：只在 `filter.project` 有值時放進 meta。判定方式是這個 project 在 `sessions` 有沒有任何一列，比對規則和 recall 的 project 過濾一致，放在 `src/core/db/recall.ts`。查詢失敗時不放欄位，recall 照常回傳（fail-open）。
- **弱命中標示**：只改 `src/cli/commands/recall.ts` 的人讀輸出。`relevance < 0.3` 的命中，在該行的 relevance 後面標「弱命中」，印成 `[0.250 弱命中]`；沒有 relevance 的命中（只靠語意索引找到）不標。門檻寫成同檔的常數。
- **人讀輸出的兩行說明**：印在筆數那行下方。`vector_hits === 0` 時印「語意查詢有執行，沒有命中；列出的是字面查詢的結果」；`project_known === false` 時印「這個 project 沒有任何記憶；已登記的名稱見 `memoria repo list`」。
- 型別：recall 的 meta 型別（`src/core/types.ts`）加兩個選用欄位。`route_mode`、`fallback_used`、`confidence`、`confidence_basis` 與 telemetry 都不動。

## 實作步驟

1. ✅ **基準（SCN-001～006 的回歸前提）** — 在隔離資料根以 `MEMORIA_EMBED_PROVIDER=stub` 跑 keyword、hybrid、vector 三種模式的查詢，各存一份 `--json`；跑 GitNexus impact（`recall`）。相依：無。
   - 完成判準：基準檔已保存，impact 結果記入本步驟；HIGH／CRITICAL 已告知使用者。
   - 完成證據：✅ 2026-11-26。基準工具在 `evidence/seed.sh`（固定種子資料根：alpha 3 則、gamma 2 則加向量、範例 session）與 `evidence/run.mjs`（keyword、hybrid、vector 各 8 組查詢，共 24 組；刪掉 `recall_id`、`latency_ms`、`meta.timestamp` 與隨時間衰減的 `score`，順序由陣列保留）。改動前的 bundle 連跑 4 次逐位元組相同。為了讓結果可重現，種子資料的向量文字刻意各不相同：stub embedding 遇到距離相同的列時，helper 的排序會隨機翻轉。GitNexus impact（`recall`，upstream）為 CRITICAL，有 6 個直接呼叫端：createServer、createUiRouter、fileQuery、verifyVectorReadiness、registerRecallCommand、memory-browser-driver。這次只加欄位，下面步驟 6 的比對就是在驗證這一點
2. ✅ **SCN-001、SCN-002：`vector_hits`** — 在 `test-vector-recall.sh` 先寫斷言取得紅燈，再改 `recall()` 與型別。相依：步驟 1。
   - 完成判準：兩個 Scenario 綠燈，非 vector 模式沒有這個欄位。
   - 完成證據：✅ 紅燈：改動前 `test-vector-recall.sh` 報「SCN-001 語意查詢沒有命中時 vector_hits 應為 0，實際 undefined」；SCN-002 斷言的是同一個欄位，原因相同，所以合併記錄。照計畫原寫法 `rows.length` 實作時又紅一次：「兩則筆記（4 列語意命中）時 vector_hits 應為 2，實際 4」，因此改以筆記計（README TBD-1）。綠燈：`memoria.ts` 的 `vector_hits` 加上型別，SCN-001 的人讀說明行也一起完成。非 vector 模式（keyword、hybrid、tree）與降級（vector_unavailable）時沒有這個欄位。SCN-002 的前提會重建索引直到 helper 回滿 4 列（README TBD-2），重跑 6 次都通過
3. ✅ **SCN-003、SCN-004：`project_known`** — 在 `test-cli-memory.sh` 先寫斷言取得紅燈，再實作。相依：步驟 1。
   - 完成判準：兩個 Scenario 綠燈，沒帶 `--project` 時沒有這個欄位。
   - 完成證據：✅ 紅燈：「mode=keyword project_known 應為 false，實際 undefined」；SCN-004 斷言的是同一個欄位，合併記錄。核心改完、CLI 還沒改時，人讀輸出的斷言也是紅燈（只印出 0 hits）。綠燈：`projectHasMemories`（`db/recall.ts`）比對 `sessions.project`，規則與路由的 project 過濾相同，檢查失敗時不放欄位（fail-open）。keyword 與 hybrid 兩種模式都斷言過；沒帶 `--project` 時沒有這個欄位
4. ✅ **SCN-005：弱命中標示** — 在 `test-cli-memory.sh` 斷言人讀輸出的標示，並以 `--json` 比對步驟 1 的基準。相依：步驟 1。
   - 完成判準：標示正確；`--json` 去掉新欄位後與基準相同。
   - 完成證據：✅ 紅燈：「第 3 筆 relevance=0.25 標示應為 true」。綠燈：`WEAK_RELEVANCE = 0.3`，輸出為 `[0.250 弱命中]`，人讀行數等於 `--json` 筆數。只靠語意索引找到的命中印 `[ n/a ]`、不標示，斷言在 `test-vector-recall.sh`。`--json` 的比對見步驟 6
5. ✅ **SCN-006：HTTP** — 在 `test-http-api.sh` 斷言 `POST /v1/recall` 的 meta 帶兩個欄位。相依：步驟 2、3。
   - 完成判準：斷言綠燈，`http-mcp` 組腳本全綠。
   - 完成證據：✅ `test-http-api.sh`：`project_known` 在有記憶的 project 為 true、沒有記憶的為 false，與 CLI 對同一資料根的結果相同；沒帶 project 時兩個新欄位都沒有。`vector_hits` 的 HTTP 斷言放在 `test-vector-recall.sh`（理由見測試策略）：0 筆與 2 筆兩種情況，HTTP 與 CLI 相同。http-mcp 組 5 支全綠
6. ✅ **回歸與常青文件** — 重跑步驟 1 的查詢並比對基準；更新 `docs/CLI.md`、`docs/CLI.zh-TW.md`、`docs/API.md`、`docs/API.zh-TW.md`、`AGENTS.md` HTTP 段、`docs/agents/architecture.md`。相依：步驟 2～5。
   - 完成判準：去掉新欄位後與基準逐位元組相同；`core`、`http-mcp` 組全綠。
   - 完成證據：✅ 2026-11-26。最終程式在同一份種子資料上跑 24 組查詢，刪掉兩個新欄位後與基準 24/24 逐位元組相同。`pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`、`bash -n install.sh`、`pnpm run release:docs-check` 都通過；core（10 支）、adapters（5 支）、http-mcp（5 支）共 20 支腳本全綠，執行前依地雷 M-4 清掉相關環境變數。常青文件：CLI.md、CLI.zh-TW.md、API.md、API.zh-TW.md、AGENTS.md、architecture.md 已更新，最後驗證日期改為 2026-11-26；CHANGELOG [Unreleased] 的 Added 一節也補上了

## 測試策略

| 驗收編號 | 測試層級 | 腳本 |
|---|---|---|
| SCN-001、SCN-002 | CLI 端到端（stub provider） | `scripts/test-vector-recall.sh` |
| SCN-003、SCN-004、SCN-005 | CLI 端到端 | `scripts/test-cli-memory.sh` |
| SCN-006 | HTTP 契約 | `project_known`：`scripts/test-http-api.sh`；`vector_hits`：`scripts/test-vector-recall.sh`（helper 依賴在這支腳本安裝，CI 的 http-mcp 組先跑 test-http-api） |
| 其餘輸出不變 | 基準比對 | 步驟 1、6 |

本機跑測試前依 project.md 地雷 M-4，先清掉 shell 帶進來的 `LIBSQL_URL`、`MEMORIA_EMBED_PROVIDER`、`MEMORIA_VECTOR_TIMEOUT_MS`、`MEMORIA_HOME`。
