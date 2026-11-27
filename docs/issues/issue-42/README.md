# Issue 42 - 已促升的摘要重新寫回後，recall 仍是舊內容 (Small)

## 概述

2026-11-27 平行寫回 git 摘要時，downstream-b 一筆 merge 的第三個 decision，理由是寫摘要的 agent 自己推論的，commit 沒有寫。要更正時發現，重新 `repo summarize --submit` 改不到 recall 裡的內容：

- `repoSubmitSummary`（`src/core/memoria.ts`）會用新 payload 覆寫 `git_summaries` 那一列，但促升前先檢查 `!promotionExists(…)`。已促升過的摘要直接跳過促升，回 `promoted:false`。
- 促升時寫入的 recall 記憶（session `gitsum-<summary>` 的文字，與每個 decision 的 event `gitdec-<summary>-<n>`，見 `src/core/db/git-promote.ts` 的 `promoteSummary`）因此維持舊內容。`promoteSummary` 本身也是 `INSERT OR IGNORE`，即使呼叫也不會更新。
- 結果是 `git_summaries` 與 recall 對同一筆合併說法不一致。被拿掉的 decision 仍會出現在 recall 與 brief 的近期決策裡，而寫回結果的 `promoted:false` 看起來像「沒有促升」，沒有提示 recall 沒跟著變。
- 目前唯一的更正方式是 `remember "<更正內容>" --supersedes gitdec-<summary>-<n>`，但只能撤下 decision，改不到 session 的摘要文字，而且這個做法沒有寫在任何文件裡。

本 issue 讓重新寫回已促升的摘要時，recall 的內容與寫回結果一致，或至少明確告知呼叫端 recall 沒有更新。

## 涉及檔案

依 TBD-1 的決定而定，候選：

- `src/core/memoria.ts` - `repoSubmitSummary` 對已促升摘要的處理
- `src/core/db/git-promote.ts` - 更新已促升的 session 與 decision events
- `src/core/db/memory-attributes.ts` - 被拿掉的 decision 改標 superseded
- `src/core/db/schema.ts` - 只讀：events 與 sessions 的 FTS 更新 trigger 已存在（`trg_recall_fts_events_au` 等），預期不改
- `docs/CLI.md`、`docs/CLI.zh-TW.md`、`docs/API.md`、`docs/API.zh-TW.md`、`skills/memoria-memory-sync/deployed/DEPLOYED_REFERENCE.md` - 重新寫回的行為
- `scripts/test-repo-promotion.sh` - 回歸測試

## 驗收條件

待 TBD-1 決定後撰寫，目前沒有已核准的驗收條件。

## 風險與首要驗證

- **最大風險**：更新已促升的記憶會碰到掛在 `gitdec-` id 上的其他資料：效用（`memory_utility`，2026-11-27 本機有 38 筆）、標記（`memory_attributes`，3 筆）、向量索引與 tree index 的節點文字。用刪除再重建的方式會讓這些資料失去對應，或留下指向不存在記憶的列。
- **風險等級與理由**：Medium。改動的是已在 recall 裡的記憶，下游的 brief、recall 排序與 prune 都會讀它們；decision 數量變少時，id 是依序號（`-<n>`）編的，序號對應的內容可能改變。
- **首要驗證**：在隔離資料根促升一筆有 2 個 decision 的摘要，再以只有 1 個 decision、文字不同的 payload 重新寫回；以現行程式確認 recall 仍回舊文字、第二個 decision 仍在，作為紅燈。
- **選擇理由**：這是 2026-11-27 實際遇到的形態。
- **完成證據**：待驗收條件核准後補上。

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
|---|---|---|---|
| TBD-1 | 重新寫回已促升的摘要時怎麼處理。可選做法：(a) 同步更新：更新 session 文字與既有 decision 的內容；新 payload 少掉的 decision 標記 superseded（不刪除，保留效用與標記），多出的新增；向量與 tree index 由既有的「文字變了就重 embed」與 `buildMemoryIndex` 更新；(b) 拒絕：已促升的摘要重新寫回回 409 `summary_already_promoted`，提示改用 `remember --supersedes`；(c) 維持現狀，只在回傳加 `already_promoted` 說明 recall 沒有更新，並把 `--supersedes` 的做法寫進文件。建議 (a)：更正摘要是正當需求，(b)、(c) 都只能撤下 decision，改不到摘要本身的文字。decision 依序號對應的問題見 TBD-2 | 待確認 | 驗收條件、涉及檔案與風險等級 |
| TBD-2 | 採 (a) 時，新舊 decision 怎麼對應。decision 的 id 是 `gitdec-` 加摘要 id 與序號，刪掉中間一個會讓後面的序號整體位移。可選：依序號對應（簡單，但位移時效用會掛到內容不同的 decision 上）；依 decision 文字比對，相同的沿用 id，不同的視為新增並把舊的標 superseded（效用只留在內容相同的 decision 上）。建議依文字比對 | 待確認 | AC 的細節，TBD-1 選 (a) 時才需要 |
| TBD-3 | 2026-11-27 已用 `--supersedes` 撤下的那一筆（downstream-b 的 decision），本 issue 完成後是否改用新做法重做。建議不重做：supersede 結果已正確，重做沒有收穫 | 待確認 | 不影響驗收條件 |

## Timeline

| 日期 | 異動 |
|------|------|
| 2026-11-27 | 建立（來源：2026-11-27 平行寫回 git 摘要時，downstream-b 一筆推論出的 decision 只能用 `--supersedes` 撤下；使用者 2026-11-27 回「兩個發現開 issue」）；驗收條件待 TBD-1 決定 |

---
**建立日期**: 2026-11-27  
**分級**: Small  
**風險**: Medium\
**狀態**: 待確認
