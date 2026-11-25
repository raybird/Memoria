# Issue 34 - recall 把同一則筆記列兩次，top-k 實際只剩一半不同的內容 (Small)

## 概述

`remember` 寫入一則筆記時，會用同一個內容指紋建兩筆資料：session `note-<指紋>` 與事件 `noteev-<指紋>`（`src/core/memoria.ts:475-476`）。recall 把兩筆各當成一個命中，所以同一則筆記常佔掉兩個名額。2026-11-25 對 9 個下游 session 做使用體驗調查，有 5 份回報這個問題，其中一份的 top-5 裡只有 3 則不同的內容。

brief 已經有同樣的合併（`collapseNotePairs`，`src/core/db/brief.ts:76`），recall 沒有。本 issue 讓 recall 一則筆記只佔一格，空出的名額由下一則不同的記憶補上。

## 涉及檔案

- `src/core/memoria.ts` - `recall()`：排序後、截斷前合併筆記的兩筆；各路由先多取一些候選，合併後仍能湊滿 top-k
- `scripts/test-cli-memory.sh` - 新增：同一則筆記只出現一次、top-k 補滿、非筆記命中不受影響
- `docs/agents/architecture.md` - recall 語意補一句「同一則筆記只回一筆」

## 驗收條件

1. **AC-1**：查詢同時命中某則筆記的 `note-` 與 `noteev-` 時，結果只留排名較前的那一筆，另一筆不出現。檢查方式：在隔離資料根 remember 一則筆記，以能同時命中兩筆的查詢跑 `recall --json`，斷言結果裡這個指紋只出現一次。
   - 失敗路徑：兩筆都出現，或兩筆都消失。
2. **AC-2**：合併後結果仍是 top-k 則不同的記憶；候選不足 k 則時，只回實際有的數量。檢查方式：寫入超過 k 則都會命中的筆記，`--top-k 3` 回 3 則不同指紋；只寫 2 則時回 2 則。
   - 失敗路徑：合併後不到 k 則，但還有沒列出的相關筆記。
3. **AC-3**：不是成對筆記的命中（git 促升的 `gitdec-`／`gitsum-`、`sync` 匯入的 session）照原樣回傳，順序與數量和改動前相同。檢查方式：既有的 `test-utility-ranking.sh`、`test-repo-promotion.sh`、`test-vector-recall.sh` 全綠。
   - 失敗路徑：任何既有排序或筆數的斷言轉紅。

- **核准日期**: 2026-11-25
- **核准來源**: 使用者 2026-11-25 對話中說「照這份清單開 issue」，清單第一項即本 issue；做法選「留排名較前那筆並補滿」
- **核准 commit**: 待提交

## 風險與首要驗證

- **最大風險**：多取候選再截斷時，把 hybrid 的 `fallback_used`／`route_mode` 判定、或 UFL 排序之後的順序弄亂。`routeUtility` 依 route 分組，標錯 route 會讓「哪條路由比較有用」的讀數失真（見 `memoria.ts` hybrid 分支的註解）。
- **風險等級與理由**：Medium。改動集中在一個函式，但 `recall()` 是所有 recall 入口共用的核心路徑，影響範圍廣。
- **首要驗證**：改動前先跑 `test-utility-ranking.sh`、`test-vector-recall.sh`、`test-http-api.sh` 存一份基準。改動後，非筆記命中的結果與 `route_mode` 要逐筆相同；改程式前另跑 GitNexus impact（`recall`）。
- **選擇理由**：這次只要成對筆記的行為改變，其他路徑都應該完全不變，用 characterization 對照最直接。
- **完成證據**：AC-1、AC-2 的新斷言改動前紅、改動後綠；AC-3 三支腳本全綠，`route_mode` 與基準相同。

## 實作與驗證步驟

1. 📝 **AC-3 基準** — 改動前跑 AC-3 的三支腳本與 `test-http-api.sh`，記錄全綠輸出；跑 GitNexus impact（`recall`），風險為 HIGH／CRITICAL 時先告知使用者。
   - 完成證據：
2. 📝 **AC-1、AC-2：合併成對筆記並補滿 top-k** — 在 `test-cli-memory.sh` 先寫 AC-1、AC-2 的斷言並取得紅燈，再改 `recall()`。
   - 完成證據：
3. 📝 **AC-3 回歸與文件** — 重跑步驟 1 的腳本並比對 `route_mode`，更新 `docs/agents/architecture.md`。
   - 完成證據：

## Timeline

| 日期 | 異動 |
|------|------|
| 2026-11-25 | 建立並核准 AC-1～3（來源：9 個下游 session 的使用體驗調查） |

---
**建立日期**: 2026-11-25  
**分級**: Small  
**風險**: Medium\
**狀態**: 待實作
