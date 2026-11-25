# Issue 35 實作計畫

風險與首要驗證見 [README](./README.md#風險與首要驗證)。

## 設計方案

- **`vector_hits`**：只在 `mode === 'vector'` 且 helper 回 `ok` 時放進 meta，值為 `vectorOutcome.rows.length`（融合前的語意命中數）。helper 降級（`vector_unavailable`／`vector_timeout`）時沒有這個欄位，因為那時 `route_mode` 已經說明了原因。
- **`project_known`**：只在 `filter.project` 有值時放進 meta。判定方式是這個 project 在 `sessions` 有沒有任何一列，比對規則和 recall 的 project 過濾一致，放在 `src/core/db/recall.ts`。查詢失敗時不放欄位，recall 照常回傳（fail-open）。
- **弱命中標示**：只改 `src/cli/commands/recall.ts` 的人讀輸出。`relevance < 0.3` 的命中，在該行的 relevance 後面標「弱命中」；沒有 relevance 的命中（只靠語意索引找到）不標。門檻寫成同檔的常數。
- **人讀輸出的兩行說明**：`vector_hits === 0` 時印「語意查詢有執行，沒有命中」；`project_known === false` 時印「這個 project 沒有任何記憶；已登記的名稱見 `memoria repo list`」。
- 型別：recall 的 meta 型別（`src/core/types.ts`）加兩個選用欄位。`route_mode`、`fallback_used`、`confidence`、`confidence_basis` 與 telemetry 都不動。

## 實作步驟

1. 📝 **基準（SCN-001～006 的回歸前提）** — 在隔離資料根以 `MEMORIA_EMBED_PROVIDER=stub` 跑 keyword、hybrid、vector 三種模式的查詢，各存一份 `--json`；跑 GitNexus impact（`recall`）。相依：無。
   - 完成判準：基準檔已保存，impact 結果記入本步驟；HIGH／CRITICAL 已告知使用者。
   - 完成證據：
2. 📝 **SCN-001、SCN-002：`vector_hits`** — 在 `test-vector-recall.sh` 先寫斷言取得紅燈，再改 `recall()` 與型別。相依：步驟 1。
   - 完成判準：兩個 Scenario 綠燈，非 vector 模式沒有這個欄位。
   - 完成證據：
3. 📝 **SCN-003、SCN-004：`project_known`** — 在 `test-cli-memory.sh` 先寫斷言取得紅燈，再實作。相依：步驟 1。
   - 完成判準：兩個 Scenario 綠燈，沒帶 `--project` 時沒有這個欄位。
   - 完成證據：
4. 📝 **SCN-005：弱命中標示** — 在 `test-cli-memory.sh` 斷言人讀輸出的標示，並以 `--json` 比對步驟 1 的基準。相依：步驟 1。
   - 完成判準：標示正確；`--json` 去掉新欄位後與基準相同。
   - 完成證據：
5. 📝 **SCN-006：HTTP** — 在 `test-http-api.sh` 斷言 `POST /v1/recall` 的 meta 帶兩個欄位。相依：步驟 2、3。
   - 完成判準：斷言綠燈，`http-mcp` 組腳本全綠。
   - 完成證據：
6. 📝 **回歸與常青文件** — 重跑步驟 1 的查詢並比對基準；更新 `docs/CLI.md`、`docs/CLI.zh-TW.md`、`docs/API.md`、`docs/API.zh-TW.md`、`AGENTS.md` HTTP 段、`docs/agents/architecture.md`。相依：步驟 2～5。
   - 完成判準：去掉新欄位後與基準逐位元組相同；`core`、`http-mcp` 組全綠。
   - 完成證據：

## 測試策略

| 驗收編號 | 測試層級 | 腳本 |
|---|---|---|
| SCN-001、SCN-002 | CLI 端到端（stub provider） | `scripts/test-vector-recall.sh` |
| SCN-003、SCN-004、SCN-005 | CLI 端到端 | `scripts/test-cli-memory.sh` |
| SCN-006 | HTTP 契約 | `scripts/test-http-api.sh` |
| 其餘輸出不變 | 基準比對 | 步驟 1、6 |

本機跑測試前依 project.md 地雷 M-4，先清掉 shell 帶進來的 `LIBSQL_URL`、`MEMORIA_EMBED_PROVIDER`、`MEMORIA_VECTOR_TIMEOUT_MS`、`MEMORIA_HOME`。
