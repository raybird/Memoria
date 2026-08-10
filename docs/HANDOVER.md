# Handover — Memoria 開發現況

- 建立：2026-07-03
- 用途：跨 session 接續。讀完這份就能無縫接手,不必回溯對話。
- 維護：這是**活文件**,每次告一段落更新「當前狀態」與「下一步」兩節即可。

---

## 0. TL;DR（30 秒版）

> 2026-07-28 更新

- **版本**:`v1.23.1` 已發(2026-08-09,GitHub Release + npm;同日連發 v1.22.0 → v1.22.1 → v1.23.0 → v1.23.1)。
- **v1.21.0 = issue-2 Git-Aware v1.1 可用性改進**(`docs/issues/issue-2/`,實測驅動):(a) `repo summarize --pending` 預設不含 diff(104KB → 2.4KB,`--with-diff`/`--limit` opt-in);(b) **pending 骨架一律不自動 promote**(Phase 2 + R1,不分型別與 importance;`--promote` 仍為明示逃生口);(c) 多 repo 情境 recall 務必帶 `project`(文件化,adapter 本已帶)。
- **v1.21.1 = issue-3 修 bug**(`docs/issues/issue-3/`):(a) 非 semver tag 的 `--tag` release 邊界不再退化成全 repo range——semver 比較優先,否則 creatordate fallback(`for-each-ref`,白名單內);(b) context 上限 `maxContextCommits`(200)/`maxContextFiles`(500),截斷永不靜默,`diffstat` 維持全範圍。實測同一 tag:context 157KB → 7.4KB。
- **真實試用已完成**(2026-07-28):對 Memoria 自身 + 一個外部私有 repo(代稱 external-repo,**細節不入版控文件**)跑通 add → sync → `--pending` → agent 回寫 → promote → recall(hit 附 SHA 溯源)→ UFL explicit outcome 全閉環;髒工作區上受控比對 git 狀態 byte-identical。issue-2/issue-3 全部源自這次試用。
- **既有基礎**:Git-Aware Memory v1(v1.19.0)、四平台發佈 + service(v1.20.0)、UFL Phase 0–3 + 語意召回 MVP(v1.18.0),全部 `done`。
- **v1.22.0 = issue-4 + issue-5**(2026-08-09,兩批一起發):(a) **issue-4 Agent-Native 記憶介面**——新增 `recall` / `remember` / `feedback` / `brief` 四個 CLI 命令,補上 skill 型部署下唯一的記憶讀寫與 UFL 回報入口,`brief` 產 `<knowledge>/BRIEF.md` 供 `CLAUDE.md` 以 `@` 引入(不接 hooks 也能開場注入),`recall()` 邏輯零變更;(b) **issue-5 長期記憶語意**——migration 14 側表 `memory_attributes` 承載 durable(豁免衰減與 stale 裁剪)/ supersedes(預設退出召回,資料不刪)/ sensitivity(`export --redact` 代稱化),未標記的資料庫行為不變(已用舊版 build 對照驗證),**assessment 缺點 4／5 至此收斂**。
- **⚠ 發版過程順手修掉一個會踩到真實資料的測試缺陷**:`test-no-clone-install.sh` 未清除繼承的 `MEMORIA_HOME`,在有設該變數的開發機上(本機 `~/.bashrc` 就有設)會**對真實 `~/.memoria` 執行 init、部署 skill、起 server**,同時讓「分離資料根目錄」的斷言失效。已加 `unset MEMORIA_HOME`;另 30 支測試腳本逐一稽核過,全部已把 `MEMORIA_HOME` 侷限在暫存目錄。
- **v1.22.1 = issue-6 修 bug**(`docs/issues/issue-6/`):`recall_fts` 重複列——`importSession` 的兩個語句改用 `ON CONFLICT(id) DO UPDATE`(走 UPDATE trigger,正確汰換索引列)+ migration 15 重建既有索引。影響面經查證只有 `sessions`/`events` 兩張表(其餘 8 處 `INSERT OR REPLACE` 的表沒有 trigger);本機資料庫當時未受污染。**未採用 `PRAGMA recursive_triggers`**——那是連線層的全域行為變更,且只在透過本專案連線時生效。
- **v1.23.0 = 評測讀數 + 直測 + brief 修正**:(a) `stats` / telemetry 新增 `recallRouting.routeUtility`——依 route 分組的已觀測 utility + 冠亞軍 uplift,**這是回答「語意召回是否勝過字面」的讀數**(先前只有 route 次數與 confidence 校準,沒有「哪個 route 比較有用」);(b) `scripts/test-pure-functions.sh` 純函式直測(43 斷言,tsx driver,進 CI);(c) 修 `brief` 把同一則 CLI 筆記列兩次(一則筆記占 session + event 兩個 ref,outcome 兩個都歸因)。
- **⚠ Memoria 已實際接上本機使用**(2026-08-09):全域升級至 v1.23.0;`~/.memoria/knowledge/BRIEF.md` 由 `memoria brief` 產生,並在 `~/.claude/CLAUDE.md` 以 `@` 絕對路徑引入(不放專案 CLAUDE.md——那是版控檔且路徑為絕對);寫入三則 `--durable` 記憶(skill 型整合拍板、停 server 用 PID、TeleNexus 容器為獨立資料),皆屬 **git 抓不到的環境事實**。工程決策不手寫,由 `repo sync` 促升。**(c) 這個 bug 正是實際使用十分鐘後才浮現的——fixture 測不出來,因為它沒有「一則筆記 + 對它回報過 outcome」的組合。**
- **語意召回也已實際接上**(2026-08-09):`skills/memoria-vector` 裝了 devDeps(723MB)、真模型 e2e(`MEMORIA_VECTOR_E2E_REAL=1`)通過、67 個實體 ingest 進 `~/.memoria/.memory/vectors.db`、`~/.bashrc` 設好四個變數。**實測語意勝過字面的案例**:查「停止伺服器行程要注意什麼」對記憶「停 Memoria server 一律用 PID 精準停」——keyword 0 hits、vector 命中且排前二。另**確認 libSQL 原生向量是真的在運作**(獨立探針:`vector_distance_cos` 與手算餘弦一致、`vector_top_k` 走 ANN 索引排序正確)——當初 §13.2 證偽的是 `mcp-memory-libsql` 那個 MCP server,不是 libSQL 本身。
- **issue-7 已修**(2026-08-09,未發版):促升後自動建 tree 索引,`tree` 模式終於看得到 git 記憶,bridge payload 也不再靜默縮水;`stats` 新增 `memoryIndex` 覆蓋率(缺口才出聲)。**既有資料庫仍需跑一次 `memoria index build` 回填**——`stats` 會提醒。
- **下一步**:(a) **讓真實 recall/outcome 資料累積**——四種 route 都可用了,現在純粹缺使用量;(b) 工程債:`repo-facade` 抽取(等下次動 repo 邏輯)。**無待拍板、無待評估事項**。
- **一個待收尾的外部驗證**:Antigravity transcript 行格式(見 §6)。

