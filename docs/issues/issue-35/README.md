# Issue 35 - recall 查不到或只查到弱命中時，輸出說不出原因

## 文件清單
- [implementation-plan.md](./implementation-plan.md)

## 概述

2026-11-25 對 9 個下游 session 做使用體驗調查，有三種情況會讓呼叫端讀不懂 recall 的結果：

1. **語意查詢跑了但 0 筆。** 指定 `--mode vector`、helper 正常回應但沒有命中時，`route_mode` 會是 `keyword`，`fallback_used` 是 `false`（`src/core/memoria.ts:753-755`），看起來就像語意查詢根本沒跑。有 2 份回報因此以為 `--mode vector` 失效；這兩筆查詢在 telemetry 的耗時是 1164 ms 與 1277 ms，表示 helper 確實執行過。
2. **帶了 `--project` 卻 0 筆。** 這個 project 在資料庫裡完全沒有記憶時，和「有記憶但這次查不到相關的」輸出一模一樣。有 2 個下游的專案沒有登記，agent 得另外跑 `repo list` 才知道原因，其中一個因此一開始就跳過了 recall。
3. **沒有相關記憶時仍補滿 top-k。** keyword 模式會回 top-k 筆只沾到一兩個字的命中（有一份回報是 8 筆、relevance 全是 0.125），人讀輸出不容易和「沒有紀錄」區分。

issue-18 決定過「不新增 `route_mode` 值」：`route_mode` 是公開契約，`routeUtility` 也依它分組。所以本 issue 只在 meta 加欄位，並調整 CLI 的人讀輸出；`route_mode` 的值、recall 回傳的命中與排序都不變。

## 現況

**現行 review**: review-c57fa47.md

## 關鍵差異

| 項目 | 變更前 | 變更後 |
|------|--------|--------|
| vector 模式、語意 0 筆 | `route_mode: keyword`，沒有其他線索 | `route_mode` 不變；meta 多 `vector_hits: 0`，人讀輸出多一行說明 |
| `--project` 指向沒有任何記憶的 project | 與「沒有相關命中」無法區分 | meta 多 `project_known: false`，人讀輸出提示改用 `repo list` 的名稱 |
| relevance 很低的命中 | 和一般命中列法相同 | 照常回傳；人讀輸出在該行標「弱命中」 |

## 涉及檔案

```text
src/core/
├── memoria.ts          # 可改：recall() 的 meta 加 vector_hits、project_known
├── types.ts            # 可改：recall meta 型別
├── db/recall.ts        # 可改：查詢某 project 有沒有任何記憶
└── recall-vector.ts    # 不可觸及：helper 契約與降級矩陣不變
src/cli/commands/recall.ts  # 可改：人讀輸出的三種提示
scripts/test-vector-recall.sh、scripts/test-cli-memory.sh、scripts/test-http-api.sh  # 可改：新增斷言
docs/CLI.md、docs/CLI.zh-TW.md、docs/API.md、docs/API.zh-TW.md、AGENTS.md、docs/agents/architecture.md  # 常青文件
```

## Gherkin 驗收劇本

```gherkin
Feature: recall 的輸出能說明查不到或只查到弱命中的原因

  Background:
    Given 一個已初始化的隔離資料根，裡面有 project "alpha" 的記憶

  @SCN-001
  Scenario: vector 模式的語意查詢沒有命中
    Given 語意召回已啟用，helper 正常回應但這次查詢沒有任何語意命中
    When 以 --mode vector --json 執行 recall
    Then meta.route_mode 與變更前相同，為 "keyword"
    And meta.vector_hits 為 0
    And 人讀輸出多一行，說明語意查詢有執行但沒有命中

  @SCN-002
  Scenario: vector 模式的語意查詢有命中
    Given 語意召回已啟用，這次查詢有 2 筆語意命中
    When 以 --mode vector --json 執行 recall
    Then meta.vector_hits 為 2，route_mode 與變更前相同
    And 非 vector 模式的 recall 沒有 vector_hits 欄位

  @SCN-003
  Scenario: --project 指向沒有任何記憶的 project
    When 以 --project "beta" --json 執行 recall
    Then 結果為 0 筆，meta.project_known 為 false
    And 人讀輸出提示這個 project 沒有任何記憶，並指向 repo list 列出的名稱

  @SCN-004
  Scenario: --project 有記憶但這次沒有相關命中
    When 以 --project "alpha" 和不相關的查詢 --json 執行 recall
    Then 結果為 0 筆，meta.project_known 為 true
    And 沒帶 --project 的 recall 沒有 project_known 欄位

  @SCN-005
  Scenario: 弱命中照常回傳，人讀輸出加上標示
    Given 有幾則記憶只和查詢共用一個字
    When 執行 recall
    Then 回傳的命中、順序與 --json 輸出和變更前相同
    And 人讀輸出中 relevance 低於 0.3 的命中，在該行標示「弱命中」
    And 只靠語意索引命中、沒有 relevance 的命中不標示

  @SCN-006
  Scenario: HTTP 與 CLI 回傳相同的 meta 欄位
    When 透過 POST /v1/recall 送出與 SCN-001、SCN-003 相同的查詢
    Then 回應的 meta 帶有相同的 vector_hits 與 project_known
```

## Gherkin 核准紀錄
- **核准 commit**: fec4368
- **核准來源**: 使用者 2026-11-25 對話中說「照這份清單開 issue」，三題分別選「meta 加 vector_hits 欄位」「meta 加 project_known」「只標示、不濾掉」（SCN-001～006）

