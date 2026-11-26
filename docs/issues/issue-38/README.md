# Issue 38 - brief 的未掃描 commit 把未合併分支算進去，發版後沒 sync 時也看不出最新摘要已過時

## 文件清單
- [implementation-plan.md](./implementation-plan.md)

## 概述

brief 與 `doctor` 會顯示每個 repository 的「未掃描 commit」，提醒讀者該跑 `repo sync`。2026-11-25 對 9 個下游 session 做使用體驗調查，發現這個數字有兩個問題：

1. **未合併分支也被算進去。** `countUnscanned`（`src/core/git/scan-lag.ts:19-34`）用 `--branches --tags HEAD` 計算，所以在主 worktree 切到 issue 分支後，還沒合併的工作也算「未掃描」。有一個下游 session 因此一直看到 21 個未掃描 commit，但依 skill 的規定，合併或發版之後才該 sync，這個數字反而讓人分心。
2. **發版後沒 sync，看不出最新摘要已經過時。** 一個下游已經發了新版，brief 的「最新摘要」還停在上一版，只附一個「未掃描 commit: 17」。另一個下游移除某個整合的提交還沒 sync，recall 回傳的是被那個提交推翻的舊記憶。

本 issue 把未掃描的計數改成只看登記的預設分支與 tag，並在有未掃描的 tag 時點名。`repo sync` 本身的掃描範圍不變。

## 關鍵差異

| 項目 | 變更前 | 變更後 |
|------|--------|--------|
| 未掃描 commit 的計算範圍 | 所有本機分支、tag 與 HEAD | 登記的預設分支與 tag；沒有登記預設分支時維持原範圍 |
| 未掃描的 tag | 不顯示 | brief 的 Repository 狀態行與 `--json` 列出名稱 |
| `repo sync` 掃描範圍 | 所有分支與 tag | 不變 |

## 現況

**現行 review**: review-2cca66c.md

## 涉及檔案

```text
src/core/git/scan-lag.ts      # 可改：計數範圍改為預設分支與 tag；另列未掃描的 tag
src/core/db/brief.ts          # 可改：Repository 狀態行顯示未掃描的 tag
src/core/types.ts             # 可改：BriefData 的 repository 加 unscanned_tags
src/core/memoria.ts           # 可改：attachScanLag 一併帶入 unscanned_tags
src/cli/commands/doctor.ts    # 未改：repo scan 檢查透過 measureScanLag 沿用新的計數
src/core/git/scanner.ts       # 不可觸及：repo sync 的掃描範圍不變
scripts/test-brief-scope.sh   # 可改：(K) 段擴充
scripts/test-http-api.sh      # 可改：/v1/brief 的 unscanned_tags
docs/CLI.md、docs/CLI.zh-TW.md、docs/API.md、docs/API.zh-TW.md、docs/OPERATIONS.md、docs/agents/architecture.md、CHANGELOG.md  # 常青文件
```

## Gherkin 驗收劇本

```gherkin
Feature: brief 的未掃描提示只反映該 sync 的變更，並點名未掃描的發版

  Background:
    Given 一個已登記、已 sync 過的 repository，登記的預設分支是 main

  @SCN-001
  Scenario: 未合併分支的提交不算未掃描
    Given sync 之後在 feature 分支新增 4 個提交，main 沒有新提交
    When 產生 brief，並執行 doctor
    Then 這個 repository 沒有未掃描 commit 的提示
    And doctor 的 repo scan 檢查不把它列為落後

  @SCN-002
  Scenario: 預設分支的新提交算未掃描
    Given sync 之後 main 新增 3 個提交
    When 產生 brief
    Then Repository 狀態行顯示「未掃描 commit: 3」
    And 執行 repo sync 後提示消失

  @SCN-003
  Scenario: 未掃描的 tag 被點名
    Given sync 之後在 main 上新增 tag v1.1.0
    When 產生 brief
    Then Repository 狀態行列出「未掃描 tag: v1.1.0」
    And brief --json 的該 repository 帶有 unscanned_tags ["v1.1.0"]
    And 執行 repo sync 後不再列出

  @SCN-004
  Scenario: 沒有登記預設分支時維持原本的計數
    Given 一個登記時沒有預設分支的 repository，sync 之後在任一分支新增 2 個提交
    When 產生 brief
    Then 未掃描 commit 與變更前相同，為 2

  @SCN-005
  Scenario: repo sync 的掃描範圍不變
    Given SCN-001 的 feature 分支提交
    When 執行 repo sync
    Then 產生的 git 事件與變更前相同，feature 分支的提交照常被掃描
```

## Gherkin 核准紀錄
- **核准 commit**: fec4368
- **核准來源**: 使用者 2026-11-25 對話中說「照這份清單開 issue」，兩題分別選「只算預設分支與 tag」與「點名未掃描的 tag」（SCN-001～005）

全部 Scenario 於 2026-11-25 核准。

## 重構步驟概要

