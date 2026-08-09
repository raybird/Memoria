# Issue 7: promotion 不建 `memory_node`，導致向量 ingest 靜默漏掉絕大多數記憶

## 基本資訊

| 項目 | 內容 |
|---|---|
| Issue 編號 | 7（本地文件編號） |
| 複雜度級別 | 待評估（傾向 Medium；行為變更需先確認效能與正確性） |
| 狀態 | **待評估**（分析完成，未拍板、未實作） |
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

## 修法選項（未拍板）

| 方案 | 說明 | 疑慮 |
|---|---|---|
| A. `promoteSummary` 後順帶 `buildMemoryIndex` | 成因處直接修，促升後立即可被 tree / payload 看見 | 促升在 `repo sync` 熱路徑上，每次促升多一次索引建置；且 `promoteSummary` 目前是純 DB 寫入（`withDb` 內的 transaction），加索引會擴大它的職責與交易範圍 |
| B. `build-mcp-bridge-payload.mjs` 前置呼叫 index build | 只影響離線 ingest 路徑，不動熱路徑 | 治標；`tree` 模式的缺口仍在 |
| C. payload 範圍改為由 `sessions` 驅動，`memory_nodes` 僅作補充 | 從根本解除兩者的耦合 | 改動 payload 語意與增量 cursor 機制，影響面最大 |
| D. 不修，文件明載「ingest 前先跑 `memoria index build`」 | 零風險 | 靠人記得；正是目前狀態（v1.23.1 已寫入 OPERATIONS） |

**傾向 A**，但需先量測 `buildMemoryIndex` 在大型 repo 促升時的成本，並確認它與 `promoteSummary` 的交易邊界不衝突。

## 待確認

1. `buildMemoryIndex` 對單一 session 的成本（`repo sync` 一次可能促升多筆摘要）。
2. `tree` 模式召不到 git 記憶，是既有設計取捨還是同一個疏漏？——這會決定要修成因（A/C）還是只補 ingest（B）。
3. 若採 A，既有資料庫仍需一次性 `index build` 回填；是否放進 migration。

## Timeline

| 日期 | 事件 |
|---|---|
| 2026-08-09 | 接語意召回時發現；當下以 `memoria index build` 繞過，並把步驟寫入 OPERATIONS；建立本 issue 待評估 |

---
**建立日期**: 2026-08-09
**最後更新**: 2026-08-09
**文件版本**: 1.0
**狀態**: **待評估**
