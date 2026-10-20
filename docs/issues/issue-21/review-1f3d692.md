# Issue 21 第二輪審查報告：dismissed 摘要狀態（退回修正後）

- **保存位置**：`docs/issues/issue-21/review-1f3d692.md`
- **審查日期**：2026-10-20
- **Reviewed BASE SHA**：`ac7610985fc07c068e284f4dc02b05c53e680576`（ac76109 docs(issue-19～22): 回填核准紀錄的核准 commit）
- **Reviewed HEAD SHA**：`1f3d692fa760777cd586a2de3066ccba21910d91`（分支 `issue-21-dismissed-summaries`）
- **Reviewed patch-id**：`87d1f7b196d5050c9f46eba067721b7bfcc34440`（`git diff ac76109 1f3d692 | git patch-id --stable`）
- **獨立 reviewer**：Claude subagent（general-purpose，未參與實作）
- **判定**：`PASS`（無 MUST FIX；2 項 SHOULD FIX 不阻塞）

## 審查範圍與風險

- 完整範圍是 `ac76109..1f3d692`，共 3 個提交、21 個檔案（+566/−29）：
  - `3764a9f`：實作。前輪報告 `review-3764a9f.md` 判定 RETURN TO execute-task。
  - `7f47d18`：只新增前輪報告。`git diff --name-status 3764a9f 7f47d18` 的結果只有一行 `A docs/issues/issue-21/review-3764a9f.md`。
  - `1f3d692`：修正。共 14 個檔案：`src/core/db/git-summary.ts`、`src/core/{memoria,types}.ts`、`src/{server,sdk}.ts`、`src/cli/commands/repo.ts`、兩支測試、`CLAUDE.md`、`AGENTS.md`、兩份 README，以及 issue-21 的 README 與 plan。
- 本輪重點是 `git diff 3764a9f 1f3d692`。前輪已通過的部分（`isPromotable`、brief、HTTP 路由順序、`parseDismissTypes`、schema 不需 migration）沿用前輪結論；本輪逐檔確認修正提交沒有動到這些部分，相關測試也重跑過。
- 規則依據：`1f3d692:docs/agents/{acceptance,review-evidence,verification}.md`。
- 風險：Medium，與前輪相同。本輪新增的風險是 dismiss 多了一道 `memory_sources` 守門。如果守門有誤，會讓不該略過的摘要被略過，或擋下該略過的摘要。

## 證據

命令都在 `1f3d692` 的獨立 detached worktree 內執行，`node_modules` 以 symlink 共用。測試一律加 `env -u LIBSQL_URL -u MEMORIA_HOME`。完成後 worktree 已用 `worktree remove --force` 移除。主工作區沒有讀取任何檔案，也沒有改動。