全部 Scenario 於 2026-11-25 核准。

## 重構步驟概要

任務清單與狀態只在 [implementation-plan.md](./implementation-plan.md)「實作步驟」維護。

## 風險與首要驗證

- **最大風險**：新欄位改到既有的 recall 契約，例如 `route_mode` 的值、`confidence`、命中順序跟著變了，或 telemetry 與 `routeUtility` 的分組被動到。下游 adapter 與 UFL 校準都依這些欄位運作。
- **風險等級與理由**：Medium。只加欄位、只改人讀輸出，但改的是所有 recall 入口共用的 `recall()` 與 HTTP 回應。
- **首要驗證**：改動前，在隔離資料根以 stub provider 對 keyword、hybrid、vector 三種模式各跑一組查詢，保存 `--json` 輸出作基準。改動後去掉新欄位再比對，必須逐位元組相同；另跑 GitNexus impact（`recall`）。
- **選擇理由**：這次的承諾是「只多欄位」，直接比對去掉新欄位的輸出，最能證明其餘都沒變。
- **完成證據**：基準比對相同；SCN-001～006 的新斷言改動前紅、改動後綠；`http-mcp` 組腳本全綠。

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
|---|---|---|---|
| TBD-1 | 計畫原把 `vector_hits` 定為 `vectorOutcome.rows.length`，但每則筆記在語意索引裡有 session 與 event 兩列，基準資料中回 2 則筆記時這個值是 4，和 `data` 的筆數對不起來 | 已解決（2026-11-26 實作時決定，2026-11-26 使用者對 review-14b4625 回「照建議」時一併確認）：改以 `data` 的單位計數，一則筆記的兩列算一則；SCN-002 的「2 筆語意命中」本來就以筆記計，Gherkin 不變。最後的定義見 TBD-3 | SCN-002 |
| TBD-2 | libSQL 的向量索引是近似搜尋：同一份 4 列資料重建 25 次，有 2 次 helper 只回其中一則筆記的兩列（2026-11-26 實測），SCN-002 的測試因此偶發失敗過一次 | 不影響本次交付（2026-11-26 整理）。追蹤：無；SCN-002 的測試先確認 helper 回滿 4 列，沒有就重建索引（最多 5 次），斷言本身不放寬；issue-34 的語意補滿測試用 10 列、只要 3 則，今天跑了約 12 次沒有失敗過 | SCN-002、SCN-006 |
| TBD-3 | review-14b4625 S1：`vector_hits` 只算 helper 前 top_k 列，觸發 issue-34 補位時，補位那一輪用的是 2 × top_k 列，會少算（實測 5 則筆記全部來自語意命中，卻報 3）；被取代的記憶也被算進去 | 已解決（2026-11-26 使用者選「修正」）：改成計算最後一輪路由實際融合的語意列，先扣掉被取代的記憶，成對筆記算一則。測試與紅綠燈證據見計畫步驟 2 | SCN-001、SCN-002 |
| TBD-4 | review-14b4625 N1：SCN-002 的前提檢查用 topK 5 問 helper，recall 實際送 15，前提比實際嚴格 | 已解決（2026-11-26 使用者選「修正」）：前提檢查改用 15，抽成 `build_full_index35`，補位測試也共用 | SCN-002 |
| TBD-5 | review-14b4625 N2：tree 路由過濾的是 `memory_nodes.project`，舊資料若 project 為 NULL，可能一邊列出命中、一邊印「這個 project 沒有任何記憶」 | 已解決（2026-11-26 使用者選「修正」）：只在 0 筆時印這行提示；`project_known` 欄位照舊依 sessions 判定。沒有另寫測試，因為要造出舊格式資料；SCN-003 的 0 筆情況照常會印 | SCN-003 |
| TBD-6 | review-14b4625 N3：「已登記的名稱見 memoria repo list」列不出不屬於任何 repository 的 project | 不影響本次交付（2026-11-26 使用者選「不修」）。追蹤：無；這是 SCN-003 核准的寫法 | SCN-003 |
| TBD-7 | review-14b4625 N4：資料庫不存在、以及查詢太短被略過時，兩個新欄位都不會出現，API 文件沒寫 | 已解決（2026-11-26 使用者選「修正」）：API.md 與 API.zh-TW.md 各補一句 | SCN-006 |
| TBD-8 | review-14b4625 N5：計畫步驟 1 沒寫明 GitNexus impact 的 CRITICAL 結果已經告知使用者 | 已解決（2026-11-26 使用者選「修正」）：步驟 1 證據已補上 | 無 |

## Timeline

| 日期 | 異動 |
|------|------|
| 2026-11-25 | 建立並核准 SCN-001～006（來源：9 個下游 session 的使用體驗調查） |
| 2026-11-26 | 實作完成：`vector_hits` 改以筆記計（TBD-1）；SCN-006 的 `vector_hits` 斷言放在 test-vector-recall.sh |
| 2026-11-26 | review-14b4625 PASS，附 1 項 SHOULD FIX、5 項 NICE TO HAVE；使用者回「照建議」，修正 S1、N1、N2、N4、N5（TBD-3～8），送增量覆審 |

---
**建立日期**: 2026-11-25  
**分級**: Medium（recall meta 加兩個欄位 + CLI 人讀輸出 + HTTP 同步；零 schema 變更、零新依賴）  
**風險**: Medium — `recall()` 是共用核心路徑，承諾只加欄位、其餘輸出不變\
**狀態**: 實作中
