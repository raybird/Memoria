# Handover — 工程改進交辦清單

- 建立：2026-07-06
- 用途：交辦給下一個 agent 的**可執行改進清單**，按性價比排序。每項含證據（檔案:行號）、方向、驗收條件，讀完即可獨立執行，不必回溯對話。
- 來源：2026-07-06 全 repo 體檢（文件缺口盤點 + 程式碼/CI 掃描），已與 `docs/HANDOVER.md`、`docs/memory-mechanism-assessment.md`、兩份 RFC 交叉比對。
- 關係：本文件是**工程債/打磨向**清單；「記憶智能」主線（效用回饋迴路 → 語意召回）仍以 `docs/HANDOVER.md` §4–§5 為準，兩者互補不衝突。

---

## 執行進度（2026-07-06 更新）

**P1–P5 已完成並各自 commit**（Phase A+B，全數通過完整 CI parity）：

| 項 | commit | 摘要 |
|----|--------|------|
| P1 | `1041935` | server.ts 註解 + serve.ts 輸出補齊至完整 11 端點 |
| P2a | `666f286` | HTTP body 上限 `MAX_BODY_BYTES`（預設 1 MiB）→ 413；OPERATIONS 補曝露說明 |
| P2b | `d10e7db` | 版本號改由 package.json 經 esbuild define 注入；bump 失敗改 exit 1 |
| P3 | `bec8f11` | 新增 `test-prune.sh` 覆蓋 consolidate/stale/dedupe 刪除路徑並掛進 CI |
| P4 | `76e76e5` | 抽 `withResult` 統一 envelope；memoria.ts 795→500 行；重構前後輸出逐欄位比對一致 |
| P5 | `f1e4400` | 抽 `utils.tokenizeQuery` 統一三處；CJK 範圍差異常數化+註記（行為不變） |
| P7 | `894ca65` | CI 拆平行 job（static/test 矩陣/node18/release）+ Node 18 smoke + docs-check 進 CI |
| P8 | `676274a` | 連線收斂到 `withDb`（支援 RW/RO options），消除 20+ 處直接 `new Database` |
| P6 | `dfea241` | UFL Phase 0 shadow spike：reuse 訊號 Gate 通過（非退化、有鑑別力）；固化 `test-utility-shadow.sh`；未動 recall()/schema |
| P9 | `0ae0264` | recall.ts 抽 buildSnippet/buildScopeClause、統一 keyword 重複 SQL；未動 recall()，輸出 byte-identical |
| P10 | (本次) | install.sh 加 SHA256 checksum 驗證 + `--version` 格式檢查；打包產 `.sha256`、release 上傳；backward-compat（無 sidecar 則警告續行） |

**P1–P10 全數完成。** 記憶智能主線 **UFL Phase 0 + Phase 1 MVP 亦已完成並 ship**（見 `docs/RFC-utility-feedback.md`）：`recall()` 加 `recall_id`、Migration 6、`recordRecallOutcome` + `POST /v1/recall/:id/outcome`、SDK、adapter 預設回報。**下一步 = UFL Phase 2 校準呈現**（confidence×utility 分桶，不自動改 confidence）。P5 的 CJK 範圍對齊方向仍為待決。

**P8 補充**：`withDb` 現以 `<mode>:<dbPath>` 為 pool key，readonly 與 read-write handle 分開池化（readonly caller 保留 SQLite 寫入保護）。唯一保留直接 `new Database` 的是 `schema.ts` 的 `initDatabase`（DDL/migration bootstrap，刻意不動）。踩到的坑：better-sqlite3 不接受 `fileMustExist: undefined`，需強制 boolean。

---

## 0. TL;DR（30 秒版）

