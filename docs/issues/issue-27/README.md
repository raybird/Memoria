# Issue 27 - `doctor` 的向量覆蓋率修法不能照著執行 (Small)

## 概述

部署版 memoria skill（`setup --agent` 產生）的收尾步驟要求：`doctor` 的 `vector coverage` 顯示 `missing` 大於 0 時，執行它印出的修法。那段修法（`src/cli/commands/doctor.ts` 的 vector coverage 檢查）寫的是：

```
node skills/memoria-memory-sync/scripts/build-mcp-bridge-payload.mjs --memoria-home <home>
node skills/memoria-vector/vector-ingest.mjs <payload.json>
```

照著做會卡住：

- `skills/…` 是相對於套件根目錄的路徑，但全域安裝的套件在 `$(npm root -g)/@raybird.chen/memoria/` 底下，agent 的工作目錄不在那裡。
- `<home>` 與 `<payload.json>` 是佔位符。第一步沒有帶 `--out` 時，會寫進 `<home>/.memory/exports/mcp-bridge/mcp-bridge-<session id>-<時間戳>.json`，檔名事先不知道，而且每跑一次就在資料根多留一個檔案。

所以維護者本機一直在用另外手寫的 `ingest-vectors.sh`。改成部署版 skill 後，2026-10-21 收尾時又得回頭用備份裡的那支。部署給其他人的 skill 沒有這支腳本，只能靠 doctor 的修法。

## 涉及檔案

- `src/cli/commands/doctor.ts` - vector coverage 的 fix 文字
- `scripts/test-vector-recall.sh` - doctor 輸出的斷言
- `docs/OPERATIONS.md` - doctor 檢查表
- `src/cli/runtime.ts` - `quoteShellArg` 改為 export，讓 doctor 共用同一個 shell 引號規則
- `skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md` - 不改：TBD-2 採 (A)，收尾步驟本來就寫「執行 doctor 印出的修法」

## 驗收條件

1. **AC-1**：`missing` 大於 0 時，`doctor` 的修法是可以直接複製執行的命令：路徑是實際安裝的絕對路徑，`--memoria-home` 填入目前的資料根，payload 寫進暫存目錄、不留在資料根。執行後再跑 `doctor`，`missing=0` — 檢查方式：用 stub provider 與隔離的 `MEMORIA_HOME`／`LIBSQL_URL` 製造 `missing>0`，取出 `doctor --json` 的 fix 字串，原樣交給 `bash -c` 執行，再跑 `doctor`，斷言 `missing=0`，且資料根底下沒有多出 export 檔
   - 失敗路徑：fix 命令執行失敗時以非 0 結束（ingest 失敗不可被吞掉）
2. **AC-2**：`missing` 為 0 或向量層未啟用時，doctor 的輸出不變 — 檢查方式：既有 `test-vector-recall.sh` 的 doctor 斷言照常通過

- **核准日期**: 2026-10-21
- **核准來源**: 使用者 2026-10-21 回覆「順手發現的也開 issue」同意開立；驗收條件與 TBD-2 由規劃提出建議，使用者 2026-10-21 回覆「好先清理再來照建議進行」核准

## 風險與首要驗證

**風險**: Low — 只改 doctor 的 fix 文字，不動 ingest 本身。要先驗證的是：組出的命令在全域安裝的形狀下、也就是 helper 旁邊沒有 `node_modules`、依賴在使用者快取時，真的能跑完。

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
|------|------|------|------|
| TBD-1 | AC-1、AC-2 需使用者核准 | 已解決 | 2026-10-21 使用者回覆「照建議」，全部核准 |
| TBD-2 | 做法：(A) 只把 doctor 的 fix 改成可直接執行的完整命令（建議，介面不變）；(B) 新增一個 CLI 入口來補向量庫，例如 `setup --vector` 加旗標或新的子命令，skill 改呼叫它。B 比較好用，但會新增 CLI 介面，屬於 agent 契約的變更 | 已解決 | 2026-10-21「照建議」採 (A)：只改 doctor 的 fix 文字，不新增 CLI 介面 |

## 實作與驗證步驟