| # | 命令 | 被測版本 | 結果 |
|---|------|---------|------|
| E1 | `pnpm run check` | 1f3d692 | exit 0 |
| E2 | `pnpm run build`；`node dist/cli.mjs --help` | 1f3d692 | 兩者皆 exit 0 |
| E3 | `node dist/cli.mjs repo summarize --help` | 1f3d692 | `--dismiss` 的說明為 `not auto-promoted, not counted as 待增強` |
| E4 | `bash -n` 兩支改動過的測試 | 1f3d692 | 通過 |
| E5 | `bash scripts/test-repo-summary.sh` | 1f3d692 | exit 0，55 ✓ / 0 ✗。SCN-003 七條含 `fixture: 1 pending merge + 2 pending releases`、`the pending merge is dismissed`；SCN-008 五條 ✓ |
| E6 | `bash scripts/test-repo-promotion.sh` | 1f3d692 | exit 0，52 ✓ / 0 ✗。S-2 段三條 ✓：`range skeleton exists`、`explicit range returned the same summary`、`dismissed range not promoted` |
| E7 | `bash scripts/test-pure-functions.sh` | 1f3d692 | exit 0，60 ✓ / 0 ✗ |
| E8 | `test-brief-scope.sh`、`test-http-api.sh`、`test-repo-noninvasive.sh` | 1f3d692 | 三支皆 exit 0，分別以 `✓ all checks passed`、`[http] ok`、`[noninvasive] PASS` 結尾 |
| E9 | 變異：`dismissPendingSummaries` 只處理型別清單最後一項 | 1f3d692＋變異 | `test-repo-summary.sh` exit 1：`✗ reports how many were dismissed: expected '3', got '2'` |
| E10 | 變異：`dismissPendingSummaries` 靜默略過 `merge` 型別（M-1 原本測不出的情況） | 1f3d692＋變異 | `test-repo-summary.sh` exit 1：`✗ reports how many were dismissed: expected '3', got '2'` |
| E11 | 變異：`isPromotable` 改回 `status === 'pending'`（與前輪 E10 相同；前輪測試在此變異下仍是 exit 0） | 1f3d692＋變異 | `test-repo-promotion.sh` exit 1：`✗ dismissed range not promoted: expected '0', got '1'` |
| E12 | 變異：拿掉 `dismissSummary` 的 `memory_sources` 守門 | 1f3d692＋變異 | `test-repo-summary.sh` exit 1：`✗ dismissing a promoted summary succeeded` |
| E13 | 變異：批次不跳過已促升的摘要 | 1f3d692＋變異 | `test-repo-summary.sh` exit 1：`✗ batch still dismisses the others: expected '1', got '2'`。可見 fixture 中「其他筆」為 1，不是 0，斷言有鑑別力 |
| E14 | 還原變異後確認狀態 | worktree | `git status --porcelain` 只剩 `?? node_modules`（symlink），隨後重新 build |
| E15 | 臨時探針：用人類可讀模式單筆 dismiss 一筆已強制促升的 pending | 1f3d692 | `❌ 執行失敗: summary_already_promoted: … is already in recall (force-promoted)`，exit 1 |
| E16 | 臨時探針：用人類可讀模式批次 `--type branch` | 1f3d692 | `✓ 已略過 1 筆 pending 摘要 (branch)`，下一行是 `⚠ 1 筆已用 --promote 進入記憶，未略過`，exit 0 |
| E17 | 臨時探針（HTTP）：單筆 dismiss 已促升的摘要；批次 `{"types":["branch"]}` | 1f3d692 | 單筆回 409，`ok:false`，error 為 `summary_already_promoted…`。批次回 200，`data` 為 `{dismissed:0, summary_ids:[], skipped_promoted:2}`。兩筆被跳過的摘要維持 pending |
| E18 | 臨時探針：先 dismiss，再 `--branch … --promote`（逃生口），然後再 dismiss 一次 | 1f3d692 | promote 成功，狀態變成 `dismissed\|memory_sources=1`。再 dismiss 時回 `summary_already_promoted`，exit 1，不是 no-op（見 N-2）。brief 顯示「已略過: 1」，包含這筆已在 recall 的摘要（屬於 (B) 已接受的殘餘，見 N-2） |
| E19 | `git diff ac76109 1f3d692 -- package.json pnpm-lock.yaml` | diff | 0 行，依賴沒有變動 |
| E20 | `git diff ac76109 1f3d692` 的新增行，以 grep 搜尋本機路徑、帳號與外部專案真名樣式 | diff | 沒有命中 |
| E21 | `git diff --name-status 7f47d18 1f3d692` | diff | 前輪報告檔沒有被修改 |

## 逐項核對

### 1. SCN-008、TBD-3 與核准表（acceptance.md）