---

## 1. 專案座標

- 位置:`/home/kevin/Documents/RCodes/Memoria`,分支 `main`,npm 套件 `@raybird.chen/memoria`。
- 技術:TypeScript CLI + HTTP(`node:http`)+ Node SDK,共用 `src/core/`。`better-sqlite3` / `commander` / `zod`。pnpm、ESM-only、TS strict。
- 權威指令來源:`package.json` scripts 與 `.github/workflows/ci.yml`。本機測試順序照 CI。
- 讀這幾份就懂全貌:`CLAUDE.md`(規則)、`AGENTS.md`(長文指南)、`RFC.md`(roadmap 索引)、`docs/RFC-*.md`(設計)。

### ⚠️ 兩條鐵律(每次都要守)

1. **commit 訊息絕不含 `Co-Authored-By` 或任何 AI 署名**,只寫功能描述,不加尾行。
2. **回應一律繁體中文(台灣用語)**;文件內若需日期,用具體系統日期。

---

## 2. 出貨紀錄（v1.13.0 → v1.21.1）

| 版本 | 主題 | 一句話 |
|------|------|--------|
| v1.14.0 | FTS5/BM25 | keyword 召回改 FTS5 `MATCH` + `bm25()`,短詞/CJK 回退 LIKE(嚴格超集,無退化) |
| v1.15.0 | confidence 解耦 | `confidence` 改用 decay-free relevance;recall telemetry 加 `query_hash`/`token_count`/`top_confidence` |
| v1.15.1 | adapter 去重 | `shouldWrite` 改 content-aware,`dedupeWindowSec` 接上(原本是死參數) |
| v1.16.0 | 重構 + 測試網 | 抽出 `StdinHookAdapter` 消三份重複;新增 `test-migrations.sh` + `test-http-api.sh` 並進 CI |
| v1.16.1 | CJK gate | adaptive gate 改 CJK 加權長度,短中文查詢不再被誤略過 |
| v1.16.2 | Zod 邊界 | 5 個 POST handler 改 `readValidatedBody` + Zod(`.passthrough`),畸形 body 回 400 |
| v1.16.3 | 抽取去重 | `parseDecisionEvent`/`parseSkillEvent` 統一到 `src/core/extract.ts`(sync/recall/telemetry 三處共用) |
| v1.17.0 | adapter 契約 | Codex 驗證正確(僅改註解);Antigravity 修好(改 transcript-based + 扁平輸出);加 `MEMORIA_ADAPTER_DEBUG` |
| v1.18.0 | UFL + 語意召回 | UFL Phase 0–3 全數 ship;`mode:'vector'`(本地 e5 + libSQL 原生向量 + RRF,選用 fail-open);HTTP body 上限 + install.sh SHA256 驗證;CI 拆平行 job |
| v1.19.0 | Git-Aware Memory v1 | issue-1 Phase 0–6:唯讀觀察 → 增量掃描(migrations 9–13)→ 事件推斷(含 history rewrite)→ deterministic 摘要 + agent 回寫 → promotion 進 recall 語料(hit 附 `source` SHA 溯源);`repo` 七個子命令 + `/v1/repos/*` + 8 支 e2e;非侵入性總驗收 byte-identical |
| v1.20.0 | 發佈與服務化 | Linux/macOS × x64/arm64 四平台 no-clone 產物(對應 runner 實測後才發);`memoria service` 免 sudo 管理 LaunchAgent / `systemd --user`;修好 npm/npx 模式的 skill wrapper 部署;新增 npm 打包 E2E 與 Ubuntu/macOS CI 矩陣 |
| v1.21.0 | Git-Aware 可用性(issue-2) | `--pending` diff 改 opt-in + `--limit`(payload -97.7%);pending 骨架一律不自動 promote(含 R1 收緊,`--promote` 為逃生口);多 repo recall 帶 `project` 文件化 |
| v1.21.1 | Git-Aware 修 bug(issue-3) | 非 semver tag 的 release 邊界 creatordate fallback(不再退化成全 repo range);context 上限 `maxContextCommits`/`maxContextFiles`(截斷不靜默,diffstat 全範圍) |
| v1.22.0 | Agent-Native 介面 + 長期記憶語意(issue-4/5) | CLI 補 `recall`/`remember`/`feedback`/`brief`(skill 型部署下唯一的讀寫與 UFL 入口);migration 14 `memory_attributes` = durable 衰減/裁剪豁免 + 明示 supersedes(**召回預設變更**,零標記時 no-op)+ `export --redact`;修掉 `test-no-clone-install.sh` 會踩真實 `~/.memoria` 的缺陷 |
| v1.22.1 | `recall_fts` 重複列(issue-6) | `importSession` 改真正的 upsert(`ON CONFLICT DO UPDATE`,走 UPDATE trigger)——REPLACE 的隱式 DELETE 不觸發 FTS delete trigger,重複 `sync` 同一 id 會讓召回命中翻倍;migration 15 重建既有索引 |
| v1.23.0 | 評測讀數 + 直測 + brief 修正 | `recallRouting.routeUtility`(依 route 分組的已觀測 utility + uplift,兩種 route 都有 outcome 才給 `best`);`test-pure-functions.sh` 純函式直測 43 斷言(tsx driver);修 `brief` 把同一則 CLI 筆記列兩次 |
| v1.23.1 | vector helper 入包 | helper 的 `.mjs` + package.json 納入 npm `files`(node_modules 不入,包 1.20→1.22MB)——先前 `resolveHelperScript()` 在 npm 安裝下**永遠**解析不到 helper,`mode:'vector'` 靜默退回 `vector_unavailable`。helper 依賴仍為明示 opt-in;`test-npm-install.sh` 釘住解析路徑與「不含 node_modules」 |

