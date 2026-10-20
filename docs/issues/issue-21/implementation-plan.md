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

1. 📝 **首要驗證：status 比較點盤點** — SCN-005
   驗證：`grep -rn "status" src/core/db/git-*.ts src/core/db/brief.ts src/core/memoria.ts` 中所有針對 `git_summaries` 的比較逐一分類（等於 pending／等於 enriched／不等於），結果記入本步驟。
   完成判準：每個比較點都標明新增 dismissed 後的正確行為，沒有未分類項。
2. 📝 **S1 狀態與 db 層** — SCN-001、002、003、004
   驗證：db 層單元斷言——只改 pending、enriched 回錯誤、型別過濾正確、空型別陣列拒絕。
   完成判準：四種情況各有一條斷言紅→綠。
3. 📝 **S2 讀取端** — SCN-005、006
   相依：步驟 1、S1。
   驗證：`test-repo-promotion.sh` 斷言 dismissed 不被 sync 促升、submit 後促升；`test-brief-scope.sh` 斷言待增強數與「已略過」。
   完成判準：兩支腳本全綠，且步驟 1 盤點的每個比較點都有對應處理。
4. 📝 **S3 CLI** — SCN-001～004
   相依：S1。
   驗證：`test-repo-summary.sh` 以 CLI 跑 SCN-001～004；`repo summarize --help` 列出兩個旗標。
   完成判準：四個 Scenario 的 CLI 斷言全綠。
5. 📝 **S4 HTTP 與 SDK** — SCN-007
   相依：S1。
   驗證：`test-http-api.sh` 契約斷言（封包形狀、批次缺 types 回錯）。
   完成判準：契約斷言全綠。
6. 📝 **S5 常青文件**
   依 [project.md](../../agents/project.md)「常青文件更新責任」：`CLAUDE.md` Git-Aware 段落記三態與轉移；`AGENTS.md` HTTP 段補兩個端點；`README.md`／`README.zh-TW.md` 補 CLI 旗標。
   完成判準：三態轉移在 CLAUDE.md 有單一權威描述，其餘文件引用它。

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
- [ ] 步驟 1 盤點完成並記錄
- [ ] S1～S5 完成判準全部達成
- [ ] 改 symbol 前已跑 GitNexus impact，commit 前已跑 detect_changes
