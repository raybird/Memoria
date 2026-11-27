# Issue 41 - 摘要寫回時促升失敗不說原因，sync 也只補最近 50 筆 (Small)

## 概述

2026-11-27 以多個 agent 平行寫回約 240 筆 git 摘要時，一個外部 repository（代稱 downstream-b）有兩筆 merge 第一次 `repo summarize --submit` 回 `ok:true`、`promoted:false`；同一份 payload 重送後才 `promoted:true`。merge 與 release 依 `isPromotable`（`src/core/db/git-promote.ts:39`）一律可促升，所以這兩次 `promoted:false` 是促升失敗，不是不符資格。

- `src/core/memoria.ts` 的 `repoSubmitSummary` 把促升包在 `try { … } catch { /* summary stays enriched; next sync retries promotion */ }` 裡：失敗時摘要維持 enriched，回傳只有 `promoted:false`，不帶任何原因，錯誤本身被丟掉。呼叫端分不出「不符資格」（例如 importance 低的 commit_range）、「已經促升過」和「寫入失敗」三種情況，兩次失敗的實際原因因此無從得知。當時有其他程序同時寫同一個 `sessions.db`，`SQLITE_BUSY_TIMEOUT_MS` 為 5000 毫秒，是可能的原因但未證實。
- 註解說下次 sync 會補做，但 `promoteEligible`（同檔）在 `force` 為假時只從 `listSummaries(…, { status: 'enriched', limit: 50 })` 補候選。一次寫回超過 50 筆時，較早寫回而促升失敗的摘要不在這 50 筆裡，sync 不會補，它們就一直不在 recall 裡，而且沒有任何訊息。

本 issue 讓促升失敗可以被看見，並讓補救確實涵蓋所有漏掉的摘要。

## 現況

**現行 review**: review-91a8edc.md

## 涉及檔案

採 TBD-1 (a)、TBD-2 (a)。

- `src/core/memoria.ts` - `repoSubmitSummary` 的促升錯誤處理與回傳；`promoteEligible` 的補救候選
- `src/core/db/git-summary.ts` 或 `src/core/db/git-promote.ts` - 列出「已增強、可促升、尚未促升」的摘要
- `src/core/types.ts` - 寫回結果的型別
- `src/cli/commands/repo.ts` - `--submit` 的人類可讀輸出
- `src/server.ts`、`docs/API.md`、`docs/API.zh-TW.md` - `POST /v1/repos/:ref/summaries/:summaryId` 的回應欄位
- `docs/CLI.md`、`docs/CLI.zh-TW.md`、`skills/memoria-memory-sync/deployed/DEPLOYED_REFERENCE.md` - 寫回結果的說明
- `AGENTS.md` - 可改：HTTP API 表的寫回端點補 `promotion`
- `skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md` - 可改：merge 摘要寫回的完成判準原本是 `promoted: true`，改為看 `promotion`，失敗時重送
- `src/sdk.ts` - 寫回結果的型別
- `scripts/test-repo-promotion.sh` - 回歸測試
- `src/core/db/telemetry.ts`、recall 排序 - 不應改動

## 驗收條件

1. **AC-1**：促升寫入失敗時看得到原因。在隔離資料根讓促升的寫入失敗（例如測試資料庫在 `memory_sources` 加一個 `RAISE(ABORT)` 的 trigger），對一筆 merge 執行 `repo summarize --submit --json`：結果 `ok:true`，摘要狀態為 enriched，`data.promotion` 為 `failed`，`data.promotion_error` 帶有錯誤訊息；人類可讀輸出印出促升失敗的警告與原因。HTTP `POST /v1/repos/:ref/summaries/:summaryId` 回同樣的欄位。
   - 失敗路徑：促升失敗卻沒有 `failed` 或沒有原因；或促升失敗讓整個寫回失敗、摘要被回滾。
2. **AC-2**：另外三種結果分得出來。可促升且成功為 `promoted`；importance 低於門檻、沒有 decisions／限制／風險的 commit_range 為 `not_eligible`；已促升過的摘要重新寫回為 `already_promoted`。既有的 `promoted` 布林欄位照舊（只有 `promoted` 時為 true），`dismissed_covered` 不變。
   - 失敗路徑：三種情況任兩種回同一個值；或既有欄位的值改變。
3. **AC-3**：sync 補做所有漏掉的促升。隔離資料根有超過 50 筆已增強的摘要，最早寫回的那筆可促升卻沒有促升；執行 `repo sync` 後它已促升、出現在 recall。已促升過與不符資格的摘要不會因此重複促升或被促升。
   - 失敗路徑：只補最近 50 筆；或補救重複寫入既有的促升。
