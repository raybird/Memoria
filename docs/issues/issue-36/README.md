# Issue 36 - 部署的 skill 沒寫 recall 輸出的形狀、n/a 的意思與測試查詢的回報方式 (Small)

## 概述

2026-11-25 對 9 個下游 session 做使用體驗調查，有 5 份回報第一次解析 `recall --json` 就失敗：把 `data` 當成物件讀，但它其實是陣列，`recall_id`、`confidence`、`route_mode` 都在 `meta` 裡。部署的 skill（`skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md:47`）只寫了「Keep the `recall_id` from the output」，沒有說它在哪裡。

另外三件事也沒寫：

- **`[ n/a ]` 的意思。** 人讀輸出裡，只靠語意索引找到的命中會顯示 `[ n/a ]`（`src/cli/commands/recall.ts:63`，issue-9 的設計），但 skill 與 `docs/CLI.md` 都沒解釋，讀者看不出原因。
- **測試查詢的 feedback。** 只是測試、結果沒拿去用的 recall 要不要標 `--used`，三個 session 各做各的。
- **主機自己的記憶不能取代 recall。** 同一個專案還有 Claude auto-memory 這類主機記憶時，有 3 個 session 只讀了主機記憶就沒 recall，其中一個根據主機記憶的一句話判斷「recall 不會有結果」而跳過。

本 issue 只改文件，不改程式行為。

## 現況

**現行 review**: review-438a19e.md

## 涉及檔案

- `skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md` - recall 段補輸出形狀、`n/a`；feedback 段補測試查詢的規則；開頭補主機記憶不能取代 recall
- `docs/CLI.md`、`docs/CLI.zh-TW.md` - recall 段補 `n/a` 的意思與 `--json` 的形狀

## 驗收條件

1. **AC-1**：skill 的 recall 段寫出 `--json` 的形狀：頂層有 `ok`、`data`（命中陣列）與 `meta`；`recall_id`、`route_mode`、`confidence`、`confidence_basis` 在 `meta`；每筆命中有 `id`，有 `relevance` 時才是字面比對的分數。檢查方式：拿一份真實 `recall --json` 輸出逐欄對照 skill 的描述，欄位名稱與位置一致。
2. **AC-2**：skill 與 `docs/CLI.md`（含中文版）說明 `[ n/a ]` 代表「只靠語意索引找到，沒有字面分數」，不是低分。檢查方式：閱讀這三處文件，說法和 `recall.ts:57-63` 的註解一致。
3. **AC-3**：skill 的 feedback 段寫明：只是測試、結果沒用在工作上的 recall，照命中品質給 `--score`，不標 `--used`；「每個 `recall_id` 都回報一次」的收尾判準不變。檢查方式：閱讀 feedback 段。
4. **AC-4**：skill 寫明主機自己的記憶（例如 Claude auto-memory）不能取代 recall，開始 issue 或功能前照樣先 recall；查不到就回報 `--score 0`，不能事先猜測沒有結果就跳過。檢查方式：閱讀 skill 開頭與 recall 段。
5. **AC-5**：部署後的 skill 仍通過既有檢查。檢查方式：`test-bootstrap.sh`、`test-setup-onboarding.sh`、`test-npm-install.sh` 全綠。

- **核准日期**: 2026-11-25
- **核准來源**: 使用者 2026-11-25 對話中說「照這份清單開 issue」，清單內含「補上 `--json` 的形狀、`n/a` 的意思、測試查詢該不該標 `--used`」與「把 skill 的觸發說明寫清楚」；測試查詢選「照結果品質給分、不標 --used」

## 風險與首要驗證

**風險**: Low — 無明顯未知，依一般相依順序實作與驗證。只改文件；skill 隨下次發版、使用者跑 `memoria setup` 後才會更新到各 host。

## 實作與驗證步驟

1. ✅ **AC-1、AC-2：recall 段** — 先取得一份真實的 `recall --json` 輸出（隔離資料根），照它寫形狀說明；同步 `docs/CLI.md`、`docs/CLI.zh-TW.md`。
   - 完成證據：✅ 2026-11-26。真實輸出兩份：(a) 隔離資料根用本分支的 `./cli` 寫一則筆記後 `recall "pnpm lockfile" --project Demo --json`；(b) 維護者資料根用已安裝的 1.39.0 跑 `recall … --mode vector --project Memoria --json`（`route_mode: hybrid_vector`）。兩份的頂層鍵都是 `ok`、`data`、`meta`，`data` 是陣列；每筆命中有 `id`、`type`、`project`、`timestamp`、`snippet`、`score`、`session_id`；`meta` 有 `recall_id`、`route_mode`、`confidence`、`confidence_basis`。(b) 的 5 筆裡只有 1 筆沒有 `relevance`，同一查詢的人讀輸出正是這筆印 `[ n/a ]`；`relevance` 只在語意單獨命中時省略，對照 `src/core/memoria.ts:789` 與 `src/core/types.ts:278-281`。skill 的 recall 段、`docs/CLI.md` 與中文版的欄位名稱與位置照這兩份寫，`n/a` 的說法和 `src/cli/commands/recall.ts:71-76` 的註解一致（issue-35 之後行號從 57-63 移到這裡）。`node scripts/check-deployed-skill-sync.mjs` → `deployed_skill_check=ok`，`pnpm run release:docs-check` 通過。