> 每一版都是「一個小單元 → 驗證 → commit → tag → release」的節奏,向後相容。

---

## 3. 當前未提交的工作(git status)

> 2026-07-28:無。main 乾淨且與 `origin/main` 同步,所有交付均已 commit + push,v1.21.1 已 tag + release。
>
> 註:`.serena/project.yml` 已於 `0c0c80b` 隨 Serena 新版 schema(`languages` → `language_servers`)一併提交,不再是長期髒檔;`mcp-memory-libsql.db`(MCP 本機記憶 DB)已加入 `.gitignore`,檔案保留在磁碟但不進版控。

---

## 4. 進行中的主線:記憶機制評估 → 效用回饋迴路

- `docs/memory-mechanism-assessment.md`:四階段盤點(優 6 / 缺 8)。核心結論——**基礎設施 8 分、記憶智能 3 分**;最該補、且不被 blocked 的是「效用回饋」。
- `docs/RFC-utility-feedback.md`:把上述缺點 #2 展開成可落地設計。要點:
  - **不碰 embedding、不新增依賴、不被 blocked**;是語意召回 RFC 的**評測靶場**。
  - 對 `recall()`(CRITICAL blast radius)**純加法**:成功分支 meta 多回一個 `recall_id`,其餘 byte-identical。
  - 訊號 = 重用既有 `tokenCoverage` 算「注入的記憶下一回合有沒有被字面沿用」。
  - **§10 分階段**:Phase 0 spike(驗訊號,不 ship)→ Phase 1 MVP(關聯+持久化+adapter 生產者)→ Phase 2 校準曲線 → Phase 3 行動(ranking/prune/明確回饋)。

