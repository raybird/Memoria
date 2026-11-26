# Issue 40 - 一則筆記的效用只記在回報的那一半，另一半與 stale prune 都看不到 (Small)

## 概述

issue-39 的增量覆審（review-03683f0 N1，見 [issue-39 TBD-3](../issue-39/README.md#待確認事項)）發現：

- `remember` 把一則筆記存成兩列，session `note-<指紋>` 與 event `noteev-<指紋>`。`feedback --hits` 把效用記在回報的那個 id 上（`src/core/db/telemetry.ts` 的逐筆歸因），不會同時記到另一半。
- recall 的效用加權以 `hit.id` 查 `memory_utility`（`src/core/db/recall.ts` 的 `applyUtilityWeighting`）。issue-34 之後，一則筆記只留排名較前的那一半；留下的若不是當初回報的那一半，就讀不到累積的效用。
- stale prune 只用 session id 查效用（`src/core/db/prune-export.ts` 的 stale 段，節點經 `memory_node_sources` 對到 session）。回報 `noteev-` 時，那則筆記不會因為效用高而免於刪除；審查以隔離資料根實測，event id 那則的節點照樣被刪。

`mark`、`--supersedes` 與 `--durable` 已經會同時處理兩半（`src/core/memoria.ts` 的 `notePairOf`），效用回報與讀取還沒有。

本 issue 讓一則筆記的效用不論回報哪一半，recall 排序與 stale prune 都看得到。

## 涉及檔案

候選，待驗收條件決定：

- `src/core/db/telemetry.ts` - 逐筆歸因時是否同時記到另一半
- `src/core/db/recall.ts` - 效用加權是否合併兩半
- `src/core/db/prune-export.ts` - stale prune 的效用豁免是否合併兩半
- `scripts/test-utility-ranking.sh`、`scripts/test-prune.sh` - 回歸測試

## 驗收條件

待 TBD-1 決定後撰寫，目前沒有已核准的驗收條件。

## 風險與首要驗證

- **最大風險**：合併兩半的效用會改變既有資料的排序與 prune 結果；同一次回報若兩半都被列進 `--hits`，可能重複計算。
- **風險等級與理由**：Medium。效用是 recall 排序與 prune 保留的輸入，既有資料已依舊方式寫入。
- **首要驗證**：在隔離資料根以現行程式重現兩件事作為紅燈：回報 `noteev-` 後 stale prune 仍刪除該筆記；回報其中一半後，recall 留下另一半時排序沒有反映效用。
- **選擇理由**：這是審查實測到的可觀察形態。
- **完成證據**：待驗收條件核准後補上。

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
|---|---|---|---|
| TBD-1 | 在哪一層合併：(a) 寫入時，回報任一半就同時記到兩半（和 `mark` 一致；既有資料不會自動補）；(b) 讀取時，recall 加權與 prune 依指紋合併兩半的效用（既有資料立即生效，兩半都被回報時要避免重複計算）。建議 (b)：不必回補既有資料，也不改寫入的語意 | 待確認 | 驗收條件、涉及檔案與分級 |

## Timeline

| 日期 | 異動 |
|------|------|
| 2026-11-26 | 建立（來源：issue-39 review-03683f0 N1；使用者 2026-11-26 回「照建議」：另開 issue）；驗收條件待 TBD-1 決定 |

---
**建立日期**: 2026-11-26  
**分級**: Small  
**風險**: Medium\
**狀態**: 待確認
