# Issue 12: `doctor` 不檢查向量層——升級後最容易靜默斷掉的一環，沒有任何指令會說出來

## 基本資訊

| 項目 | 內容 |
|---|---|
| Issue 編號 | 12（本地文件編號） |
| 複雜度級別 | Small（在既有 `checks[]` 陣列加項目，無 schema、無契約變更） |
| 風險等級 | Low（純診斷面；但要小心別把 opt-in 功能的「未啟用」誤報成「不健康」） |
| 狀態 | **未實作**（待排程） |
| 需求來源 | 2026-08-13 另一 session 分析 Memoria 升級機制時發現，經本 session 查證 |
| 建立日期 | 2026-08-13 |
| 相關 | [issue-10](../issue-10/README.md) 與 [issue-11](../issue-11/README.md)（本 issue 要能診斷出的兩種失效）、[issue-7](../issue-7/README.md)（同樣的「靜默漏掉」問題，當時的解法是讓 `stats` 報出 `memoryIndex` 覆蓋率） |

## 摘要

`src/cli/commands/doctor.ts:28-35` 的檢查清單共六項，全部是路徑存在性：

```
MEMORIA_HOME / memory dir / knowledge dir / sessions path / config path / sessions.db
```

向量層完全不在檢查範圍內。而向量層恰好是升級與重新部署後最容易斷掉的一段：[issue-10](../issue-10/README.md)（helper 沒被交付）與 [issue-11](../issue-11/README.md)（helper 裝了但缺 embedding 後端）兩種失效，目前**沒有任何指令會主動說出來**。

issue-10 那條路徑尤其糟：`recall` 會 fail-open 退回字面召回並正常回傳結果，所以連使用者自己跑一次都看不出差別。

## 建議檢查項目

| 檢查 | 判定 |
|---|---|
| `LIBSQL_URL` | 未設定 → **未啟用**（不是失敗） |
| helper script 可解析 | `resolveHelperScript()` 回 null → 失敗（僅在已啟用時判定） |
| embedding 後端 | provider 為 `local` 且 helper 的 `node_modules/@huggingface/transformers` 不存在 → 失敗 |
| `MEMORIA_VECTOR_RECALL_CMD` 覆寫 | 有設定時一併印出，避免診斷的是別的 helper |

## 必須保留的語意界線

**opt-in 功能未啟用 ≠ 不健康。** `doctor` 的 `ok` 是 `checks.every((c) => c.ok)`，若把「沒設 `LIBSQL_URL`」算成 `false`，等於讓所有沒用語意召回的使用者拿到紅燈——那會訓練人忽略 doctor 的輸出，比不檢查更糟。

這與 v1.24.0 CHANGELOG 對 `memoryIndex` 的處理一致：當時刻意**不**把索引落後放進 `verify`，正因為 `VerifyStatus` 沒有 `warn`、`runVerify` 的 `ok` 要求全過，而 `MemoriaCore.health()` 會呼叫它——一個落後的索引會把 `/v1/health` 拖成 unhealthy，誇大了實際狀況。

`DoctorCheck` 目前是 `{ name, ok, value, fix? }`，同樣沒有第三態。實作時要先決定：新增 `skipped`/`disabled` 狀態，或是把未啟用表達成 `ok: true` + `value: '(not enabled)'`。後者不動型別、也不動 `--json` 契約，成本較低。

## 驗收標準

- [ ] 未設 `LIBSQL_URL` 時 `doctor` 仍全綠，並明確顯示向量層未啟用
- [ ] 已設 `LIBSQL_URL` 但 helper 不存在時 `doctor` 報錯並附可行動的 `fix`
- [ ] 已設 `LIBSQL_URL`、provider 為 `local` 但缺 `@huggingface/transformers` 時 `doctor` 報錯
- [ ] `--json` 輸出結構維持向後相容
