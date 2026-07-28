# Issue 2: Git-Aware Memory v1.1 可用性改進 — enrichment 迴路的三個實測缺口

## 基本資訊

| 項目 | 內容 |
|---|---|
| Issue 編號 | 2（本地文件編號） |
| 複雜度級別 | Medium（局部功能調整，無架構變更、無 schema 變更） |
| 狀態 | **待實作**（分析完成，三項待確認見文末） |
| 需求來源 | 2026-07-28 於兩個真實 repository 實跑 Git-Aware Memory v1 全鏈路後的實測發現 |
| 建立日期 | 2026-07-28 |
| 前置 | [issue-1](../issue-1/README.md) Git-Aware Memory v1（已於 v1.19.0 出貨） |

## 文件清單

- [implementation-plan.md](implementation-plan.md) — 分析概要與實作計畫（3 Phase）

## 摘要

issue-1 交付的鏈路（`repo add` → `sync` → `summarize` → `--pending` → agent 回寫 `--submit` → `--promote` → recall）在真實 repository 上**功能全數正確**：SHA 溯源帶得出來、UFL 歸因接得上、非侵入性在髒工作區上仍 byte-identical。

但**可用性**有三個缺口，都只有在真實資料上才會浮現：

1. `--pending` 的 context payload 大到讓自動化回寫不實際（diff 佔 6 成以上）
2. `merge`/`release` 型摘要**無條件**通過 promotion 檢查，未經 agent 增強的骨架也會進召回語料
3. 未帶 `project` 的 recall 會跨 repository 混排

本 issue 不新增資料表、不改 CLI 命令名、不動非侵入性契約。

## 實測證據（2026-07-28）

試用對象：`Memoria` 自身（126 commits）與一個外部私有專案 repo（626 commits，掃描上限 200；下稱 external-repo，細節不入文件）。

### 發現 1：`--pending` payload 過大

| 摘要 | payload 總計 | 其中 `diff` | 佔比 |
|---|---|---|---|
| Memoria `issue-1` commit range | 296 KB | 198 KB（已觸發截斷） | 67% |
| external-repo feature branch | 140 KB | 88 KB | 63% |

`repoPendingSummaries` 一次最多回 20 筆待增強摘要（`src/core/memoria.ts:884`），每筆各自重建完整 context。最壞情況單一回應可達數 MB，換算約 35–75K token／筆。

實際扮演 host agent 回寫時，真正用到的是 `commits`（0.8–1.2 KB）與 `changed_files`（1.5–2.8 KB），`diff` 幾乎未派上用場——需要細節時直接讀原始檔更準。

### 發現 2：骨架摘要會被 promote

`isPromotable`（`src/core/db/git-promote.ts`）原本第一行對 `merge`/`release` **無條件放行**，不看 `status`（`pending` / `enriched`）：

```ts
if (summary.summary_type === 'merge' || summary.summary_type === 'release') return true
```

實測 v1.20.0 的 release 骨架：`importance=0.85`、`confidence=0.4`、`decisions=[]`、`known_limitations=[]`、`risks=[]`。三筆摘要的骨架 `decisions` 全為空是設計使然（決策要靠 agent 補），因此「未增強即 promote」的產出價值極低。

> ⚠️ **實作階段修正了觸發路徑的認定**：我最初以為問題出在自己下的 `--promote`，實際查證後是**兩條不同路徑**——
>
> | 路徑 | `promoteEligible` 的 `force` | 是否經過 `isPromotable` |
> |---|---|---|
> | `repo sync` 自動 promote（`memoria.ts:763`） | `false` | **是** ← 真正的破口 |
> | `repo summarize --promote`（`memoria.ts:870`） | `true` | 否，刻意繞過（程式碼註解已載明「使用者手動指定保留」） |
>
> 所以我實測時看到的骨架被 promote，是**明示 `--promote` 的既定設計行為**，不是 bug。真正的缺口是 `repo sync` 時里程碑骨架會自動進語料。
>
> 連帶結論：原計畫 Task 2.2「新增 `--force` 逃生口」**不需要做**——`--promote` 本身就是逃生口，也因此完全避開了 `--force` 一詞兩義的風險。
>
> 另註：舊行為是**有測試明文覆蓋**的（`test-repo-promotion.sh` 的 `merge summary auto-promoted (§7.6 merge rule)`），因此本次屬**契約變更**，已記入 CHANGELOG 的 Changed。

### 發現 3：跨 repository 混排

未帶 `project` 的查詢「選品線 agent 不建單 網頁結帳 為什麼」，第 4 筆命中的是 Memoria 的決策（score 0.383），與提問無關。

> ⚠️ **這一項要修正先前的判斷**：`RecallFilter.project`（`src/core/types.ts:206`）與 `buildScopeClause`（`src/core/db/recall.ts:418-428`）**已經可用**，promotion 也已把 `project` 寫成 repository 名稱（`src/core/db/git-promote.ts:67`）。實測帶上 `project` 後隔離完全正確（同一問題 top-1 score 0.936，無跨 repo 混入）。
>
> 所以這不是缺功能，是**預設值與文件的缺口**——呼叫端不知道要帶。Phase 3 的範圍因此極小，甚至可能只需文件與 adapter 預設值。

