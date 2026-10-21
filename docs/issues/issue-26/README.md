# Issue 26 - `test-bootstrap.sh` 在 `setup --vector` 本身失敗時不印出原因 (Small)

## 概述

`scripts/test-bootstrap.sh` 的 issue-25 段以 `VEC_OUT=$(… "$CLI" setup --vector --json)` 取得輸出。腳本開著 `set -e`，命令以非 0 結束時，指令替換的賦值讓整支腳本直接退出，不會執行到後面任何 `✗ …` 的訊息，`setup --vector` 自己印的失敗原因也被吞進變數裡。

2026-10-21 發 v1.31.0 時實際發生：本機 `/tmp` 的使用者配額用完，stub 的 `npm ci` 解壓時出現 errno -122，`setup --vector` 照設計以非 0 結束、不寫 `.complete`。但 `release.sh publish` 只轉印出 log 的最後幾行，最後一行停在 `[bootstrap] issue-25: setup --vector installs helper deps into the user cache`，看不出是哪一步、為什麼失敗，要另外用 `bash -x` 重跑才定位到這一行。

修法：這類「預期成功、取輸出」的呼叫在失敗時印出 `✗ <哪一步> exited <code>` 與命令的完整輸出，再以非 0 結束。

## 涉及檔案

- `scripts/test-bootstrap.sh` - issue-25 段以指令替換呼叫 CLI 的地方（目前 3 處，含 `VEC_OUT`、`VEC_OUT2`）

## 驗收條件

1. **AC-1**：`setup --vector` 在這些呼叫中以非 0 結束時，`test-bootstrap.sh` 以非 0 結束，輸出含一行 `✗`，指出是哪一個呼叫，並附上該命令的 stdout／stderr — 檢查方式：PATH 前置一個一律失敗的假 `npm`，執行時讓第一個 `setup --vector` 呼叫失敗，斷言結束碼非 0、輸出含 `✗` 與假 `npm` 印出的原因
   - 失敗路徑：本條即失敗路徑
2. **AC-2**：正常環境下測試結果不變 — 檢查方式：`bash scripts/test-bootstrap.sh` 以 `[bootstrap] ok` 結束；CI 全數通過

- **核准日期**: 2026-10-21
- **核准來源**: 使用者 2026-10-21 回覆「順手發現的也開 issue」同意開立；驗收條件與 TBD-2 由規劃提出建議，使用者 2026-10-21 回覆「好先清理再來照建議進行」核准

## 風險與首要驗證

**風險**: Low — 只改測試腳本的失敗訊息，不動產品程式。要防的是改法讓原本會失敗的情況變成通過，所以 AC-1 要先在現行腳本上取得「靜默退出」的紅燈。

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
|------|------|------|------|
| TBD-1 | AC-1、AC-2 需使用者核准 | 已解決 | 2026-10-21 使用者回覆「照建議」，全部核准 |
| TBD-2 | 其他測試腳本有沒有相同的寫法要一起改。建議只改 `test-bootstrap.sh` 的 issue-25 段，其餘另行盤點 | 已解決 | 2026-10-21「照建議」：只改 issue-25 段 |

## 實作與驗證步驟

1. ⬜ **AC-1、AC-2：失敗時印出原因** — 驗證方式：先在現行腳本取得紅燈（靜默退出，輸出沒有 `✗`），修正後取得綠燈；`bash -n scripts/test-bootstrap.sh`；CI 全套

## Timeline

| 日期 | 事件 | 關聯 |
|------|------|------|
| 2026-10-21 | 建立；v1.31.0 第一次 `release:publish` 因本機 `/tmp` 配額失敗時發現 | - |
| 2026-10-21 | AC-1、AC-2 與 TBD-2 核准（「照建議」） | - |

---
**建立日期**: 2026-10-21  
**分級**: Small  
**風險**: Low  
**狀態**: 進行中
