# Memoria x LLM Wiki Integration Plan

**Goal:** 將 Memoria 從「可程式化長期記憶層」擴展為一個完整的 `raw sources -> structured memory -> compiled wiki -> schema` 知識系統，讓 agent 不只可以寫入 session memory 和 recall，還能持續維護一個可瀏覽、可累積、可 lint 的 LLM-maintained wiki。

**Recommended scope:** 不做最小版，也不追求一次到位的研究平台。建議做一個 **完整但可交付的 v1**：

- 支援多種 raw source，不只 session JSON
- 保留 SQLite 作為 durable source of truth
- 建立完整 wiki page taxonomy，而不是只有 `Daily/Decisions/Skills`
- 將 query 結果回寫成 wiki artifact
- 新增 wiki lint / governance / provenance / contradiction workflow
- 保留現有 CLI/API 使用習慣，不破壞既有 memory flow

**Non-goals for v1:**

- 不做即時多人協作編輯器
- 不做 browser UI / web app-first wiki 編輯體驗
- 不做向量資料庫必選依賴
- 不做全自動無人監督的高風險知識覆寫
- 不做跨 repo / multi-tenant ACL 系統

---

## Why This Version

最小版只能證明「Memoria 可以多產出幾個 markdown 檔」。那不夠。

如果要真的承接 Karpathy 那種 LLM Wiki pattern，第一個值得做的完整版本至少要具備這 6 個能力：

1. `raw sources` 明確獨立，且 immutable
2. `structured memory` 繼續當 source of truth
3. `compiled wiki` 有明確 page taxonomy、index、log、overview、cross-links
4. `schema` 變成可操作的 maintenance contract，而不是口頭約定
5. `query -> file back` 成立，問答結果可回寫成 durable knowledge pages
6. `lint` 成立，能持續找出 stale / contradiction / orphan / gap

如果缺少上面其中多項，系統還是比較像「記憶系統 + 幾份 markdown 輸出」，不是完整的 wiki workflow。

---

## Target Architecture

建議正式採用 4-layer architecture，而不是把所有功能都塞進 markdown 層。

### Layer 1: Raw Sources

Raw source 是 immutable input layer。

應支援至少下列 source types：

- `session`：既有 session JSON
- `note`：手動 markdown / plain text note
- `article`：web clip / article markdown
- `document`：匯入的 markdown or text export
- `attachment`：image / pdf metadata reference（v1 可先只做 metadata，不要求完整 OCR）

原則：

- agent 永不覆寫 raw source
- raw source 必須有 stable ID、type、timestamp、scope、origin metadata
- 所有 wiki page / memory node / synthesis 都要能追溯到 raw source

### Layer 2: Structured Memory

SQLite 仍是 durable source of truth。

這一層保留並擴展現有表：

- `sessions`
- `events`
- `skills`
- `memory_nodes`
- `memory_node_sources`
- `memory_sync_state`
- `recall_telemetry`

新增建議表：

- `sources`
- `source_chunks` or equivalent normalized source fragments
- `wiki_pages`
- `wiki_page_sources`
- `wiki_page_links`
- `wiki_lint_runs`
- `wiki_lint_findings`
- `wiki_query_artifacts`

這一層負責：

- import normalization
- provenance tracking
- retrieval / ranking
- governance / lint candidate generation
- incremental update routing

### Layer 3: Compiled Wiki

這一層是 human-readable, agent-maintained markdown artifact layer。

建議 taxonomy：

- `knowledge/Index/`
- `knowledge/Logs/`
- `knowledge/Sources/`
- `knowledge/Entities/`
- `knowledge/Concepts/`
- `knowledge/Syntheses/`
- `knowledge/Comparisons/`
- `knowledge/Questions/`
- `knowledge/Daily/`
- `knowledge/Decisions/`
- `knowledge/Skills/`

特殊檔案：

- `knowledge/index.md`
- `knowledge/log.md`
- `knowledge/overview.md`
- `knowledge/open-questions.md`
- `knowledge/contradictions.md`

每個 page 應至少具備：

