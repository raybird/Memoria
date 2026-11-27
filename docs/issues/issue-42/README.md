# Issue 42 - 已促升的摘要重新寫回後，recall 仍是舊內容 (Small)

## 概述

2026-11-27 平行寫回 git 摘要時，downstream-b 一筆 merge 的第三個 decision，理由是寫摘要的 agent 自己推論的，commit 沒有寫。要更正時發現，重新 `repo summarize --submit` 改不到 recall 裡的內容：

- `repoSubmitSummary`（`src/core/memoria.ts`）會用新 payload 覆寫 `git_summaries` 那一列，但促升前先檢查 `!promotionExists(…)`。已促升過的摘要直接跳過促升，回 `promoted:false`。
- 促升時寫入的 recall 記憶（session `gitsum-<summary>` 的文字，與每個 decision 的 event `gitdec-<summary>-<n>`，見 `src/core/db/git-promote.ts` 的 `promoteSummary`）因此維持舊內容。`promoteSummary` 本身也是 `INSERT OR IGNORE`，即使呼叫也不會更新。
- 結果是 `git_summaries` 與 recall 對同一筆合併說法不一致。被拿掉的 decision 仍會出現在 recall 與 brief 的近期決策裡，而寫回結果的 `promoted:false` 看起來像「沒有促升」，沒有提示 recall 沒跟著變。
- 目前唯一的更正方式是 `remember "<更正內容>" --supersedes gitdec-<summary>-<n>`，但只能撤下 decision，改不到 session 的摘要文字，而且這個做法沒有寫在任何文件裡。

本 issue 讓重新寫回已促升的摘要時，recall 的內容與寫回結果一致，或至少明確告知呼叫端 recall 沒有更新。

## 現況

**現行 review**: review-8750532.md

## 涉及檔案

採 TBD-1 (a)、TBD-2 依文字比對。相依 [issue-41](../issue-41/README.md)：寫回結果沿用它新增的 `promotion` 欄位，多一個值 `updated`。

- `src/core/memoria.ts` - `repoSubmitSummary` 對已促升摘要的處理
- `src/core/db/git-promote.ts` - 更新已促升的 session 與 decision events
- `src/core/db/memory-attributes.ts` - 被拿掉的 decision 改標 superseded
- `src/core/db/recall.ts` - 可改：tree index 會跳過已有節點來源的 session，更新後要先拿掉它的節點才能重建；`buildMemoryIndex` 挑 topic 用的 decision 要排除已取代的
- `src/core/types.ts`、`src/cli/commands/repo.ts` - 可改：`promotion` 多一個值 `updated`，CLI 印出對應的一行
- `src/core/db/schema.ts` - 只讀：events 與 sessions 的 FTS 更新 trigger 已存在（`trg_recall_fts_events_au` 等），預期不改
- `docs/CLI.md`、`docs/CLI.zh-TW.md`、`docs/API.md`、`docs/API.zh-TW.md`、`skills/memoria-memory-sync/deployed/DEPLOYED_REFERENCE.md` - 重新寫回的行為
- `AGENTS.md`、`docs/agents/architecture.md`、`skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md`、`CHANGELOG.md` - 可改：HTTP 表、Git memory 契約、merge 寫回的完成判準與變更紀錄
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

- **核准日期**: 2026-11-27
- **核准 commit**: `fec7d1bc6aa1366ee03ea5961ecd45d2b4a6b0db`
- **核准來源**: 使用者 2026-11-27 逐題確認時 TBD-1 選 (a)、TBD-2 選依文字比對、TBD-3 選不重做，對 AC-1～4 回「核准」

## 風險與首要驗證

- **最大風險**：更新已促升的記憶會碰到掛在 `gitdec-` id 上的其他資料：效用（`memory_utility`，2026-11-27 本機有 38 筆）、標記（`memory_attributes`，3 筆）、向量索引與 tree index 的節點文字。用刪除再重建的方式會讓這些資料失去對應，或留下指向不存在記憶的列。
- **風險等級與理由**：Medium。改動的是已在 recall 裡的記憶，下游的 brief、recall 排序與 prune 都會讀它們；decision 數量變少時，id 是依序號（`-<n>`）編的，序號對應的內容可能改變。
- **首要驗證**：先寫 AC-1、AC-2 的斷言，以現行程式取得紅燈：重新寫回後 recall 仍回舊文字，拿掉的 decision 仍在 recall。
- **選擇理由**：這是 2026-11-27 實際遇到的形態。
- **完成證據**：見「實作與驗證步驟」步驟 1 的紅燈：重新寫回後 recall 仍回舊文字，拿掉的 decision 仍在 recall 與 brief。

