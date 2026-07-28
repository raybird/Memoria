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

| Task | 產出 | 完成判準 | 狀態 |
|---|---|---|---|
| 1.1 | `buildRangeContext` 新增選用 `options?: SummaryContextOptions`（`includeDiff` 覆寫 config） | 既有兩個呼叫者不傳 options，行為不變 | ✅ |
| 1.2 | `repoPendingSummaries(ref, options)` 接受 `{ includeDiff?, limit? }`，預設 `includeDiff=false`、`limit=20` | 常數 `DEFAULT_PENDING_SUMMARY_LIMIT` 取代寫死的 20 | ✅ |
| 1.3 | CLI `--with-diff`、`--limit <n>`；順手抽 `parsePositiveInt` 與既有 `--history-limit` 共用 | 錯誤訊息格式不變 | ✅ |
| 1.4 | HTTP `?with_diff=true&limit=n`；SDK `repoPendingSummaries(ref, opts)` | 非法 `limit` 回 400 | ✅ |
| 1.5 | `scripts/test-repo-summary.sh` 補測：預設不含 diff、`--with-diff` 含、`--limit` 生效、payload 確實變小 | 腳本通過 | ✅ |
| 1.6 | 文件：`AGENTS.md` 端點表、`docs/OPERATIONS.md` payload 體積說明 | 文件與實作一致 | ✅ |

**驗收結果**：line-oa-plus `099394f..a0790ad` range，`104,392 → 2,412 bytes`（**減 97.7%**）。`commits` / `changed_files` / `diffstat` 三欄位逐位元不變，僅 `diff`（61,672 bytes）移除。

> **實作發現（安全性）**：`test-repo-summary.sh` 的 secret 遮罩斷言是靠掃描 context 內是否出現 `sk-live...`。diff 改為預設不含之後，該斷言會**空過**（沒有 diff 就必然掃不到）。已將該段改為明確使用 `--with-diff`，並補一條 `--with-diff carries a diff` 前置斷言，確保遮罩邏輯真的被執行到。

### Phase 2 — promotion 品質把關

**前置**：README Q2 需先拍板（擋掉 vs 降權）。

| Task | 產出 | 完成判準 | 狀態 |
|---|---|---|---|
| 2.1 | `isPromotable`：`merge`/`release` 改為 `return summary.status !== 'pending'` | 純骨架不再無條件通過 | ✅ |
| 2.2 | ~~逃生口 `--promote --force`~~ | — | ❌ **取消**：查證後 `--promote` 走 `promoteEligible(force=true)`，本來就繞過 `isPromotable`，逃生口已存在。連帶避開 `--force` 一詞兩義的風險 |
| 2.3 | 已 promote 的資料不回溯處理 | `promotionExists` 冪等性不受影響 | ✅ |
| 2.4 | `scripts/test-repo-promotion.sh` 改寫：骨架 merge/release 不進語料、enriched 後可進、`--promote` 仍可強推 | 腳本通過 | ✅ |
| 2.5 | `CHANGELOG.md` 的 `[Unreleased] / Changed` 記錄行為收緊 | 條目說明何時不再自動 promote | ✅ |

> **實作發現**：舊行為有測試明文覆蓋（`merge summary auto-promoted (§7.6 merge rule)`），改動後該斷言如預期變紅並已改寫為新契約。這確認舊行為是刻意設計而非疏漏，故本次屬**契約變更**。
>
> 另：`./cli` 優先使用 `dist/cli.mjs`，改完 core 未重建就跑 e2e 會測到舊 bundle（本次踩過一次，測試假性全綠）。**改 core 後務必先 `pnpm run build` 再跑 `scripts/test-*.sh`。**

**驗收**：重跑 v1.20.0 release 骨架 → 不進語料；`--submit` 增強後 → 進語料。

### Phase 3 — 跨 repo scope 預設值與文件（範圍最小，可能無程式碼）

**前置**：README Q3 拍板；若選 (a) 則本 Phase 僅文件與 adapter 預設值。

| Task | 產出 | 完成判準 | 狀態 |
|---|---|---|---|
| 3.1 | 查證各 adapter 呼叫 `recall` 時是否帶 `project` | — | ✅ **無需改動**：`BaseAdapter.recallForContext`（`adapter.ts:128-131`）與 `stdin-hook-adapter.ts:96` 都已帶，預設值 `config.project ?? 'default'` |
| 3.2 | 文件：`docs/OPERATIONS.md` §Scope Filtering 與 `AGENTS.md`，附實測對照（未帶 project 時無關 repo 決策以 0.383 進前五；帶了則正確決策 0.936） | 文件可讓呼叫端一眼看懂為何要帶 | ✅ |
| 3.3 | （Q3 選 (b) 時才做）新增 `repository` filter | — | ❌ 未採用 |

**驗收**：Phase 3 最終為純文件變更，零程式碼改動——與 Q3 拍板一致。

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
