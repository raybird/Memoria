# Issue 21 - 實作計畫

README 的 Gherkin 為驗收來源。風險與首要驗證見 README「風險與首要驗證」。

## 設計方案

- `GitSummaryStatus = 'pending' | 'enriched' | 'dismissed'`。`git_summaries.status` 沒有 CHECK 約束，不需 migration。
- db 層新增 `dismissSummary(dbPath, summaryId)` 與 `dismissPendingSummaries(dbPath, repositoryId, types)`：只更新 `status = 'pending'` 的列，回傳更新筆數；對非 pending 單筆呼叫時回錯誤（SCN-002）。
- `isPromotable`：`status !== 'enriched'` 一律 false。`--promote` 的強制路徑走 `promoteEligible(force=true)`，不經 `isPromotable`，維持唯一逃生口。
- `submitAgentSummary` 現在把任何狀態改為 enriched，dismissed 自然可以被覆寫（SCN-006），不需改動；以測試釘住。
- brief：待增強計數維持 `status = 'pending'`；另查 `status = 'dismissed'` 筆數，非 0 時同列顯示「已略過 N」。
- HTTP：`POST /v1/repos/:ref/summaries/:id/dismiss` 與 `POST /v1/repos/:ref/summaries/dismiss`（body `{types: string[]}`，必填）。

## 實作步驟

1. ✅ **首要驗證：status 比較點盤點** — SCN-005
   驗證：`grep -rn "status" src/core/db/git-*.ts src/core/db/brief.ts src/core/memoria.ts` 中所有針對 `git_summaries` 的比較逐一分類（等於 pending／等於 enriched／不等於），結果記入本步驟。
   完成判準：每個比較點都標明新增 dismissed 後的正確行為，沒有未分類項。
   盤點結果（2026-10-20，`main` 於 `ac76109`；另查 `src/server.ts`、`src/cli/commands/repo.ts`、`src/core/git/`）：

   | 位置 | 比較 | 新增 dismissed 後 | 處理 |
   |------|------|------------------|------|
   | `git-promote.ts:40` `isPromotable` | `status === 'pending'` → false | **dismissed 會漏過，merge／release 直接走到下一行回 true** | 改成 `status !== 'enriched'` → false（S2） |
   | `memoria.ts` `promoteEligible` 的補促升池 | `listSummaries({status:'enriched'})` | 不含 dismissed，正確 | 不改 |
   | `memoria.ts` `promoteEligible` 的 candidates | 經 `isPromotable` | `sync --from/--to` 一律建 commit_range，可回傳既有的 dismissed **commit_range** 當 candidate（fingerprint 含型別，帶不回 merge／release）；修好 `isPromotable` 後即被擋 | 隨 `isPromotable` 修正（審查 N-3 更正本列） |
   | `memoria.ts` `repoSummarize --promote` | force，不經 `isPromotable` | 使用者明確指定，可促升 dismissed；反向也可能先強制促升再 dismiss（審查 S-1） | 強制路徑不改（唯一逃生口）；dismiss 改為拒絕已在 recall 的摘要（SCN-008） |
   | `memoria.ts` `repoPendingSummaries` | `listSummaries({status:'pending'})` | 不含 dismissed，正確 | 不改 |
   | `memoria.ts` `repoSubmitSummary` | 先改 enriched 再 `isPromotable` | dismissed 可被覆寫成 enriched（SCN-006） | 不改，以測試釘住 |
   | `git-summary.ts` `insertSummaryIfMissing` | 既有列直接回傳，不改 status | 重跑 sync 不會把 dismissed 改回 pending | 不改 |
   | `git-summary.ts` `submitAgentSummary` | 無條件設 enriched | 同 SCN-006 | 不改 |
   | `brief.ts` 最新摘要 | `status = 'enriched'` | 不含 dismissed，正確 | 不改 |
   | `brief.ts` 待增強計數 | `status = 'pending'` | 不含 dismissed，正確 | 另加 dismissed 計數（S2） |
   | `server.ts` submit 路由 | regex `/summaries/([^/]+)$` | 會把 `/summaries/dismiss` 當成 summary id | dismiss 路由排在 submit 之前（S4） |

   無其他針對 `git_summaries.status` 的比較點（`git_scan_runs`、`git_events`、`repositories` 的 status 是不同欄位）。
2. ✅ **S1 狀態與 db 層** — SCN-001、002、003、004
   驗證：db 層單元斷言——只改 pending、enriched 回錯誤、型別過濾正確、空型別陣列拒絕。
   完成判準：四種情況各有一條斷言紅→綠。
   完成證據（2026-10-20）：db 層沒有獨立的單元測試入口，四種情況由 S3 的 CLI 端到端斷言承擔（單迴圈合併：CLI 直接呼叫 core→db，中間沒有另外的整合責任；`parseDismissTypes` 的空陣列拒絕同時由 CLI 與 HTTP 兩條路徑覆蓋）。紅綠燈見 S3。