## 實作與驗證步驟

1. ✅ **AC-1、AC-2 紅燈** — 在 `scripts/test-repo-promotion.sh` 寫斷言。相依：驗收條件核准，以及 issue-41 已合併（`promotion` 欄位）。
   - 完成判準：兩項斷言以現行程式失敗，失敗形態與概述相同。
   - 完成證據：✅ 2026-11-27。新增 issue-42 段：merge 摘要先以 decision A、B 促升，A、B 掛上 `feedback` 效用，A 另掛 `mark --durable`，並以 stub provider 先 ingest 一次向量；接著寫回新文字與 A（理由不同）、C，再寫回加回 B，最後原樣重送。以 main `6a1b490` 的程式、斷言失敗不中止的副本（`assert_eq` 的 `exit 1` 改成 `return 0`）執行 `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME bash` 加副本路徑：18 項 issue-42 斷言失敗，其餘斷言與前提都通過。失敗形態與概述相同：結果是 `already_promoted`；session 仍是舊文字，recall 以新文字查不到、以舊文字查得到；A 仍是舊理由；B 沒有已取代標記、仍在 recall 與 brief；C 不存在；tree index 節點與向量列都是舊文字，第二次 ingest 沒有 embed 任何列。AC-3 的斷言一起寫在這段，所以步驟 3 的紅燈也在這裡取得。
2. ✅ **重新促升** — 已促升的摘要重新寫回時，更新 session 文字；decision 依文字比對沿用、新增或標記已取代；結果回 `updated`。相依：步驟 1。對應 AC-1、AC-2。
   - 完成判準：AC-1、AC-2 綠燈；被取代的 decision 的效用與標記列仍在。
   - 完成證據：✅ 2026-11-27。`git-promote.ts` 新增 `updatePromotedSummary`，在一個交易內改寫 session 文字與 `event_count`，再依 decision 文字逐一比對：相同的沿用、理由不同就改寫內容，先前由這份摘要標記的已取代會取消；新的用從未用過的下一個序號新增事件與 `memory_sources`；沒對到的以 `markSupersededBy` 標記，已被其他更正取代的維持原標記。`memory-attributes.ts` 新增 `markSupersededBy`、`clearSupersededBy`，在呼叫端的交易內執行，因為 `upsertMemoryAttributes` 的 COALESCE 無法清除標記。decision 事件的 JSON 與來源列 id 抽成 `decisionEventContent`、`memorySourceId`，促升與更新共用，`promoteSummary` 的 SQL 與流程不變。`repoSubmitSummary` 對已促升的摘要改呼叫它，有更動回 `updated`，否則回 `already_promoted`。`pnpm run check`、`pnpm run build` exit 0，AC-1、AC-2 斷言通過；B 的事件列與效用列（`memory_utility`）仍在，A 的 `durable` 標記不變。GitNexus impact：`repoSubmitSummary` HIGH（CLI、HTTP 寫回），`promoteSummary` CRITICAL（sync、`--promote`、寫回三條促升路徑），後者只抽出兩個純函式。
3. ✅ **索引** — 確認 FTS trigger、tree index 與向量 payload 都反映新文字，不足的補上。相依：步驟 2。對應 AC-3。
   - 完成判準：AC-3 綠燈。
   - 完成證據（review-28ec168 修正）：✅ 2026-11-27。拿掉第一個 decision 後舊文字會留在 topic 節點，見 TBD-5。新斷言在不含 `buildMemoryIndex` 修正的程式上 3 項失敗：session 的 topic 節點仍含被拿掉的文字、tree recall 以那個詞仍查得到 session、向量 payload 的 `memory_node` 實體仍帶著它；修正後通過，`memoryIndex.missing` 仍為 0。手動取代的兩項斷言在修正前後都通過，是補上直接測試，不是行為變更。
   - 完成證據：✅ 2026-11-27。FTS 由既有的 `trg_recall_fts_sessions_au`、`trg_recall_fts_events_au` 跟著 UPDATE 更新，不必改。tree index 原本不會更新：`buildMemoryIndex` 會跳過已有 `memory_node_sources` 的 session，所以 `recall.ts` 新增 `dropSessionFromIndex`，拿掉該 session 的節點來源與沒有其他來源、沒有子節點的節點，再由 `buildMemoryIndex` 以新文字重建；拿掉之後重建失敗時，`stats` 的 `memoryIndex.missing` 會顯示缺口。向量 payload 直接讀資料庫，新文字自然帶出，`vector-ingest` 以文字比對判定有變而重新 embed。AC-3 斷言通過：tree index 節點只有新文字、`memoryIndex.missing` 為 0、第二次 ingest `embedded > 0`，session 與 A 的 decision 向量列是新文字與新理由。
