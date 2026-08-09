# Issue 5: 長期記憶語意 — 衰減不分類、無取代關係、敏感度靠人守紀律

## 基本資訊

| 項目 | 內容 |
|---|---|
| Issue 編號 | 5（本地文件編號） |
| 複雜度級別 | Medium（新增 1 張側表 + 召回／保留／匯出語意擴充；**零標記時行為 byte-identical**） |
| 狀態 | **待拍板**（分析完成，Q1–Q4 見「待確認決策」） |
| 需求來源 | 2026-08-09 以「把 Memoria 當成 coding agent 的永久記憶」角度盤點記憶語意；三項缺口與 `docs/memory-mechanism-assessment.md` 的開放缺點 4／5 對應 |
| 建立日期 | 2026-08-09 |
| 前置 | [issue-4](../issue-4/README.md)（`remember` CLI 是本 issue 三個標記的唯一寫入入口，**必須先出貨**） |

## 文件清單

- [implementation-plan.md](implementation-plan.md) — 分析概要與實作計畫（3 Phase）

## 摘要

issue-4 補完介面之後，Memoria 已能被 agent 當日常記憶用。接著浮現的是**記憶語意**的三個缺口，全部只有在「長期、跨專案、含個人偏好」的真實使用下才會痛：

1. **衰減不分類**——「這週的除錯過程」和「使用者永遠用 pnpm、commit 不寫 AI 署名」套同一條 90 天半衰期。後者是**恆真事實**，衰減它是錯的。
2. **無取代關係**——先決定 A、後改用 B，兩筆都在語料裡、都會被召回，下游 agent 得自己猜哪個現行。
3. **敏感度靠人守紀律**——「私人層記憶用真實名稱、版控文件一律代稱」目前是人腦規則，系統沒有任何欄位或機制保證，一次疏忽就外洩。

本 issue 以**單一側表 `memory_attributes`**（migration 14）一次承載三者的標記，並在召回、保留、匯出三個路徑各接一個消費點。設計紀律沿用 UFL Phase 3 的既有作法：**表不存在或無標記時，所有輸出與現況 byte-identical**（`applyUtilityWeighting`，`src/core/db/recall.ts:31-49`）。

## 現況證據（2026-08-09）

### 缺口 1：時間衰減對恆真事實是錯的

`computeDecayFactor()`（`src/core/db/recall.ts:64`）對每一筆命中無差別套用 `1 / (1 + ageDays / halfLifeDays)`，`DEFAULT_DECAY_HALF_LIFE_DAYS = 90`（`src/core/db/recall.ts:11`）。一則 270 天前記下的「使用者偏好」命中，score 被壓到約 1/4——**它並沒有變得比較不真**。

`prune` 這一側同樣是純時間裁剪：consolidate 90 天、stale 180 天。`docs/memory-mechanism-assessment.md` 缺點 4 已明列「time-decay 只影響排序、不影響保留，缺一個 importance/access-weighted retention」；UFL Phase 3 已補上「高效用豁免」，但**恆真事實在被召回夠多次以前，仍可能先被 stale 裁掉**。

### 缺口 2：矛盾決策並存且無標記

`docs/memory-mechanism-assessment.md` 缺點 5 至今為開放項：「記了兩個互斥的 Decision，系統兩個都存、都可能被召回，卻沒有『B supersedes A』的關係建模」。wiki 的 comparison／synthesis 是**編譯產物**，解決不了**召回當下**的矛盾。

同時 `prune` 的去重只在裁剪階段做（`pruneSkillsDuplicates`），寫入端沒有任何「已有相似記憶」的提示——重複與矛盾都只能事後清。

### 缺口 3：敏感度沒有落點

現行紀律是「私人層記憶可用真實名稱、版控文件一律用代稱」（issue-2/issue-3 文件中的 `external-repo` 即為此規則的產物）。`exportMemory()`（`src/core/db/prune-export.ts:387`）支援 `--type` / `--format` / `--project` 等篩選，**但沒有任何欄位標示哪些內容不可外流，也沒有代稱化路徑**。匯出一份 markdown 給外部，靠的是人記得先看過一遍。

### 為什麼是一張側表

`memory_utility.ref_id` 的 id 空間就是 `RecallHit.id`（session id 或 event id），schema.ts:151 註解明載。三項標記的 key 完全相同，**沒有理由分三張表或去改既有表結構**：

| 作法 | 評估 |
|---|---|
| 在 `sessions` / `events` 加欄位 | 兩張表都要改、兩邊都要 guarded ALTER；且 events 沒有 project 欄位，語意分散 |
| 分三張表 | 三次 migration、三個 JOIN，標記彼此又常同時查 |
| **單一 `memory_attributes` 側表** | 一次 migration；與 `memory_utility` 同 key 同模式（可共用「表不存在即 fail-open」的既有紀律）；未標記的記憶完全不出現在表中 → 天然 byte-identical |

## 變更邊界

### 可修改

- `src/core/db/schema.ts` — 新增 migration **id 14**（現有最大為 13，`src/core/db/schema.ts:399`）
- `src/core/db/recall.ts` — 衰減豁免與 superseded 過濾的消費點
- `src/core/db/prune-export.ts` — retention 豁免、`exportMemory` 的 redact 路徑
- `src/core/db/` 新增 `memory-attributes.ts` — 標記的讀寫函式
- `src/cli/commands/remember.ts`（issue-4 產出）— 新增 `--durable` / `--supersedes` / `--sensitivity` 旗標
- `src/cli/commands/recall.ts`、`export.ts` — 新增對應旗標
- `src/server.ts` — `/v1/remember`、`/v1/recall` 的對應欄位
- `scripts/test-utility-ranking.sh`、`scripts/test-prune.sh`、`scripts/test-cli-memory.sh`、文件