- Repo 體質好：TS strict 無 `any`、無 TODO 殘留、邊界都有 Zod、README 命令清單與實作一致。改進重點是**樣板債、破壞性路徑測試缺口、CI 效率**，不是大翻修。
- **建議先做 P1–P3**（路由清單漂移、安全防呆、prune 刪除測試）：一個下午可完成、全低風險。
- P4 是最划算的重構（`MemoriaResult` helper）；P5（tokenize 統一）附一個 CJK 範圍對齊的待決；P6（UFL Phase 0）是戰略主線，與 `docs/HANDOVER.md` §5 同一件事。
- **不要碰**：語意召回（`blocked`，卡維護者決策）、矛盾偵測 / importance-weighted retention（只有想法層級）。

### ⚠️ 兩條鐵律（每次都要守）

1. **commit 訊息絕不含 `Co-Authored-By` 或任何 AI 署名**，只寫功能描述，不加尾行。
2. **回應一律繁體中文（台灣用語）**；文件內若需日期，用具體系統日期。

---

## 1. 執行方式

- 每項維持專案一貫節奏：**單一小單元 → 驗證 → commit**；獨立項目各自成 commit，不要混包。
- 動任何 symbol 前先 `gitnexus_impact({target, direction:'upstream'})`；commit 前 `gitnexus_detect_changes()`。
- DoD 通則：`pnpm run check` → `pnpm run build` + `node dist/cli.mjs --help` → 相關 `scripts/test-*.sh` → 觸及的 shell 過 `bash -n`。
- 行號為 2026-07-06（v1.17.0 後、main @ 0779499）快照，執行時以符號名重新定位。

---

## 2. 交辦項目（按性價比排序）

### P1 · 修正路由清單漂移（成本：極低｜風險：零）

**問題**：兩處給使用者看的路由清單只列 6 條，實際有 11 條端點。

| # | 證據 | 現況 | 修法 |
|---|------|------|------|
| a | `src/server.ts:5-11` 檔頭 Routes 註解 | 只列 6 條路由（health/stats/telemetry/remember/recall/sessions summary） | 實際 11 條端點，補齊漏列的 `POST /v1/sources`、`GET /v1/sources`、`POST /v1/wiki/build`、`POST /v1/wiki/file-query`、`POST /v1/wiki/lint` |
| b | `src/cli/commands/serve.ts:18-24` 啟動印出的路由清單 | 只印同上 6 條 | 補齊；考慮從單一路由表產生註解 + 啟動輸出，避免再漂移 |

**驗收**：`serve` 啟動輸出與 server.ts 註解都列出全部 11 端點；與 `server.ts` 實際 handler 逐一對得上。

> **附帶觀察（非漂移，優先度低，可略）**：四個 adapter 的整合管道不對稱——`memoria adapter <name>` CLI hook 子命令只註冊了 claude-code / codex / antigravity 三個（`src/cli/commands/adapter.ts:89-109`），**OpenCode 沒有對應子命令**；OpenCode 改由 SDK（`OpenCodeAdapter` class，見 `README.md:176-178`）+ MCP config（`resources/mcp/opencode.mcp.json`）整合。這**不是 bug、也不是文件錯誤**（README 從未宣稱有 `memoria adapter opencode`，SDK/MCP 兩條路徑都真實存在），只是四者整合方式不一致而 README 未點明。若日後要收斂體驗，可補一句說明各 adapter 的接入方式差異，或替 OpenCode 也加 CLI hook 子命令——但不急。

---

### P2 · 兩個安全／防呆修補（成本：低｜風險：低）

**a. HTTP body 無大小上限（memory-exhaustion DoS）**
- 證據：`src/server.ts:85-92` 的 `readBody` 無限累積 chunks。
- 方向：加 `MAX_BODY_BYTES`（例如 1 MiB，可用 env 覆寫），超過即中斷並回 `413`。
- 順帶：在 README/OPERATIONS 警示 server 無認證，建議只綁 localhost 或置於反向代理後。
- 驗收：`test-http-api.sh` 加一個超大 body 案例，預期 413；既有案例不變。

