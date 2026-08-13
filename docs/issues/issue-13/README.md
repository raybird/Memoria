# Issue 13: HTTP 介面缺 `/v1/brief`，且主命令無法改走 server——sidecar 部署形態不成立

## 基本資訊

| 項目 | 內容 |
|---|---|
| Issue 編號 | 13（本地文件編號） |
| 複雜度級別 | Medium（`/v1/brief` 本身是 Small；「主命令走 server」動到每個命令的執行模型，需要先定範圍） |
| 風險等級 | Medium（會新增公開 HTTP 契約，一旦發布就要維持） |
| 狀態 | **第一階段實作完成**（2026-08-13，`GET /v1/brief`）；`--server` 仍未實作、另議 |
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

## 下游消費者（2026-08-13 補）

有一個下游容器化部署（代稱 downstream-container，**細節不入版控文件**）已經因為這兩個缺口而被迫把 CLI 連同資料卷塞進 agent 容器。它的結論是「必須是 CLI 而不是 sidecar」，理由收斂成單一項：**`brief` 沒有端點，而那是該 host workflow 每次開場要讀的東西**。

也就是說第一階段（只做 `/v1/brief`）就足以讓那邊收斂成 sidecar，`--server` 不是前提。交付時需知會該部署。

## 需要先定的範圍

`/v1/brief` 是直接的一段：`queryBrief` + `renderBrief` 都已是純函式，包一層 handler 即可。要決定的是**回傳什麼**——`BriefData`（JSON，讓呼叫端自己渲染）、markdown 字串，或兩者由 `Accept` 決定。另外要決定是否寫檔：CLI 的 `brief` 會覆寫 `<knowledge>/BRIEF.md`，而 HTTP 端寫本地檔案在 sidecar 情境下語意可疑（那是 memoria 容器的檔案系統，不是 agent 容器的）。傾向純回傳、不寫檔。

「主命令走 server」則是更大的決定：要不要讓每個命令都能切換執行模型？影響 `MemoriaCore` 的呼叫路徑、錯誤語意（本地失敗 vs 網路失敗）、以及 `MemoriaResult` envelope 的 `latency_ms` 意義。建議拆成兩階段，先做 `/v1/brief`，`--server` 另議。

## 驗收標準（第一階段）

- [x] `GET /v1/brief` 支援 `project` / `days` / `top_k`
- [x] 回傳維持 `MemoriaResult<T>` envelope（`meta.evidence[]` / `meta.confidence` / `meta.latency_ms`）
- [x] 不寫入 `<knowledge>/BRIEF.md`
- [x] `scripts/test-http-api.sh` 加上契約斷言
- [x] AGENTS.md / README.md 的端點清單與 `src/server.ts` 檔頭註解同步更新

## 實作結果（2026-08-13，第一階段）

**回傳形式定案：`BriefData` 與渲染好的 markdown 一起給，不做 `Accept` 協商。**

原本列的三個選項裡，只回 JSON 是最糟的——需要這個端點的消費者要的就是 markdown（那是開場要注入的東西），只給結構化資料等於逼每個呼叫端自己重寫一份 `renderBrief`。那會是一份活在本 repo 之外、可以自由漂移的第二個渲染器，也就是 [issue-10](../issue-10/README.md) 與 `bump-version.mjs` 那次的同一種失效。`Accept` 協商則會讓 envelope 依請求頭改變形狀，多一條路徑卻沒有多解決什麼。

**不寫檔定案。** CLI 的 `brief` 會覆寫 `<knowledge>/BRIEF.md`，HTTP 端刻意不做：在這個端點存在的理由（sidecar 部署）裡，那個路徑是 **server 容器**的檔案系統，不是發問的 agent 的——寫下去會產生一個沒人讀的檔案。測試直接斷言檔案不存在。

用 `GET` 而非 `POST`：這是唯讀操作，與 `/v1/stats`、`/v1/telemetry/recall` 一致，參數走 query string。`days` / `top_k` 非正數或非數字回 400（`queryBrief` 自己會把非正數退回預設值，但那樣呼叫端拿到的是靜默的錯誤設定，不如明說）。

順手修掉 `server.ts` 檔頭「Routes (12 endpoints)」——那個數字早就漂移，底下實際列了 19 條。改成不寫數字，清單本身就是清冊。

### 實作中修正的兩個測試錯誤

兩個都值得記，因為它們都是「斷言通過不代表功能正確」的反面：

1. 內容斷言原本用預設 30 天窗口去找 fixture 種下的決策，但那筆日期在窗外——**測的是窗口不是端點**。改用足夠寬的 `days` 才真的驗到內容。
2. envelope 斷言原本寫 `d.latency_ms`，實際在 `d.meta.latency_ms`。錯的斷言會恆真或恆假，這次是恆假所以立刻現形。

### 尚未實作

「主命令走 server」（`--server`）維持未動。下游確認過第一階段就足以讓他們從 CLI-in-container 收斂成 sidecar，所以那不是前提。
