# Issue 41 - 摘要寫回時促升失敗不說原因，sync 也只補最近 50 筆 (Small)

## 概述

2026-11-27 以多個 agent 平行寫回約 240 筆 git 摘要時，一個外部 repository（代稱 downstream-b）有兩筆 merge 第一次 `repo summarize --submit` 回 `ok:true`、`promoted:false`；同一份 payload 重送後才 `promoted:true`。merge 與 release 依 `isPromotable`（`src/core/db/git-promote.ts:39`）一律可促升，所以這兩次 `promoted:false` 是促升失敗，不是不符資格。

- `src/core/memoria.ts` 的 `repoSubmitSummary` 把促升包在 `try { … } catch { /* summary stays enriched; next sync retries promotion */ }` 裡：失敗時摘要維持 enriched，回傳只有 `promoted:false`，不帶任何原因，錯誤本身被丟掉。呼叫端分不出「不符資格」（例如 importance 低的 commit_range）、「已經促升過」和「寫入失敗」三種情況，兩次失敗的實際原因因此無從得知。當時有其他程序同時寫同一個 `sessions.db`，`SQLITE_BUSY_TIMEOUT_MS` 為 5000 毫秒，是可能的原因但未證實。
- 註解說下次 sync 會補做，但 `promoteEligible`（同檔）在 `force` 為假時只從 `listSummaries(…, { status: 'enriched', limit: 50 })` 補候選。一次寫回超過 50 筆時，較早寫回而促升失敗的摘要不在這 50 筆裡，sync 不會補，它們就一直不在 recall 裡，而且沒有任何訊息。

本 issue 讓促升失敗可以被看見，並讓補救確實涵蓋所有漏掉的摘要。

## 涉及檔案

依 TBD-1、TBD-2 的決定而定，候選：

- `src/core/memoria.ts` - `repoSubmitSummary` 的促升錯誤處理與回傳；`promoteEligible` 的補救候選
- `src/core/db/git-summary.ts` 或 `src/core/db/git-promote.ts` - 列出「已增強、可促升、尚未促升」的摘要
- `src/cli/commands/repo.ts` - `--submit` 的人類可讀輸出
- `src/server.ts`、`docs/API.md`、`docs/API.zh-TW.md` - `POST /v1/repos/:ref/summaries/:summaryId` 的回應欄位
- `docs/CLI.md`、`docs/CLI.zh-TW.md`、`skills/memoria-memory-sync/deployed/DEPLOYED_REFERENCE.md` - 寫回結果的說明
- `scripts/test-repo-promotion.sh` - 回歸測試
- `src/core/db/telemetry.ts`、recall 排序 - 不應改動

## 驗收條件

待 TBD-1、TBD-2 決定後撰寫，目前沒有已核准的驗收條件。

## 風險與首要驗證

- **最大風險**：促升失敗的觸發條件未證實；測試若只模擬某一種失敗，可能讓真正的原因照樣被吞掉。另外，補救範圍擴大後，sync 會促升較早寫回、至今未促升的摘要，這些記憶會在升級後第一次 sync 時一次出現在 recall 與 brief。
- **風險等級與理由**：Low。寫回結果是新增欄位，原有欄位不變；補救只影響「已增強、可促升卻沒有促升」的摘要，2026-11-27 查本機資料根為 0 筆。
- **首要驗證**：先在隔離資料根讓促升必定失敗（例如另一個連線持有寫鎖超過逾時），以現行程式確認回傳只有 `promoted:false`、沒有原因，作為紅燈；再造出超過 50 筆已增強摘要、最早那筆未促升，確認 sync 不會補。
- **選擇理由**：這兩個都是實際發生的可觀察形態。
- **完成證據**：待驗收條件核准後補上。

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
|---|---|---|---|
| TBD-1 | 促升失敗時寫回要怎麼回報。可選做法：(a) 回傳新增 `promotion` 欄位，值為 `promoted`、`not_eligible`、`already_promoted`、`failed` 之一，`failed` 時附錯誤訊息，CLI 印出警告；`ok` 維持 true，因為摘要本身已寫入；(b) 在 (a) 之外，遇到 SQLITE_BUSY 時於 submit 內重試促升數次；(c) 促升失敗就讓整個寫回失敗並回滾。建議 (a)：原因看得見，呼叫端可以自行重送；(b) 的重試次數與間隔沒有實測依據，(c) 違反「促升失敗不回滾增強」的既有設計 | 待確認 | 驗收條件、涉及檔案 |
| TBD-2 | sync 的補救要涵蓋多少。可選做法：(a) 改為列出所有「已增強、可促升、尚未促升」的摘要，不設 50 筆上限；(b) 維持上限但提高到某個數字；(c) 不改 sync，另加指令（例如 `repo summarize --promote-missing`）讓人手動補。建議 (a)：判斷條件就是 `isPromotable` 加上 `promotionExists`，查詢成本與摘要總數成正比，本機約 1000 筆以內 | 待確認 | 驗收條件、涉及檔案 |
| TBD-3 | 這次兩筆失敗的實際原因。錯誤被吞掉，事後無法重現當時的狀態；推測是多個程序同時寫入、等鎖超過 5000 毫秒 | 待確認 | 不影響驗收條件的形態；實作 TBD-1 後再遇到時就能看到原因 |

## Timeline

| 日期 | 異動 |
|------|------|
| 2026-11-27 | 建立（來源：2026-11-27 平行寫回 git 摘要時，downstream-b 兩筆 merge 首次寫回 `promoted:false`；使用者 2026-11-27 回「兩個發現開 issue」）；驗收條件待 TBD-1、TBD-2 決定 |

---
**建立日期**: 2026-11-27  
**分級**: Small  
**風險**: Low\
**狀態**: 待確認
