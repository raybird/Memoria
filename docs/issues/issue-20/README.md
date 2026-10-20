# Issue 20 - `repo summarize --merge` 與 sync 對同一個 merge 算出不同 fingerprint，產生重複摘要 (Small)

## 概述

範圍的冪等鍵是 `sha256(repositoryId | summaryType | baseSha | headSha | sourceRef | targetRef)`（`src/core/db/git-summary.ts` 的 `upsertSummaryRange`）。sync 建 merge 摘要時，會從 commit message 的 `Merge branch '<x>'` 解析出 `sourceRef`（`src/core/git/summary-pipeline.ts` L196–216）；`summarizeMergeCommit`（L284）沒有這一步，`sourceRef` 為空。兩者 base、head、target 完全相同，fingerprint 卻不同，所以 `--merge` 永遠找不到 sync 建好的那筆。

實測證據（2026-10-20，external-repo）：

| summary | base_sha | head_sha | target_ref | source_ref |
| --- | --- | --- | --- | --- |
| `sum_6c29988a29184205`（sync 建立，已 enriched） | `<base>` | `<merge sha>` | `dev` | `<feature-branch>` |
| `sum_60c3a2a849e04504`（`--merge` 建立，pending） | `<base>` | `<merge sha>` | `dev` | （空） |

agent 照「合併後跑 `--merge` 回寫自己那筆」的流程操作時，會回寫到重複的那筆，sync 那筆則永遠 pending。摘要沒有刪除路徑，重複列的清除依賴 [issue-21](../issue-21/README.md)。本機 skill 目前以 `find-merge-summary.sh` 先查既有摘要繞過（[project.md](../../agents/project.md) 地雷 M-2）。

修法：把「從 merge commit message 解析 sourceRef」抽成 sync 與 `--merge` 共用的函式。fingerprint 公式不變，所有既有範圍維持有效；已產生的重複列不回溯合併。

## 涉及檔案

- `src/core/git/summary-pipeline.ts` - 抽出 sourceRef 解析，`summarizeMergeCommit` 改用它
- `scripts/test-repo-summary.sh` - 兩種執行順序的不重複斷言
- `scripts/test-pure-functions.sh` - 訊息格式解析斷言

## 驗收條件

1. **AC-1**：對 sync 已建立摘要的 merge commit 執行 `repo summarize --merge <sha> --json`，回傳 `created: 0`，`summaries[0].id` 等於 sync 那筆 — 檢查方式：`scripts/test-repo-summary.sh` 新增案例，fixture repo 建立 `Merge branch 'feature-x'` 的 merge，先 sync 再 `--merge`，斷言 id 相同、`git_summaries` 列數不變
2. **AC-2**：先 `--merge` 再 sync，sync 不新增該 merge 的摘要 — 檢查方式：同一案例反序執行，斷言列數
3. **AC-3**：三種訊息格式兩條路徑解析結果一致：`Merge branch 'x' into 'dev'` 得到 `x`，`Merge remote-tracking branch ...` 與自訂訊息得到空值 — 檢查方式：`scripts/test-pure-functions.sh` 斷言

- **核准日期**: 2026-10-20
- **核准來源**: 使用者 2026-10-20 同意為這次發現的問題開 issue；AC-1～AC-3 由規劃推導，使用者 2026-10-20 回覆「照建議」核准（建議內容：`--merge` 回傳 sync 既有那筆、兩種執行順序都不重複、三種訊息格式的解析規則）

## 風險與首要驗證

**風險**: Low — 只影響 `--merge` 新建範圍的 fingerprint，既有資料不改寫。唯一前置條件是讀 commit message 時沿用 git-exec 白名單內的命令（或既有的 `loadCommitFacts`），`test-repo-noninvasive.sh` 須維持通過。

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
| --- | --- | --- | --- |
| TBD-1 | AC-1～AC-3 需使用者核准 | 已解決 | 2026-10-20 使用者回覆「照建議」，全部核准 |

## 實作與驗證步驟

1. 📝 **AC-3：共用的 sourceRef 解析** — 驗證方式：純函式斷言三種格式；sync 改呼叫它之後，`test-repo-summary.sh` 既有案例不變
   - 完成證據：（實作時回寫）
2. 📝 **AC-1、AC-2：`summarizeMergeCommit` 帶入 sourceRef** — 驗證方式：兩種執行順序的測試都斷言列數不變、id 相同；`test-repo-noninvasive.sh` 通過
   - 完成證據：（實作時回寫）
3. 📝 **新版發布後移除本機繞道** — 驗證方式：`~/.claude/skills/memoria/SKILL.md` 時機 4 改回直接 `--merge`，刪除 `find-merge-summary.sh`，project.md 地雷 M-2 標註失效日期
   - 完成證據：（回寫）

## Timeline

| 日期 | 異動 | 負責人 |
| --- | --- | --- |
| 2026-10-20 | 建立；以實測資料定位根因 | - |
| 2026-10-20 | AC-1～AC-3 核准（「照建議」） | - |

---
**建立日期**: 2026-10-20  
**分級**: Small  
**風險**: Low\
**狀態**: 待實作
