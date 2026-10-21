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
- `skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md` - 收尾步驟（視 TBD-2 決定是否改動）

## 驗收條件

> 待核准（TBD-1），以下為建議內容。

1. **AC-1**：`missing` 大於 0 時，`doctor` 的修法是可以直接複製執行的命令：路徑是實際安裝的絕對路徑，`--memoria-home` 填入目前的資料根，payload 寫進暫存目錄、不留在資料根。執行後再跑 `doctor`，`missing=0` — 檢查方式：用 stub provider 與隔離的 `MEMORIA_HOME`／`LIBSQL_URL` 製造 `missing>0`，取出 `doctor --json` 的 fix 字串，原樣交給 `bash -c` 執行，再跑 `doctor`，斷言 `missing=0`，且資料根底下沒有多出 export 檔
   - 失敗路徑：fix 命令執行失敗時以非 0 結束（ingest 失敗不可被吞掉）
2. **AC-2**：`missing` 為 0 或向量層未啟用時，doctor 的輸出不變 — 檢查方式：既有 `test-vector-recall.sh` 的 doctor 斷言照常通過

- **核准日期**: （待核准）
- **核准來源**: 使用者 2026-10-21 回覆「順手發現的也開 issue」，同意開立；驗收條件待核准

## 風險與首要驗證

**風險**: Low — 只改 doctor 的 fix 文字，不動 ingest 本身。要先驗證的是：組出的命令在全域安裝的形狀下、也就是 helper 旁邊沒有 `node_modules`、依賴在使用者快取時，真的能跑完。

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
|------|------|------|------|
| TBD-1 | AC-1、AC-2 需使用者核准 | 待確認 | 核准前不實作 |
| TBD-2 | 做法：(A) 只把 doctor 的 fix 改成可直接執行的完整命令（建議，介面不變）；(B) 新增一個 CLI 入口來補向量庫，例如 `setup --vector` 加旗標或新的子命令，skill 改呼叫它。B 比較好用，但會新增 CLI 介面，屬於 agent 契約的變更 | 待確認 | 決定範圍與是否改 DEPLOYED_SKILL.md |

## 實作與驗證步驟

1. ⬜ **AC-1、AC-2：doctor 的向量覆蓋率修法可直接執行** — 驗證方式：先在現行版本取得紅燈（fix 原樣執行失敗），修正後取得綠燈；`pnpm run check`、`build`；CI 全套

## Timeline

| 日期 | 事件 | 關聯 |
|------|------|------|
| 2026-10-21 | 建立；v1.31.0 發版收尾時，部署版 skill 沒有可用的補向量庫步驟而發現 | - |

---
**建立日期**: 2026-10-21  
**分級**: Small  
**風險**: Low  
**狀態**: 待核准