- title
- page type
- scope
- summary
- source references
- last reviewed timestamp
- outbound links
- status / confidence / review hints（frontmatter 或標準章節格式）

### Layer 4: Schema and Maintenance Contract

這不是單一檔案，但應至少有一個主 schema 文件，例如：

- `docs/WIKI_SCHEMA.md`
- 或 `knowledge/SCHEMA.md`

內容至少要定義：

- page taxonomy
- naming rules
- ingest workflow
- query filing workflow
- contradiction handling policy
- overwrite vs append rules
- citation/provenance rules
- lint categories and fix policy

這一層要讓 agent 不只是 generic chatbot，而是 disciplined wiki maintainer。

---

## Product Surface

建議 v1 最終對外提供 4 類操作：

1. **Ingest**
   - 匯入 raw source
   - 更新 DB
   - 更新 wiki pages

2. **Recall / Query**
   - 依 keyword/tree/hybrid 檢索 structured memory
   - 查詢 wiki page
   - 回答後可選擇 filing back 成新 page

3. **Lint / Governance**
   - 掃描 stale / orphan / contradiction / missing-page candidates
   - 讓 agent 或使用者決定是否修補

4. **Inspect / Export**
   - index/log/overview
   - page provenance
   - change log
   - source graph summary

---

## File Structure

### Create

- `docs/2026-04-06-memoria-llm-wiki-integration-plan.md`
- `docs/WIKI_SCHEMA.md`
- `docs/WIKI_OPERATIONS.md`
- `scripts/test-wiki-ingest.sh`
- `scripts/test-wiki-query-fileback.sh`
- `scripts/test-wiki-lint.sh`
- `scripts/render-wiki-source-fixture.mjs`
- `src/core/wiki.ts`
- `src/core/source-import.ts`
- `src/core/wiki-lint.ts`
- `src/core/wiki-schema.ts`

### Modify

- `src/core/types.ts`
- `src/core/db.ts`
- `src/core/memoria.ts`
- `src/core/index.ts`
- `src/cli.ts`
- `src/server.ts`
- `README.md`
- `docs/INSTALL.md`
- `docs/OPERATIONS.md`
- `AGENTS.md`
- `.github/workflows/ci.yml`

### Potentially Create Later

- `src/core/wiki-render.ts`
- `src/core/wiki-query.ts`
- `src/core/wiki-governance.ts`
- `skills/memoria-wiki-maintenance/SKILL.md`

---

## Proposed CLI Surface

保留現有 CLI，不破壞既有 user flow，再新增 wiki-oriented commands。

### Existing commands to preserve

- `init`
- `sync`
- `stats`
- `doctor`
- `verify`
- `index`
- `govern`
- `serve`
- `preflight`
- `setup`

### New commands

- `memoria source add <file>`
- `memoria source list`
- `memoria wiki build`
- `memoria wiki page <slug>`
- `memoria wiki index`
- `memoria wiki log`
- `memoria wiki lint`
- `memoria wiki file-query --input <query-json>`
- `memoria wiki review --apply <finding-id>`

### New HTTP endpoints

- `POST /v1/sources`
- `GET /v1/sources`
- `POST /v1/wiki/build`
- `GET /v1/wiki/index`
- `GET /v1/wiki/pages/:slug`
- `POST /v1/wiki/lint`
- `POST /v1/wiki/file-query`

---

## Data Model Additions

### `sources`

Represents each immutable raw source.

Suggested columns:

- `id`
- `type`
- `scope`
- `title`
- `origin_path`
- `origin_url`
- `checksum`
- `created_at`
- `imported_at`
- `status`
- `metadata`

### `wiki_pages`

Represents each compiled wiki page.

Suggested columns:

- `id`
- `slug`
- `title`
- `page_type`
- `scope`
- `summary`
- `filepath`
- `status`
- `confidence`
- `last_built_at`
- `last_reviewed_at`
- `metadata`

### `wiki_page_sources`

Page-to-source provenance links.

Suggested columns:

- `page_id`
- `source_id`
- `relation_type`
- `created_at`

### `wiki_page_links`

Page-to-page outbound link graph.