4. ✅ **文件與回歸** — CLI、API 雙語文件、部署的 REFERENCE、CHANGELOG；跑 CI 的 repo、http-mcp 與 core 組。相依：步驟 2、3。對應 AC-4。
   - 完成判準：三組全綠，`release:docs-check` 通過。
   - 完成證據（review-28ec168 修正後）：✅ 2026-11-27。`pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`、`pnpm run release:docs-check` exit 0；repo 8 支、http-mcp 5 支、core 10 支與 wiki 4 支共 27 支腳本以同樣前綴執行，全部 exit 0。這一輪沒有改部署的 skill 文件，adapters 組與 `test-npm-install.sh` 沿用上一輪結果。
   - 完成證據：✅ 2026-11-27。CLI、API 雙語文件與 `AGENTS.md` 寫明 `updated` 與 decision 依文字比對；部署的 REFERENCE 說明更正已在 recall 的摘要只要重送更正後的內容，部署的 SKILL 完成判準加入 `updated`；`docs/agents/architecture.md` 記下更新的契約；CHANGELOG 記 Fixed 與 `already_promoted` 意義改變。CLI 的 `failed` 提示改為「recall 沒有跟著這次寫回更新」，因為更新失敗時舊內容仍在 recall，而且 sync 不會重試更新，只有重送會。`pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`、`bash -n install.sh`、`pnpm run release:docs-check` 都 exit 0；CI 的 repo 8 支、http-mcp 5 支、core 10 支、adapters 5 支加上 `test-npm-install.sh`，共 29 支以 `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME bash scripts/` 加腳本名執行，全部 exit 0。wiki 組沒有碰到促升路徑，沒有重跑。既有斷言只有 TBD-4 那一項改值。`test-repo-promotion.sh` 的 AC-3 向量斷言會在 helper 沒有依賴時以 `npm install --omit=dev` 安裝 `@libsql/client`，做法與 `test-vector-recall.sh` 相同。精煉：`insertDecision` 與 `promoteSummary` 的 INSERT 仍各寫一次（後者用 `INSERT OR IGNORE` 並分兩個迴圈），共用的是會影響資料格式的 JSON 內容與來源列 id；不為合併 SQL 而改動 CRITICAL 的 `promoteSummary`。

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
|---|---|---|---|
| TBD-1 | 重新寫回已促升的摘要時怎麼處理。可選做法：(a) 同步更新：更新 session 文字與既有 decision 的內容；新 payload 少掉的 decision 標記 superseded（不刪除，保留效用與標記），多出的新增；向量與 tree index 由既有的「文字變了就重 embed」與 `buildMemoryIndex` 更新；(b) 拒絕：已促升的摘要重新寫回回 409 `summary_already_promoted`，提示改用 `remember --supersedes`；(c) 維持現狀，只在回傳加 `already_promoted` 說明 recall 沒有更新，並把 `--supersedes` 的做法寫進文件。建議 (a)：更正摘要是正當需求，(b)、(c) 都只能撤下 decision，改不到摘要本身的文字。decision 依序號對應的問題見 TBD-2 | 已解決（2026-11-27 使用者選 (a)）：同步更新，拿掉的 decision 標記已取代、不刪除（AC-1～3） | 驗收條件、涉及檔案與風險等級 |
| TBD-2 | 採 (a) 時，新舊 decision 怎麼對應。decision 的 id 是 `gitdec-` 加摘要 id 與序號，刪掉中間一個會讓後面的序號整體位移。可選：依序號對應（簡單，但位移時效用會掛到內容不同的 decision 上）；依 decision 文字比對，相同的沿用 id，不同的視為新增並把舊的標 superseded（效用只留在內容相同的 decision 上）。建議依文字比對 | 已解決（2026-11-27 使用者選依文字比對）：decision 文字相同沿用 id，不同的新增並用未用過的序號，沒對到的舊 decision 標記已取代（AC-2） | AC 的細節，TBD-1 選 (a) 時才需要 |
| TBD-3 | 2026-11-27 已用 `--supersedes` 撤下的那一筆（downstream-b 的 decision），本 issue 完成後是否改用新做法重做。建議不重做：supersede 結果已正確，重做沒有收穫 | 已解決（2026-11-27 使用者選不重做） | 無 |
| TBD-4 | issue-41 在 `test-repo-promotion.sh` idempotency 段加的斷言：已促升的摘要以不同文字、不帶 decision 重送時 `promotion` 為 `already_promoted`。AC-1 規定這種重送回 `updated`（失敗路徑寫明「結果仍是 `already_promoted`」），與 AC-4「既有斷言不需改值」對同一個斷言要求相反 | 已解決（2026-11-27 使用者確認 AC-4「既有斷言需要改值」排除這條斷言，因為 AC-1 的失敗路徑明文要反轉它）。處理：這個斷言描述的正是本 issue 要改的行為，改為期望 `updated`，並在同一段補一次內容完全相同的重送，期望 `already_promoted`，保住 issue-41 AC-2 要區分的那個結果。同段其他斷言（`promoted` 為 false、`memory_sources` 與 sessions 筆數不變）原值通過 | AC-1、AC-4 |
| TBD-5 | review-28ec168 的 MUST FIX 1、SHOULD FIX 與 NICE TO HAVE 1、2：`buildMemoryIndex` 取 session 第一個 `DecisionMade` 當 topic 標題，沒有排除已取代的事件，拿掉或改寫 decision 0 時舊文字留在 tree index 與向量 payload；`updatePromotedSummary` 先讀後寫卻用 deferred 交易，多程序同時寫回時可能直接 SQLITE_BUSY 而回假的 `failed`；手動 `--supersedes` 的標記不受重送影響沒有直接測試；`memoria.ts` 兩段 JSDoc 疊在一起、失敗時的註解過時、`SummaryPromotion` 說明沒提 `updated` | 已解決（2026-11-27 使用者選全部修正）：`buildMemoryIndex` 挑 topic 用的事件排除 `memory_attributes.superseded_by` 不為空的列，沒有這張表的舊資料庫照舊（GitNexus impact：CRITICAL，remember、sync、`index build` 與 setup 的向量準備都呼叫它；已索引的 session 會被跳過，所以只影響之後新建或重建的 session）；`updatePromotedSummary` 改用 `.immediate()`；`test-repo-promotion.sh` 補拿掉 decision A 的寫回，斷言 tree index 節點、tree recall 與向量 payload 的 `memory_node` 實體都不再帶出它的文字，並以 `remember --supersedes` 先取代 B、C，斷言重送後兩者仍指向原本的筆記；JSDoc 與註解整理 | AC-2、AC-3 |
| TBD-6 | review-28ec168 NICE TO HAVE 3、4：拿掉 tree index 節點與重建是兩個交易，重建失敗後若該 session 超過 180 天，`prune --stale` 可能把整筆促升的 session 刪掉；`summary.range` 為 null 時重送回 `failed`，session 被手動刪除時回 `already_promoted`，兩者都沒有精確說明發生什麼 | 不影響本次交付（2026-11-27 使用者選記入待確認）。追蹤：無；(1) 需要重建本身失敗，且失敗會讓 `stats` 的 `memoryIndex.missing` 與 doctor 顯示缺口，可用 `memoria index build` 補回；合併兩個交易要改 `buildMemoryIndex` 的交易結構。(2) 促升過的摘要都有 range，session 被手動刪除也只發生在手動改資料時 | 無 |