---

## 5. 下一步（接續就從這開始）

> **2026-08-09 更新:以「把 Memoria 當成 coding agent 的永久記憶」視角盤點,產出 issue-4 與 issue-5 兩份規格;issue-4 當日拍板並全數交付。**
>
> 盤點結論:**記憶能力已到位,缺的是介面**。`core/` 的召回/寫入/UFL 回報全齊、HTTP 與 SDK 也都有出口,但 CLI 註冊的 17 個命令裡**沒有讀取路徑**。在本機採用的 skill 型整合下(2026-07-29 拍板:不接 hooks、不裝 service),agent 手上只有 bash——要召回一次記憶得先起 server 或臨時寫 Node script,結果是記憶寫得進去、讀不回來,UFL 的 explicit 訊號也沒有入口。
>
> **issue-4 已交付**(`docs/issues/issue-4/`,Phase 1–2,commits `663242f` + `8d8ac0a`):新增 `recall` / `remember` / `feedback` / `brief` 四個命令 + `scripts/test-cli-memory.sh`(CI core 群組)。`remember` 寫單則原子筆記(synthetic session + 一個 DecisionMade/SkillLearned event,provenance `cli_note`),id 為內容指紋故重跑冪等;`brief` 把高價值記憶編譯成 `<knowledge>/BRIEF.md`,`CLAUDE.md` 以 `@knowledge/BRIEF.md` 引入即得開場注入。`recall()` 與既有 `remember()` 邏輯零變更。**過程中發現兩件事(R1/R4,見該 issue README)**:`INSERT OR REPLACE` 會在 `recall_fts` 留重複列(既有 bug,`sync` 路徑未修,見下表);adaptive gate 跳過的短查詢不發 `recall_id`,`feedback` 對其為 no-op——兩個正確行為疊起來會靜默吃掉效用回饋。
>
> **issue-5 亦已交付**(`docs/issues/issue-5/`,Phase 1–3,commit `80e05fc`):migration 14 側表 `memory_attributes` 承載三個標記——`durable`(召回還原時間衰減 + 豁免 stale 裁剪)、`superseded_by`(預設退出召回,`--include-superseded` 為逃生口,資料不刪且 export 不過濾)、`sensitivity='private'`(`export --redact` 對已知實體代稱化)。標記稀疏、消費點先探測表,**未標記的資料庫行為不變**。**assessment 缺點 4／5 至此收斂**。四項實作修正見該 issue R1–R4,其中 R1 最值得記:**「byte-identical」在含 `Date.now()` 的 score 上本來就不成立**(舊版自己連跑兩次 score 也不同),驗收標準已改為「順序/id/relevance/欄位集合嚴格相同 + score 相對誤差 < 1e-5」。
>
> **2026-08-09 收尾:上一版排的三項全部處理完畢**(v1.22.0 / v1.22.1 已發,後續變更在 `[Unreleased]`)。
>
> | 原第 N 項 | 結果 |
> |---|---|
> | 1. 累積真實 recall/outcome 資料 | **工具缺口已補**:`stats` / `GET /v1/telemetry/recall` 新增 `recallRouting.routeUtility`——依 `route_mode` 分組的平均已觀測 utility + 冠亞軍 `uplift`。先前 `routeCounts` 只說各 route 跑幾次、`calibration` 只說 confidence 準不準,**沒有任何欄位回答「哪個 route 召回的記憶比較有用」**。現在剩下的真的只有資料本身(本機目前 4 筆 telemetry、1 筆有 outcome、全是 `hybrid_fallback`,且無 `vector` 資料——vector 需要 `LIBSQL_URL`)。 |
> | 2. `recall_fts` 重複列 | **已修**(issue-6 / v1.22.1) |
> | 3. 發版 | **已發**(v1.22.0 + v1.22.1) |
> | 4. 工程債 | **純函式直測已補**(`scripts/test-pure-functions.sh`,43 個斷言,tsx driver,已進 CI core 群組)。**`repo-facade` 抽取維持不做**——原文寫的是「下次動 repo 邏輯時可抽」,屬條件觸發;目前沒有動 repo 邏輯,為行數而重構不划算(`memoria.ts` 現 1,251 行)。 |
> | 5. 待拍板 `RELEASE_TAG_PATTERN` | **已拍板:不放寬**(2026-08-09)。`repo sync` 維持只對 semver tag 自動產 release 摘要;非 semver 仍可用 `repo summarize --tag` 明示觸發(issue-3 已修好它的範圍邊界)。逃生口既然存在,自動化的價值不足以換取「每個日期 tag 都生成 pending 摘要」的量。**此項就此關閉。** |
>
> 現在的排序:
>
> 1. **累積真實 recall/outcome 資料**——現在是**唯一**卡在「需要時間與實際使用」而非工程的項目。日常用 `recall` / `feedback`(skill 型部署也可以了),想比較語意 vs 字面就要另外設 `LIBSQL_URL` 並實際下 `--mode vector`;夠了就看 `stats` 的 `route_utility`。**判讀時看 per-route `n`**——uplift 在 n 個位數時沒有意義。
> 2. **工程債(非急件)**:`repo-facade` 抽取(等下次動 repo 邏輯一併做)。
> 3. (無待拍板事項)
>
> 以下為歷史紀錄,保留備查。