2. ✅ **AC-3、AC-4：feedback 段與主機記憶** — 修改 `DEPLOYED_SKILL.md`。
   - 完成證據：✅ 2026-11-26。feedback 段在「沒有幫助時 `--score 0`」之後加一句：只是測試或看看、結果沒用在工作上的 recall，照命中品質給 `--score`，不標 `--used`；收尾判準「每個 `recall_id` 都回報一次」原樣保留。開頭在 Runtime／Data root 兩項之後寫明主機自己的記憶（例如 Claude auto-memory）是另一份內容不同的記憶，照下列時機 recall；recall 段寫明預期沒有結果、或主機記憶看似已涵蓋時照樣執行，沒有結果就回報 `--score 0`。CHANGELOG `[Unreleased]` 加 `### Changed`。
3. ✅ **AC-5：部署檢查** — 跑 AC-5 的三支腳本。不改變可觀察行為，記等價證據：三支腳本全綠的輸出。
   - 完成證據：✅ 2026-11-26。以 `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME`（地雷 M-4）跑三支腳本，全部 exit 0：`[bootstrap] ok`、`[setup-onboarding] ok`、`[npm-install] ok`，輸出沒有任何 ✗。`test-setup-onboarding.sh` Step 6 以 `cmp` 確認各 host 讀到的 `SKILL.md` 與本分支的範本相同，`test-bootstrap.sh` Step 3 確認部署後的 skill 仍含 setup 指引並能執行 `run-sync.sh`。處理 review-88b341c 的建議（TBD-2）後在同樣環境重跑，三支仍全部 exit 0、沒有 ✗；`check-deployed-skill-sync.mjs` 與 `release:docs-check` 也照樣通過。

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
|---|---|---|---|
| TBD-1 | review-88b341c S1：AC-3 要測試查詢不標 `--used`，但 CLI 的 `--used` 不影響寫入。`src/cli/commands/feedback.ts:41` 沒帶旗標時也當成 true，CLI 一定會送分數，而 `src/core/db/telemetry.ts:99-101` 只在沒有分數時才看 `used`；隔離資料根實測帶與不帶旗標寫入的資料相同。skill 原有的「`--score 0` without `--used`」也一樣 | 已解決（2026-11-27 使用者逐題確認：已由 issue-39 解決，v1.40.1 起 `--help`、文件與部署的 skill 寫明 `--used` 不影響寫入）。原記錄：不影響本次交付（2026-11-26 使用者對 review-88b341c 回「照建議」：另開 issue 決定 `--used` 的語意）。追蹤：[issue-39](../issue-39/README.md)。本 issue 的文字照核准的 AC-3 保留，AC-3 要的測試查詢回報一致已經達到，不會造成錯誤寫入 | AC-3 |
| TBD-2 | review-88b341c N1～N3：skill 的命中欄位沒提 `score`；「沒有 `relevance`」在 skill 寫了三次；`docs/CLI.md` 與中文版漏了 `session_id`，且「`score` 不在 0–1 範圍」不準 | 已解決（2026-11-26 使用者回「照建議」，選修正）：skill 補 `score` 只決定排序，`[ n/a ]` 併進命中欄位那一條；CLI 文件補 `session_id`，改成「不是 0–1 的比對品質」，其他欄位改用泛稱 | AC-1、AC-2 |
| TBD-3 | review-88b341c N4：README 的涉及檔案沒列 CHANGELOG.md | 已解決（2026-11-26 使用者回「照建議」，選不修；2026-11-26 對 review-438a19e 的建議回「好照建議」，改寫理由）：「涉及檔案」在送審後屬凍結內容，補列會讓 PASS 失效；CHANGELOG 是每個 issue 都會更新的檔案，不列也不影響範圍判斷 | 無 |

## Timeline

| 日期 | 異動 |
|------|------|
| 2026-11-25 | 建立並核准 AC-1～5（來源：9 個下游 session 的使用體驗調查） |
| 2026-11-26 | 步驟 1～3 完成：skill recall／feedback 段、開頭與 CLI 文件補齊，AC-5 三支腳本全綠 |
| 2026-11-26 | 獨立審查 review-88b341c：PASS，1 項 SHOULD FIX（需決策）、4 項 NICE TO HAVE |
| 2026-11-26 | 使用者對建議回「照建議」：S1 記入待確認（TBD-1），N1～N3 修正（TBD-2），N4 不修（TBD-3） |
| 2026-11-26 | 增量覆審 review-438a19e：PASS，1 項 NICE TO HAVE |
| 2026-11-26 | 使用者對 review-438a19e 的建議回「好照建議」：TBD-3 改寫理由；TBD-1 開好追蹤 issue-39，改為不影響本次交付 |
| 2026-11-27 | 待確認事項逐題確認：TBD-1 |

---
**建立日期**: 2026-11-25  
**分級**: Small  
**風險**: Low\
**狀態**: 已完成