- **核准來源**：SCN-008 的來源記為前輪 S-1（`需決策`）的建議 (A)，使用者原話是 2026-10-20 的「一律都照建議」。依 acceptance.md，「回答照建議即接受該題建議答案」，而來源紀錄已包含原話、日期、題號（S-1／TBD-3）、建議內容與對應的 SCN-008，符合要求。
- **內容是否落在建議範圍內**：前輪建議 (A) 的原文是「dismiss 改以 `promotionExists` 為不變量：已促升的單筆回 409，批次則跳過」，並建議強制促升路徑先採 (B) 的文件修正。SCN-008 的三個 Then 都在這個範圍內：單筆以非 0 結束、批次跳過、摘要維持 pending。唯一超出原文的是「回報跳過筆數」，屬於推導出的輸出細節（見 N-1）。
- **TBD-3**：狀態為「已解決」，結論寫明 (A) 與 (B) 各自的落點，日期 2026-10-20，符合「解決的待確認事項同步更新狀態、結論與日期」。
- **核准表與 Scenario 集合**：Gherkin 現存 `@SCN-001`～`@SCN-008` 共 8 個，核准表 8 列皆為「已核准」，兩者完全相等。TBD-2 仍是「待確認」，但它標明不影響已列的 Scenario，所以不阻擋 PR。
- **核准 commit**：仍只寫 `a79d3be`，但這個提交裡沒有 SCN-008（見 S-2）。

### 2. 修正提交 `3764a9f..1f3d692`

| 前輪項目 | 修正 | 本輪結論 |
|---------|------|---------|
| M-1：SCN-003 未驗到 merge | SCN-003 前另造一筆 pending merge（`feature/batch`）。fixture 數量斷言為字面值 3，回報筆數斷言為字面值 3，並逐一檢查那筆 merge 與一筆 release 的 id 已變成 dismissed | **已修正**。E10 的「靜默略過 merge」變異正是前輪說的覆蓋缺口，現在會失敗。Background 寫的是 merge 與 release 各一筆、回報筆數 2，fixture 因為前面的 Scenario 多了一筆 release，所以期望值是 3。測試以字面值釘住、用註解說明原因，並另外斷言 merge 的 id，符合 Then 的「只有 pending 的 merge 與 release 變為 dismissed」 |
| S-1 (A)：dismiss 以是否已促升守門 | `dismissSummary` 在交易內查 `memory_sources`，命中就丟 `summary_already_promoted`；批次在同一條 SELECT 內以 `EXISTS` 標記，只更新未促升的列，並回傳 `skippedPromoted` | **已修正**。守門與 `promotionExists` 用同一條 SQL（`source_id = ?`），語意一致。檢查順序是先檢查 enriched（409 `summary_not_pending`），再檢查已促升，enriched 的錯誤訊息不變（SCN-002 仍 ✓）。跨 repo 檢查在 `repoDismissSummary` 先執行，不會藉 `already_promoted` 訊息洩漏其他 repo 的摘要狀態。批次的 SELECT 與 UPDATE 在同一個 transaction 內。E12、E13、E15～E17 皆驗證 |
| S-1 (B)：`--promote` 維持逃生口，文件改為「不自動促升」 | 強制路徑不變；CLAUDE.md、AGENTS.md、兩份 README、CLI help、SDK 與 server 註解都改了用語 | **大致完成**。各處用語已一致為「not auto-promoted／不自動促升」，但只有 CLAUDE.md 寫明 `--promote` 例外（見 S-1） |
| S-2：端到端測不出 `isPromotable` | 把門檻設為 0，以 `--range` 建 commit_range，dismiss 後用 `sync --from/--to` 帶回同一個範圍，斷言 `memory_sources` 為 0；另斷言範圍確實被重用 | **已修正**。E11 的變異現在會失敗（前輪是 exit 0）。測試結束時會清掉 config，不影響後續段落 |
| S-3：GitNexus 紀錄 | plan 第 7 步補記 staged 的 `detect_changes` 結果與誤報判斷，並勾選檢查清單 | **已修正**（只核對紀錄存在；本輪沒有獨立重跑 GitNexus，因為主工作區目前在另一個分支，索引不對應被審查的 HEAD） |

新程式的細節：