> **2026-07-28 更新:上一版排的第 1 項(真實 repo 試用)已完成**——閉環全通,並直接產出 issue-2(v1.21.0)與 issue-3(v1.21.1)兩批交付。試用對象為 Memoria 自身 + 一個外部私有 repo;**外部 repo 的名稱/路徑/tag 命名一律不寫入版控文件**(統一用 external-repo 代稱),UFL/promotion 的試用資料在使用者的 `~/.memoria`,不在本 repo。
>
> 現在的排序:
>
> 1. **累積真實 recall/outcome 資料**:adapter + vector 模式日常使用,累積夠了用 `route_mode` 分組比較 utility uplift,客觀回答「語意召回是否勝過字面」。標尺(UFL)與待測物(vector)都已就位,只差資料。
> 2. **工程債(非急件)**:`core/memoria.ts` 因 Git-Aware 新增 9 個 `repo*` 方法而回到約 1,100 行(P4 曾壓到 500),下次動 repo 邏輯時可抽 `core/repo-facade.ts` 由門面委派;另 `effectiveUtility`/`buildCalibration`/`tokenCoverage`/`applyUtilityWeighting` 等純函式目前只被 e2e 間接覆蓋,可比照 `scripts/repo-git-exec-driver.mts` 的 tsx driver 模式補一支直測腳本(不引入測試框架)。
> 3. **待拍板**:`repo sync` 的 `RELEASE_TAG_PATTERN` 是否放寬,讓非 semver tag 也自動產 release 摘要(issue-3 刻意留在範圍外;會讓每個日期 tag 都生成 pending 摘要,量的影響需先評估)。
>
> 以下為歷史紀錄,保留備查。