**b. CLI 版本號硬編碼**
- 證據：`src/cli.ts:28` 寫死 `.version('1.17.0')`；`scripts/bump-version.mjs:43-48` 用非 global 字串替換同步，失敗只印 `⚠ no change` 不報錯（`bump-version.mjs:34`）→ 版本可能部分更新。
- 方向：build 時由 esbuild `define` 從 `package.json` 注入版本（`scripts/build.mjs`），移除 `cli.ts` 的硬編碼；`bump-version.mjs` 替換失敗改為非零退出。
- 驗收：`node dist/cli.mjs --version` 輸出與 `package.json` 一致；故意弄壞格式跑 bump 會報錯而非靜默。

---

### P3 · 補 prune 實際刪除路徑測試（成本：中低｜風險：防最貴的事故）

- 問題：`src/core/db/prune-export.ts:49-224` 的 `pruneConsolidate` / `pruneStaleMemory` / `pruneSkillsDuplicates` 是全 repo 唯一破壞性 DELETE 區塊，但現有 e2e 幾乎只走 dry-run 分支（`test-smoke.sh` 僅基本呼叫）。錯刪記憶是這類系統最不可逆的失敗。
- 方向：新增 `scripts/test-prune.sh` 並掛進 CI（`.github/workflows/ci.yml`，順序照既有慣例）：
  1. 灌入橫跨 90/180 天門檻兩側的資料（可用 SQL 直接改 timestamp，參考 `test-migrations.sh` 造資料手法）。
  2. 分別驗證 consolidate、stale、`--all`、自訂 `--consolidate-days`/`--stale-days`。
  3. 斷言「該刪的刪了、不該刪的一筆不少」（前後 COUNT 精確比對），dry-run 與實刪結果一致性也驗。
- 注意：**不要改 prune 預設值**（90/180 是契約，見 CLAUDE.md）。
- 驗收：新腳本本機綠 + CI 綠；故意把刪除條件弄反能讓測試紅（驗證測試有牙齒）。

---

### P4 · 抽 `MemoriaResult` 包裝 helper（成本：中低｜收益：消數百行重複）

- 問題：`src/core/memoria.ts`（795 行）每個 public method 手寫相同的 success/catch/latency 樣板——`latency_ms: Date.now() - start` ×32、`ok: false` catch 區塊 ×17、`confidence: 0` meta ×19；另 `if (!existsSync(dbPath)) … initDatabase(…)` 前置重複 6 處（:143、:319、:484、:599、:645、:690）。改 meta 結構要同步改 12 處。
- 方向：抽 `withResult(source, fn)` 高階函式統一組裝 envelope（latency/confidence/timestamp/catch），另抽 `ensureDb()` 前置。**envelope 欄位與現有輸出 byte-level 相容**——這是對外契約（`MemoriaResult<T>`），只消重複、不改形狀。
- 前置：`gitnexus_impact` 對 `MemoriaCore` 各方法跑 upstream，逐一確認 blast radius。
- 驗收：`pnpm run check` 過；`test-smoke.sh` + `test-http-api.sh` 綠（HTTP 契約測試就是 envelope 的守門員）；`memoria.ts` 行數明顯下降。

---

### P5 · 統一 tokenize／CJK 範圍不一致（成本：低｜窄影響，附一個待決）

