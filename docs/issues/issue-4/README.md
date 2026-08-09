# Issue 4: Agent-Native 記憶介面 — CLI 沒有召回/寫入/回饋出口，skill 型部署下記憶讀不到

## 基本資訊

| 項目 | 內容 |
|---|---|
| Issue 編號 | 4（本地文件編號） |
| 複雜度級別 | Medium（新增 4 個 CLI 命令 + 1 個衍生產物，**零 schema 變更**、零新依賴） |
| 狀態 | **待拍板**（分析完成，Q1–Q4 見「待確認決策」） |
| 需求來源 | 2026-08-09 以「把 Memoria 當成 coding agent 的永久記憶」角度盤點現況介面 |
| 建立日期 | 2026-08-09 |
| 前置 | [issue-1](../issue-1/README.md)（Git-Aware Memory v1）、[issue-2](../issue-2/README.md)、[issue-3](../issue-3/README.md) |
| 後續 | [issue-5](../issue-5/README.md)（長期記憶語意：durable 衰減 / supersedes / sensitivity）依賴本 issue 的 `remember` 入口 |

## 文件清單

- [implementation-plan.md](implementation-plan.md) — 分析概要與實作計畫（2 Phase）

## 摘要

Memoria 的記憶**能力**（召回、寫入、UFL 效用回饋）在 `core/` 全數齊備且有 HTTP／SDK 出口，但 **CLI 出口缺了三個最常用的動作**。`src/cli.ts:49-65` 註冊 17 個命令，其中沒有 `recall`、沒有單則 `remember`、沒有 outcome 回報。

這在一般部署下只是不方便；在**本機採用的 skill 型整合**（2026-07-29 拍板：不接 Claude Code hooks、不裝 `memoria service`，記憶由 agent 主動呼叫 CLI 觸發）下，它是**阻斷性**的——agent 手上只有 bash，要召回一次記憶得先起 HTTP server 或臨時寫 Node script。結果是：**記憶寫得進去、讀不回來，UFL 迴路也回報不了**。

本 issue 只補介面，不動任何記憶語意：`recall` / `remember` / `feedback` 三個薄殼命令包既有 `MemoriaCore` 方法（Phase 1），再加一個 `brief` 把高價值記憶編譯成可被 `CLAUDE.md` 引入的衍生 markdown（Phase 2），在不接 hooks 的前提下取得近似「開場即注入」的效果。

## 現況證據（2026-08-09）

### 三條出口的不對稱

| 動作 | `core/` | HTTP | SDK | **CLI** |
|---|---|---|---|---|
| 召回 | `MemoriaCore.recall()`（`src/core/memoria.ts:303`） | `POST /v1/recall`（`src/server.ts:290`） | 有 | **無** |
| 寫入單則記憶 | `MemoriaCore.remember()`（`src/core/memoria.ts:273`） | `POST /v1/remember`（`src/server.ts:281`） | 有 | 僅 `sync <file>`，需先產出整份 SessionData JSON |
| 效用回報（UFL） | `recordRecallOutcome()`（`src/core/memoria.ts:568`） | `POST /v1/recall/:id/outcome`（`src/server.ts:344`） | `markRecallUseful` | **無** |

`src/cli.ts:49-65` 的註冊清單為完整佐證：`init` / `sync` / `source` / `repo` / `wiki` / `stats` / `index` / `govern` / `doctor` / `verify` / `prune` / `export` / `serve` / `service` / `preflight` / `setup` / `adapter`——**讀取路徑完全不在其中**。

### 為何 HTTP／SDK 不構成替代

| 出口 | 在 skill 型部署下的可及性 |
|---|---|
| HTTP | 需 `memoria serve` 常駐。使用者明示不裝 `memoria service`；臨時起停要管 PID（且本機另有無關的容器行程，`pkill` 樣式比對已有誤殺前例），成本與風險都高於一次召回本身 |
| SDK | 需寫一次性 Node script 才能呼叫，等於把「查一句記憶」變成寫程式 |
| adapter | `memoria adapter claude-code` 走 hook stdin 協定（`src/adapter/claude-code-adapter.ts:1-21`），依設計必須掛進 host 的 hooks —— 與已拍板的被動整合方向衝突 |

### 寫入粒度不匹配

記憶的自然形狀是「剛剛確立了一件事」，但目前最小寫入單位是一整份 session。`SessionData`（`src/core/types.ts:33-40`）雖然欄位皆為 optional，CLI 這一側仍要求先落一個 JSON 檔再 `sync`。

**可直接沿用的先例**：`promoteSummary()`（`src/core/db/git-promote.ts:64` 起）已經在做「一則結構化記憶 → 一個 synthetic session + `DecisionMade` events + `memory_sources` provenance，並以確定性 id + `INSERT OR IGNORE` 保證冪等」。`remember` 命令是同一個模式換一個輸入來源，**不需要發明新機制**。

### UFL 迴路在此部署下是斷的