3. ✅ **S2 讀取端** — SCN-005、006
   相依：步驟 1、S1。
   驗證：`test-repo-promotion.sh` 斷言 dismissed 不被 sync 促升、submit 後促升；`test-brief-scope.sh` 斷言待增強數與「已略過」。
   完成判準：兩支腳本全綠，且步驟 1 盤點的每個比較點都有對應處理。
   完成證據（2026-10-20）：
   - 單元紅燈：`bash scripts/test-pure-functions.sh` → exit 1，`✗ dismissed merge is not: expected false, got true`、`✗ dismissed release is not: expected false, got true`——就是盤點第一列的漏洞。
   - 外迴圈紅燈：`bash scripts/test-repo-promotion.sh` → exit 1，SCN-005 段 `error: unknown option '--dismiss'`。
   - 綠燈：`isPromotable` 改為 `status !== 'enriched'` → false，brief 加 dismissed 計數與「已略過: N」；`test-pure-functions.sh` 的 `[pure] isPromotable` 四條 ✓；`test-repo-promotion.sh` 的 SCN-005（re-sync 仍是 dismissed、未促升、待增強少 1、已略過: 1）與 SCN-006（re-submit 轉 enriched 並促升）全部 ✓，exit 0。
   - SCN-006 屬特性測試：`submitAgentSummary` 本來就無條件寫 enriched，不改程式；狀態 dismissed 在改動前不存在，因此沒有可取的紅燈。
   - 位置調整：「已略過」的 brief 斷言放在 `test-repo-promotion.sh`，因為只有它的 fixture 同時有 repo、sync 和 dismiss；`test-brief-scope.sh` 照常全綠。
4. ✅ **S3 CLI** — SCN-001～004
   相依：S1。
   驗證：`test-repo-summary.sh` 以 CLI 跑 SCN-001～004；`repo summarize --help` 列出兩個旗標。
   完成判準：四個 Scenario 的 CLI 斷言全綠。
   完成證據（2026-10-20）：
   - 紅燈：`bash scripts/test-repo-summary.sh` → exit 1，SCN-001 段 `error: unknown option '--dismiss'`。
   - 綠燈：SCN-001（dismissed、離開 `--pending`）、SCN-002（非 0 結束、訊息含 enriched、狀態與 `memory_sources` 不變）、SCN-003（回報筆數等於事前查得的 pending merge+release 數、commit_range 與 enriched 不變）、SCN-004（未給 `--type` 非 0 結束、dismissed 數不變）共 12 條 ✓，exit 0。`node dist/cli.mjs repo summarize --help` 列出 `--dismiss` 與 `--dismiss-pending`。
5. ✅ **S4 HTTP 與 SDK** — SCN-007
   相依：S1。
   驗證：`test-http-api.sh` 契約斷言（封包形狀、批次缺 types 回錯）。
   完成判準：契約斷言全綠。
   完成證據（2026-10-20）：
   - 紅燈：暫存 src 修改、用改動前的 bundle 起 server 實打，單筆 `POST …/summaries/<id>/dismiss` → 404；批次 `POST …/summaries/dismiss` 被 submit 路由當成 summary id「dismiss」，回 `invalid summary payload`——證實路由必須排在 submit 之前。
   - 綠燈：`test-repo-promotion.sh` 的 SCN-007 段 7 條 ✓（封包 ok、`meta.evidence[0]` 為該 id、enriched → 409、缺 types → 400、批次筆數）。斷言放在 `test-repo-promotion.sh` 而不是 `test-http-api.sh`，因為只有它有 repo fixture 與 HTTP server。
   - 測試修正：初版斷言誤讀頂層 `d.evidence`；依 `withResult` 定義，envelope 的 evidence 位於 `meta.evidence`，修正的是測試的讀取路徑，不是放寬行為。
6. ✅ **S5 常青文件**
   依 [project.md](../../agents/project.md)「常青文件更新責任」：`CLAUDE.md` Git-Aware 段落記三態與轉移；`AGENTS.md` HTTP 段補兩個端點；`README.md`／`README.zh-TW.md` 補 CLI 旗標。
   完成判準：三態轉移在 CLAUDE.md 有單一權威描述，其餘文件引用它。
   完成證據（2026-10-20）：CLAUDE.md「Git-Aware Memory」段落記三態、可轉移方向與只動 pending 的理由；`AGENTS.md` 與兩份 README 的 HTTP 表各加兩列，README 命令範例加 `--dismiss-pending`。