> **2026-07-07 更新:UFL Phase 0/1/2/3 全數完成**(見 `docs/RFC-utility-feedback.md`)。Phase 1：`recall_id` + Migration 6 + `recordRecallOutcome` + `POST /v1/recall/:id/outcome` + SDK + adapter 回報。Phase 2：`buildCalibration` confidence×utility 校準(`memoria stats`/telemetry,不改 confidence)。**Phase 3(b)**:Migration 7 `memory_utility` per-memory 歸因 + `applyUtilityWeighting` utility-weighted **召回排序**(只降權)+ **prune retention**(stale/consolidate 保留高效用)。**Phase 3(a)**:Migration 8 explicit 累加器 + `effectiveUtility`(explicit 高保真、與 reuse **分開累計永不相加**、存在即凌駕)+ SDK `markRecallUseful`。全數**零觀測即 byte-identical、可回退**。**下一步 = 轉入語意召回評測靶場**(語意 RFC 解 embedding backend 後,用 utility uplift 客觀證明語意勝過字面);或讓資料在實際使用中累積,回看校準曲線與排序/保留效果。以下為 Phase 0 的原始說明,保留備查。

> **2026-07-07 再更新:語意召回 MVP 已 ship**(`docs/RFC-semantic-recall.md` §14,狀態 `phase-1-shipped`)。維護者拍板 embedding backend:本地 `multilingual-e5-small`(spike 5/6,英文 MiniLM 僅 2/6 跨語言全滅)+ libSQL 原生 `F32_BLOB`/`vector_top_k`,沿用 `LIBSQL_URL` 選用 gating。`recall({mode:'vector'})` = lexical floor + RRF 融合,全程 fail-open;重依賴隔離在 `skills/memoria-vector/`(spawn,core 零新增依賴);既有模式 envelope 逐位元一致。**UFL×語意匯合:比較 route_mode 分組的 utility uplift 即可客觀量測語意是否勝過字面**——兩條 RFC 主線正式閉環。下一步:讓真實資料累積,用 uplift 說話;殘餘項(hybrid 融合、語意去重)待資料再議。

**已完成動作:效用回饋迴路 RFC 的 Phase 0 spike**(`docs/RFC-utility-feedback.md` §10)。

