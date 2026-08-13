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

有一個下游容器化部署（代稱 **downstream-cli-container**，**細節不入版控文件**）已經因為這兩個缺口而被迫把 CLI 連同資料卷塞進 agent 容器。它的結論是「必須是 CLI 而不是 sidecar」，理由收斂成單一項：**`brief` 沒有端點，而那是該 host workflow 每次開場要讀的東西**。

> **代稱區分（2026-08-13 補）**：已知有兩個下游容器化部署，整合形態相反，本文件先前用同一個代稱造成無法分辨。
>
> - **downstream-cli-container** — agent 打 CLI 指令，並把 `skills/memoria-vector` 打進自己的 image。**本節與第二階段講的都是這一個。**
> - **downstream-http-sidecar** — 已經是 sidecar + 純 HTTP client，只打 `/v1/recall`、`/v1/remember`、`/v1/recall/:id/outcome`，容器內不需要 `MEMORIA_HOME` 或 CLI。**它沒有本 issue 的問題**（見下方「誰會受益」）。

～～也就是說第一階段（只做 `/v1/brief`）就足以讓那邊收斂成 sidecar，`--server` 不是前提。～～

**⚠ 上面這句是錯的，已於 2026-08-13 第一階段發版後由該部署實接推翻。** 保留原文是因為它被寫進過 CHANGELOG 與交付通知，直接刪掉會讓讀到那些的人對不上。

推翻的理由見下節——它不是端點覆蓋率的問題，所以「補齊端點」永遠不會滿足它。

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

「主命令走 server」（`--server`）維持未動。

## 第二階段的真正理由（2026-08-13，第一階段發版後實接才浮現）

第一階段發版後，該下游實際接上去，回報**端點齊全並不足以讓他們收斂成 sidecar**。原因不在 API 覆蓋率——`recall` / `remember` / `feedback` / `brief` 現在都有端點——而在**agent 打的是 CLI 指令，不是 HTTP**。使用者的 `CLAUDE.md` 直接寫著要 agent 執行 `memoria recall "<查詢>"` 與 `memoria feedback <recall_id> --score`。

所以走 sidecar 的話，agent 容器裡仍然需要一個把 CLI 翻成 HTTP 的 shim，而**那個 shim 必須重寫輸出渲染**。`memoria recall` 預設印的是 `src/cli/commands/recall.ts:55-77` 那段：`🔎 Recall: N hits (Xms, mode=…)` 標頭、每筆的 `[score] type | project | timestamp | marks` 版面、`id:` 行、以及 agent 拿去餵 `feedback` 的 `- recall_id:` 尾行。HTTP 回的是原始 `MemoriaResult`，這些全都得在 shim 裡重做。

**這正是本 issue 第一階段為 `brief` 刻意避開的那件事**——「活在 Memoria repo 之外、可以自由漂移的第二實作」——只是換到 `recall` 身上，而 `recall` 是 agent 讀得最頻繁的一個。

兩條路：

| 方案 | 內容 | 評估 |
|---|---|---|
| A | 把「回傳渲染結果」延伸到 `recall`/`remember`/`feedback`（envelope 加 `data.rendered`） | 可行，但等於新增一個「給下游重組用的表示層」契約面，之後每個輸出格式變更都要同時維護兩處 |
| B | 做第二階段的 `--server` | 渲染所有權完全留在 Memoria，下游零重寫，CLI 輸出改版也不會在下游斷掉 |

**B 較優**，理由是 A 把渲染變成公開契約而 B 不用。

### ⚠ 但 B 的成本效益要先修正一項前提

下游預期 `--server` 之後「better-sqlite3 的 ABI 配對成本會消失」。**以目前的結構，不會。**

`src/cli.ts:5` 直接 `import { MemoriaCore } from './core/index.js'`，而 `core/db/connection.ts:1` 與 `core/db/schema.ts:1` 都在模組頂層 `import Database from 'better-sqlite3'`。原生模組在**任何** CLI 啟動時就被載入，與該次執行做什麼無關。加一個 `--server` 旗標不會改變這件事——agent 容器裝了 memoria 就仍然需要能載入的原生模組。

要拿到那個效益，`--server` 模式必須讓 db 層變成延遲載入（core barrel 不能急切拉進 `better-sqlite3`）。那是結構調整，不是加一個旗標。

### 三個目標要分開，因為實測顯示它們互不相關（2026-08-13 量測）

下游回報 image 佔用，本機獨立量測一致：

