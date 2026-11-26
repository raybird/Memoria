# Issue 39 - feedback 的 --used 不影響寫入，skill 卻要 agent 依情況標或不標 (Small)

## 概述

issue-36 的審查（review-88b341c S1，見 [issue-36 TBD-1](../issue-36/README.md#待確認事項)）發現 CLI 的 `feedback --used` 帶不帶都寫入一樣的資料：

- `src/cli/commands/feedback.ts:41` 是 `used: options.used ?? true`，沒帶旗標也當成 true。
- CLI 一定會送分數（`--score` 預設 `'1'`），而 `src/core/db/telemetry.ts:99-101` 只在沒有分數時才用 `used` 推算分數；`recall_telemetry` 沒有 `used` 欄位。
- 2026-11-26 在隔離資料根實測：兩次 recall 各以 `--score 0.4 --hits` 同一筆回報，一次帶 `--used`、一次不帶，`recall_telemetry` 兩列都是 `0.4|explicit`，`memory_utility` 也累加成一樣。

部署的 skill（`skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md` feedback 段）卻要 agent 在沒有幫助、或只是測試查詢時不標 `--used`，寫出了一個程式沒有的區別。測試查詢的結果沒用在工作上，照命中品質給分又帶 `--hits` 時，那些記憶照樣累積效用，排序因此偏移；這是 issue-36 想避免的情況，目前沒有擋下來。

本 issue 決定 `--used` 的語意，讓 skill、CLI 文件與程式一致。HTTP `POST /v1/recall/:id/outcome` 與 SDK `markRecallUseful` 也接受 `used`，一併確認。

## 涉及檔案

依 TBD-1 的決定而定，候選：

- `src/cli/commands/feedback.ts` - `--used` 的預設值或旗標本身
- `src/core/db/telemetry.ts` - `used` 與分數、逐筆效用歸因的關係
- `skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md`、`DEPLOYED_REFERENCE.md` - feedback 段
- `docs/CLI.md`、`docs/CLI.zh-TW.md`、`docs/API.md`、`docs/API.zh-TW.md` - feedback 與 outcome 的說明
- `scripts/test-cli-memory.sh` 或 `scripts/test-utility-ranking.sh` - 回歸測試

## 驗收條件

待 TBD-1 決定後撰寫，目前沒有已核准的驗收條件。

## 風險與首要驗證

- **最大風險**：改變回報語意會影響 UFL 的逐筆效用累積，進而改變 recall 排序與 prune 的保留判斷；既有資料已用舊語意寫入。
- **風險等級與理由**：Medium。程式改動小，但效用訊號是排序的輸入，下游 adapter 與 SDK 也會送 `used`。
- **首要驗證**：先在隔離資料根以現行程式重現「帶與不帶 `--used` 寫入相同」作為紅燈，再確認選定語意下 `memory_utility` 的變化。
- **選擇理由**：這是問題本身的可觀察形態，直接對照 `recall_telemetry` 與 `memory_utility` 的列。
- **完成證據**：待驗收條件核准後補上。

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
|---|---|---|---|
| TBD-1 | `--used` 該代表什麼。可選做法：(a) 不再區分，`--used` 保留為可接受但不影響寫入的旗標，skill 與文件改成測試查詢照品質給 `--score`、不帶 `--hits`，讓效用不歸到個別記憶；(b) 讓旗標有作用，沒帶 `--used` 時不做逐筆效用歸因，只記分數；(c) 在 `recall_telemetry` 另存 `used`，校準與遙測可以分開看，需要 migration。建議 (a)：不改程式與 schema，用既有的 `--hits` 就能讓測試查詢不影響排序 | 待確認 | 驗收條件、涉及檔案與分級都取決於此 |

## Timeline

| 日期 | 異動 |
|------|------|
| 2026-11-26 | 建立（來源：issue-36 review-88b341c S1；使用者 2026-11-26 回「照建議」：另開 issue 決定 `--used` 的語意）；驗收條件待 TBD-1 決定 |

---
**建立日期**: 2026-11-26  
**分級**: Small  
**風險**: Medium\
**狀態**: 待確認
