# Handover — Memoria 開發現況

- 建立：2026-07-03
- 用途：跨 session 接續。讀完這份就能無縫接手,不必回溯對話。
- 維護：這是**活文件**,每次告一段落更新「當前狀態」與「下一步」兩節即可。

---

## 0. TL;DR（30 秒版）

- **版本**:`v1.17.0` 已發布(npm + GitHub Release 皆綠),main 乾淨。
- **本 session 出貨**:從 v1.13.0 連發 **8 版**(見 §2),主題是召回品質 + adapter 契約 + 測試網 + 輸入驗證。
- **當前未提交**:2 份新設計文件 + `RFC.md` 索引更新(見 §3)。**尚未 commit**,等你決定。
- **進行中的主線**:記憶機制評估 → 展開成「效用回饋迴路」RFC。**下一個動作 = 該 RFC 的 Phase 0 spike**(見 §5)。
- **一個待你收尾的外部驗證**:Antigravity transcript 行格式(見 §6)。

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

## 2. 本 session 出貨紀錄（v1.13.0 → v1.17.0）

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

> 每一版都是「一個小單元 → 驗證 → commit → tag → release」的節奏,向後相容。

---

## 3. 當前未提交的工作(git status)

```
 M .serena/project.yml          ← 一貫排除,不提交(Serena 本機設定)
 M RFC.md                       ← 掛上兩份新設計文件的索引
?? docs/RFC-utility-feedback.md         ← 新:效用回饋迴路 RFC(本 session 主要交付)
?? docs/memory-mechanism-assessment.md  ← 新:記憶機制優缺點評估
```

- 這批是 **docs-only**,無程式碼、無需 build。
- **尚未 commit** — 依既有節奏,等你說「commit」再動。若要提交,建議訊息:
  `docs: 新增記憶機制評估與召回效用回饋迴路 RFC`(記得無署名尾行)。

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

**建議動作:效用回饋迴路 RFC 的 Phase 0 spike**(`docs/RFC-utility-feedback.md` §10)。

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
| **UFL** | 召回效用回饋迴路 | `proposed`,**不 blocked** | 本 session 新 RFC,策略價值最高;是語意召回的驗收標尺。**建議先做**。 |
| D2 | tree recall O(N) → 建索引 | `idea` | 規模議題,量大才痛;純效能 |
| D3 | 手改衍生 summary 後 re-index staleness | `idea` | 正確性:SQLite/markdown/FTS 可能漂移 |
| D4 | `time_window` parser 只支援 `P<n>D` | `idea` | `src/core/memoria.ts:366` 只解析天;可擴 ISO duration |
| C4 | opencode adapter e2e 測試 | `idea` | 測試覆蓋缺口(其餘三個 adapter 已有 e2e) |
| E2/E3/F | 語意召回(vector mode + embedding) | `blocked` | 卡 embedding backend 決策;見 `docs/RFC-semantic-recall.md` §13.3 |

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
- **`.serena/project.yml` 一律不提交。**
