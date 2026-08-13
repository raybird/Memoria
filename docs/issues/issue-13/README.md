# Issue 13: HTTP 介面缺 `/v1/brief`，且主命令無法改走 server——sidecar 部署形態不成立

## 基本資訊

| 項目 | 內容 |
|---|---|
| Issue 編號 | 13（本地文件編號） |
| 複雜度級別 | Medium（`/v1/brief` 本身是 Small；「主命令走 server」動到每個命令的執行模型，需要先定範圍） |
| 風險等級 | Medium（會新增公開 HTTP 契約，一旦發布就要維持） |
| 狀態 | **未實作**（待定範圍） |
| 需求來源 | 2026-08-13 另一 session 分析 Memoria 升級機制時發現，經本 session 查證 |
| 建立日期 | 2026-08-13 |
| 相關 | [issue-4](../issue-4/README.md)（brief 與 CLI 記憶命令的來源）；`src/server.ts`、`src/adapter/adapter.ts` |

## 摘要

容器化部署想把 Memoria 當 sidecar（memoria 容器持有 SQLite，agent 容器只透過 HTTP 存取）目前不可行，有兩個缺口：

1. **`/v1/brief` 不存在。** `brief` 是記憶注入面的核心產物，只能靠 CLI 產生。
2. **主命令沒有走 server 的模式。** `recall` / `remember` / `feedback` / `brief` 一律直接開本地 SQLite（`src/` 內查無任何 `--server` 旗標），所以 agent 容器必須自己帶 CLI 與資料卷——sidecar 就失去意義了。

## 更正交接時的一項描述

交接訊息寫「HTTP 缺 `/v1/brief` 與 `/v1/feedback`」。查證後 **feedback 在 HTTP 上是有的**：

- `src/server.ts:343-352` — `POST /v1/recall/:id/outcome`（正規表達式路由 `/^\/v1\/recall\/([^/]+)\/outcome$/`）
- CLAUDE.md 也已載明 `memoria feedback` 是這個端點的 CLI 對應

缺的只有 `brief`。命名不一致（CLI 叫 `feedback`、HTTP 叫 `outcome`）確實會讓人以為端點不存在，但那是文件與命名的問題，不是功能缺口。

## 現況盤點

`src/server.ts` 既有路由（節錄自檔頭 :6-24）：`/v1/health`、`/v1/stats`、`/v1/telemetry/recall`、`/v1/remember`、`/v1/recall`、`/v1/recall/:id/outcome`、`/v1/sources`、`/v1/wiki/*`、`/v1/sessions/:id/summary`、`/v1/repos/*`。**無 `/v1/brief`**。

adapter 這一側本來就是 HTTP client：`src/adapter/adapter.ts:19-20` 的 config 收 `MemoriaClient` 或 base URL 字串。所以「agent 透過 HTTP 用 Memoria」的路已經鋪好一半，斷在主命令這一段。

## 需要先定的範圍

`/v1/brief` 是直接的一段：`queryBrief` + `renderBrief` 都已是純函式，包一層 handler 即可。要決定的是**回傳什麼**——`BriefData`（JSON，讓呼叫端自己渲染）、markdown 字串，或兩者由 `Accept` 決定。另外要決定是否寫檔：CLI 的 `brief` 會覆寫 `<knowledge>/BRIEF.md`，而 HTTP 端寫本地檔案在 sidecar 情境下語意可疑（那是 memoria 容器的檔案系統，不是 agent 容器的）。傾向純回傳、不寫檔。

「主命令走 server」則是更大的決定：要不要讓每個命令都能切換執行模型？影響 `MemoriaCore` 的呼叫路徑、錯誤語意（本地失敗 vs 網路失敗）、以及 `MemoriaResult` envelope 的 `latency_ms` 意義。建議拆成兩階段，先做 `/v1/brief`，`--server` 另議。

## 驗收標準（第一階段）

- [ ] `GET /v1/brief`（或 `POST`，視參數形式而定）支援 `project` / `days` / `top_k`
- [ ] 回傳維持 `MemoriaResult<T>` envelope（`evidence[]` / `confidence` / `latency_ms`）
- [ ] 不寫入 `<knowledge>/BRIEF.md`
- [ ] `scripts/test-http-api.sh` 加上契約斷言
- [ ] AGENTS.md 的端點清單與 `src/server.ts` 檔頭註解同步更新
