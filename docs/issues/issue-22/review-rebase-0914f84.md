# Rebase 疊加審查：issue-21 → issue-19 → issue-22（疊在 issue-20 合併後的 main）

- 審查日期：2026-10-20
- 獨立 reviewer：Claude subagent（general-purpose，未參與實作）
- 依據：`docs/agents/review-evidence.md`「重寫歷史後重新核對規格、測試與完整變更範圍」
- TARGET：`main` = `b62af5ea494a86aed14ab741f9191dc67dfe1f3f`（issue-20 已 fast-forward）
- 舊 ref（rebase 前）：`backup/issue-21-dismissed-summaries-prerebase` = `a2a44d6`、`backup/issue-19-embed-batching-prerebase` = `770b43f`、`backup/issue-22-skill-deployment-prerebase` = `e365e3e`，三者皆從 `ac76109` 分出

## 範圍變更紀錄

審查開始時三條分支解析到 `bc58623`／`09ba550`／`b7e3e45`。本 reviewer 在該組 tip 上獨立重現 `test-repo-summary.sh` 紅燈（見 E6），審查進行中協調者通知分支已移動，改以下列固定 SHA 為準。以下判定只對新 SHA 有效，舊組 tip 不予放行。

## 判定摘要

| Issue | Reviewed BASE SHA | Reviewed HEAD SHA | Reviewed patch-id | 對應原 PASS 報告 | 判定 |
|---|---|---|---|---|---|
| issue-21 | `b62af5ea494a86aed14ab741f9191dc67dfe1f3f` | `1df6530150c11ac31c732c27192d018be22a2be4` | `851088c09f6a0243b0bd2cb8fbbe6843ab6ecea6` | `docs/issues/issue-21/review-2405040.md`（PASS，2405040） | **PASS** |
| issue-19 | `1df6530150c11ac31c732c27192d018be22a2be4` | `274f58d09d03171f4e7a4885b8a9d28fe5e08d52` | `08be9b05d079d8ab3d60adc7e0c14cdb7ff446f7` | `docs/issues/issue-19/review-3b0caca.md`（PASS，3b0caca） | **PASS** |
| issue-22 | `274f58d09d03171f4e7a4885b8a9d28fe5e08d52` | `0914f84db43c86c8eb10b3c27863fbaf38d9806d` | `cfca5961628365e94f92fce7471d694184b84a67` | `docs/issues/issue-22/review-cfcbc0d.md`（PASS，cfcbc0d） | **PASS** |

patch-id 計算：issue-21 `git diff b62af5e 1df6530`、issue-19 `git diff 1df6530 274f58d`、issue-22 `git diff 274f58d 0914f84`，皆 `| git patch-id --stable`。

參考值（原審查範圍，`git diff ac76109 <HEAD>`）：2405040 → `9b1b03d8…`、3b0caca → `1fa1b910…`、cfcbc0d → `a990ab51…`。issue-22 新切片 patch-id 與 `ac76109..backup/issue-22-…-prerebase` 完全相同（`cfca5961…`），因其檔案與前兩個 issue 無重疊；issue-21、issue-19 因 `scripts/pure-fn-driver.mts` 上下文改變與 `1df6530` 而不同，如預期。相同 patch-id 不作為放行依據，以下逐項核對。

## 證據