Suggested columns:

- `from_page_id`
- `to_page_id`
- `link_type`
- `created_at`

### `wiki_lint_findings`

Stores durable lint findings so they can be reviewed and resolved.

Suggested columns:

- `id`
- `finding_type`
- `severity`
- `page_id`
- `related_page_id`
- `source_id`
- `status`
- `summary`
- `details`
- `created_at`
- `resolved_at`

---

## Page Taxonomy Rules

v1 不應讓 agent 自由發明 page 類型，否則 taxonomy 會漂移。

建議固定 7 種 page type：

1. `source-summary`
2. `entity`
3. `concept`
4. `synthesis`
5. `comparison`
6. `question`
7. `index-meta`

規則：

- `source-summary`: 每個 raw source 至少一頁
- `entity`: 人物 / 組織 / 產品 / 專案 / 地點等具名主體
- `concept`: 方法 / 主題 / theory / recurring pattern
- `synthesis`: 跨多 source 的綜合頁
- `comparison`: 多對象對照表 / decision memo
- `question`: 未解問題 / 研究缺口 / pending exploration
- `index-meta`: `index.md`, `log.md`, `overview.md`, `contradictions.md`

---

## Provenance Rules

v1 必須把 provenance 當成一等公民，不然 wiki 很快失真。

每個 wiki page 都要：

- 列出 supporting source IDs
- 標記 last updated / last reviewed
- 對關鍵 claims 保留 source references

每個 generated page section 最少要能回答：

- 這段來自哪些 source？
- 是原始摘要、綜合判斷、還是 query 產物？
- 是否存在衝突或低信心？

---

## Contradiction Policy

不要讓 agent 直接覆蓋舊知識而不留痕跡。

建議規則：

- 新 source 與舊 page 衝突時，不直接 hard overwrite
- 先建立 contradiction finding
- page 中標記：
  - current view
  - prior view
  - conflicting sources
  - review needed

若使用者選擇自動修補，才更新 page 並把 prior claim 記入 changelog/log。

---

## Query Filing Rules

Karpathy 那篇最重要的能力之一是：好 query 不應蒸發在 chat。

v1 建議支援兩種回寫模式：

1. `ad hoc filing`
   - 使用者或 agent 明確要求：把這個答案寫成頁面

2. `suggested filing`
   - 系統判斷某次 query 產物高價值，回傳 suggestion，但不自動寫入

可 filing 的內容：

- 比較表
- synthesis memo
- recurring question summary
- research brief

不應自動 filing 的內容：

- trivial Q&A
- low-confidence hallucinated synthesis
- 缺乏明確 source support 的 speculation

---

## Lint Categories

完整 v1 至少要支援下列 lint finding 類型：

1. `orphan-page`
2. `stale-page`
3. `missing-page`
4. `missing-link`
5. `contradiction`
6. `low-provenance`
7. `duplicate-page`
8. `source-not-compiled`

Severity:

- `high`: contradiction, broken provenance
- `medium`: stale-page, duplicate-page
- `low`: missing-link, weak summary, suggested page split

---

## Full Implementation Phases

## Planning Mode for This Program

這份計畫採用兩種 planning mode：

- **Detailed upfront planning**：Phase 1-2 可先細拆到 task 級別，因為邊界較穩
- **Rolling-wave planning**：Phase 3-6 先拆成可執行版本，但每個 phase 結束後必須 review 再校正下一階段

原因：

- 前期主要處理 schema、DB、CLI/API surface，變數較低
- 後期會受到真實 page growth、query noise、lint quality、taxonomy drift 影響
- 若把後期設計一次凍結，通常會在實作中發現 taxonomy 或 lint policy 需要回修

因此「全部拆解」是可以的，但不代表「全部鎖死」。

## Phase 1: Formalize Wiki Data Model

**Goal:** 讓 wiki 不再只是幾個 markdown 副產物，而是正式的 product layer。

### Files

- Modify: `src/core/types.ts`
- Modify: `src/core/db.ts`
- Modify: `src/core/index.ts`
- Create: `src/core/wiki.ts`
- Create: `src/core/wiki-schema.ts`

