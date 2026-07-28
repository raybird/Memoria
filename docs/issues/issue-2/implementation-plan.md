# Issue 2 — 實作計畫

- 建立：2026-07-28
- 對應：[README.md](README.md)
- 分級：Medium（分析概要併入本文件前置章節，不另出 requirement/technical analysis）

---

## 0. 分析概要

### 現況鏈路

```
repo add ─→ repo sync ─→ summarize --branch/--range/--merge/--tag
                              │
                              ├─ deterministic 骨架（status='pending', confidence=0.4,
                              │   decisions/known_limitations/risks 皆空）
                              │
                              ├─ --pending ──→ host agent 讀 context ──→ --submit
                              │                                          （status='enriched'）
                              └─ --promote ──→ synthetic session + DecisionMade events → FTS
                                               memory_sources 存 SHA 溯源
                                               recall hit 附 source
```

### 三個缺口的程式碼落點

| # | 缺口 | 落點 | 現況 |
|---|---|---|---|
| 1 | context payload 過大 | `src/core/git/summary-context.ts:98-126`（diff 組裝）、`src/core/memoria.ts:880-892`（一次最多 20 筆） | `git.summarization.includeDiff` 已存在（`src/core/config.ts:22`）但只有 config 層級，無 per-invocation 控制；`maxDiffBytes` 預設 200_000（`config.ts:23`） |
| 2 | 骨架也 promote | `src/core/db/git-promote.ts:32-36` | `merge`/`release` 無條件放行，不看 `status` |
| 3 | 跨 repo 混排 | `src/core/types.ts:206`、`src/core/db/recall.ts:418-428`、`src/core/db/git-promote.ts:67` | 機制已完備且實測有效，缺的是呼叫端預設值與文件 |

### 關鍵判斷

- **三項皆不需 schema 變更**，因此不涉及 migration，`initDatabase()` 不動。
- **三個 Phase 無依賴**，可任意順序、各自獨立 commit 與回滾。
- Phase 3 範圍極小且可能只是文件工作，**不應為了「湊成三件」而擴大**（見 README Q3）。

---

## 1. 實作步驟

> 排序原則：先做「痛點最大且獨立可出貨」者。Phase 1 直接解除自動化回寫的阻塞，優先。
> 每個 Phase 完成即獨立 commit，DoD 見 §3。

### Phase 1 — `--pending` context 分級（阻塞自動化回寫，優先）

**前置**：README Q1 需先拍板（預設 opt-out 或 opt-in）。

| Task | 產出 | 完成判準 |
|---|---|---|
| 1.1 | `SummaryContext` 組裝支援分級：`buildRangeContext` 新增 `level` 參數（`minimal` = commits + changed_files + diffstat；`full` = 現行含 diff） | `pnpm run check` 過；`level='full'` 的輸出與改動前**逐欄位一致** |
| 1.2 | `repoPendingSummaries(ref, options)` 接受 `{ contextLevel?, limit? }`，預設值依 Q1 拍板結果 | 既有無參數呼叫的行為符合 Q1 決議；`limit` 可覆寫現行寫死的 20 |
| 1.3 | CLI `repo summarize --pending` 新增對應旗標（命名依 Q1：`--no-diff` 或 `--with-diff`），`--limit <n>` | `memoria repo summarize <repo> --pending --help` 顯示新旗標；命令名與既有子命令名不變 |
| 1.4 | HTTP `GET/POST /v1/repos/:ref/summaries` 對應查詢參數，Zod 驗證於邊界 | 畸形參數回 400 而非 500 |
| 1.5 | `scripts/test-repo-summary.sh` 補測：minimal 層級不含 `diff` 欄位、full 層級含且與舊行為一致 | 腳本通過；`bash -n` 過 |
| 1.6 | 文件：`AGENTS.md` 的 `repo summarize` 段落、`docs/OPERATIONS.md` 補 payload 體積與分級建議 | 文件所述旗標與實作一致 |

**驗收**：對 line-oa-plus `#112` branch 取 minimal context，payload 從 140 KB 降到 5 KB 量級（`diff` 88 KB 移除、其餘欄位不變）。

### Phase 2 — promotion 品質把關

**前置**：README Q2 需先拍板（擋掉 vs 降權）。

