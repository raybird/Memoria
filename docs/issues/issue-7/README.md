# Issue 7: promotion 不建 `memory_node`，導致向量 ingest 靜默漏掉絕大多數記憶

## 基本資訊

| 項目 | 內容 |
|---|---|
| Issue 編號 | 7（本地文件編號） |
| 複雜度級別 | Medium（兩個呼叫點各加一次索引建置 + 一項 verify 檢查，無 schema 變更） |
| 狀態 | **實作完成**（2026-08-09） |
| 需求來源 | 2026-08-09 實際把語意召回接上本機 `~/.memoria` 時發現 |
| 建立日期 | 2026-08-09 |
| 相關 | [issue-1](../issue-1/README.md)（promotion 管線）；同批發現的另一項（helper 不入 npm 包）已於 v1.23.1 修復 |

## 摘要

`promoteSummary()` 把 git 摘要促升成記憶時，寫入 `sessions` / `events` / `memory_sources` / `memory_checkpoints`，但**不呼叫 `buildMemoryIndex`**——而 `remember()` 會。

`build-mcp-bridge-payload.mjs` 的涵蓋範圍是由 `memory_nodes` 驅動的（先取 `updated_at > cursor` 的節點，再回推 `memory_node_sources` 對應的 session）。兩者相接的結果：**以 `repo sync` 為主的資料庫，bridge payload 會靜默漏掉絕大多數記憶**，向量索引因此形同虛設，而過程中沒有任何錯誤或警告。

## 實測證據（2026-08-09，本機 `~/.memoria`）

```
sessions 共 10：gitsum-* 7 筆（repo sync 促升）、note-* 3 筆（CLI remember）
memory_node_sources 涵蓋的 session：只有 3 筆 note-*
→ 7 筆 git 促升記憶全部沒有 memory_node
```

| 階段 | payload 實體數 | 涵蓋 session |
|---|---|---|
| 直接產 payload | 17 | 3 / 10 |
| 先跑 `memoria index build`（21 nodes / 14 links）後再產 | **104** | **10 / 10** |

也就是 **70% 的記憶不會進向量庫**，而使用者完全不會察覺——ingest 回報 `{"ok":true,"embedded":N}`，只是那個 N 少得多。

## 影響面

| 路徑 | 是否受影響 |
|---|---|
| 向量 ingest（`vector-ingest.mjs`） | **是**，這是主要受害者 |
| MCP bridge（`mcp-memory-libsql`） | **是**，同一份 payload |
| 本地 keyword / hybrid 召回 | 否——走 `recall_fts`，與 `memory_nodes` 無關 |
| `tree` 模式召回 | **是**，tree 走 `memory_nodes`，git 促升記憶本來就不在 tree 索引裡 |

> 附帶觀察：`tree` 模式召不到 git 促升的記憶，是同一個成因的另一面，且**先於**向量議題存在。

## 修法選項（評估前的初始列舉，結論見下一節）

| 方案 | 說明 | 疑慮 |
|---|---|---|
| A. `promoteSummary` 後順帶 `buildMemoryIndex` | 成因處直接修，促升後立即可被 tree / payload 看見 | 促升在 `repo sync` 熱路徑上，每次促升多一次索引建置；且 `promoteSummary` 目前是純 DB 寫入（`withDb` 內的 transaction），加索引會擴大它的職責與交易範圍 |
| B. `build-mcp-bridge-payload.mjs` 前置呼叫 index build | 只影響離線 ingest 路徑，不動熱路徑 | 治標；`tree` 模式的缺口仍在 |
| C. payload 範圍改為由 `sessions` 驅動，`memory_nodes` 僅作補充 | 從根本解除兩者的耦合 | 改動 payload 語意與增量 cursor 機制，影響面最大 |
| D. 不修，文件明載「ingest 前先跑 `memoria index build`」 | 零風險 | 靠人記得；正是目前狀態（v1.23.1 已寫入 OPERATIONS） |

當時傾向 A，但三項疑慮未經查證。**下一節逐項查證後，A 成立且形狀有修正**（索引建置放呼叫端而非 `promoteSummary` 內部）。

## 已查證（2026-08-09）

### Q1 · `buildMemoryIndex` 的成本 → **不是問題**

實測（`importSession` 造合成語料，形態比照 promotion 產出的「一 session + 3 個 DecisionMade」）：

| 語料規模 | 單一 session 建 index | 全量重建 |
|---|---|---|
| 100 sessions | median 3.27ms / p95 4.22ms | 12ms（240 nodes） |
| 1000 sessions | median 2.63ms / p95 3.67ms | 75ms（2940 nodes） |

單筆成本**不隨語料規模成長**。一次 `repo sync` 促升通常是個位數筆，即使 10 筆也只有 ~30ms，而 `repo sync` 本身要跑 git 命令、掃 commits、產摘要，是數百 ms 到數秒的量級。**方案 A 的效能疑慮排除。**

