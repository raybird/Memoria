# Issue 36 - 部署的 skill 沒寫 recall 輸出的形狀、n/a 的意思與測試查詢的回報方式 (Small)

## 概述

2026-11-25 對 9 個下游 session 做使用體驗調查，有 5 份回報第一次解析 `recall --json` 就失敗：把 `data` 當成物件讀，但它其實是陣列，`recall_id`、`confidence`、`route_mode` 都在 `meta` 裡。部署的 skill（`skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md:47`）只寫了「Keep the `recall_id` from the output」，沒有說它在哪裡。

另外三件事也沒寫：

- **`[ n/a ]` 的意思。** 人讀輸出裡，只靠語意索引找到的命中會顯示 `[ n/a ]`（`src/cli/commands/recall.ts:63`，issue-9 的設計），但 skill 與 `docs/CLI.md` 都沒解釋，讀者看不出原因。
- **測試查詢的 feedback。** 只是測試、結果沒拿去用的 recall 要不要標 `--used`，三個 session 各做各的。
- **主機自己的記憶不能取代 recall。** 同一個專案還有 Claude auto-memory 這類主機記憶時，有 3 個 session 只讀了主機記憶就沒 recall，其中一個根據主機記憶的一句話判斷「recall 不會有結果」而跳過。

本 issue 只改文件，不改程式行為。

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

1. 📝 **AC-1、AC-2：recall 段** — 先取得一份真實的 `recall --json` 輸出（隔離資料根），照它寫形狀說明；同步 `docs/CLI.md`、`docs/CLI.zh-TW.md`。
   - 完成證據：
2. 📝 **AC-3、AC-4：feedback 段與主機記憶** — 修改 `DEPLOYED_SKILL.md`。
   - 完成證據：
3. 📝 **AC-5：部署檢查** — 跑 AC-5 的三支腳本。不改變可觀察行為，記等價證據：三支腳本全綠的輸出。
   - 完成證據：

## Timeline

| 日期 | 異動 |
|------|------|
| 2026-11-25 | 建立並核准 AC-1～5（來源：9 個下游 session 的使用體驗調查） |

---
**建立日期**: 2026-11-25  
**分級**: Small  
**風險**: Low\
**狀態**: 待實作