4. **AC-4**：既有行為不變。寫回成功的路徑、dismiss 與 sync 的其餘結果照舊，`test-repo-promotion.sh`、`test-repo-summary.sh`、`test-http-api.sh` 照常通過；CLI、API 雙語文件與部署的 REFERENCE 寫明 `promotion` 的四個值。
   - 失敗路徑：既有測試的斷言需要改值才能通過。

- **核准日期**: 2026-11-27
- **核准來源**: 使用者 2026-11-27 逐題確認時 TBD-1、TBD-2 選 (a)，對 AC-1～4 回「核准」

## 風險與首要驗證

- **最大風險**：促升失敗的觸發條件未證實；測試只能注入一種失敗，要確保回報走的是「任何例外都帶出原因」的路徑，而不是只認某種錯誤碼。另外，補救範圍擴大後，sync 會促升較早寫回、至今未促升的摘要，這些記憶會在升級後第一次 sync 時一次出現在 recall 與 brief。
- **風險等級與理由**：Low。寫回結果是新增欄位，原有欄位不變；補救只影響「已增強、可促升卻沒有促升」的摘要，2026-11-27 查本機資料根為 0 筆。
- **首要驗證**：先寫 AC-1、AC-3 的斷言，以現行程式取得紅燈：注入的促升失敗只回 `promoted:false`、沒有原因；超過 50 筆時最早那筆 sync 後仍未促升。
- **選擇理由**：這兩個都是實際發生的可觀察形態。
- **完成證據**：見「實作與驗證步驟」步驟 1 的紅燈：注入的促升失敗只回 `promoted:false`、沒有原因；超過 50 筆時最早那筆 sync 後仍未促升。

## 實作與驗證步驟

1. ✅ **AC-1、AC-3 紅燈** — 在 `scripts/test-repo-promotion.sh` 寫斷言。相依：驗收條件核准。
   - 完成判準：兩項斷言以現行程式失敗，失敗形態與概述相同。
   - 完成證據：✅ 2026-11-27。以現行程式（main `fec7d1b` 的 src）執行 `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME bash scripts/test-repo-promotion.sh` exit 1，停在第一個 `promotion` 斷言（得 `undefined`）。另以斷言失敗不中止的副本跑完全段：AC-1 的 `promotion` 為 `undefined`、錯誤訊息沒有帶出、CLI 只印「已寫回摘要」；AC-2 三種結果都是 `undefined`；AC-3 在 50 筆較新的已增強摘要之後，最早那筆 sync 後仍沒有 `memory_sources`（得 0）。促升失敗以測試資料庫在 `memory_sources` 加 `RAISE(ABORT)` trigger 注入；commit range 骨架以 `repo summarize --range` 明確建立，因為前一段測試用 `sync --from/--to` 掃過範圍，一般 sync 不一定會為新提交建出骨架。
2. ✅ **寫回回報促升結果** — `repoSubmitSummary` 區分四種結果並帶出例外訊息；CLI、HTTP 與型別帶出欄位。相依：步驟 1。對應 AC-1、AC-2。
   - 完成判準：AC-1、AC-2 綠燈。
   - 完成證據：✅ 2026-11-27。`types.ts` 新增 `SummaryPromotion` 與 `SubmitSummaryData`（core 與 SDK 共用）；先查 `promotionExists` 判定 `already_promoted`，再依 `isPromotable` 促升，任何例外都記為 `failed` 並帶 `promotion_error`。HTTP 直接回傳 core 的結果，不必改 server。CLI 依四種結果各印一行。`pnpm run check`、`pnpm run build` exit 0，AC-1、AC-2 斷言通過。GitNexus impact：`repoSubmitSummary` 為 HIGH（CLI、HTTP 寫回），新增欄位、原有欄位不變。
3. ✅ **sync 補救不設上限** — `promoteEligible` 改為列出所有已增強、可促升、尚未促升的摘要。相依：步驟 1。對應 AC-3。
   - 完成判準：AC-3 綠燈，已促升的摘要沒有重複的 `memory_sources`。
   - 完成證據：✅ 2026-11-27。`listSummaries` 新增 `unpromoted` 選項：只留沒有 `memory_sources` 列的摘要，未指定上限時不設限（`LIMIT -1`）；`promoteEligible` 的非 force 路徑改用它，是否促升仍由 `isPromotable` 決定。AC-3 斷言通過：最早那筆被促升、50 筆填充摘要沒有促升、第二次 sync 沒有新增任何 `memory_sources`。GitNexus impact：`promoteEligible` 為 CRITICAL（sync 主路徑），只放寬候選範圍。