- 問題一（重複，明確該修）：tokenize split regex 三份近乎相同——`src/core/db/recall.ts:14`、`recall.ts:381`、`src/core/db/telemetry.ts:10`（皆 `split(/[^a-z0-9一-鿿]+/)`）。抽到 `src/core/utils.ts` 單一 `tokenizeQuery()` + `CJK_RANGE` 常數，三處引用。
- 問題二（範圍不一致，影響窄）：adaptive gate 的 `CJK_CHAR = /[぀-ヿ㐀-鿿가-힣]/`（含假名、韓文；`src/core/memoria.ts:760`，用於 `weightedQueryLength` → `shouldSkipAdaptiveRecall`）比 tokenize 的 `一-鿿`（僅漢字）範圍寬。
  - **實際影響有限**：對主要受眾的**中文（漢字）查詢兩邊都涵蓋，無 regression**。只有**純假名/純韓文**查詢會出現「gate 放行、tokenize 抓不到詞」，且失敗模式是 **graceful zero-hits（查無命中），非 crash**——與一般 no-match 無異。
  - **⚠️ 修法方向是個待決，不是顯而易見**：往上對齊（tokenize 也含假名/韓文）會讓 keyword 路徑開始索引/匹配這些語系；往下對齊（gate 只加權漢字）＝「不對 keyword 路徑處理不了的語系承諾召回」。**先與維護者確認取向再動**；若無明確需求，最小修法是先只做問題一的抽取、把兩個範圍常數化並在註解標明差異與待決，不改行為。
- 驗收：`grep` 全 src 只剩一份 tokenize regex；若決定對齊範圍，補一個 CJK 查詢小案例背書；若只做常數化，確認 `test-smoke.sh` 行為不變。

---

### P6 · 效用回饋迴路 Phase 0 spike（成本：中｜戰略價值最高）

- **這就是 `docs/HANDOVER.md` §5 指定的下一步**，細節照 `docs/RFC-utility-feedback.md` §10 執行，此處不重複展開。
- 一句話：adapter 加 `MEMORIA_UTILITY_SHADOW` 影子開關，用既有 `tokenCoverage` 量「注入的記憶下一回合是否被字面沿用」，JSONL 落地看分佈；**不動 schema、不動 `recall()`、不 ship**。
- 為什麼排這裡：它不 blocked、不需 embedding，且是語意召回 RFC 的驗收標尺——所有「記憶智能」類改進都排在它後面。

---

### P7 · CI 提速與補洞（成本：中｜每次 push 都回本）

- 問題：
  - `.github/workflows/ci.yml:9-98` 單一 job 串行 19 步（含 14 個 e2e 腳本），wall time = 總和。
  - `release:package`（`scripts/package-release-artifacts.sh:49`）內又跑一次 `pnpm install --prod`，install 執行兩次。
  - `engines.node >=18`（`package.json`）+ esbuild target `node18`，但 CI 只測 Node 22——最低支援版本從未被驗證。
  - `release.yml:54-58` 只跑 3 個測試，發布路徑覆蓋反而窄。
- 方向：
  1. e2e 腳本按獨立性分 2–3 個平行 job（build 產物用 artifact 傳遞）。
  2. 快取 pnpm store（`actions/setup-node` 的 pnpm cache 或 `actions/cache`）。
  3. 加一個 Node 18 的 smoke job（只跑 `test-smoke.sh` 即可）。
- 注意：**測試順序在單一 job 內仍照 CI 現有順序**（CLAUDE.md 慣例）；拆 job 時保持每組內部順序。
- 驗收：CI 綠且 wall time 明顯下降；Node 18 job 綠。

---

### P8 · 統一 DB 連線策略（成本：中｜一致性債）

- 問題：`src/core/db/connection.ts:3-12` 有連線 pool（`withDb`），`recall.ts`/`telemetry.ts` 走 pool；但 `session.ts`、`source.ts`、`wiki.ts`、`lint.ts`、`sync.ts`、`verify.ts`、`schema.ts`、`prune-export.ts` 共 20+ 處直接 `new Database()` 各自 try/finally 開關。兩套並存，改連線行為（pragma、逾時）要改兩套。另 `health()` 路徑會疊加多次 open/close（`verify.ts:51-55` + `memoria.ts:556`）。
- 方向：全部收斂到 `withDb`；`closeAllConnections` 的呼叫點（目前 `serve.ts:30`、`setup.ts:100`）檢查是否需要擴充到其他長駐路徑。CLI 一次性命令靠 process 退出釋放的語意保持不變。
- 前置：這是橫切面改動，動手前對 `withDb` 與各 db 函式跑 `gitnexus_impact`；**逐檔小步遷移、每檔一 commit**，不要一口氣全換。
- 驗收：`grep 'new Database(' src/` 只剩 `connection.ts`（與 schema 初始化如確有必要的例外，需註明理由）；全部 e2e 綠。