### Tasks

- 新增 `SourceRecord`, `WikiPage`, `WikiLintFinding` types
- 擴充 SQLite schema 加入 `sources`, `wiki_pages`, `wiki_page_sources`, `wiki_page_links`, `wiki_lint_findings`
- 建立 wiki page upsert / query / link APIs
- 定義 page taxonomy constants，避免 magic strings 散落

### Exit Criteria

- DB migration 可在舊資料庫上安全執行
- `pnpm run check` 通過
- 既有 `remember/recall` flow 不退化

### Detailed Execution Breakdown

- Step 1: 在 `src/core/types.ts` 新增 wiki domain types
  - `SourceRecord`
  - `SourceType`
  - `WikiPage`
  - `WikiPageType`
  - `WikiPageLink`
  - `WikiLintFinding`
- Step 2: 定義 page taxonomy 常數與 allowed statuses
- Step 3: 在 `src/core/db.ts` 擴充 `initDatabase()` migration
- Step 4: 新增 `sources` table migration
- Step 5: 新增 `wiki_pages` table migration
- Step 6: 新增 `wiki_page_sources` table migration
- Step 7: 新增 `wiki_page_links` table migration
- Step 8: 新增 `wiki_lint_findings` 與 `wiki_lint_runs` table migration
- Step 9: 為新表補最小必要 indexes
- Step 10: 實作 source upsert helpers
- Step 11: 實作 wiki page upsert/query helpers
- Step 12: 實作 page-source link upsert helpers
- Step 13: 實作 page-page link upsert helpers
- Step 14: 在 `src/core/index.ts` re-export 新 API
- Step 15: 驗證舊 DB 可安全升級
- Step 16: 跑 `pnpm run check`
- Step 17: 跑 `bash scripts/test-smoke.sh`

### Review Gate

Phase 1 完成後要先確認：

- page taxonomy 是否仍維持最小集合
- migration 命名與 table responsibilities 是否清楚
- `memory_nodes` 與 `wiki_pages` 的責任是否沒有混淆

## Phase 2: Add Raw Source Ingestion Beyond Sessions

**Goal:** 讓 system 不只吃 session JSON，也能 ingest 一般來源。

### Files

- Create: `src/core/source-import.ts`
- Modify: `src/cli.ts`
- Modify: `src/server.ts`
- Create: `scripts/render-wiki-source-fixture.mjs`

### Tasks

- 新增 `memoria source add <file>`
- 支援 markdown / text 作為第一批 source type
- 將 imported source 記錄到 `sources`
- 為每個 source 建立 `source-summary` page
- 保留 checksum，避免重複 ingest

### Exit Criteria

- 可 import 非 session 類 source
- 產生對應 `source-summary` page
- source provenance 可追到 DB

### Detailed Execution Breakdown

- Step 1: 定義 v1 支援的 source types
  - `session`
  - `note`
  - `article`
  - `document`
- Step 2: 明確 v1 不支援的 source 類型處理方式
  - PDF/image 僅記 metadata 或顯式拒收
- Step 3: 建立 `src/core/source-import.ts`
- Step 4: 實作 source checksum 與 dedupe policy
- Step 5: 定義 source metadata normalization 規則
- Step 6: 實作 markdown/text source import
- Step 7: 將 source 落盤到 raw source 路徑或記錄 origin path
- Step 8: 將 source metadata 寫入 `sources`
- Step 9: 建立對應 `source-summary` wiki page builder
- Step 10: 把 `source-summary` page 與 source 建立 provenance link
- Step 11: 在 `src/cli.ts` 新增 `memoria source add <file>`
- Step 12: 在 `src/cli.ts` 新增 `memoria source list`
- Step 13: 在 `src/server.ts` 新增 `/v1/sources` endpoints
- Step 14: 建立 `scripts/render-wiki-source-fixture.mjs`
- Step 15: 建立 `scripts/test-wiki-ingest.sh`
- Step 16: 驗證 source import 不影響既有 session sync

### Review Gate

Phase 2 完成後要確認：