7. ✅ **回歸與精煉**
   完成證據（2026-10-20）：
   - 精煉：code-simplify no-op。新函式沿用 `submitAgentSummary` 既有的讀回列＋range→`mapSummary` 寫法，CLI 兩個分支與既有 `--pending`／`--submit` 分支同形，沒有可再收斂的重複，沿用上述綠燈。
   - GitNexus impact：`isPromotable` 是 CRITICAL（sync 與 submit 的促升閘門），已向使用者揭露；改動只把 dismissed 也擋下，pending／enriched 行為不變。`queryBrief`、`renderBrief`、`registerRepoCommand`、`createServer` 都是 LOW。
   - 提交前 `detect_changes`（staged）：20 檔，命中的符號除本次改動外另有 `docs/issues/issue-4/5/9`、`isEmojiOnlyQuery`、`readBody` 等未修改項，判定為索引過期與 hunk 相鄰的誤報。
   - `pnpm run check` 無錯；CI 全套（依 `ci.yml` 順序逐支執行 34 支，清除 `LIBSQL_URL`／`MEMORIA_HOME` 等開發者環境變數）全數 PASS、exit 0，被測為 `ac76109` 加上本次提交內容的工作區，2026-10-20。

8. ✅ **審查退回修正**（[review-3764a9f](./review-3764a9f.md)）— SCN-003、SCN-008、SCN-005
   完成證據（2026-10-20）：
   - M-1（SCN-003 未驗到 merge）：SCN-003 前另造一筆 pending merge，斷言字面值 3（1 merge＋2 release）並逐一確認該 merge 與一筆 release 的 id 變成 dismissed。這是補強測試、不改程式；變異檢查：讓 `dismissPendingSummaries` 只處理型別清單最後一項 → `✗ reports how many were dismissed: expected '3', got '2'`，還原後綠。
   - S-1 → SCN-008：紅燈 `bash scripts/test-repo-summary.sh` → `✗ dismissing a promoted summary succeeded`；實作 `dismissSummary` 遇 `memory_sources` 已有該摘要時丟 `summary_already_promoted`（HTTP 409），批次以同一條件跳過並回報 `skipped_promoted`；綠燈 SCN-008 五條 ✓。CLI help、CLAUDE.md、AGENTS.md、兩份 README 的「never promoted／不促升」改為「not auto-promoted／不自動促升」。（第二輪審查 S-1 更正：`1f3d692` 只有 CLAUDE.md 寫明 `--promote` 例外，AGENTS.md 已寫批次跳過；其餘處在 `2146fb5` 補上。第三輪審查指出兩份 README 寫成「只有 `--promote`」，漏了 `--submit`（SCN-006），於下一個提交更正。）
   - S-2（端到端測不出 `isPromotable` 修正）：`test-repo-promotion.sh` 新增一段——門檻設 0 讓 commit_range 必過重要度閘門，以 `repo summarize --range` 建 pending 範圍、dismiss，再用 `repo sync --from/--to` 帶回同一範圍；斷言 `memory_sources` 為 0。變異檢查：把 `isPromotable` 改回 `status === 'pending'` → `✗ dismissed range not promoted: expected '0', got '1'`，還原後綠。
   - S-3：本計畫第 7 步補記 detect_changes 結果，檢查清單勾選。
   - 回歸：`test-repo-summary`、`test-repo-promotion`、`test-pure-functions`、`test-brief-scope`、`test-http-api` 全部 exit 0；CI 全套（依 `ci.yml` 順序 34 支，清除開發者環境變數）全數 PASS、exit 0，被測為 `7f47d18` 加上本次提交內容的工作區，2026-10-20。

## 使用方式對照

| 情境 | 變更前 | 變更後 |
|------|--------|--------|
| 清掉 131 筆他人 merge／release 骨架 | 無法不促升地清除 | `memoria repo summarize <repo> --dismiss-pending --type merge,release` |
| 清掉 issue-20 造成的重複列 | 無法清除 | `memoria repo summarize <repo> --dismiss <id>` |

## 測試策略

| Scenario | 層級 | 位置 |
|----------|------|------|
| SCN-001～004 | CLI 端到端 | `scripts/test-repo-summary.sh` |
| SCN-005、006 | CLI 端到端（含 sync、brief） | `scripts/test-repo-promotion.sh`、`scripts/test-brief-scope.sh` |
| SCN-007 | HTTP 契約 | `scripts/test-http-api.sh` |

完成定義另依 [project.md](../../agents/project.md)：`pnpm run check`、build 與 `node dist/cli.mjs --help`、觸及 shell 過 `bash -n`、CI 順序全跑。

## 檢查清單

- [x] 所有 Scenario 已核准（2026-10-20）
- [x] 步驟 1 盤點完成並記錄
- [x] S1～S5 完成判準全部達成
- [x] 改 symbol 前已跑 GitNexus impact，commit 前已跑 detect_changes