| Task | 產出 | 完成判準 |
|---|---|---|
| 2.1 | `isPromotable` 判準納入 `status`：未 enriched 的 `merge`/`release` 依 Q2 決議擋掉或降權 | 純骨架（`decisions=[]` 且 `status='pending'`）不再無條件通過 |
| 2.2 | 逃生口：`repo summarize --promote --force` 可略過新判準 | 既有 `--force`（現為略過 trivial filter）語意擴充需在 `--help` 與文件寫清楚，避免一詞兩義 |
| 2.3 | 已 promote 的資料不回溯處理 | 既有 `memory_sources` 列數不變（`promotionExists` 冪等性不受影響） |
| 2.4 | `scripts/test-repo-promotion.sh` 補測：骨架 release 不進語料、enriched 後可進、`--force` 可強推 | 腳本通過 |
| 2.5 | `CHANGELOG.md` 的 `[Unreleased] / Changed` 記錄行為收緊 | 條目說明「什麼情況下不再自動 promote」 |

**驗收**：重跑 v1.20.0 release 骨架 → 不進語料；`--submit` 增強後 → 進語料。

### Phase 3 — 跨 repo scope 預設值與文件（範圍最小，可能無程式碼）

**前置**：README Q3 拍板；若選 (a) 則本 Phase 僅文件與 adapter 預設值。

| Task | 產出 | 完成判準 |
|---|---|---|
| 3.1 | 查證各 adapter 呼叫 `recall` 時是否帶 `project`，未帶者補上 | `src/adapter/` 下所有呼叫點明確帶 `project` 或明確記錄「刻意不帶」的理由 |
| 3.2 | 文件：`AGENTS.md` recall 段落與 `README*.md` 明載「多 repository 情境務必帶 `project`」，附本 issue 的實測對照（0.383 混入 vs 帶 project 後 top-1 0.936） | 文件可讓呼叫端一眼看懂為何要帶 |
| 3.3 | （僅當 Q3 選 (b)）新增 `repository` filter | — |

**驗收**：文件更新後，同一組查詢在帶／不帶 `project` 的差異有據可查。

---

## 2. 測試策略

沿用本 repo 慣例：**不引入 unit test framework**，全部以 `scripts/test-*.sh` 端到端驗證。

- Phase 1 → `scripts/test-repo-summary.sh`
- Phase 2 → `scripts/test-repo-promotion.sh`
- Phase 3 → 若無程式碼變更則不需新測試；若選 (b) 則 `scripts/test-repo-promotion.sh` 補 filter 案例
- 三個 Phase 都不觸及非侵入性契約，但合併前仍應跑一次 `scripts/test-repo-noninvasive.sh` 確認無回歸

CI 既有 `repo` 測試群組已涵蓋上述腳本，無需新增 job。

---

## 3. Definition of Done（每個 Phase 各自滿足）

1. `pnpm run check` 通過
2. `pnpm run build` 成功且 `node dist/cli.mjs --help` 可執行
3. 該 Phase 對應的 `scripts/test-repo-*.sh` 通過
4. 觸及的 shell 腳本通過 `bash -n`
5. CLI 旗標與輸出與既有 UX 一致，命令名未變
6. `CHANGELOG.md` `[Unreleased]` 有對應條目

---

## 4. 風險與緩解

| 風險 | 影響 | 緩解 |
|---|---|---|
| Q1 選 opt-in（預設不含 diff）屬破壞性變更 | 既有依賴 diff 的呼叫端拿不到資料 | 列為 `Changed` 而非 `Fixed`；於 CHANGELOG 明示遷移方式 |
| `--force` 語意從「略過 trivial filter」擴充為「略過所有 promotion 判準」 | 一詞兩義造成誤用 | 若拍板認為混淆，改用獨立旗標；`--help` 文字須明確 |
| Phase 2 收緊後既有自動化流程「靜默少東西」 | 使用者以為壞掉 | promote 被擋時輸出明確原因（非靜默略過） |

---

## 5. 不做的事（範圍外）

- 不新增資料表、不改既有欄位、不寫 migration
- 不改 `recall()` 未帶 `project` 時的既有查詢語意
- 不動 git 唯讀白名單、非侵入性契約與 `GIT_OPTIONAL_LOCKS=0`
- 不處理 RFC.md 候選方向 #10 的其他 v1.1 項目（FF-merge 推斷、session 整合、MCP `repo_*` tools、跨 process 鎖）——那些各自獨立，不併入本 issue
- 不引入 linter / formatter / test framework / runtime dependency