### Q2 · 設計取捨還是疏漏？ → **疏漏**

issue-1 的技術分析已經寫明意圖（`docs/issues/issue-1/technical-analysis.md:74`）：

> 資料流關鍵：**promotion 寫入既有 `events` 表**（新 event_type 或沿用 `DecisionMade`），使其自動進入 FTS 與 **`buildMemoryIndex` 的既有路徑**；`memory_sources` 表只負責 provenance 回鏈。不建立平行 recall 體系。

`requirement-analysis.md:108`（X3）同樣要求「promotion 必須寫入 recall 的資料路徑，而非平行體系」。

落差出在**兩條路徑的觸發機制不同**：FTS 由 trigger 維護（寫入即自動生效），`buildMemoryIndex` 卻是批次命令（必須明確呼叫）。設計者假設「寫進 `events` 就會自動進兩者」，實作只滿足了 FTS。

**所以要修成因（A/C），不是只補 ingest（B）。**

### Q3 · 既有資料庫如何回填 → **不能用 migration**

`recall.ts:6` 已經 `import { initDatabase } from './schema.js'`，migration 若反向 import `buildMemoryIndex` 會形成循環 import。在 migration 內複製一份索引邏輯則是更糟的重複。

改為：**`verify` 加一項覆蓋率檢查**（`runVerify` 本來就開 DB，且已有 `VerifyCheck { id, status, detail }` 結構）——回報有多少 session 缺 `memory_node`，並提示跑 `memoria index build`。回填本身極便宜（1000 sessions 全量 75ms），只是不該靜默。

> `doctor` 不適合：它只做路徑存在性檢查，完全不開 DB。

## 建議方案（依查證結果收斂）

1. **主修（成因）**：促升成功後呼叫 `buildMemoryIndex(dbPath, { sessionId })`。落點在**呼叫端**——`src/core/memoria.ts:971`（`repo sync` 自動促升）與 `:1097`（`repoSubmitSummary`）——而**不是** `promoteSummary` 內部：後者是 `withDb(...)` 內的 `db.transaction(...)`，把索引建置塞進去會擴大它的職責，也可能造成巢狀交易。
2. **回填可見化**：`verify` 新增 `memory_index_coverage` 檢查，缺 node 時 `warn` + 提示 `memoria index build`。**（實作時推翻，見 R1）**
3. **不做**：方案 B（只補 ingest 前置）已被 Q2 否決；方案 C（payload 改由 sessions 驅動）影響 cursor 增量機制，收益不及風險。

驗收要點：促升後不必手動 `index build`，`tree` 模式即可召回 git 記憶；bridge payload 涵蓋全部 session；既有 DB 在 `verify` 看得到缺口。

## 實作後追加

### R1 · 覆蓋率檢查不能放 `verify`，改放 `stats`

建議方案 2 寫「`verify` 加檢查，缺 node 時 `warn`」，實作時發現**兩個前提都不成立**：

- `VerifyStatus` 只有 `'pass' | 'fail'`（`src/core/types.ts:132`），**沒有 `warn`**。要加就得改型別，牽動所有 check 的消費端與既有 e2e 契約。
- `runVerify` 的 `ok` 是 `checks.every((c) => c.status === 'pass')`（`verify.ts:90`），而 **`MemoriaCore.health()` 也呼叫 `runVerify`**——把「索引落後」報成 `fail`，`/v1/health` 就會變成不健康。那是過度反應：索引沒跟上不是資料庫損壞，promoted 記憶透過 FTS 照樣召得回來。

改放 `stats`：新增 `memoryIndex { sessions, indexed, missing }`，`missing > 0` 時人讀輸出才多印兩行（含 `memoria index build` 的修復指引），全數索引時完全不出聲。純資訊、不參與任何健康判定，也沿用 stats 既有的加法紀律。

### R2 · 實測確認 `tree` 缺口同步修復

修好促升路徑後，`tree` 模式即可召回 git 記憶（`test-repo-promotion.sh` 斷言 `tree` 命中 > 0）。這驗證了 Q2 的判斷——兩個症狀確實同源。

## Timeline

| 日期 | 事件 |
|---|---|
| 2026-08-09 | 接語意召回時發現；當下以 `memoria index build` 繞過，並把步驟寫入 OPERATIONS；建立本 issue 待評估 |
| 2026-08-09 | 三項待確認查證完畢：成本非問題（實測）、屬疏漏而非取捨（issue-1 技術分析原文）、migration 不可行（循環 import）→ 方案收斂為「呼叫端補索引 + verify 覆蓋率檢查」，狀態轉待實作 |
| 2026-08-09 | 實作完成：兩個呼叫點補 `indexPromotedSession`；覆蓋率改放 `stats`（R1）；`test-repo-promotion.sh` 加索引覆蓋與 tree 召回斷言 |

---
**建立日期**: 2026-08-09
**最後更新**: 2026-08-09
**文件版本**: 2.0
**狀態**: **實作完成**