- **`DismissPendingData.skipped_promoted`**：型別是 `number`，有註解，core 與 HTTP 都會回傳（E17）。SDK 直接沿用這個型別，所以不必另外改。這是新增的欄位，不破壞既有呼叫端。
- **HTTP 409 對應**：`gitErrorStatus` 先判 `not_found`，而 `summary_already_promoted` 不含 `not_found`，不會被誤判成 404；接著由新增的 `includes('summary_already_promoted')` 回 409（E17）。
- **CLI 提示**：只有 `skipped_promoted > 0` 時才印出 ⚠ 那一行，`--json` 輸出不變（E16）。
- **既有的 N-3**：盤點表第 3 列已依建議更正。

### 3. 完整範圍 `ac76109..1f3d692`

- 前輪通過的項目沒有被修正提交破壞：
  - `isPromotable`、`brief.ts`、`git-promote.ts`、`summary-schema.ts`、`index.ts` 這輪都沒動，pure 測試（E7）仍然全綠。
  - SCN-001、002、004、005、006、007 全部重跑通過（E5、E6）。
  - HTTP 路由順序與錯誤碼由 E6 的 SCN-007 段與 E17 確認。
- 沒有新增依賴（E19），也沒有改命令名，只新增欄位與錯誤碼。版控文件裡沒有本機路徑或外部真名（E20）。
- `7f47d18` 只新增報告；前輪報告在本範圍內沒有被修改（E21）。

## 失敗面（本輪新增或受影響）

| 失敗面 | 輸入／狀態 | 預期 | 覆蓋 | 結論 |
|--------|-----------|------|------|------|
| 單筆 dismiss 已強制促升的 pending | `--branch X --promote` 後 `--dismiss` | 非 0 結束，說明已在記憶中，狀態維持 pending | E5 SCN-008、E12 變異、E15 | 通過 |
| 批次遇到已促升的 pending | 一筆已促升、一筆未促升，`--type branch` | 已促升的跳過並計數，未促升的 dismiss | E5、E13 變異、E16 | 通過 |
| HTTP 的同一守門 | 單筆與批次端點 | 單筆 409，批次 `skipped_promoted` | 只有 E17 探針，沒有測試釘住 | 行為正確，屬於證據持久力不足（N-3） |
| 批次靜默漏掉某個型別 | `--type merge,release` 只處理其中一種 | 回報 3 並逐一確認 id | E9、E10 變異 | 通過（M-1 已閉環） |
| dismissed 經 `sync --from/--to` 回到候選 | dismissed 的 commit_range，門檻 0 | 不促升 | E6、E11 變異 | 通過（S-2 已閉環） |
| 逃生口：dismissed 再強制促升 | `--dismiss` 後 `--promote` | 依 TBD-3 (B) 允許 | E18 | 依決策允許；殘餘行為見 N-2 |
| 跨 repo 與守門的順序 | 用 repo B 的 ref dismiss repo A 已促升的摘要 | 回 `summary_not_found`，而不是 `already_promoted` | 讀程式碼確認：`repoDismissSummary` 先比對 `repository_id` | 通過 |

## 發現

### MUST FIX

無。

### SHOULD FIX

**S-1　`--promote` 例外只寫在 CLAUDE.md，plan 第 8 步的完成證據高估了文件範圍**

- plan 第 8 步寫：「CLI help、CLAUDE.md、AGENTS.md、兩份 README 的『never promoted／不促升』改為『not auto-promoted／不自動促升』，並寫明 `--promote` 是唯一可越過閘門的路徑」。實際情況：
  - 用語修正：五處皆已完成。
  - `--promote` 例外：只有 CLAUDE.md 寫了（"Explicit `repo summarize --promote` stays the one override…"）。AGENTS.md、兩份 README、CLI help 都只寫「not auto-promoted」，沒有說明例外。
  - 批次那一列：README 兩份沒有提到「已在 recall 的會被跳過」或 `skipped_promoted`；AGENTS.md 有。
  - `docs/OPERATIONS.md` 的 Promotion gate 段落本來就說 `--promote` 是逃生口，但沒有提到 dismissed。