- source metadata 是否足夠支援後續 provenance
- dedupe policy 是否太嚴或太寬
- `source-summary` page 結構是否能支撐後續 synthesis

## Phase 3: Build the Compiled Wiki Layer

**Goal:** 建立完整 wiki artifact，而不是只有 daily/decision/skill markdown。

### Files

- Create: `docs/WIKI_SCHEMA.md`
- Create: `docs/WIKI_OPERATIONS.md`
- Modify: `src/core/wiki.ts`
- Modify: `src/core/memoria.ts`

### Tasks

- 建立 `knowledge/index.md`, `knowledge/log.md`, `knowledge/overview.md`
- 建立 taxonomy-specific page builders
- 將既有 `Daily/Decisions/Skills` 納入同一 wiki model
- 產生 page backlinks / outbound link metadata
- 引入 page frontmatter 或標準 metadata section

### Exit Criteria

- wiki pages 有固定結構
- `index.md` 與 `log.md` 可穩定更新
- `knowledge/` 內容可被人與 agent 同時閱讀

### Detailed Execution Breakdown

- Step 1: 決定 wiki page metadata 格式
  - frontmatter
  - 或固定 `## Metadata` section
- Step 2: 建立 `docs/WIKI_SCHEMA.md`
- Step 3: 建立 `docs/WIKI_OPERATIONS.md`
- Step 4: 將現有 `Daily/Decisions/Skills` 映射到正式 page types
- Step 5: 新增 `knowledge/index.md` builder
- Step 6: 新增 `knowledge/log.md` builder
- Step 7: 新增 `knowledge/overview.md` builder
- Step 8: 新增 `knowledge/open-questions.md` builder
- Step 9: 新增 `knowledge/contradictions.md` builder
- Step 10: 建立 `entity` page builder
- Step 11: 建立 `concept` page builder
- Step 12: 建立 `synthesis` page builder
- Step 13: 建立 `comparison` page builder
- Step 14: 實作 wiki page outbound link extraction
- Step 15: 實作 backlinks/index registration
- Step 16: 讓 `remember()` 後的 wiki refresh 有穩定更新順序
- Step 17: 補 `scripts/test-wiki-ingest.sh` 驗證 index/log/page generation

### Rolling Recalibration Notes

這一階段完成後，多半需要第一次大的設計校正。要特別檢查：

- taxonomy 是否太細或太粗
- page metadata 是否過重
- `index.md` 是否資訊太多導致 agent 難讀
- 現有 `knowledge/` 舊檔案結構是否需要 migration 或 compatibility path

## Phase 4: Query and File-Back

**Goal:** 讓高價值 query 結果能回寫成 durable wiki page。

### Files

- Modify: `src/core/memoria.ts`
- Create: `src/core/wiki-query.ts`
- Modify: `src/cli.ts`
- Modify: `src/server.ts`
- Create: `scripts/test-wiki-query-fileback.sh`

### Tasks

- 新增 `memoria wiki file-query`
- 支援比較表 / synthesis memo 回寫
- 將 query artifact 記入 `wiki_query_artifacts`
- 為 filed page 建立 provenance links 到 recall evidence / source pages

### Exit Criteria

- query output 可選擇性持久化
- filed page 能追溯 supporting evidence
- trivial query 不會自動污染 wiki

### Detailed Execution Breakdown

- Step 1: 定義 `query artifact` 型別與 DB schema
- Step 2: 明確哪些 query output 可 filing
- Step 3: 明確哪些 query output 不可 filing
- Step 4: 建立 `src/core/wiki-query.ts`
- Step 5: 實作 comparison-style file-back
- Step 6: 實作 synthesis memo file-back
- Step 7: 將 filed page 寫入 `wiki_pages`
- Step 8: 建立 filed page -> source/page provenance links
- Step 9: 建立 query artifact -> page link
- Step 10: 在 `src/cli.ts` 新增 `memoria wiki file-query`
- Step 11: 在 `src/server.ts` 新增 `/v1/wiki/file-query`
- Step 12: 建立 `scripts/test-wiki-query-fileback.sh`
- Step 13: 驗證 trivial query 不會自動寫檔
- Step 14: 驗證 filed page 可被 `index.md` 正常索引