| # | 命令／方法 | 被測版本 | 結果 |
|---|---|---|---|
| E1 | `git range-diff ac76109..backup/issue-21-…-prerebase b62af5e..1df6530` | 1df6530 | 8 筆對 8 筆：`3764a9f ! 83b4418`，其餘 7 筆 `=`；另多一筆新提交 `1df6530`（`-: ------- > 9:`）。`!` 的差異只在 `scripts/pure-fn-driver.mts`：import 區與斷言區的上下文改為 issue-20 新增的 `parseMergeSourceRef` import／斷言，issue-21 自己的 `+` 行（`isPromotable`、`GitSummaryRecord` import 與 isPromotable 斷言區塊）一字未變 |
| E2 | `git range-diff ac76109..backup/issue-19-…-prerebase 1df6530..274f58d` | 274f58d | 4 對 4：`b968c23 ! 53831e4`、`3b0caca ! a96aa7f`，`64c6cfd = c4041cb`、`770b43f = 274f58d`。兩個 `!` 都只是 `pure-fn-driver.mts` hunk 標頭／上下文改為 issue-20、21 新增的 import 與 `dismissed release is not` 斷言；issue-19 的 `embedTexts` import 與 embedLocal batching 斷言 `+` 行未變 |
| E3 | `git range-diff ac76109..backup/issue-22-…-prerebase 274f58d..0914f84` | 0914f84 | 6 對 6 全部 `=` |
| E4 | `git range-diff bc58623..09ba550 1df6530..274f58d`、`09ba550..b7e3e45 274f58d..0914f84` | — | 第二次 `rebase --onto` 前後 issue-19／22 全部 `=`；切片 patch-id 前後相同（`08be9b05…`、`cfca5961…`） |
| E5 | 檔案層級聯集：`git diff --name-only ac76109 backup/*` 三者聯集 vs `git diff --name-only b62af5e 0914f84`（`LC_ALL=C` 排序） | 0914f84 | 完全相同，40 個檔案，無非預期檔案。issue-20 的 `src/core/git/summary-pipeline.ts` 不在疊加 diff 中（維持 main 版本） |
| E6 | 單一 issue 擁有的 36 個檔案：比對 `backup:<f>` 與 tip blob | b7e3e45（舊 tip）；0914f84 與 b7e3e45 差異僅 `1df6530` 兩檔（E8） | 36 檔 blob SHA 完全相同 |
| E7 | 多方修改的 4 個檔案：各擁有方 `git diff -U0 ac76109 <owner>` 的 `+/-` 行多重集合 vs 疊加結果 | b7e3e45 | `README.md`（21+22）、`README.zh-TW.md`（21+22）11 行、`scripts/pure-fn-driver.mts`（20+21+19）73 行、`scripts/test-repo-summary.sh`（20+21）95 行，皆完全相同：無遺失、無改寫、無多出 |
| E8 | `git diff b7e3e45 0914f84` 的 patch-id vs `git show 1df6530` 的 patch-id | — | 相同：新舊疊加 tip 的差異恰好是 `1df6530`，只動 `docs/issues/issue-21/implementation-plan.md` 與 `scripts/test-repo-summary.sh`（皆 M，一般檔案模式） |
| E9 | 閱讀 `pure-fn-driver.mts` 合併結果 | 0914f84 | 三段依 issue-20 → 21 → 19 順序附加在 clampedRoute 之後、結尾 summary 之前；頂層識別子（`milestone`、`pipelineCalls`、`vectors`、`rejected` 等）無重複宣告；env 還原段落保留 |
| E10 | 自建 worktree（detached），`env -u LIBSQL_URL -u MEMORIA_HOME bash scripts/test-repo-summary.sh` | b7e3e45、bc58623 | 兩者皆 exit 1，`✗ fixture: 1 pending merge + 2 pending releases: expected '3', got '4'`，重跑 2 次結果一致（確定性） |
| E11 | 同上 | `backup/issue-21-…-prerebase`（a2a44d6） | exit 0，`[repo-summary] PASS`：紅燈只在與 issue-20 疊加後出現，屬語意衝突 |
| E12 | 在測試副本 SCN-003 批次前印出 merge／release 狀態 | b7e3e45 | SCN-001 dismiss 的是 `feature/pricing`；write-back enrich 的是 release `build-2026.0715`；批次前 pending：merge `feature/coupons`（issue-20 情境留下）、merge `feature/batch`、release `v1.0.0`、`v1.1.0` → 4 筆，與協調者推論一致 |
| E13 | `test-repo-summary.sh` | 1df6530 | exit 0，62 ✓／0 ✗，`[repo-summary] PASS` |
| E14 | `test-pure-functions.sh` | 0914f84 | exit 0，75 ✓／0 ✗，含 parseMergeSourceRef（issue-20）、isPromotable（issue-21）、embedLocal batching 與查詢路徑（issue-19）全部斷言 |
| E15 | `test-repo-summary.sh` | 0914f84 | exit 0，62 ✓／0 ✗；SCN-003 八條 ✓（含新增 `the other pending merge is dismissed`），SCN-004、SCN-008、non-invasive ✓ |
| E16 | 探針：在 0914f84 測試副本的批次命令前印狀態 | 0914f84 | `coupons_before_batch=pending batch_before=pending scn001=feature/pricing release_before=pending`：新斷言在批次前確實是 pending，不是空轉 |
| E17 | `npx tsc --noEmit`；`test-repo-promotion.sh` | b7e3e45 | TSC 通過；repo-promotion exit 0 PASS（程式碼與 0914f84 相同，差異僅 E8 兩檔） |

完整 CI 由協調者另行執行，本報告不重跑。