1. ✅ **AC-1、AC-2：doctor 的向量覆蓋率修法可直接執行** — 驗證方式：先在現行版本取得紅燈（fix 原樣執行失敗），修正後取得綠燈；`pnpm run check`、`build`；CI 全套
   - 完成證據（2026-10-21）：
     - 做法：`missing>0` 時，fix 在原本的說明後面接 `Run: <命令>`，由 `ingestFix(helperPath, memoriaHome)` 組出：
       - `D=$(mktemp -d) && node '<skills>/memoria-memory-sync/scripts/build-mcp-bridge-payload.mjs' --memoria-home '<資料根>' --out "$D" >/dev/null && node '<skills>/memoria-vector/vector-ingest.mjs' "$D"/*.json; S=$?; rm -rf "$D"; (exit $S)`
       - `<skills>` 取自 recall 實際解析到的 helper 路徑（`report.helperPath` 往上兩層），不另外推導；路徑一律經 `quoteShellArg` 加引號。
       - payload 寫進暫存目錄，結束碼是 ingest 的結束碼，不會被後面的清理蓋掉。
       - helper 解析不到時沒有路徑可以組，維持一句說明，不印 `Run:`。
     - 測試（`scripts/test-vector-recall.sh` 的 issue-27 段）：從 `doctor --json` 取出 `Run: ` 之後的命令，在 repo 以外的工作目錄原樣交給 `bash -c`，再跑 doctor，斷言 `missing=0`，且資料根裡 export 檔的數量不變；失敗路徑讓 `LIBSQL_URL` 指向不存在的目錄，斷言整串命令以非 0 結束。
     - 紅燈（修正前）：`Error: missing>0 時 fix 必須以 Run: <命令> 結尾`，原本的 fix 只有兩段帶 `<home>`、`<payload.json>` 佔位符的說明。
     - 綠燈：`修法原樣執行後 missing=0，資料根沒有多出檔案`、`ingest 失敗時修法以非 0 結束（rc=1）`、`[vector] ok`。
     - 全域安裝形狀（首要風險）：用全域的 1.31.0 套件，helper 旁邊沒有 `node_modules`，依賴在使用者快取。以隔離的資料根與向量庫、從 `/` 執行同樣形式的命令：`{"ok":true,"embedded":6,"skipped":4}`、rc=0，doctor 顯示 `embedded=6 expected=6 missing=0`，資料根沒有 export 檔。
     - 變異檢查：
       - 拿掉 `S=$?; … (exit $S)`：`✗ ingest 失敗時修法仍以 0 結束`。
       - 拿掉 `--out "$D"`：`✗ doctor 的修法執行失敗`。payload 落到預設位置，`"$D"/*.json` 找不到檔案，ingest 先失敗；這個變異擋下來的是命令本身，不是殘留檔案的斷言。
       - 拿掉 `--out` 並改從資料根讀 payload，讓 ingest 成功：`✗ 修法在資料根留下 payload 檔（0 -> 1）`，殘留檔案的斷言有在把關。
     - AC-2：`missing=0`、未啟用、override 三種情況的既有斷言照常通過。
     - 常青文件：`docs/OPERATIONS.md` 的驗證段改指 doctor 的 coverage 與可執行的修法。順手更正原本的 `SELECT COUNT(*) FROM memoria_vectors`：少了 `NOT INDEXED` 會在填滿的向量庫上回 0。
     - GitNexus：`vectorChecks` 的 impact 為 LOW，只有 `registerDoctorCommand` 呼叫；`quoteShellArg` 只是改為 export，行為不變。
     - 精煉：code-simplify no-op。
     - 限制：payload 產生器依 `memory_sync_state` 的游標只取游標之後更新的節點。有人跑過 `update-mcp-sync-state.mjs` 而向量庫又缺了更早的資料時，照修法執行後 `missing` 仍可能大於 0。這是產生器本來的行為，本 issue 不改；本機與測試環境都沒有這個游標。

## Timeline

| 日期 | 事件 | 關聯 |
|------|------|------|
| 2026-10-21 | 建立；v1.31.0 發版收尾時，部署版 skill 沒有可用的補向量庫步驟而發現 | - |
| 2026-10-21 | AC-1、AC-2 核准，TBD-2 採 (A)（「照建議」） | - |

---
**建立日期**: 2026-10-21  
**分級**: Small  
**風險**: Low  
**狀態**: 進行中
