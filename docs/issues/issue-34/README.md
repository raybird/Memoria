# Issue 34 - recall 把同一則筆記列兩次，top-k 實際只剩一半不同的內容 (Small)

## 概述

`remember` 寫入一則筆記時，會用同一個內容指紋建兩筆資料：session `note-<指紋>` 與事件 `noteev-<指紋>`（`src/core/memoria.ts:475-476`）。recall 把兩筆各當成一個命中，所以同一則筆記常佔掉兩個名額。2026-11-25 對 9 個下游 session 做使用體驗調查，有 5 份回報這個問題，其中一份的 top-5 裡只有 3 則不同的內容。

brief 已經有同樣的合併（`collapseNotePairs`，`src/core/db/brief.ts:76`），recall 沒有。本 issue 讓 recall 一則筆記只佔一格，空出的名額由下一則不同的記憶補上。

## 涉及檔案

- `src/core/memoria.ts` - `recall()`：排序後、截斷前合併筆記的兩筆；合併後不足 top-k 且路由填滿視窗時，以 2 × top-k 再跑一次路由
- `src/core/utils.ts` - `collapseNoteHits`；`noteFingerprintOf` 從 `src/core/db/brief.ts` 移來共用
- `src/core/recall-vector.ts` - 另回傳截斷前的 `candidates`，補滿時沿用同一次 helper 的結果，不重跑 embedding
- `scripts/test-cli-memory.sh` - 新增：同一則筆記只出現一次、top-k 補滿（keyword、hybrid）
- `scripts/test-vector-recall.sh` - 新增：vector 模式補滿 top-k，且一次 recall 只跑一次 helper
- `docs/agents/architecture.md`、`AGENTS.md` - recall 語意補「同一則筆記只佔一格」

## 驗收條件

1. **AC-1**：查詢同時命中某則筆記的 `note-` 與 `noteev-` 時，結果只留排名較前的那一筆，另一筆不出現。檢查方式：在隔離資料根 remember 一則筆記，以能同時命中兩筆的查詢跑 `recall --json`，斷言結果裡這個指紋只出現一次。
   - 失敗路徑：兩筆都出現，或兩筆都消失。
2. **AC-2**：合併後結果仍是 top-k 則不同的記憶；候選不足 k 則時，只回實際有的數量。檢查方式：寫入超過 k 則都會命中的筆記，`--top-k 3` 回 3 則不同指紋；只寫 2 則時回 2 則。
   - 失敗路徑：合併後不到 k 則，但還有沒列出的相關筆記。
3. **AC-3**：不是成對筆記的命中（git 促升的 `gitdec-`／`gitsum-`、`sync` 匯入的 session）照原樣回傳，順序與數量和改動前相同。檢查方式：既有的 `test-utility-ranking.sh`、`test-repo-promotion.sh`、`test-vector-recall.sh` 全綠。
   - 失敗路徑：任何既有排序或筆數的斷言轉紅。

- **核准日期**: 2026-11-25
- **核准來源**: 使用者 2026-11-25 對話中說「照這份清單開 issue」，清單第一項即本 issue；做法選「留排名較前那筆並補滿」
- **核准 commit**: fec4368

## 風險與首要驗證

- **最大風險**：多取候選再截斷時，把 hybrid 的 `fallback_used`／`route_mode` 判定、或 UFL 排序之後的順序弄亂。`routeUtility` 依 route 分組，標錯 route 會讓「哪條路由比較有用」的讀數失真（見 `memoria.ts` hybrid 分支的註解）。
- **風險等級與理由**：Medium。改動集中在一個函式，但 `recall()` 是所有 recall 入口共用的核心路徑，影響範圍廣。
- **首要驗證**：改動前先跑 `test-utility-ranking.sh`、`test-vector-recall.sh`、`test-http-api.sh` 存一份基準。改動後，非筆記命中的結果與 `route_mode` 要逐筆相同；改程式前另跑 GitNexus impact（`recall`）。
- **選擇理由**：這次只要成對筆記的行為改變，其他路徑都應該完全不變，用 characterization 對照最直接。
- **完成證據**：AC-1、AC-2 的新斷言改動前紅、改動後綠；AC-3 三支腳本全綠，`route_mode` 與基準相同。

## 實作與驗證步驟

1. ✅ **AC-3 基準** — 改動前跑 AC-3 的三支腳本與 `test-http-api.sh`，記錄全綠輸出；跑 GitNexus impact（`recall`），風險為 HIGH／CRITICAL 時先告知使用者。
   - 完成證據：2026-11-25 在 `main`（eb654e2）`pnpm run build` 後，以 `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME bash scripts/{名稱}.sh`（地雷 M-4）跑 `test-utility-ranking`、`test-repo-promotion`、`test-vector-recall`、`test-http-api`、`test-cli-memory`，exit 皆 0。GitNexus impact（`MemoriaCore.recall`，upstream）為 CRITICAL：直接呼叫者 6 個（HTTP `createServer`、CLI recall、`searchMemories`、`fileQuery`、`verifyVectorReadiness`、memory-browser 驅動），9 條流程、5 個模組；已在對話中告知使用者，回歸因此擴大到 CI 全部五組。