- 影響：TBD-3 的結論只要求「文件改為不自動促升」，這一點已經達成，「not auto-promoted」本身也沒有寫錯，所以不構成驗收缺口。問題在於完成證據的描述比實際做的多，讀者會以為 AGENTS.md 與 README 已說明例外。
- 建議：任選一種做法。
  - 改正 plan 第 8 步的描述，寫成「例外說明在 CLAUDE.md」。
  - 或在 AGENTS.md 的 dismiss 列，以及 README 兩份的批次列，各補一句（例如 `explicit --promote still overrides` 與 `already-promoted ones are skipped`）。

**S-2　核准 commit 沒有反映 SCN-008 的基線**

- acceptance.md 規定核准 commit 是「承載當次核准規格的提交」，增刪條件經重新核准後要「更新日期、狀態、核准來源與基線提交」。SCN-008 的日期、狀態、來源都已更新，但 `**核准 commit**` 仍只寫 `a79d3be`，而這個提交裡沒有 SCN-008。照規則以 `git diff a79d3be -- docs/issues/issue-21/README.md` 查核時，會看到一個沒有基線的新增條件。
- 不阻塞的理由：核准來源可追溯，SCN-008 第一次出現的提交就是 `1f3d692`，基線可以明確取得。
- 建議：改成「`a79d3be`（SCN-001～007）；`1f3d692`（SCN-008）」這類分項寫法。要注意，回填提交不是「只新增報告」的提交，依 review-evidence.md 會讓本 PASS 失效。所以建議：
  - 在合併前與其他必要變更一起處理，並重新審查；
  - 或依 docs/AGENTS.md 的 Gate 豁免紀錄留痕；
  - 或在 PR 的 Proof of Test 直接引用 `1f3d692:docs/issues/issue-21/README.md` 作為 SCN-008 的固定版本規格。

### NICE TO HAVE

- **N-1**：SCN-008 的「並回報跳過筆數」是規劃推導出的輸出細節。前輪建議 (A) 的原文只寫「批次則跳過」。這是新增的計數欄位，風險低，可以視為「照建議」的合理具體化；若要嚴格依 acceptance.md，可在核准來源補一句「回報筆數為規劃推導，併入本次照建議」。
- **N-2**：「dismissed 但已在 recall」仍可能經逃生口產生（E18）。這是 TBD-3 (B) 接受的殘餘，但有兩處描述和實際行為不完全一致：
  - `dismissSummary` 的註解與 CLAUDE.md 說「Re-dismissing is a no-op」，但對這種列再次 dismiss 會回 `summary_already_promoted` 並以非 0 結束。
  - brief 的「已略過」會把這種列算進去。
  
  建議在 CLAUDE.md 補一句說明這兩點，或把註解改成「re-dismissing a dismissed summary that is not in recall is a no-op」。
- **N-3**：HTTP 的 `summary_already_promoted → 409` 與批次 `skipped_promoted` 只有本輪探針驗證過（E17），`test-repo-promotion.sh` 的 SCN-007 段沒有釘住。SCN-008 只要求 CLI，所以不算驗收缺口；補兩條斷言可以防止 `gitErrorStatus` 被改壞。
- **N-4**：前輪的 N-1、N-2、N-4～N-7 仍維持原狀，包括 issue README「涉及檔案」與 plan 測試策略表裡仍列著沒有改動的 `test-brief-scope.sh`、`test-http-api.sh`。這些都不阻塞。

## 判定

`PASS`

- 前輪的 M-1、S-2、S-3 已閉環，各有變異測試的紅燈與還原後的綠燈證據（E9～E11）。S-1 依使用者決策落實為 SCN-008 與文件修正，守門的正確性與鑑別力也有證據（E12、E13、E15～E17）。
- 必要驗收 SCN-001～SCN-008 全部已核准，且都有本輪重跑的測試證據。
- S-1、S-2 屬於證據描述與核准基線的可追溯性問題，不影響行為正確性，也不構成驗收缺口，建議在合併前處理。若處理時新增了非報告提交，需依 review-evidence.md 重新審查，或依 Gate 豁免紀錄留痕。