## 變更邊界

### 可修改

- `src/core/git/summary-context.ts` — context 組裝分級
- `src/core/memoria.ts` — `repoPendingSummaries` 簽名與傳遞
- `src/core/db/git-promote.ts` — `isPromotable` 判準
- `src/cli/commands/repo.ts` — 新增旗標（不改命令名）
- `src/server.ts` — `/v1/repos/*` 對應參數
- `src/core/config.ts` — 既有 `git.summarization` 區塊內的欄位
- 文件：`AGENTS.md`、`docs/OPERATIONS.md`、`README*.md`

### 禁止修改

- **不新增資料表、不改既有欄位**（本 issue 三項皆不需要 schema 變更）
- **不改 CLI 命令名與子命令名**（agent 契約）
- **不動 git 唯讀白名單與非侵入性契約**
- **不改 `recall()` 既有預設行為**——Phase 3 只補預設值與文件，不改變未帶 `project` 時的查詢語意
- 不引入 linter / formatter / test framework / runtime dependency

### 風險

| 風險 | 說明 | 緩解 |
|---|---|---|
| 既有 `--pending` 消費者行為改變 | 若預設值改為不含 diff，既有依賴 diff 的呼叫端會少拿資料 | 預設維持現狀，改由旗標 opt-out（見待確認 Q1） |
| promotion 收緊導致既有流程「東西不見了」 | 已 promote 的資料不受影響，但新流程可能不再自動 promote | 收緊條件寫進 CHANGELOG 的 Changed；`--force` 保留逃生口 |
| 三項綁在同一 issue 出貨 | 任一項卡住會拖累其他兩項 | 三個 Phase 各自獨立 commit、獨立可回滾，順序無依賴 |

## 已拍板決策（2026-07-28）

| # | 議題 | 決議 |
|---|---|---|
| **Q1** | `--pending` 的 diff 預設值 | **預設不含 diff，`--with-diff` opt-in**。屬破壞性變更，記入 CHANGELOG 的 Changed |
| **Q2** | `merge`/`release` 未增強時如何處理 | **擋掉，增強後才能 promote**。`repo summarize --promote` 為既有逃生口（不需新旗標） |
| **Q3** | Phase 3 是否需要程式碼變更 | **只補文件**。查證後 adapter 已全數帶 `project`（`adapter.ts:128-131`、`stdin-hook-adapter.ts:96`），連 adapter 預設值都不必改 |

## 實作後追加（R1）

| # | 議題 | 決議 |
|---|---|---|
| **R1** | 非里程碑的 pending 骨架仍可能自動 promote | **一併收緊**（2026-07-28 拍板）。Q2 原只處理 `merge`/`release`，但 `commit_range`/`branch` 骨架若 `importance ≥ promoteImportanceThreshold`（預設 0.7）仍會在 sync 時自動進語料。改為 `status === 'pending'` 一律擋下，`isPromotable` 反而更簡單：里程碑規則回歸無條件（只是前提改成必須已 enriched） |

收緊後的 `isPromotable`：

```ts
if (summary.status === 'pending') return false          // ← R1：一切未增強者皆擋
if (type === 'merge' || type === 'release') return true
if (summary.importance >= threshold) return true
return decisions.length > 0 || known_limitations.length > 0 || risks.length > 0
```

## Timeline

| 日期 | 事件 |
|---|---|
| 2026-07-28 | 於 Memoria 與一個外部私有 repo 實跑 v1 全鏈路，取得三項可用性發現 |
| 2026-07-28 | 對照原始碼查證三項發現；修正發現 3 的定性（機制已存在，屬預設值/文件缺口） |
| 2026-07-28 | 建立 issue 文件（README + implementation-plan） |
| 2026-07-28 | Q1–Q3 拍板（全數採建議方案），Phase 1–3 實作完成並通過 e2e |
| 2026-07-28 | R1 拍板一併收緊：pending 骨架一律不自動 promote，不分型別與 importance |

## Changelog

- 2026-07-28: 初版建立。三項發現皆附實測數據與原始碼行號；Q1–Q3 待拍板。
- 2026-07-28: Q1–Q3 定案並完成 Phase 1–3。實作過程修正兩處分析：(a) 發現 2 的觸發路徑是 `repo sync` 自動 promote 而非 `--promote`（後者為刻意繞過的設計），連帶取消原 Task 2.2；(b) Phase 3 查證後 adapter 已全數帶 `project`，範圍縮為純文件。新增殘留待決 R1。
- 2026-07-28: R1 一併收緊並補測（`no skeleton auto-promoted`、`every skeleton is still pending`、`high-importance skeleton not promoted either`）。全數待決事項清空。

---
**建立日期**: 2026-07-28
**最後更新**: 2026-07-28
**文件版本**: 2.1
**狀態**: **實作完成**（Phase 1–3 + R1 全數交付，無待決事項）
**分級**: Medium