## 各 issue 核對

### issue-21（1df6530）

- 規格：SCN-003 Gherkin 要求「只有 pending 的 merge 與 release 變為 dismissed，並回報筆數 2」，Background 是各一筆。測試 fixture 在 Background 之外累積了其他情境的摘要，早在原審查（review-1f3d692 M-1 說明）就以字面值 3 加註解處理；現在 issue-20 再多留一筆 pending merge，字面值改為 4（2 merge＋2 release）是同一套做法的延續，Then 的語意（只有 merge／release、commit_range 與 enriched 不變）仍逐條斷言。
- `1df6530` 的推論成立：E12 證實多出的那筆就是 `feature/coupons`，E16 證實它在批次前是 pending，E15 證實批次後變 dismissed。回報筆數字面值 4 仍能抓到「略過某一型別」的變異（原 M-1 變異檢查的機制未變）。
- `test-repo-summary.sh` 段落順序：issue-20 的兩段（`--merge` 在 sync 後／前）插在 merge summary 之後、release 之前；issue-21 的 SCN 段落全部在檔尾 branch summary 之後。issue-20 段落只新增摘要，不改其他摘要狀態；對 issue-21 唯一的影響就是 pending merge 數，已由 `1df6530` 處理。SCN-001 選到 `feature/pricing`、SCN-002 的 enriched 仍是 `build-2026.0715` release，SCN-008 的 branch 數以查詢取得而非字面值，皆不受影響。
- 程式碼未變（E6：`src/` 下 issue-21 檔案 blob 與 backup 相同）。

### issue-19（274f58d）

- 與原審查的差異僅 `pure-fn-driver.mts` 上下文（E2），`skills/memoria-vector/embed.mjs`、`README.md`、`docs/issues/issue-19/*` blob 與 backup 相同（E6）。斷言全數保留且通過（E14）。

### issue-22（0914f84）

- range-diff 全部 `=`，切片 patch-id 與 backup 相同（E3、E4）。共用檔 `README.md`／`README.zh-TW.md` 與 issue-21 的改動行多重集合完全保留（E7）。

## 失敗面

| 失敗面 | 輸入／狀態 | 預期 | 覆蓋 | 結論 |
|---|---|---|---|---|
| 文字衝突解法遺失一方斷言 | `pure-fn-driver.mts` 三方新增 | 三方 `+` 行全在 | E1、E2、E7、E14 | 無遺失 |
| 自動合併的語意衝突 | issue-20 fixture 多一筆 pending merge | SCN-003 期望值跟著調整 | E10–E16 | 舊 tip 確實紅；`1df6530` 修正後綠，斷言非空轉 |
| 疊加帶入非預期檔案 | — | 聯集相等 | E5 | 相等 |
| 第二次 `rebase --onto` 改動 19／22 | — | 全 `=` | E4 | 相同 |

## 發現

### MUST FIX

無（舊 tip `bc58623` 的語意衝突已由 `1df6530` 修正，見 E10–E16）。

### SHOULD FIX

無。

### NICE TO HAVE

- **N-1（issue-21，`scripts/test-repo-summary.sh` SCN-003 段首註解）**：仍寫「SCN-001 used up the only pending merge」。疊上 issue-20 後 SCN-001 之後還有一筆 `feature/coupons` pending，這句已不成立；`1df6530` 在下方另加了說明，但上方舊句沒改，讀者會看到前後矛盾。建議改成「SCN-001 dismissed one pending merge」之類的說法。
- **N-2（issue-21，SCN-001 選取方式）**：`SELECT id … WHERE summary_type='merge' AND status='pending' LIMIT 1` 沒有 `ORDER BY`，現在靠全表掃描的 rowid 順序選到 `feature/pricing`（E12、E16；`idx_git_summaries` 以 `repository_id` 為首欄，這個查詢用不上）。如果哪天選到 `feature/coupons`，計數 4 仍成立，但 `the other pending merge is dismissed` 會在批次前就已是 dismissed 而空轉。建議把 SCN-001 固定在 `source_ref = 'feature/pricing'`，或在批次前先斷言 coupons 為 pending。

## 判定

- issue-21 `1df6530`：**PASS**
- issue-19 `274f58d`：**PASS**
- issue-22 `0914f84`：**PASS**

前提：三個 tip 的完整 CI 由協調者回報通過。本判定不涵蓋舊組 tip `bc58623`／`09ba550`／`b7e3e45`（`test-repo-summary.sh` 紅燈，E10）。