2. ✅ **AC-1、AC-2：合併成對筆記並補滿 top-k** — 在 `test-cli-memory.sh` 先寫 AC-1、AC-2 的斷言並取得紅燈，再改 `recall()`。
   - 完成證據：單迴圈合併，理由：AC-1、AC-2 的可觀察層就是 `recall --json` 的結果，CLI 端到端斷言已涵蓋從路由、排序到截斷的整條路徑，沒有另一層整合責任。
   - 紅燈（2026-11-25，改動前原始碼）：`bash scripts/test-cli-memory.sh` exit 1，`mode=keyword: fingerprint ba33996087373d1a appears 2 times (want 1)`；手動探測 keyword、hybrid 都回 `note-{fp} noteev-{fp}`，`--top-k 3` 對 5 則筆記只有 2 則不同指紋；tree 本來就只回 session 那筆，且 5 則只回 2 則（tree 路由自身的候選數），所以 AC-2 斷言只涵蓋 keyword、hybrid，AC-1 保留 tree 當守門。vector 模式的新斷言（`test-vector-recall.sh`）以 stash 掉 `src/` 的建置跑，exit 1，`--top-k 3 應回 3 則不同筆記，實際 noteev-68f580e02f5c2fab note-68f580e02f5c2fab noteev-017e900a65db44c2`。
   - 綠燈：改動後 `bash scripts/test-cli-memory.sh` exit 0（AC-1 三種模式各一次；AC-2 5 則時 `--top-k 3` 回 3 則不同、2 則時回 2 則）；`bash scripts/test-vector-recall.sh` exit 0（`route_mode=vector`、3 則不同筆記、計數 wrapper 記到 helper 只跑一次）。
   - 精煉：code-simplify 檢查一次為 no-op，`runRoutes`／`rank` 只承接原本內聯的流程，沒有可再合併的重複，沿用上面的綠燈。
3. ✅ **AC-3 回歸與文件** — 重跑步驟 1 的腳本並比對 `route_mode`，更新 `docs/agents/architecture.md`。
   - 完成證據：2026-11-25 改動後 `pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`、`bash -n install.sh`、`pnpm run release:docs-check` 通過；CI 的 core、adapters、wiki、http-mcp、repo 五組共 32 支腳本依序執行（同樣清掉 M-4 的變數），exit 皆 0。步驟 1 的四支腳本輸出與基準正規化後比對：`test-utility-ranking`、`test-http-api` 完全相同；`test-repo-promotion` 只差隨機 port 與測試 repo 的隨機 SHA；`test-vector-recall` 只差並行 ingest 期間的 recall 次數與新增段落。
   - 真實資料對照：以 `sqlite3 -readonly` 備份本機資料庫兩份，舊、新建置各跑 25 個查詞 × keyword／tree／hybrid × top-k 5、10。舊結果沒有成對筆記的 78 組，新結果的 id、順序、relevance、`route_mode`、`fallback_used` 逐筆相同（score 含以當下時間算的衰減，容許 1e-6 相對誤差）。有成對筆記的 72 組，新結果都沒有重複指紋，筆數都補到 2k 視窗內可得的不同筆數；其中 2 組（hybrid「migration」k=5、「fallback」k=10）非筆記命中的相對順序改變，見 TBD-1。
   - 文件：`docs/agents/architecture.md` recall 段與最後驗證日期、`AGENTS.md` 的 `recall(filter)` 說明。

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
|---|---|---|---|
| TBD-1 | 有成對筆記而觸發補滿時，結果等於路由在 2 × top-k 視窗下的管線結果再去掉成對的那筆，因此非筆記命中的相對順序可能和改動前不同：hybrid 原本 k 筆內沒有任何命中帶 utility 時，`applyUtilityWeighting` 原樣回傳（tree 在前、不依分數排序），視窗加深後有命中帶 utility 就整批依分數重排。實例 hybrid「migration」k=5，新結果的順序和舊版 k=10 去掉成對那筆後相同。同理，補滿時被 superseded 濾掉的空位也會一起補上。沒有成對筆記的查詢不受影響。是否接受，或要求補滿時保留第一輪非筆記命中的順序 | 待確認 | AC-3 字面「順序與數量和改動前相同」在有成對筆記的查詢上不完全成立；AC-3 的檢查方式（三支腳本全綠）已通過 |

## Timeline

| 日期 | 異動 |
|------|------|
| 2026-11-25 | 建立並核准 AC-1～3（來源：9 個下游 session 的使用體驗調查） |

---
**建立日期**: 2026-11-25  
**分級**: Small  
**風險**: Medium\
**狀態**: 實作完成，待審查