### 禁止修改

- **不改既有 CLI 命令名與既有旗標語意**（agent 契約）
- **不改 `DEFAULT_DECAY_HALF_LIFE_DAYS` 的值**——90 天對 episodic 記憶是對的，本 issue 只加豁免，不調參數
- **不改 `prune` 的 90／180 天預設值**（CLAUDE.md 明列為契約）
- **不改既有表結構**——只新增側表；`sessions` / `events` / `memory_utility` 一律不動
- **不做自動矛盾偵測**——`supersedes` 是**明示**關係，由寫入者宣告；語意層自動判斷互斥留給日後（見「範圍外」）
- 不引入依賴

### 風險

| 風險 | 說明 | 緩解 |
|---|---|---|
| 召回排序語意變更是對外契約變更 | durable 不衰減、superseded 隱藏，都會改變既有呼叫端拿到的結果 | **零標記即 byte-identical**（沿用 `applyUtilityWeighting` 的 fail-open 紀律）；既有 DB 升級後在寫入第一個標記前輸出完全不變，並以 `test-utility-ranking.sh` 現有斷言把關 |
| durable 記憶永不衰減 → 舊資訊長期霸佔 top-k | 若誤標，錯誤會永久排在前面 | durable **只豁免時間衰減，不豁免 UFL 效用降權**——低效用仍會被壓下去，形成自我修正；且必須明示旗標，不自動推導（Q1） |
| `superseded` 隱藏導致「東西不見了」 | 使用者以為記憶被刪 | 只影響召回預設，資料一律保留；`--include-superseded` 為逃生口；`export` 預設**不套用**此過濾（匯出是稽核路徑，要看得到全貌） |
| durable 記憶被 prune stale 裁掉 | 恆真事實在累積足夠效用觀測前可能先被時間裁掉 | retention 豁免與 UFL 高效用豁免掛在同一處，一併處理（Phase 1 Task 1.4） |
| redact 代稱不穩定或可逆推 | 兩次匯出代稱不一致 → 無法比對；代稱可反推 → 遮蔽無效 | 代稱用**確定性 hash 短碼**（同一原詞跨匯出恆等）、且不含原詞任何片段；映射表**不寫入匯出檔** |
| 誤以為 `--redact` 等於安全 | 只遮明示標記者，未標記的敏感內容照樣輸出 | 匯出摘要明文列出「遮蔽 N 筆／未標記 M 筆」，文件明載這是**輔助而非保證** |

## 待確認決策

| # | 議題 | 選項 | 建議 |
|---|---|---|---|
| **Q1** | durable 的判定方式 | (a) 明示旗標 `remember --durable`；(b) 由事件類型自動推導（如 `SkillLearned` 恆為 durable） | **(a)**。自動推導會把「上週學到的某個 CLI 用法」也變成永不衰減，誤判成本高且不可見。明示旗標貴一點但可稽核 |
| **Q2** | superseded 記憶的召回預設 | (a) 預設濾掉，`--include-superseded` opt-in；(b) 預設回傳但標記 `superseded: true` 由下游決定 | **(a)**。記憶系統的價值在於給出**現行**答案；(b) 等於把矛盾原封不動丟給下游，缺點 5 沒有真正解決。`RecallHit` 仍附 `superseded_by` 欄位供追溯 |
| **Q3** | 未標記記憶的 sensitivity 預設 | (a) 視為未分類，`--redact` 不處理；(b) 視為 private，`--redact` 一律遮蔽 | **(a)**。(b) 會讓既有 DB 一開 `--redact` 就整份遮成無用；且違反「零標記即行為不變」的紀律。以匯出摘要提示未標記筆數補足 |
| **Q4** | 寫入端的相似記憶提示 | (a) 本 issue 納入（`remember` 偵測高相似既有記憶並提示 `--supersedes <id>`）；(b) 延後 | **(b) 延後**。它需要一條相似度門檻，而門檻好壞只有在語意召回累積實測資料後才判斷得準；`--supersedes` 先給明示入口即可 |

## 範圍外

- **自動矛盾偵測**（語意層判斷兩則記憶互斥）——需要語意召回的實測資料支撐，且誤判成本高。本 issue 只做明示 `supersedes`。
- **記憶可見範圍／隔離模型**（`docs/memory-mechanism-assessment.md` 缺點 8 的後半）——`sensitivity` 只影響匯出，不改召回的可見性。多租戶／多身分隔離是另一個題目。
- **代稱映射的持久化與還原**——`--redact` 是單向的匯出時處理，不提供還原路徑。

## Timeline

| 日期 | 事件 |
|---|---|
| 2026-08-09 | 盤點記憶語意三缺口，對應 assessment 開放缺點 4／5；確認可用單一側表承載且維持 byte-identical；建立 issue 文件（README + implementation-plan） |

## Changelog

- 2026-08-09: 初版建立。三項缺口皆附 `file:line` 證據與 assessment 對應；Q1–Q4 待拍板。

---
**建立日期**: 2026-08-09
**最後更新**: 2026-08-09
**文件版本**: 1.0
**狀態**: **待拍板**（前置 [issue-4](../issue-4/README.md) 未出貨前不啟動）
**分級**: Medium
