# Issue 42 - 已促升的摘要重新寫回後，recall 仍是舊內容 (Small)

## 概述

2026-11-27 平行寫回 git 摘要時，downstream-b 一筆 merge 的第三個 decision，理由是寫摘要的 agent 自己推論的，commit 沒有寫。要更正時發現，重新 `repo summarize --submit` 改不到 recall 裡的內容：

- `repoSubmitSummary`（`src/core/memoria.ts`）會用新 payload 覆寫 `git_summaries` 那一列，但促升前先檢查 `!promotionExists(…)`。已促升過的摘要直接跳過促升，回 `promoted:false`。
- 促升時寫入的 recall 記憶（session `gitsum-<summary>` 的文字，與每個 decision 的 event `gitdec-<summary>-<n>`，見 `src/core/db/git-promote.ts` 的 `promoteSummary`）因此維持舊內容。`promoteSummary` 本身也是 `INSERT OR IGNORE`，即使呼叫也不會更新。
- 結果是 `git_summaries` 與 recall 對同一筆合併說法不一致。被拿掉的 decision 仍會出現在 recall 與 brief 的近期決策裡，而寫回結果的 `promoted:false` 看起來像「沒有促升」，沒有提示 recall 沒跟著變。
- 目前唯一的更正方式是 `remember "<更正內容>" --supersedes gitdec-<summary>-<n>`，但只能撤下 decision，改不到 session 的摘要文字，而且這個做法沒有寫在任何文件裡。

本 issue 讓重新寫回已促升的摘要時，recall 的內容與寫回結果一致，或至少明確告知呼叫端 recall 沒有更新。

## 涉及檔案

採 TBD-1 (a)、TBD-2 依文字比對。相依 [issue-41](../issue-41/README.md)：寫回結果沿用它新增的 `promotion` 欄位，多一個值 `updated`。

- `src/core/memoria.ts` - `repoSubmitSummary` 對已促升摘要的處理
- `src/core/db/git-promote.ts` - 更新已促升的 session 與 decision events
- `src/core/db/memory-attributes.ts` - 被拿掉的 decision 改標 superseded
- `src/core/db/schema.ts` - 只讀：events 與 sessions 的 FTS 更新 trigger 已存在（`trg_recall_fts_events_au` 等），預期不改
- `docs/CLI.md`、`docs/CLI.zh-TW.md`、`docs/API.md`、`docs/API.zh-TW.md`、`skills/memoria-memory-sync/deployed/DEPLOYED_REFERENCE.md` - 重新寫回的行為
- `scripts/test-repo-promotion.sh` - 回歸測試

## 驗收條件

1. **AC-1**：重新寫回後 recall 是新內容。在隔離資料根促升一筆 merge 摘要，再以摘要文字不同的 payload 重新 `repo summarize --submit --json`：結果 `data.promotion` 為 `updated`；session `gitsum-` 加摘要 id 的文字改為新內容，recall 以新文字查得到、以只出現在舊文字的詞查不到它。
   - 失敗路徑：recall 仍回舊文字；或結果仍是 `already_promoted`。
2. **AC-2**：decision 依文字比對。原本有 decision A、B，重新寫回時改為 A、C：A 沿用原 id，掛在上面的效用（`memory_utility`）與標記（`memory_attributes`）不變，理由不同時更新為新理由；B 標記為已取代（`superseded_by` 指向該摘要的 session），不再出現在 recall 與 brief，資料列與效用保留；C 以未用過的下一個序號新增。之後再寫回含 B 的 payload，B 恢復原 id、取消已取代標記。
   - 失敗路徑：A 換了 id 或掉了效用；B 被刪除或仍在 recall；C 重用了 B 的序號。
3. **AC-3**：索引跟著更新。重新寫回後，字面 recall（FTS）反映新文字；tree index 的節點文字是新內容；向量的 bridge payload 產出新文字，`vector-ingest` 把它當成有變而重新 embed。
   - 失敗路徑：任一個索引仍是舊文字，且 doctor 沒有顯示缺口。
4. **AC-4**：其他路徑不變。尚未促升的摘要寫回、第一次促升、不符資格的摘要都照舊；CLI 筆記與其他記憶不受影響；`test-repo-promotion.sh`、`test-repo-summary.sh`、`test-vector-recall.sh`、`test-brief-scope.sh` 照常通過；CLI、API 雙語文件與部署的 REFERENCE 寫明重新寫回會更新 recall。
   - 失敗路徑：既有測試的斷言需要改值才能通過。

- **核准日期**: 待核准
- **核准來源**: 待核准

## 風險與首要驗證