- 目標:證明「lexical reuse」訊號**可觀測且有鑑別力**,再決定要不要進 Phase 1。
- 做法(不動 schema、不動 `recall()`、不 ship):adapter 加 `MEMORIA_UTILITY_SHADOW` 開關,inject 時緩衝注入命中,下一回合用 `tokenCoverage` 算 reuseScore,把 `{recallId, top_confidence, reuseScore}` append 成 JSONL,眼看分佈。
- Gate:若每筆 ≈0 或 ≈1 → 停,重設計訊號(改量「下一輪 user prompt 是否延續主題」)。
- 這一步就是本專案一貫的「**先驗證再建造**」紀律(語意 RFC 的 Phase 0 曾靠這個省下 1.5 天)。

> 若不想動這條主線,§7 backlog 有其他可選項。任何一項都維持「單元 → 驗證 → commit → release」節奏,動 symbol 前先 `gitnexus_impact`。

---

## 6. 一個待收尾的外部驗證（低優先、但要記得）

Antigravity adapter 已對齊「驗證過的契約」(欄位來源、事件名、扁平輸出都正確),**唯一未證實的是 transcript 逐行格式**(目前照 Claude Code JSONL 格式假設)。收尾方式:

```bash
memoria serve                                   # 開著 server
MEMORIA_ADAPTER_DEBUG=/tmp/agy-capture.jsonl memoria adapter antigravity
# 用 agy 跑一輪,把 /tmp/agy-capture.jsonl 貼回來 → 100% 校準 src/adapter/transcript.ts
```

拿到真實 payload 前,adapter 功能已可用;這只是把最後一個假設坐實。

---

## 7. Backlog（依價值排序,狀態如實）

> 2026-07-06 補充:全 repo 工程體檢產出一份**按性價比排序的改進交辦清單**(P1–P10,含證據行號與驗收條件),見 `docs/HANDOVER-improvements.md`。其中 P6 = 下表 UFL(同一件事),C4/D2 亦已涵蓋。

