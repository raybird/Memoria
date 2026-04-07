# Memoria x LLM Wiki Phase 1 Implementation Plan

> **For agentic workers:** 建議使用 task-by-task 方式執行，逐步勾選。這一份只涵蓋 **Phase 1: Formalize Wiki Data Model**，目標是建立 wiki domain 的正式資料模型與 DB schema，但**不**在這一階段處理一般 raw source ingest、wiki page rendering、query file-back 或 lint workflow。

**Goal:** 在不破壞既有 `remember/recall/sync` 行為的前提下，將 wiki domain 正式納入 Memoria core，建立可演進的 types、SQLite tables、DB helpers、module export surface，為後續 source ingest / compiled wiki / lint 打基礎。

**Architecture for this phase:**

- 保留現有 `sessions/events/skills/memory_nodes` 作為既有 durable memory 結構
- 新增 wiki 專屬資料模型：`sources`, `wiki_pages`, `wiki_page_sources`, `wiki_page_links`, `wiki_lint_runs`, `wiki_lint_findings`
- 先把 wiki 當成 **first-class domain model**，但還不把它接進所有 CLI flow
- 本階段只建立 schema 與 core helper，不急著做完整 product surface

**Non-goals:**

- 不新增 `memoria source add`
- 不新增 `memoria wiki build`
- 不建立 markdown page rendering pipeline
- 不建立 lint detector
- 不做大規模 migration/refactor of existing `knowledge/` outputs

---

## Files

**Create:**

- `src/core/wiki.ts` - wiki domain helper 與 constants 的集中入口

**Modify:**

- `src/core/types.ts` - 新增 wiki-related types
- `src/core/db.ts` - 新增 wiki tables migration 與最低限度的 DB helpers
- `src/core/index.ts` - 將 wiki domain export 出去
- `src/core/memoria.ts` - 視需要最小接線，但不要在本階段加入完整 wiki build flow
- `AGENTS.md` - 若實作過程中發現 phase 邊界需要補充，可在最後同步；若無必要可不動

**Verification targets:**

- `pnpm run check`
- `pnpm run build`
- `bash scripts/test-smoke.sh`
- `bash scripts/test-bootstrap.sh`

---

## Delivery Rules

- 優先建立可演進 schema，不要在這一階段過早發明完整 wiki UX
- 不要把 `memory_nodes` 與 `wiki_pages` 混成同一責任層
- 既有 CLI commands 與 API response shape 不可被 Phase 1 破壞
- migration 必須對舊 DB fail-safe，不能要求手動 reset database
- 本階段如果需要新增 constants 或 helpers，優先集中到 wiki domain，而不是散落在 `cli.ts`

---

## Task 1: Define the Wiki Domain Types

**Files:**

- Modify: `src/core/types.ts`

- [ ] **Step 1: 新增 source domain types**

最小建議包含：

```ts
type SourceType = 'session' | 'note' | 'article' | 'document' | 'attachment'

type SourceRecord = {
  id: string
  type: SourceType
  scope: string
  title: string
  origin_path?: string
  origin_url?: string
  checksum?: string
  created_at: string
  imported_at: string
  status: 'active' | 'archived'
  metadata?: Json
}
```

- [ ] **Step 2: 新增 wiki page domain types**

最小建議包含：

```ts
type WikiPageType =
  | 'source-summary'
  | 'entity'
  | 'concept'
  | 'synthesis'
  | 'comparison'
  | 'question'
  | 'index-meta'
```

以及：

- `WikiPage`
- `WikiPageStatus`
- `WikiPageLink`
- `WikiPageSourceLink`

- [ ] **Step 3: 新增 lint domain types**

最小建議包含：

- `WikiLintFindingType`
- `WikiLintSeverity`
- `WikiLintFinding`
- `WikiLintRun`

- [ ] **Step 4: 檢查命名與現有 type style 一致**

Expected outcome:

- 使用現有 `types.ts` 風格
- 不新增不必要的 class
- 不讓 type 名稱與既有 `Recall*`, `Governance*` 混淆

---

## Task 2: Create Explicit Wiki Constants and Boundaries

**Files:**

- Create: `src/core/wiki.ts`
- Modify: `src/core/index.ts`

- [ ] **Step 1: 抽出 wiki page type constants**

不要把 wiki page type 字串散落在後續實作中。集中在單一 wiki domain module，例如：

- `wikiPageTypes`
- `wikiPageStatuses`
- `wikiLintFindingTypes`
- `wikiLintSeverities`

- [ ] **Step 2: 補最小 helper type guards 或 validators（如果需要）**

原則：

- helper 要小
- 若只是 compile-time 常數，不要過度包裝
- 先不要引入新的 validation dependency

- [ ] **Step 3: 在 `src/core/index.ts` re-export wiki domain**

Expected outcome:

- 後續 phase 可以從 core index 直接用 wiki domain types/constants

---

## Task 3: Add Wiki Tables to SQLite Schema

**Files:**

- Modify: `src/core/db.ts`

- [ ] **Step 1: 在 `initDatabase()` 補 `sources` table**