## Timeline

| 日期 | 異動 |
|------|------|
| 2026-11-27 | 建立（來源：2026-11-27 平行寫回 git 摘要時，downstream-b 一筆推論出的 decision 只能用 `--supersedes` 撤下；使用者 2026-11-27 回「兩個發現開 issue」）；驗收條件待 TBD-1 決定 |
| 2026-11-27 | TBD-1 使用者選 (a)、TBD-2 選依文字比對、TBD-3 選不重做；撰寫 AC-1～4，待核准 |
| 2026-11-27 | 使用者核准 AC-1～4 |
| 2026-11-27 | 開始實作（使用者回「直接開始 issue-42」）；核准 commit 回填為 `fec7d1b`；步驟 1～4 完成，待審查 |
| 2026-11-27 | review-28ec168 RETURN TO execute-task（使用者對建議與 TBD-4 都回照建議，結論記在 TBD-4～6；修正後送增量覆審）：MUST FIX 2 項（被取代的第一個 decision 留在 topic 節點；TBD-4 需決策）、SHOULD FIX 1 項、NICE TO HAVE 4 項 |
| 2026-11-27 | review-8750532（增量覆審）PASS，附 NICE TO HAVE 1 項（需決策），結論待使用者確認 |

---
**建立日期**: 2026-11-27  
**分級**: Small  
**風險**: Medium\
**狀態**: 待審查
