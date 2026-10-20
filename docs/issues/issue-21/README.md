# Issue 21 - git 摘要缺 `dismissed` 狀態：團隊 repo 的他人 merge／release 骨架無法不促升地清除

## 概述

摘要狀態只有 `pending | enriched`（`src/core/types.ts` 的 `GitSummaryStatus`）。`isPromotable`（`src/core/db/git-promote.ts`）對 merge 與 release 在非 pending 時無條件回 true，所以清掉一筆 merge／release 骨架的唯一方式是補成 enriched，而那必然促升進 recall。

2026-10-20 補 external-repo 時，sync 帶進 3441 個團隊 commit、產生 200 筆 pending，其中 131 筆 merge／release 只能放著：
- 不處理：brief 永遠顯示「待增強 N」，N 隨團隊 repo 活動持續成長（約每月 90 筆）。
- 補薄的精簡版去清：等於把內容稀薄的記憶灌進 recall，正是 [issue-2](../issue-2/README.md) 擋骨架促升要避免的事。

本 issue 新增 `dismissed` 狀態，代表「看過、決定不寫進記憶」，並提供單筆與批次的 dismiss 介面。

## 文件清單
- [implementation-plan.md](./implementation-plan.md)

## 快速導覽

### 當前流程
sync → 產生 pending 骨架 →（唯一出口）`--submit` 成 enriched → merge／release 必定促升

### 重構後流程
sync → 產生 pending 骨架 → `--submit` 成 enriched 並依規則促升，**或** `--dismiss` 成 dismissed（不促升、不計入待增強）→ 之後仍可再 `--submit` 改回 enriched

## 關鍵差異
| 項目 | 變更前 | 變更後 |
|------|--------|--------|
| 狀態集合 | pending、enriched | pending、enriched、dismissed |
| 清除骨架 | 只能補成 enriched（必促升） | `--dismiss <id>` 或 `--dismiss-pending --type ...` |
| brief「待增強」 | 含所有未處理骨架 | 只含 pending；dismissed 另列「已略過 N」 |

## 涉及檔案
### 核心
- `src/core/types.ts` - `GitSummaryStatus` 加 `dismissed`
- `src/core/db/git-summary.ts` - 單筆與批次 dismiss（只改 pending）
- `src/core/db/git-promote.ts` - `isPromotable` 對 dismissed 回 false
- `src/core/db/brief.ts` - 待增強計數排除 dismissed、另列已略過
- `src/core/memoria.ts` - `MemoriaCore` 方法
### 介面
- `src/cli/commands/repo.ts` - `--dismiss`、`--dismiss-pending --type`
- `src/server.ts`、`src/sdk.ts` - HTTP 端點與 SDK 方法
### 測試
- `scripts/test-repo-summary.sh`、`scripts/test-repo-promotion.sh`、`scripts/test-brief-scope.sh`、`scripts/test-http-api.sh`

## Gherkin 驗收劇本

```gherkin
Feature: 略過不寫進記憶的 git 摘要

  Background:
    Given 一個已註冊的 repository，含 pending 的 merge、release、commit_range 摘要各一筆，以及一筆 enriched 摘要

  @SCN-001
  Scenario: 單筆略過 pending 摘要
    When 執行 repo summarize --dismiss <pending merge 的 id>
    Then 該摘要狀態變為 dismissed
    And 不出現在 repo summarize --pending 的輸出

  @SCN-002
  Scenario: 拒絕略過已寫進記憶的摘要
    When 對 enriched 摘要執行 repo summarize --dismiss <id>
    Then 命令以非 0 結束並說明該摘要已是 enriched
    And 該摘要狀態與已促升的記憶都不變

  @SCN-003
  Scenario: 依型別批次略過
    When 執行 repo summarize --dismiss-pending --type merge,release
    Then 只有 pending 的 merge 與 release 變為 dismissed，並回報筆數 2
    And commit_range 與 enriched 摘要不變

  @SCN-004
  Scenario: 批次略過必須指定型別
    When 執行 repo summarize --dismiss-pending 而未給 --type
    Then 命令以非 0 結束，且沒有任何摘要被改動

  @SCN-005
  Scenario: 略過的摘要不促升也不計入待增強
    Given 一筆 merge 摘要已被略過
    When 執行 repo sync 與 brief
    Then 該摘要沒有被促升進 recall
    And brief 的待增強數不含它，並顯示「已略過 1」

  @SCN-006
  Scenario: 略過後仍可改回寫進記憶
    Given 一筆 merge 摘要已被略過
    When 對它執行 repo summarize --submit <id> 並提供合法 payload
    Then 狀態變為 enriched，且依一般規則促升

  @SCN-007
  Scenario: HTTP 介面提供相同能力
    When 呼叫單筆與批次的 dismiss 端點
    Then 回應為 MemoriaResult 封包，結果與對應 CLI 相同
```