### Rolling Recalibration Notes

這一階段結束後要重點檢查：

- filing threshold 是否太低造成 wiki 汙染
- filed page 類型是否需要限縮
- evidence/provenance 是否足夠支持回頭審核
- query artifact 與正式 synthesis page 是否應該分層

## Phase 5: Wiki Lint and Governance

**Goal:** 讓 wiki 有持續維護能力，不只是持續累積。

### Files

- Create: `src/core/wiki-lint.ts`
- Modify: `src/core/db.ts`
- Modify: `src/core/memoria.ts`
- Modify: `src/cli.ts`
- Create: `scripts/test-wiki-lint.sh`

### Tasks

- 新增 `memoria wiki lint`
- 產生 durable findings
- 擴充 governance review 到 wiki domain
- 支援 suggestion-only 與 apply-fix 兩種模式
- 將 contradiction candidate 與 stale-page candidate 明確輸出

### Exit Criteria

- lint finding 可查詢、可審核、可關閉
- 可以把 wiki health 當成長期治理面，而不是一次性工具

### Detailed Execution Breakdown

- Step 1: 固定 v1 lint finding taxonomy
- Step 2: 定義 severity 規則
- Step 3: 建立 `src/core/wiki-lint.ts`
- Step 4: 實作 `orphan-page` detector
- Step 5: 實作 `stale-page` detector
- Step 6: 實作 `missing-page` detector
- Step 7: 實作 `missing-link` detector
- Step 8: 實作 `duplicate-page` detector
- Step 9: 實作 `low-provenance` detector
- Step 10: 實作 `source-not-compiled` detector
- Step 11: 實作第一版 `contradiction` detector
- Step 12: 將 finding 寫入 `wiki_lint_findings`
- Step 13: 將 lint run 寫入 `wiki_lint_runs`
- Step 14: 在 `src/cli.ts` 新增 `memoria wiki lint`
- Step 15: 在 `src/cli.ts` 新增 `memoria wiki review --apply <finding-id>` 的最小版本
- Step 16: 擴充 governance review，讓 wiki finding 可共用 deterministic review surface
- Step 17: 建立 `scripts/test-wiki-lint.sh`

### Rolling Recalibration Notes

這一階段幾乎一定要調整。請預期需要修正：

- contradiction detector 的 precision/recall
- stale threshold
- duplicate-page heuristic
- missing-page noise level
- auto-apply 與 suggestion-only 的邊界

## Phase 6: Agent Contract and Operationalization

**Goal:** 讓 agent 可以穩定執行這套 wiki workflow。

### Files

- Modify: `AGENTS.md`
- Create: `skills/memoria-wiki-maintenance/SKILL.md`
- Modify: `.github/workflows/ci.yml`

### Tasks

- 更新 agent rules，加入 wiki maintenance contract
- 新增 wiki skill，定義 ingest/query/lint SOP
- CI 加入 wiki-specific tests
- 文件補齊 product mode, maintenance mode, review mode

### Exit Criteria

- agent 能 deterministic 地維護 wiki
- CI 能驗證 wiki layer 沒有明顯回歸

### Detailed Execution Breakdown

- Step 1: 在 `AGENTS.md` 新增 wiki maintenance mode 說明
- Step 2: 定義 ingest / query / lint / review 的 agent responsibilities
- Step 3: 建立 `skills/memoria-wiki-maintenance/SKILL.md`
- Step 4: 將 wiki command 與 verification flow 寫入 skill
- Step 5: 更新 `README.md` 的 product positioning
- Step 6: 更新 `docs/INSTALL.md` 的 wiki-related setup 說明
- Step 7: 更新 `docs/OPERATIONS.md` 的 wiki governance workflow
- Step 8: 在 `.github/workflows/ci.yml` 新增 wiki-specific tests
- Step 9: 決定 release gating 是否要求 wiki tests 全綠
- Step 10: 補 release SOP，明確 wiki migration / build / lint 驗證順序

### Rolling Recalibration Notes