UFL Phase 1–3 全數 ship（`recall_id`、per-memory 歸因、explicit 訊號凌駕 reuse 代理）。但 explicit 訊號的唯一出口是 HTTP／SDK；skill 型部署既無 hooks 自動回報、又無 CLI 手動回報，**系統收不到「這次召回有沒有用」**。`docs/memory-mechanism-assessment.md` 把「效用回饋」列為最高價值的一條迴路，現在它在實際部署形態下沒有入口。

## 變更邊界

### 可修改

- `src/cli.ts` — 新增 register 呼叫（**只增不改**）
- `src/cli/commands/recall.ts`、`remember.ts`、`feedback.ts`、`brief.ts` — 新檔
- `src/core/memoria.ts` — Phase 2 若需 brief 聚合，新增 method（不改既有 method 簽名）
- `src/core/index.ts` — 新增 re-export
- `scripts/test-cli-memory.sh`（新）、`.github/workflows/ci.yml`
- 文件：`CLAUDE.md`、`AGENTS.md`、`README*.md`、`docs/OPERATIONS.md`、`CHANGELOG.md`

### 禁止修改

- **不改既有 CLI 命令名、子命令名與旗標**（agent 契約，CLAUDE.md 明列）
- **不新增資料表、不改 schema**——本 issue 零 schema 變更；所有需要 schema 的能力一律推到 [issue-5](../issue-5/README.md)
- **不改 `recall()` 的既有語意、排序與預設值**——CLI 只是新的呼叫端
- **不接 hooks、不裝 service**——使用者 2026-07-29 拍板被動整合；Phase 2 的 `brief` 是替代解，不是回頭接 hooks 的前置
- **不引入依賴**（linter / formatter / test framework / runtime dep 皆不可）

### 風險

| 風險 | 說明 | 緩解 |
|---|---|---|
| `remember` 產生的 synthetic session 汙染 `stats` / telemetry 基數 | 每則筆記各成一個 session，會抬高 session 數與 `event_count` 統計 | 沿用 git-promote 的作法，在 `memory_sources` 寫入 `source_type='cli_note'` provenance，使其可被辨識與過濾；`stats` 的呈現是否分列見 Q2 |
| CLI 輸出格式一旦被 agent 消費即成新契約 | 人讀格式日後想調整會變成破壞性變更 | **一開始就分流**：`--json` 為機器讀的穩定契約（沿用 `export --json` 慣例，`src/cli/commands/export.ts:16`），人讀格式明文不保證穩定 |
| `brief` 產出的 markdown 被手改 → 三方漂移 | 正是 `docs/memory-mechanism-assessment.md` 缺點 7（衍生視圖可被手改，single source of truth 前提會裂） | 檔頭寫明 generated + 產生時間 + 來源命令，每次**整檔覆寫**不做 merge；`doctor` 不對它做一致性斷言 |
| 新增命令擴大 agent 契約面 | 日後改名／改旗標的成本 | 命名與既有 HTTP 路由一一對應（`recall` ↔ `/v1/recall`、`feedback` ↔ `/v1/recall/:id/outcome`），語意不另創 |

## 待確認決策

| # | 議題 | 選項 | 建議 |
|---|---|---|---|
| **Q1** | `remember` 寫入的事件類型 | (a) 沿用既有 `DecisionMade` / `SkillLearned`；(b) 新增 `FactRecorded` / `PreferenceStated` 等類型 | **(a)**。新事件類型會牽動 `src/core/db/recall.ts:165`、`:536` 的 `event_type IN (...)` 白名單與 `src/core/utils.ts:308`，屬記憶語意變更，應併入 issue-5 一起評估。v1 先以 `--type decision\|skill` 覆蓋 |
| **Q2** | `remember` 的 session 粒度 | (a) 一則一 session（provenance 清楚、冪等 id 簡單，但 session 數膨脹）；(b) 當日聚合成一個 session | **(a)**。與 `promoteSummary` 一致（一摘要一 session），id 用內容 hash（`note-<hash>`）+ `INSERT OR IGNORE` 天然去重；膨脹以 provenance 標記換取可追溯 |
| **Q3** | `brief` 的產生時機 | (a) 只手動 `memoria brief`；(b) `sync` / `repo sync` 完成後自動重建 | **(a)**。自動重建等於在寫入路徑上掛副作用，與「被動整合」的取向不合；先手動，若實際使用頻繁再議 |
| **Q4** | 效用回報的命令形狀 | (a) 頂層 `memoria feedback <recall_id>`；(b) 子命令 `memoria recall outcome <recall_id>` | **(a)**。`recall` 保持單一動作（查詢即輸出），與 HTTP 兩個獨立路由的切分一致；頂層動詞也較短、agent 好記 |

## Timeline

| 日期 | 事件 |
|---|---|
| 2026-08-09 | 以 agent 永久記憶的使用視角盤點現況，確認三條出口不對稱與 skill 型部署下的阻斷；建立 issue 文件（README + implementation-plan） |

## Changelog

- 2026-08-09: 初版建立。三項缺口皆附 `file:line` 證據；Q1–Q4 待拍板。

---
**建立日期**: 2026-08-09
**最後更新**: 2026-08-09
**文件版本**: 1.0
**狀態**: **待拍板**
**分級**: Medium