---

### P9 · `recall.ts` 重構（成本：中高｜為 RFC 主線鋪路）

- 問題：
  - `queryRecallLike`（`src/core/db/recall.ts:474-548`）decision/skill/session 三段 SQL 幾乎相同；`project/scope/after` filter 子句樣板在 `recall.ts:404-429`、`:484-520`、`telemetry.ts:225-255`、`prune-export.ts` 重複 4+ 次。
  - `buildMemoryIndex`（:63-228，~165 行）、`recallTree`（:230-358，~128 行）混雜 SQL、交易、評分、路徑計算。
  - `memoria.ts` 的 `recall()`（:316-477，161 行）內嵌 IIFE 做 hybrid 合併，路由邏輯應下沉到 `recall.ts`。
  - `maybeParseJson` + snippet 截斷樣板兩處重複（`recall.ts:432-441`、`:531-540`）。
- 方向：抽 `buildFilterClause(project, scope, after)`；長函式按「SQL 準備／評分／組裝」拆小；hybrid 路由下沉。
- ⚠️ `recall()` 在既有 RFC 中標為 **CRITICAL blast radius**——改前必跑 `gitnexus_impact`，且 utility-feedback RFC 要求對 `recall()` 的改動維持輸出 byte-identical。若 P6 已在進行，先與其協調順序（建議 P6 spike 先完成，因 spike 不動 `recall()`）。
- 驗收：`test-smoke.sh` 中 recall 相關案例輸出不變；`pnpm run check` 綠。

---

### P10 · install.sh 供應鏈強化（成本：低｜受眾目前小）

- 問題：`install.sh:57-63` 下載 tarball 無 checksum/簽章驗證；`--version` 參數未驗格式即拼 URL（`install.sh:72-82`）；產物只有 linux-x64（`install.sh:7`、`package-release-artifacts.sh:10`），better-sqlite3 是原生模組，macOS/arm64 無 no-clone 安裝路徑。
- 方向：release 流程產出 `SHA256SUMS`，install.sh 下載後驗證；`--version` 加格式檢查。多平台產物**先不做**，等有需求。
- 驗收：`bash -n install.sh` 過；`test-no-clone-install.sh` 綠（需同步更新該測試以覆蓋 checksum 路徑）。

---

## 3. 明確不做（讀了別動）

| 項目 | 原因 |
|------|------|
| 語意召回（vector/embedding） | RFC 狀態 `blocked`，卡維護者決策（本地模型 vs 託管 API、sqlite-vec vs libSQL），且與 lean-deps 原則衝突。見 `docs/RFC-semantic-recall.md` §13.3 |
| 矛盾偵測、importance-weighted retention、tree recall O(N) 索引 | 只有想法層級；部分依賴 P6 累積 utility 資料後才有意義 |
| 加 linter/formatter/測試框架/runtime 依賴 | repo 刻意保持 lean（CLAUDE.md 鐵則），除非維護者明說 |
| 改 CLI 命令名、prune 預設值（90/180 天） | agent 契約，動了就是 breaking |

## 4. 已排除的誤報（別重複調查）

- `.memory/sessions.db` **沒有**進版控——已驗證 `git ls-files` 無任何 .db，且 `.gitignore:8` 明確排除。體檢初稿曾誤報，此處澄清。
- 「`project` tag 無隔離模型」是評估文件的殘留觀點——multi-scope isolation（`agent:`/`user:`/`project:`/`global`）已在 `RFC.md` 標為 `done`，`OPERATIONS.md` 有 scope 過濾說明。