## Gherkin 核准紀錄
- **核准 commit**: a79d3be
- **核准來源**: 介面範圍——使用者 2026-10-20 對「dismissed 要提供哪種介面？」選擇「單筆加批次」（建議內容：`--dismiss <id>` 單筆、`--dismiss-pending --type merge,release` 批次，dismissed 之後仍可再 `--submit` 回到 enriched）。各 Scenario 的具體行為由規劃推導，使用者 2026-10-20 回覆「照建議」全部核准（建議內容：對 enriched 摘要 dismiss 報錯、批次必須給 `--type`、brief 另列「已略過 N」、HTTP 兩個端點）

| Scenario | 核准日期 | 狀態 |
|----------|---------|------|
| SCN-001 | 2026-10-20 | 已核准 |
| SCN-002 | 2026-10-20 | 已核准 |
| SCN-003 | 2026-10-20 | 已核准 |
| SCN-004 | 2026-10-20 | 已核准 |
| SCN-005 | 2026-10-20 | 已核准 |
| SCN-006 | 2026-10-20 | 已核准 |
| SCN-007 | 2026-10-20 | 已核准 |

## 重構步驟概要
1. ✅ **S1 狀態與 db 層** - 完成
2. ✅ **S2 讀取端：促升、pending 清單、brief** - 完成
3. ✅ **S3 CLI 旗標** - 完成
4. ✅ **S4 HTTP 與 SDK** - 完成
5. ✅ **S5 常青文件** - 完成

## 風險與首要驗證

- **最大風險**：既有查詢若以 `status != 'enriched'` 推斷「pending」，新增狀態後會把 dismissed 誤算進待增強或促升候選
- **風險等級與理由**：Medium——動到 promotion 閘門的輸入，誤判會讓不該進 recall 的骨架進去，或讓該進的被擋
- **首要驗證**：實作前 grep 全部 `git_summaries` 的 `status` 比較點並逐一分類，再寫 SCN-005 的斷言（紅）
- **選擇理由**：靜默誤判只會出現在讀取端，盤點比對比任何單一測試更能確保沒有漏網的查詢
- **完成證據**：盤點清單記入 implementation-plan；SCN-005 紅→綠；`test-repo-promotion.sh` 全綠

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
|------|------|------|------|
| TBD-1 | SCN-001～SCN-007 需使用者核准 | 已解決 | 2026-10-20 使用者回覆「照建議」，全部核准 |
| TBD-2 | 批次是否加作者過濾（只略過非本人 commit）：需要 git 身分對應，本次不做 | 待確認 | 不影響已列 Scenario |

## Timeline

| 日期 | 異動 | 負責人 |
|------|------|--------|
| 2026-10-20 | 建立；介面範圍決策「單筆加批次」 | - |
| 2026-10-20 | SCN-001～SCN-007 核准（「照建議」） | - |

---
**建立日期**: 2026-10-20  
**分級**: Medium  
**風險**: Medium\
**狀態**: 待審查