4. ✅ **文件與回歸** — CLI、API 雙語文件、部署的 REFERENCE、CHANGELOG；跑 CI 的 repo 與 http-mcp 組。相依：步驟 2、3。對應 AC-4。
   - 完成判準：兩組全綠，`release:docs-check` 通過。
   - 完成證據：✅ 2026-11-27。CLI、API 雙語文件寫明 `promotion` 的四個值；部署的 REFERENCE 說明每個值與失敗後重送；部署的 SKILL 完成判準改為 `promotion: promoted`；CHANGELOG 記 Added、Fixed 與升級後第一次 sync 可能促升較早摘要。`pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`、`bash -n install.sh`、`pnpm run release:docs-check` 都 exit 0。repo、http-mcp、core 三組 23 支腳本，加上部署 SKILL 有改而補跑的 adapters 組與 `test-npm-install.sh`，共 29 支以 `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME bash scripts/` 加腳本名執行，全部 exit 0；既有斷言沒有改值。精煉：`listSummaries` 加選項而不另寫一個查詢函式，沿用既有的欄位對應；其餘為 no-op。

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
|---|---|---|---|
| TBD-1 | 促升失敗時寫回要怎麼回報。可選做法：(a) 回傳新增 `promotion` 欄位，值為 `promoted`、`not_eligible`、`already_promoted`、`failed` 之一，`failed` 時附錯誤訊息，CLI 印出警告；`ok` 維持 true，因為摘要本身已寫入；(b) 在 (a) 之外，遇到 SQLITE_BUSY 時於 submit 內重試促升數次；(c) 促升失敗就讓整個寫回失敗並回滾。建議 (a)：原因看得見，呼叫端可以自行重送；(b) 的重試次數與間隔沒有實測依據，(c) 違反「促升失敗不回滾增強」的既有設計 | 已解決（2026-11-27 使用者選 (a)）：加 `promotion` 欄位與 `promotion_error`，不在 submit 內重試，不回滾（AC-1、AC-2） | 驗收條件、涉及檔案 |
| TBD-2 | sync 的補救要涵蓋多少。可選做法：(a) 改為列出所有「已增強、可促升、尚未促升」的摘要，不設 50 筆上限；(b) 維持上限但提高到某個數字；(c) 不改 sync，另加指令（例如 `repo summarize --promote-missing`）讓人手動補。建議 (a)：判斷條件就是 `isPromotable` 加上 `promotionExists`，查詢成本與摘要總數成正比，本機約 1000 筆以內 | 已解決（2026-11-27 使用者選 (a)）：不設上限（AC-3） | 驗收條件、涉及檔案 |
| TBD-3 | 這次兩筆失敗的實際原因。錯誤被吞掉，事後無法重現當時的狀態；推測是多個程序同時寫入、等鎖超過 5000 毫秒 | 不影響本次交付。追蹤：無；實作 TBD-1 後再遇到時，`promotion_error` 會帶出原因 | 無 |
| TBD-4 | review-91a8edc S1、N1～N5：AC-1 的測試用 commit range 而非 merge，merge 促升失敗後仍略過涵蓋範圍的路徑沒有斷言；部署 SKILL 的完成判準只認 `promoted`，重送得到 `already_promoted` 會被當成沒完成；REFERENCE 與 CHANGELOG 只說 commit range 受門檻影響，branch 摘要也是；sync 的補救整段只包一個 try，一筆失敗讓其餘候選全部跳過；`AGENTS.md` HTTP 表沒提 `promotion`；風險段完成證據仍是佔位文字 | 已解決（2026-11-27 使用者回「照建議」，全部修正）：`test-repo-promotion.sh` 補 merge 以 CLI `--json` 注入失敗的斷言（`failed`、原因、涵蓋的範圍仍略過、沒有半寫的 session）；`promoteEligible` 加可選的 `warnings`，sync 傳入時逐筆處理，失敗的記 `memory_promotion_failed` 警告後繼續，`--promote` 不傳、照舊拋錯；部署 SKILL 改為 `promoted` 或 `already_promoted` 都算完成；REFERENCE、CHANGELOG 改寫涵蓋 branch 摘要；`AGENTS.md` 補 `promotion`；風險段完成證據指向步驟 1 | AC-1、AC-3、AC-4 |

## Timeline

| 日期 | 異動 |
|------|------|
| 2026-11-27 | 建立（來源：2026-11-27 平行寫回 git 摘要時，downstream-b 兩筆 merge 首次寫回 `promoted:false`；使用者 2026-11-27 回「兩個發現開 issue」）；驗收條件待 TBD-1、TBD-2 決定 |
| 2026-11-27 | TBD-1、TBD-2 使用者選 (a)；撰寫 AC-1～4，待核准 |
| 2026-11-27 | 使用者核准 AC-1～4 |
| 2026-11-27 | 步驟 1～4 完成，待審查 |
| 2026-11-27 | review-91a8edc PASS，附 SHOULD FIX 1 項、NICE TO HAVE 5 項；使用者回「照建議」，結論記在 TBD-4，修正後送增量覆審 |

---
**建立日期**: 2026-11-27  
**分級**: Small  
**風險**: Low\
**狀態**: 待審查