任務清單與狀態只在 [implementation-plan.md](./implementation-plan.md)「實作步驟」維護。

## 風險與首要驗證

- **最大風險**：登記的預設分支不是實際的整合分支，未掃描提示從此漏報。2026-11-25 查本機資料根：有一個下游登記的預設分支是 `master`，但日常合併進 `dev`。改成只看預設分支後，這個 repository 合併進 `dev` 的工作不會再被算成未掃描（見 TBD-1）。
- **風險等級與理由**：Medium。改的是唯讀診斷，不影響資料；但漏報會讓 brief 繼續顯示過時的摘要卻沒有提示，正好是本 issue 要解決的問題。
- **首要驗證**：主要實作前，先盤點本機資料根每個 repository 的登記預設分支，與它最近 30 天合併提交實際落在哪個分支，列出不一致的 repository。
- **選擇理由**：漏報只取決於登記資料和實際使用方式是否一致，盤點現有資料最直接。
- **完成證據**：盤點結果記在計畫步驟 1；不一致的 repository 已依 TBD-1 的結論處理，或已列為已知限制。

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
|------|------|------|------|
| TBD-1 | 登記的預設分支和實際整合分支不同時怎麼辦：目前已知 1 個下游（登記 `master`、合併進 `dev`）。可以用既有的 `repo add <path> --default-branch dev` 更正登記，不需改程式；要不要更正，由使用者決定 | 已解決（2026-11-26 使用者回「照建議」，選更正）：步驟 1 盤點 12 個 repository，只有這個下游不一致，近 30 天 dev 有 926 個提交不在 master、最新 tag 只在 dev。已在維護者資料根執行 `repo add` 加 `--default-branch dev`，登記改為 dev；這次 `repo add` 也順帶做了一次初始掃描（commits=83、refs=11、tags=1）。其他使用者的登記不一致時仍會漏報，文件寫明並指出更正方式 | 不更正時，該 repository 的未掃描提示會漏報合併到 `dev` 的工作；不阻擋 SCN-001～005 的實作 |
| TBD-2 | review-2cca66c S1、S2、N2、N5：英文 CLI 文件與 CHANGELOG 把退回條件寫成「not checked out locally」，與程式（看本機有沒有該分支）相反；只有未掃描 tag 時 doctor 仍寫 up to date（需決策）；文件寫由新到舊卻沒寫排序依據，排序也沒有斷言；測試檔頭的段落清單缺 (K/issue-38) | 已解決（2026-11-26 使用者回「照建議」，選修正，S2 採做法 B）：兩處改為「no local branch by that name」；`docs/OPERATIONS.md` 寫明 doctor 的 repo scan 只看提交數，未掃描 tag 由 brief 點名，doctor 不改；CLI、API 雙語與 CHANGELOG 寫明依 tag 日期排序、輕量 tag 用提交日期，並在 (K/issue-38) 段以日期與名稱順序錯開的 4 個 tag 斷言排序（依名稱正排、反排都會失敗）；檔頭補上該段 | SCN-003、SCN-004 |
| TBD-3 | review-2cca66c N1：用 `git tag -f` 移到新提交的既有 tag 不會被點名，因為只比對 tag 名稱 | 不影響本次交付（2026-11-26 使用者回「照建議」，選記入待確認）。追蹤：無；發版流程不會移動已發布的 tag，移動後的新提交仍算進未掃描 commit，提醒不會消失 | SCN-003 |
| TBD-4 | review-2cca66c N3、N4：JSON 的 `unscanned_tags` 沒有上限；判斷分支與列 tag 是兩次 `for-each-ref` | 已解決（2026-11-26 使用者回「照建議」，選不修）：上萬個未掃描 tag 屬極端情況（實測 5000 個約 40KB），完整清單對呼叫端有用；分開兩次呼叫比較好讀，成本只多一次 git 呼叫 | 無 |

## Timeline

| 日期 | 異動 |
|------|------|
| 2026-11-25 | 建立並核准 SCN-001～005（來源：9 個下游 session 的使用體驗調查）；記錄 TBD-1 |
| 2026-11-26 | 步驟 1 盤點完成；TBD-1 使用者選更正，該下游登記改為 dev |
| 2026-11-26 | 步驟 2～5 完成，三組回歸全綠 |
| 2026-11-26 | 獨立審查 review-2cca66c：PASS，2 項 SHOULD FIX（其中 1 項需決策）、5 項 NICE TO HAVE |
| 2026-11-26 | 使用者對 review-2cca66c 的建議回「照建議」：修正 S1、S2（做法 B）、N2、N5，記錄 TBD-2～4，送增量覆審 |

---
**建立日期**: 2026-11-25  
**分級**: Medium（scan-lag 計數範圍 + brief／doctor 顯示 + BriefData 加一個欄位；零 schema 變更、零新依賴）  
**風險**: Medium — 預設分支登記不符時會漏報\
**狀態**: 審查中
