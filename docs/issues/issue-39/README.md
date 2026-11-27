# Issue 39 - feedback 的 --used 不影響寫入，skill 卻要 agent 依情況標或不標 (Small)

## 概述

issue-36 的審查（review-88b341c S1，見 [issue-36 TBD-1](../issue-36/README.md#待確認事項)）發現 CLI 的 `feedback --used` 帶不帶都寫入一樣的資料：

- `src/cli/commands/feedback.ts:41` 是 `used: options.used ?? true`，沒帶旗標也當成 true。
- CLI 一定會送分數（`--score` 預設 `'1'`），而 `src/core/db/telemetry.ts:99-101` 只在沒有分數時才用 `used` 推算分數；`recall_telemetry` 沒有 `used` 欄位。
- 2026-11-26 在隔離資料根實測：兩次 recall 各以 `--score 0.4 --hits` 同一筆回報，一次帶 `--used`、一次不帶，`recall_telemetry` 兩列都是 `0.4|explicit`，`memory_utility` 也累加成一樣。

部署的 skill（`skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md` feedback 段）卻要 agent 在沒有幫助、或只是測試查詢時不標 `--used`，寫出了一個程式沒有的區別。測試查詢的結果沒用在工作上，照命中品質給分又帶 `--hits` 時，那些記憶照樣累積效用，排序因此偏移；這是 issue-36 想避免的情況，目前沒有擋下來。

本 issue 決定 `--used` 的語意，讓 skill、CLI 文件與程式一致。HTTP `POST /v1/recall/:id/outcome` 與 SDK `markRecallUseful` 也接受 `used`，一併確認。

## 現況

**現行 review**: review-3d70567.md

## 涉及檔案

採 TBD-1 做法 (a)：寫入語意不變，只讓說明與程式一致。

- `src/cli/commands/feedback.ts` - 可改：只改 `--used` 的 help 說明，寫入邏輯不動
- `src/core/db/telemetry.ts` - 不可觸及：分數與逐筆效用歸因的寫入不變
- `src/server.ts`、`src/sdk.ts` - 不可觸及：HTTP outcome 與 SDK 的 `used` 行為不變
- `skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md`、`DEPLOYED_REFERENCE.md` - 可改：feedback 段與命令對照
- `docs/CLI.md`、`docs/CLI.zh-TW.md`、`docs/API.md`、`docs/API.zh-TW.md` - 可改：feedback 與 outcome 的說明
- `scripts/test-cli-memory.sh` - 可改：回歸斷言
- `src/core/types.ts` - 可改：只改 `RecallOutcomeInput.used` 的註解
- `CHANGELOG.md` - 可改

## 驗收條件

1. **AC-1**：`memoria feedback --help` 的 `--used` 說明寫明它為相容而保留、不影響寫入。其他參數相同時，帶與不帶 `--used` 寫入的 `recall_telemetry`（分數、訊號）與 `memory_utility` 都相同，既有呼叫照常成功、exit 0。檢查方式：隔離資料根兩次 recall，以相同的 `--score` 與 `--hits` 各回報一次（一次帶 `--used`），比對兩列 telemetry 與該記憶 utility 的增量；斷言 help 文字。
   - 失敗路徑：help 仍寫成會標記「用到」，或帶 `--used` 的舊呼叫失敗。
2. **AC-2**：回報時只給 `--score`、不帶 `--hits`：`recall_telemetry` 記下這個分數，任何記憶的 `memory_utility` 都不變。檢查方式：回報前後比對 `memory_utility` 全表，並斷言該 recall 的 telemetry 分數。
   - 失敗路徑：沒帶 `--hits` 的回報仍讓某筆記憶累積效用，測試查詢因此影響排序。
3. **AC-3**：部署的 skill feedback 段與 `DEPLOYED_REFERENCE.md` 的命令都不再出現 `--used`。feedback 段改為三種情況：結果用在工作上時依品質給 `--score`，`--hits` 列出用到的 hit；沒有幫助時給 `--score 0`；只是測試或看看、結果沒用在工作上時依品質給 `--score`、不帶 `--hits`，並說明不帶 `--hits` 就不會有記憶累積效用、排序不受影響。檢查方式：grep 兩檔、`node scripts/check-deployed-skill-sync.mjs` 與 `test-npm-install.sh` 的部署驗證。
   - 失敗路徑：skill 讓 agent 在結果用在工作上時也省略 `--hits`，有用的記憶不再累積效用。
4. **AC-4**：CLI 雙語文件寫明 `--used` 不影響寫入、`--hits` 決定效用歸到哪些記憶；API 雙語文件寫明 outcome 的 `used` 只在沒有 `utility_score` 時用來推算分數（true 為 1、false 為 0）。HTTP outcome 與 SDK `markRecallUseful` 的行為不變。檢查方式：`telemetry.ts`、`server.ts`、`sdk.ts` 沒有 diff，`test-http-api.sh`、`test-utility-ranking.sh` 照常通過，`release:docs-check` 通過。
   - 失敗路徑：文件與程式對 `used` 的描述不一致，或 HTTP、SDK 呼叫端的寫入結果改變。

- **核准日期**: 2026-11-26
- **核准來源**: 使用者 2026-11-26 對 TBD-1 回「好 issue-39 選 a」，對 AC-1～4 回「核准」

## 風險與首要驗證

- **最大風險**：skill 改寫後，agent 把該帶 `--hits` 的正式回報也省略，有用的記憶因此不再累積效用，排序訊號變弱。
- **風險等級與理由**：Low。做法 (a) 不改寫入語意與 schema，程式只改 help 說明；既有資料與下游 adapter、SDK 都不受影響。風險只在 skill 的措辭。
- **首要驗證**：先在 `scripts/test-cli-memory.sh` 寫 AC-1、AC-2 的斷言，以現行程式執行確認通過（這兩項描述既有行為，作為回歸保護，不會有紅燈）；help 說明的斷言先取得紅燈。
- **選擇理由**：AC-2 是做法 (a) 成立的前提：測試查詢不帶 `--hits` 就不影響排序。先以斷言釘住，skill 才能放心依賴它。
- **完成證據**：步驟 1 的完成證據（help 斷言的紅燈、AC-1 與 AC-2 的回歸斷言）；review-430907e 另以 6 種會改變寫入的注入錯誤確認這兩項斷言都會失敗。

## 實作與驗證步驟

1. ✅ **AC-1、AC-2：回歸斷言與 help 說明** — 在 `test-cli-memory.sh` 加斷言：同一筆 hit 分別以帶與不帶 `--used` 回報，telemetry 與 utility 相同；只給 `--score` 時 utility 不變；`feedback --help` 的 `--used` 說明含「no effect」。help 斷言取得紅燈後改 `feedback.ts` 的說明。相依：無。
   - 完成判準：三組斷言都通過；help 斷言有紅燈紀錄；`telemetry.ts`、`server.ts`、`sdk.ts` 沒有 diff。
   - 完成證據：✅ 2026-11-26。`test-cli-memory.sh` 新增 (Q/issue-39) 段，以獨立資料根比對：同一筆 hit 以 `--score 0.4` 回報兩次（一次帶 `--used`），兩列 telemetry 相同，該記憶的 explicit 累積為 1、0.4 再到 2、0.8；只給 `--score 0.7` 時 telemetry 記 0.7，`memory_utility` 整表前後相同。紅燈（改 help 前）：只有 help 斷言失敗（`--used  Mark the recall as used`），AC-1 的寫入比對與 AC-2 在現行程式就通過，屬回歸保護。綠燈：`feedback.ts` 只改 `--used` 的說明與註解，寫入邏輯未動；`git diff main` 對三個不可觸及的檔案為空。
2. ✅ **AC-3：部署的 skill** — 改 `DEPLOYED_SKILL.md` feedback 段與 `DEPLOYED_REFERENCE.md` 命令對照。相依：步驟 1。
   - 完成判準：兩檔不再出現 `--used`；`node scripts/check-deployed-skill-sync.mjs` 通過；措辭依 writing-rules 檢查。
   - 完成證據：✅ 2026-11-26。feedback 段的命令改為 `--hits <ids of the hits you used>`，下接三個情況各一行：用在工作上、沒有幫助、只是測試或看看（不帶 `--hits`，並說明不累積效用、排序不受影響）；「用在工作上」放第一行並寫出帶 `--hits` 的效果，對應最大風險。兩檔 grep `--used` 為 0；`check-deployed-skill-sync` 通過；`test-bootstrap.sh`、`test-npm-install.sh` 的部署驗證通過。writing-rules：正面表述，沒有提到被移除的旗標。
3. ✅ **AC-4：文件與回歸** — CLI、API 雙語文件與 CHANGELOG；跑 core 組與 `test-http-api.sh`、`test-utility-ranking.sh`、`test-npm-install.sh`（部署 skill 的安裝驗證）。相依：步驟 1、2。
   - 完成判準：所列腳本全綠，`release:docs-check` 通過，文件與行為一致。
   - 完成證據：✅ 2026-11-26。CLI 雙語在 `recall --json` 段後補一段 feedback 的寫入規則；API 雙語補 outcome 的 `used` 只在沒有 `utility_score` 時推算分數、`hits[]` 決定歸因；CHANGELOG `[Unreleased]` 的 Changed；各檔 Last verified 更新。rebase 到 v1.40.0 發版後的 main（`8d55363`）前後各跑一次：rebase 前 core 組 10 支與 `test-http-api`、`test-npm-install` 共 12 支 exit 0；rebase 後 `pnpm run check`、`build`、`--help`、`release:docs-check`（v1.40.0）、`check-deployed-skill-sync` 與 `test-cli-memory`、`test-utility-ranking`、`test-http-api`、`test-bootstrap`、`test-npm-install` 全部通過。

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
|---|---|---|---|
| TBD-1 | `--used` 該代表什麼。可選做法：(a) 不再區分，`--used` 保留為可接受但不影響寫入的旗標，skill 與文件改成測試查詢照品質給 `--score`、不帶 `--hits`，讓效用不歸到個別記憶；(b) 讓旗標有作用，沒帶 `--used` 時不做逐筆效用歸因，只記分數；(c) 在 `recall_telemetry` 另存 `used`，校準與遙測可以分開看，需要 migration。建議 (a)：不改程式與 schema，用既有的 `--hits` 就能讓測試查詢不影響排序 | 已解決（2026-11-26 使用者回「好 issue-39 選 a」）：採 (a)，驗收條件 AC-1～4 依此撰寫，風險降為 Low | 驗收條件、涉及檔案與分級 |
| TBD-2 | review-430907e S1、N1～N3：skill 寫回報 `--hits` 的記憶「下次排得更高」，但效用加權只往下調（`src/core/db/recall.ts` 的係數介於 0.5 到 1）；風險段的完成證據沒有回填；help 斷言依賴折行；`types.ts` 的 `used` 註解與新文件不一致 | 已解決（2026-11-26 使用者回「是否能增量複審先」，照建議四項都修並走增量覆審）：skill 改為分數低的往後排、分數高的維持原位並免於 stale prune；回填風險段的完成證據；help 斷言先合併換行再比對；`types.ts` 註解改為只在沒有 `utility_score` 時推算分數，並列入涉及檔案 | AC-1、AC-3 |
| TBD-3 | review-03683f0 N1、N2：skill 寫分數高的記憶「維持原位並免於 stale prune」，但分數低於 1 仍會略往下調，stale prune 也只用 session id 查效用，回報 `noteev-` 時沒有保護；help 斷言在「no effect」前有連字號時會誤報紅燈 | 已解決（2026-11-26 使用者回「照建議」，選修正）：skill 只保留「分數低的之後會往後排」；斷言改為 `([^-]\|-[^-])*`，允許單一連字號。stale prune 不認 event id 效用是既有限制，另開 [issue-40](../issue-40/README.md) | AC-3 |
| TBD-4 | review-03683f0 N3：風險與首要驗證段的完成證據寫「6 種會改變寫入的注入錯誤」都讓斷言失敗；實際改變寫入的是 4 種（review-430907e 的 A～D），F 由 help 斷言抓到，每種注入只讓其中一項斷言失敗 | 不影響本次交付（2026-11-26 使用者回「照建議」，選記入待確認）。追蹤：無；該段在審查後凍結，以本列更正，結論不變：AC-1、AC-2 的斷言在寫入被改壞時會失敗 | AC-1、AC-2 |
| TBD-5 | review-3d70567 N1：skill 的「分數低的之後會往後排」對一般 hit 成立，對 CLI 筆記只部分成立：recall 先做效用加權再收合筆記的兩半，回報其中一半後，下次留下另一半時分數不變或只部分下調 | 不影響本次交付（2026-11-27 使用者回「可以合併 推送發版」，同意記入待確認）。追蹤：[issue-40](../issue-40/README.md)；這是 issue-40 概述第二點的同一個問題，agent 的回報方式不受影響，issue-40 寫驗收條件時要讓這句對筆記也成立 | AC-3 |

## Timeline

| 日期 | 異動 |
|------|------|
| 2026-11-26 | 建立（來源：issue-36 review-88b341c S1；使用者 2026-11-26 回「照建議」：另開 issue 決定 `--used` 的語意）；驗收條件待 TBD-1 決定 |
| 2026-11-26 | TBD-1 使用者選 (a)；撰寫並核准 AC-1～4 |
| 2026-11-26 | 步驟 1～3 完成，rebase 到 v1.40.0 之後的 main |
| 2026-11-26 | 獨立審查 review-430907e：PASS，1 項 SHOULD FIX、3 項 NICE TO HAVE |
| 2026-11-26 | 依 review-430907e 修正 S1、N1～N3，記錄 TBD-2，送增量覆審 |
| 2026-11-26 | 增量覆審 review-03683f0：PASS，3 項 NICE TO HAVE |
| 2026-11-26 | 依 review-03683f0 修正 N1、N2，記錄 TBD-3、TBD-4，另開 issue-40；rebase 到建立 issue-40 的 main，送增量覆審 |
| 2026-11-26 | review-3d70567：rebase 後增量覆審的條件不成立，改做完整審查，PASS，1 項 NICE TO HAVE |
| 2026-11-27 | 記錄 TBD-5；狀態改為已完成，待合併 |

---
**建立日期**: 2026-11-26  
**分級**: Small  
**風險**: Low\
**狀態**: 已完成