| 項目 | 大小 |
|---|---|
| `skills/memoria-vector/node_modules` 全樹 | **852M** |
| ├ `onnxruntime-node` | 513M |
| ├ `@huggingface/transformers` | 146M |
| ├ `onnxruntime-web`（Node 環境用不到的瀏覽器 WASM build） | 130M |
| `better-sqlite3` | **12M** |

先前雙方都猜「大頭是 transformers」，錯的——`onnxruntime-node` 一項就是它的三倍以上，而那是 transformers 的傳遞依賴。

| 目標 | 需要什麼 | 範圍 | 是下游要的嗎 |
|---|---|---|---|
| **渲染的所有權留在 Memoria** | 見下 | **待定** | **是——就這一件** |
| agent 容器不必掛資料卷 | 加 `--server` 旗標 | 小 | 附帶好處 |
| agent 容器不必配對原生 ABI | db 層延遲載入 | 中，動到 core 的 import 結構 | 否 |
| 縮小 image | 語意召回搬到 sidecar 那側 | 與其他項無關，不需延遲載入 | 否 |

**第一列才是需求，其餘三列是被誤認成需求的成本論證。** 下游最初提 `--server` 時附帶了「免 ABI 配對」與「縮小 image」兩個理由，兩者都已被實測推翻（見上表）；但那不削弱需求本身，因為需求跟原生模組、跟 image 大小都無關。

需求的內容是：agent 執行 `memoria recall "<查詢>"`，讀的是 **CLI 渲染過的文字**，並從 `- recall_id:` 尾行取值去餵 `feedback`。沒有辦法讓 CLI 改打 server 的話，容器內就得維護一份重現那個版面的 shim——一個活在本 repo 之外、可以自由漂移的表示層實作。這與第一階段為 `brief` 回傳 `data.markdown` 而非只回 `BriefData` 的理由**一字不差**。

**所以 `--server` 是形狀不是需求。** 任何能讓渲染留在 Memoria 的做法都成立，包括比旗標更小的（例如讓 `recall` 認得一個 endpoint 環境變數，CLI 仍是唯一的渲染者，只是資料來源改成 HTTP）。定範圍時應該從「渲染所有權」倒推形狀，而不是先選定 `--server` 再論證它。

### 誰會受益（2026-08-13 補，由第二個下游的回報界定）

**只有「agent 打 CLI 指令」的部署會受益。** downstream-http-sidecar 早就是 sidecar + 純 HTTP client——它的程式直接打 `/v1/*`，容器內既不需要 CLI 也不需要 `MEMORIA_HOME`——所以它從一開始就沒有本 issue 的問題，第二階段對它的價值是零。

這件事界定了受益面，也解釋了為什麼第一階段對兩者的意義完全不同：對純 HTTP 的部署，`GET /v1/brief` 就是**唯一**缺的東西，v1.27.0 之後它們什麼都不缺；對 CLI 驅動的部署，端點齊全反而不解決問題，因為它們讀的是渲染過的文字。

排優先序時要記得這是**一個**下游的需求，不是所有容器化部署的共通需求。

**「縮小 image」不該成為延遲載入的理由**——better-sqlite3 只有 12M，省不到什麼。延遲載入買到的是「免掉原生模組載入失敗這個模式」，那是可靠性不是空間。而 image 的 852M 幾乎全在向量 helper，那部分只要語意召回不在 agent 容器跑就消失了，跟 `--server` 的實作方式無關。

附帶觀察（**未行動，且本 repo 不應行動**）：`onnxruntime-web` 那 130M 是瀏覽器 WASM build，helper 在 Node 下跑 `onnxruntime-node`，理論上用不到。

但它在 `@huggingface/transformers` 的 **`dependencies`**（非 `optionalDependencies`），而且釘在一個 dev build（`1.26.0-dev.…`）。所以安裝期沒有任何旗標迴避得掉——唯一的做法是**裝完之後刪掉一個套件自己宣告的相依**。風險因此不是「可能少裝了什麼」，而是「transformers 哪天在 Node 下改走 web build，就會在執行期壞掉」。

**這件事本 repo 不做，下游可以做，而那不是膽量差別而是位置差別**：下游有一個會真的跑 `recall --mode vector` 並檢查 `route_mode` 不是 `vector_unavailable` 的 image 測試，所以哪天真的壞掉會在他們發版前紅燈；而我們發布的是一個套件，下游環境各異，同樣的刪除沒有等價的守門。要壓體積的話，正確的位置是使用者的 image，不是我們的 `files`。

其餘既有的待決事項不變：錯誤語意（本地失敗 vs 網路失敗）、`MemoriaResult.meta.latency_ms` 在 server 模式下代表什麼。