建議欄位：

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

- [ ] **Step 2: 補 `wiki_pages` table**

建議欄位：

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

- [ ] **Step 3: 補 `wiki_page_sources` table**

用途：page-to-source provenance。

- [ ] **Step 4: 補 `wiki_page_links` table**

用途：page-to-page links。

- [ ] **Step 5: 補 `wiki_lint_runs` 與 `wiki_lint_findings` tables**

本階段先建立 schema，不急著完整使用。

- [ ] **Step 6: 為新表加最小必要 index**

至少考慮：

- `sources(type, imported_at)`
- `sources(scope, imported_at)`
- `wiki_pages(page_type, scope)`
- `wiki_pages(slug)` unique
- `wiki_page_sources(source_id)`
- `wiki_page_links(from_page_id)`
- `wiki_lint_findings(status, severity, created_at)`

- [ ] **Step 7: 確保 migration 對舊 DB 安全**

原則：

- 用 `CREATE TABLE IF NOT EXISTS`
- 用 `CREATE INDEX IF NOT EXISTS`
- 若需要新增欄位，沿用 repo 既有 migration 風格

Expected outcome:

- 現有舊 DB 可以直接啟動並補齊 wiki schema
- 不需要手動刪 DB

---

## Task 4: Add Minimal DB Helpers for the Wiki Domain

**Files:**

- Modify: `src/core/db.ts`
- Create or Modify: `src/core/wiki.ts`

- [ ] **Step 1: 實作 source upsert helper**

最小行為：

- 以 `id` 為 primary key upsert
- metadata JSON 要可序列化

- [ ] **Step 2: 實作 wiki page upsert helper**

最小行為：

- 以 `id` 或 `slug` 做穩定 upsert
- 不在這一階段硬塞 rendering logic

- [ ] **Step 3: 實作 page-source link upsert helper**

- [ ] **Step 4: 實作 page-page link upsert helper**

- [ ] **Step 5: 實作 lint finding write helper**

只要能寫入即可，本階段不要求完整 detector。

- [ ] **Step 6: 實作最小 query helpers**

建議至少包含：

- `listWikiPages(...)`
- `getWikiPageBySlug(...)`
- `listSourceRecords(...)`

Expected outcome:

- 後續 phase 不需要先重改 DB helper 層才能開始

---

## Task 5: Keep Phase 1 Isolated from Product-Surface Creep

**Files:**

- Modify: `src/core/memoria.ts` only if necessary

- [ ] **Step 1: 檢查是否真的需要 touching `MemoriaCore`**

原則：

- 若只新增 types/schema/helper，盡量不要提前把 wiki flow 硬接進 `remember()`
- 只有在必須 expose 最小 API 時才修改 `MemoriaCore`

- [ ] **Step 2: 若新增 `MemoriaCore` API，保持最小且前向相容**

例如可以接受：

- `listSources()`
- `listWikiPages()`

但先不要在這一階段新增複雜 orchestration。

- [ ] **Step 3: 確保既有 `remember/recall/stats/health` 行為不變**

Expected outcome:

- Phase 1 完成後 product surface 幾乎不變
- 但 core 已經具備後續 wiki 擴充基礎

---

## Task 6: Export and Verify the New Core Surface

**Files:**

- Modify: `src/core/index.ts`
- Test: `pnpm run check`
- Test: `pnpm run build`

- [ ] **Step 1: 確保新增 types/helpers 有從 core index export**

- [ ] **Step 2: 跑 type check**

Run: `pnpm run check`

- [ ] **Step 3: 跑 build**

Run: `pnpm run build`

- [ ] **Step 4: 驗證既有 integration flow**

Run:

```bash
bash scripts/test-smoke.sh
bash scripts/test-bootstrap.sh
```

Expected:

- PASS
- 沒有因 schema 擴充影響既有 bootstrap / sync / recall

---

## Phase 1 Review Gate

- [ ] **Step 1: 檢查 `memory_nodes` 和 `wiki_pages` 邊界是否清楚**

判斷原則：

- `memory_nodes` 是 retrieval/index layer
- `wiki_pages` 是 compiled human-readable artifact layer

- [ ] **Step 2: 檢查 page taxonomy 是否仍維持最小集合**

不要在 Phase 1 就發散出過多 page types。

- [ ] **Step 3: 檢查 schema 是否足夠支撐 Phase 2**

重點檢查：

- source provenance 是否夠用
- page-source/page-page links 是否足夠
- lint finding schema 是否足夠支撐後續 detector

- [ ] **Step 4: 決定是否需要修正後再進 Phase 2**

這一階段允許小幅修正，但不要帶著模糊邊界進下一個 phase。

---

## Definition of Done

- wiki domain types 已正式存在於 core type system
- SQLite schema 已包含 wiki-related tables
- 最小 DB helpers 已完成
- core export surface 已可供後續 phase 使用
- 舊 DB migration 安全
- 現有 smoke/bootstrap flow 維持綠燈
- 尚未把 product surface 膨脹到 Phase 2-6 的範圍