- **最大風險**：更新已促升的記憶會碰到掛在 `gitdec-` id 上的其他資料：效用（`memory_utility`，2026-11-27 本機有 38 筆）、標記（`memory_attributes`，3 筆）、向量索引與 tree index 的節點文字。用刪除再重建的方式會讓這些資料失去對應，或留下指向不存在記憶的列。
- **風險等級與理由**：Medium。改動的是已在 recall 裡的記憶，下游的 brief、recall 排序與 prune 都會讀它們；decision 數量變少時，id 是依序號（`-<n>`）編的，序號對應的內容可能改變。
- **首要驗證**：先寫 AC-1、AC-2 的斷言，以現行程式取得紅燈：重新寫回後 recall 仍回舊文字，拿掉的 decision 仍在 recall。
- **選擇理由**：這是 2026-11-27 實際遇到的形態。
- **完成證據**：待驗收條件核准後補上。

## 實作與驗證步驟

1. **AC-1、AC-2 紅燈** — 在 `scripts/test-repo-promotion.sh` 寫斷言。相依：驗收條件核准，以及 issue-41 已合併（`promotion` 欄位）。
   - 完成判準：兩項斷言以現行程式失敗，失敗形態與概述相同。
2. **重新促升** — 已促升的摘要重新寫回時，更新 session 文字；decision 依文字比對沿用、新增或標記已取代；結果回 `updated`。相依：步驟 1。對應 AC-1、AC-2。
   - 完成判準：AC-1、AC-2 綠燈；被取代的 decision 的效用與標記列仍在。
3. **索引** — 確認 FTS trigger、tree index 與向量 payload 都反映新文字，不足的補上。相依：步驟 2。對應 AC-3。
   - 完成判準：AC-3 綠燈。
4. **文件與回歸** — CLI、API 雙語文件、部署的 REFERENCE、CHANGELOG；跑 CI 的 repo、http-mcp 與 core 組。相依：步驟 2、3。對應 AC-4。
   - 完成判準：三組全綠，`release:docs-check` 通過。

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
|---|---|---|---|
| TBD-1 | 重新寫回已促升的摘要時怎麼處理。可選做法：(a) 同步更新：更新 session 文字與既有 decision 的內容；新 payload 少掉的 decision 標記 superseded（不刪除，保留效用與標記），多出的新增；向量與 tree index 由既有的「文字變了就重 embed」與 `buildMemoryIndex` 更新；(b) 拒絕：已促升的摘要重新寫回回 409 `summary_already_promoted`，提示改用 `remember --supersedes`；(c) 維持現狀，只在回傳加 `already_promoted` 說明 recall 沒有更新，並把 `--supersedes` 的做法寫進文件。建議 (a)：更正摘要是正當需求，(b)、(c) 都只能撤下 decision，改不到摘要本身的文字。decision 依序號對應的問題見 TBD-2 | 已解決（2026-11-27 使用者選 (a)）：同步更新，拿掉的 decision 標記已取代、不刪除（AC-1～3） | 驗收條件、涉及檔案與風險等級 |
| TBD-2 | 採 (a) 時，新舊 decision 怎麼對應。decision 的 id 是 `gitdec-` 加摘要 id 與序號，刪掉中間一個會讓後面的序號整體位移。可選：依序號對應（簡單，但位移時效用會掛到內容不同的 decision 上）；依 decision 文字比對，相同的沿用 id，不同的視為新增並把舊的標 superseded（效用只留在內容相同的 decision 上）。建議依文字比對 | 已解決（2026-11-27 使用者選依文字比對）：decision 文字相同沿用 id，不同的新增並用未用過的序號，沒對到的舊 decision 標記已取代（AC-2） | AC 的細節，TBD-1 選 (a) 時才需要 |
| TBD-3 | 2026-11-27 已用 `--supersedes` 撤下的那一筆（downstream-b 的 decision），本 issue 完成後是否改用新做法重做。建議不重做：supersede 結果已正確，重做沒有收穫 | 已解決（2026-11-27 使用者選不重做） | 無 |

## Timeline

| 日期 | 異動 |
|------|------|
| 2026-11-27 | 建立（來源：2026-11-27 平行寫回 git 摘要時，downstream-b 一筆推論出的 decision 只能用 `--supersedes` 撤下；使用者 2026-11-27 回「兩個發現開 issue」）；驗收條件待 TBD-1 決定 |
| 2026-11-27 | TBD-1 使用者選 (a)、TBD-2 選依文字比對、TBD-3 選不重做；撰寫 AC-1～4，待核准 |

---
**建立日期**: 2026-11-27  
**分級**: Small  
**風險**: Medium\
**狀態**: 待確認