這一階段要根據前面真實使用情況調整，不適合一開始就鎖死。要回顧：

- agent 是否真的能穩定遵守 schema
- skill 是否太抽象或太冗長
- CI 時間是否過重
- release gate 是否需要分層，而不是每次都跑完整 wiki suite

---

## Cross-Phase Review Checkpoints

除了每個 phase 自身的 review gate，建議固定做 3 次跨 phase 校正：

1. **Checkpoint A: After Phase 2**
   - 確認 raw source model 與 page taxonomy 是否相容
   - 決定 Phase 3 的 wiki metadata 格式是否需要修改

2. **Checkpoint B: After Phase 4**
   - 檢查 wiki 是否開始被 low-value query 汙染
   - 決定 Phase 5 lint policy 的嚴格程度

3. **Checkpoint C: After Phase 5**
   - 檢查 lint noise 與治理成本
   - 決定 Phase 6 agent contract 與 CI gate 應該多硬

---

## Testing Strategy

完整 v1 建議至少有下列測試：

1. `scripts/test-smoke.sh`
   - 既有 memory flow 不退化

2. `scripts/test-bootstrap.sh`
   - repo mode bootstrap 仍成立

3. `scripts/test-no-clone-install.sh`
   - installed runtime 仍成立

4. `scripts/test-wiki-ingest.sh`
   - raw source import -> wiki page build

5. `scripts/test-wiki-query-fileback.sh`
   - query -> filed page

6. `scripts/test-wiki-lint.sh`
   - contradiction / orphan / stale candidate generation

---

## CI Parity Checklist (Target)

完成後建議 CI parity 變成：

```bash
pnpm install
pnpm run release:docs-check
pnpm run check
pnpm run build
pnpm run release:package
node dist/cli.mjs --help
bash -n install.sh
bash scripts/test-smoke.sh
bash scripts/test-bootstrap.sh
bash scripts/test-adapter-runtime.sh
bash scripts/test-no-clone-install.sh
bash scripts/test-mcp-e2e.sh
bash scripts/test-wiki-ingest.sh
bash scripts/test-wiki-query-fileback.sh
bash scripts/test-wiki-lint.sh
```

---

## Risks

- **Markdown drift**: page taxonomy 若不固定，wiki 很快失控。
- **Provenance erosion**: 若 page update 不追 source，後面會失去可驗證性。
- **Contradiction overwrite**: 直接覆寫舊知識會讓 wiki 看起來乾淨但不可信。
- **Over-filing**: 若把低價值 query 全寫回 wiki，會快速污染知識層。
- **Mixed responsibilities**: 若 DB、wiki、schema 職責混在一起，後面很難維護。
- **Scale creep**: 不要在 v1 同時追求 embeddings、UI、ACL、real-time collaboration。

---

## Release Strategy

建議分三個 release band，而不是一次全出：

1. **v1.7.x**
   - wiki data model + source ingest + basic wiki build

2. **v1.8.x**
   - query filing + index/log/overview + page taxonomy stabilization

3. **v1.9.x**
   - wiki lint + governance + agent skill + CI hardening

不要試圖把完整 v1 壓成單一 patch/minor。這是 product mode expansion。

---

## Definition of Done

- Memoria 可 ingest session 以外的 raw source
- SQLite 持續作為 source of truth
- `knowledge/` 成為真正的 compiled wiki，而不是固定模板輸出集合
- `index.md`, `log.md`, `overview.md` 可穩定更新
- 高價值 query 結果可回寫為 wiki page
- lint 可產生 durable findings，支援 contradiction/stale/orphan/missing-page 類型
- agent contract 明確，能穩定維護 wiki
- 既有 repo mode / installed mode / recall / MCP flow 不退化

---

## Recommendation

如果真的要做，不建議停在「幫 `Memoria` 多加幾個 markdown 類別」。

最值得做的一版，是把 `Memoria` 正式升級成：

- a durable memory engine
- a compiled knowledge substrate
- and an agent-maintained wiki system

也就是：

**Memoria stores the truth, the wiki compiles the understanding, and the agent maintains the bridge.**