| 代號 | 項目 | 狀態 | 備註 |
|------|------|------|------|
| **UFL** | 召回效用回饋迴路 | **`done`**(2026-07-07) | Phase 0–3 全數 ship:recall_id / outcome 寫回 / per-memory 歸因 / 校準 / utility-weighted 排序與保留 / explicit 回饋。見 `docs/RFC-utility-feedback.md` |
| E2/E3/F | 語意召回(vector mode + embedding) | **`done` MVP**(2026-07-07) | 解鎖:本地 e5 + libSQL 原生向量,選用、fail-open。殘餘(hybrid 融合、語意去重)待 uplift 資料。見 `docs/RFC-semantic-recall.md` §14 |
| — | **Agent-Native 記憶介面** | **`done`**(2026-08-09) | `recall`/`remember`/`feedback`/`brief` 四個 CLI 命令 + `test-cli-memory.sh`。見 `docs/issues/issue-4/`(Phase 1–2 全交付,零 schema 變更,未發版) |
| D5 | 矛盾偵測(B supersedes A) | **`done`**(2026-08-09) | 評估文件缺點 #5。`docs/issues/issue-5/` Phase 2 交付:**只做明示 `--supersedes`,自動語意判斷仍在範圍外**(需語意召回實測資料才判斷得準門檻)。同 issue 併交 durable 衰減/裁剪豁免(缺點 #4 的殘餘)與 `sensitivity`/`export --redact` |
| — | **用資料評測語意 vs 字面** | `next`(**工具已備齊,只差資料**) | 讀數已於 2026-08-09 補上:`stats` / telemetry 的 `recallRouting.routeUtility`(依 route 分組平均 utility + 冠亞軍 uplift,兩種 route 都有 outcome 才給 `best`)。剩下的是使用量——要比較語意就得設 `LIBSQL_URL` 並實際下 `--mode vector`;判讀看 per-route `n` |
| — | **`recall_fts` 重複列**(既有 bug) | **`done`**(2026-08-09) | `importSession` 用 `INSERT OR REPLACE`,REPLACE 的隱式 DELETE 不觸發 FTS delete trigger → 以相同 id 重複 `sync` 會讓同一筆命中翻倍。issue-4 R1 發現,`docs/issues/issue-6/` 修復:兩個語句改真正的 upsert(`ON CONFLICT(id) DO UPDATE`,走 UPDATE trigger)+ migration 15 重建既有索引。**未採用當初推測的 trigger 修法**——寫入端修比 schema 端修簡單且對任何寫入者都成立 |
| D2 | tree recall O(N) → 建索引 | `idea` | 規模議題,量大才痛;純效能 |
| D3 | 手改衍生 summary 後 re-index staleness | `idea` | 正確性:SQLite/markdown/FTS 可能漂移 |
| D4 | `time_window` parser 只支援 `P<n>D` | `idea` | 只解析天;可擴 ISO duration |
| C4 | opencode adapter e2e 測試 | `idea` | 測試覆蓋缺口(其餘三個 adapter 已有 e2e) |
| — | **vector helper 不入 npm 包** | **`done`**(v1.23.1) | helper 的 `.mjs` + package.json 納入 `files`(node_modules 不入,包 1.20→1.22MB)→ 全域安裝的 `resolveHelperScript()` 解析得到,不再需要 `MEMORIA_VECTOR_RECALL_CMD`;helper 依賴仍為明示 opt-in(`cd .../skills/memoria-vector && npm install`)。`test-npm-install.sh` 釘住路徑與「不含 node_modules」 |
| — | **promotion 不建 memory_node** | **`done`**(issue-7) | 促升後於呼叫端建索引(不進 `promoteSummary` 的 transaction,best-effort)。實測成本 ~3ms/session 且不隨語料成長。同一成因的 `tree` 缺口一併修復。覆蓋率改由 `stats.memoryIndex` 呈現——**不放 `verify`**:`VerifyStatus` 無 `warn`、`ok` 要求全 pass,而 `health()` 也呼叫它,索引落後會讓 `/v1/health` 變不健康(見 issue-7 R1) |

---

## 8. 開發 SOP 速查（別踩雷）

- **改 symbol 前**:`gitnexus_impact({target, direction:'upstream'})`,HIGH/CRITICAL 要先示警;**commit 前** `gitnexus_detect_changes`。
- **DB 生命週期**:每條開 DB 的路徑都要 `try/finally` 關;schema 改動走 migration(guarded `PRAGMA table_info`),舊 DB 要可讀。
- **邊界驗證**:`unknown` → Zod parse,別在核心深處驗。
- **不擅自加工具**(linter/formatter/test framework/runtime dep);不改 CLI 命令名(agent 契約)。
- **測試無框架**,全是 `scripts/test-*.sh`,順序照 `.github/workflows/ci.yml`。最常跑:
  `test-smoke.sh` → `test-migrations.sh` → adapter 三支 → `test-http-api.sh`。
- **DoD**:`pnpm run check` 過 → `pnpm run build` + `node dist/cli.mjs --help` → 相關 `test-*.sh` 過 → 觸及 shell 過 `bash -n`。
- **Release SOP**:`bump-version.mjs` → CHANGELOG 從 `[Unreleased]` 提升 → guards → tests → commit(`Release vX.Y.Z`)→ tag → `push --follow-tags` → `release.yml` 自動發 npm + GitHub Release。
- **`.serena/project.yml` 隨 Serena schema 升級才提交**(2026-07-27 起);`mcp-memory-libsql.db` 等 MCP/執行期產物一律不進版控(已在 `.gitignore`)。
- **版控文件不得含外部 repo 的名稱/路徑/tag 命名**(2026-07-28 起):實測案例一律用代稱(如 external-repo、`nightly-<date>`),量化數據(commits/bytes/score)可留。本 repo 是公開的,issue 文件與 CHANGELOG 都會被讀到。
