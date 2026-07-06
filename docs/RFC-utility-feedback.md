# RFC: Recall Utility Feedback Loop（召回效用回饋迴路）

- 狀態：`phase-2-shipped` — Phase 0 spike 通過（§14）；Phase 1 MVP 已實作（recall_id + Migration 6 + recordRecallOutcome + `POST /v1/recall/:id/outcome` + SDK + adapter 預設回報，全程 fail-open）；Phase 2 校準呈現已實作（confidence×utility 分桶，呈現在 `memoria stats` 與 `GET /v1/telemetry/recall`，純加法、不改 confidence）。下一步 = Phase 3（需先累積真實資料）。
- 建立：2026-07-03
- 更新：2026-07-06
- Roadmap anchor：`RFC.md` → Candidate Direction #8（*Memory-quality guardrails — score hygiene*），兼及 #5（*Additional observability*）。
- 上游動機：[記憶機制評估](memory-mechanism-assessment.md) 缺點 #2（no utility signal）與 #3（confidence 過度信任）。
- 範圍：讓「第 N 回合注入的記憶」與「第 N+1 回合的實際結果」建立關聯,把召回從**只會發生**變成**會被評分**。不引入任何新 runtime 依賴、不碰 embedding。

## 1. Motivation（動機）

今天整條召回鏈是**開環的**:`recall()` 產生命中、注入 prompt,然後就結束了。telemetry(`recall_telemetry`)記了 `route_mode` / `hit_count` / `latency_ms` / `top_confidence`,但**沒有任何一格記錄「這次召回到底有沒有幫上忙」**。

後果有二:

1. **`confidence` 無從校準。** 目前 `confidence = hits[0].relevance ?? hits[0].score`(`src/core/memoria.ts:456`),純粹是字面 relevance。一個字面高度重合但語意不相關的命中會回報高 confidence,而系統永遠不知道自己錯了。
2. **召回品質無法自我改進,也無法被客觀評比。** 沒有效用訊號,就沒有標尺:未來語意召回([RFC-semantic-recall.md](RFC-semantic-recall.md))上線那天,**無法證明它比字面召回更好**。

本 RFC 補上這條迴路:為每次 `recall()` 產生一個可關聯的 `recall_id`,讓下游在下一回合把「觀測到的效用」寫回,累積成一份可校準、可評比的資料。

**關鍵前提:不需要 embedding。** 效用訊號來自最務實的來源——「注入的記憶,是否在後續回合被字面沿用(lexical reuse)」——重用既有的 `tokenCoverage` 字面重疊機制即可。這是弱訊號、是 proxy,但它現在就能做,且是通往一切後續(校準、retention、語意評比)的第一塊地基。

## 2. Design Principles（設計原則）

1. **純加法、零預設成本。** `recall()` 只多回一個 `meta.recall_id`;不傳/不回報 outcome 的呼叫者行為**完全不變**。這是硬約束,不是偏好——`recall()` 的 upstream blast radius 是 **CRITICAL**(7 個 symbol、5 條 execution flow:`/v1/recall`、`fileQuery`、wiki `file-query`、CLI `run`、`setup`)。唯一安全的改法是讓每一條既有分支 byte-identical。

2. **觀測與召回解耦、非同步、fail-open。** outcome 在**下一個回合、另一個 process**才產生。它透過既有的 `hook-state.ts`(跨 process 磁碟狀態,已用於 prompt buffering)關聯,經一個新的 endpoint 寫回。全鏈路任一步失敗都靜默降級,絕不干擾 agent loop。

3. **先觀測、後行動。** 本 RFC 的 MVP(Phase 1–2)**只記錄與呈現**效用,不改變任何排序或保留邏輯。「用效用去調整 ranking / prune」是 Phase 3,且必須在累積足夠資料、確認訊號可信後才做。避免用一個未經驗證的弱訊號污染既有可預測行為。

4. **proxy 訊號要誠實標註。** lexical reuse ≠ 因果有用。它是廉價 proxy;更高保真的「明確回饋」(host 直接標註有用/無用)留作 Phase 3 的獨立訊號來源。資料表用 `outcome_kind` 區分訊號種類,永不混為一談。

## 3. Data Flow（資料流）

```
回合 N ─ inject
  │  recall({query}) → hits[] + meta.recall_id = "rt_abc"
  │  adapter 緩衝到 hook-state:
  │    pendingRecall = { recallId:"rt_abc", at:N, hits:[{id,snippet,confidence}] }
  ▼
回合 N+1 ─ 下一個 inject / stop（另一個 process）
  │  讀回 pendingRecall
  │  reuseScore = max over hits of tokenCoverage(hit.snippet, 本回合 user+assistant 文本)
  │  POST /v1/recall/rt_abc/outcome { signal:'reuse', utility_score:reuseScore }
  │    → UPDATE recall_telemetry SET utility_score=?, outcome_kind='reuse', observed_at=? WHERE id='rt_abc'
  │  清掉 pendingRecall
  ▼
離線 ─ stats / calibration
     依 confidence 分桶,對每桶取平均 utility_score → 一條校準曲線
```

Baseline 保證:pendingRecall 不存在、endpoint 逾時、或 outcome 從未送達,`recall_telemetry` 那一列就只是**沒有 utility 而已**——所有既有查詢與行為不受影響。

## 4. Components and Change Points（元件與變更點）

| 檔案 | 動作 | 內容 |
|------|------|------|
| `src/core/db/telemetry.ts` `logRecallTelemetry` | edit（回傳值) | 現在生成 `id` 卻不回傳(`:38`)。改為 `return id`,讓 `recall()` 能拿到並塞進 meta。既有呼叫者忽略回傳值即可,無破壞。 |
| `src/core/memoria.ts` `recall()` | edit（加 meta 欄位) | 接住 `logRecallTelemetry` 回傳的 id,成功分支的 `meta` 加 `recall_id`(`:448`)。skipped / db-missing / error 分支不加(那些沒有可關聯的召回)。既有分支值 byte-identical。 |
| `src/core/db/schema.ts` | edit（Migration 6) | `recall_telemetry_add_utility`:guarded `ALTER TABLE recall_telemetry ADD COLUMN utility_score REAL / outcome_kind TEXT / observed_at DATETIME`,沿用 Migration 5 的 `PRAGMA table_info` 守衛樣式(`:120`)。 |
| `src/core/db/telemetry.ts` `recordRecallOutcome` | **new** | `recordRecallOutcome(dbPath, recallId, { signal, utilityScore, used })`:`UPDATE recall_telemetry SET utility_score=?, outcome_kind=?, observed_at=? WHERE id=?`。找不到 id → no-op(fail-open)。 |
| `src/server.ts` | edit（新 route) | `POST /v1/recall/:id/outcome`:沿用既有 `readValidatedBody` + Zod(`.passthrough()`)樣式,validate `{ signal, utility_score?, used? }` → `recordRecallOutcome`。回 `MemoriaResult`。 |
| `src/sdk.ts` `MemoriaClient` | edit（新方法) | `recordRecallOutcome(recallId, outcome)`:POST 上述 endpoint,fail-open 回 `{ ok:false }` 而非 throw。 |
| `src/adapter/hook-state.ts` | edit（狀態欄位) | `ConversationState` 加 `pendingRecall?: { recallId:string; at:number; hits:{ id:string; snippet:string; confidence:number }[] }`。 |
| `src/adapter/adapter.ts` / `stdin-hook-adapter.ts` | edit（生產訊號) | `recallForContext` 已有 `hits` 與(將有的)`recall_id`;`handleInject` 緩衝 pendingRecall;`handleStop`(與下一個 `handleInject`)讀回、算 reuseScore、POST outcome、清緩衝。全程 fail-open。 |
| `src/core/db/recall.ts` `tokenCoverage` | reuse（可能導出) | 既有 decay-free 字面重疊函式,拿來當 reuse scorer。若目前非 export,提升為模組導出;演算法不動。 |
| `src/core/types.ts` | edit（additive) | `RecallMeta` 加 `recall_id?: string`;`RecallTelemetryPoint` 加 `utility_score?` / `outcome_kind?` / `observed_at?`;`StatsData.recallRouting` 加校準彙總(見 §5b)。 |
| `scripts/test-migrations.sh` | edit | 降級 DB(移除 Migration 6 三欄 + 刪 migration 列),assert 重新套用、既有資料完好、冪等。 |
| `scripts/test-http-api.sh` | edit | `POST /v1/recall/:id/outcome` 契約 + malformed body 400。 |
| `scripts/test-{codex,claude-code}-adapter.sh` | edit | 端到端:inject → stop → assert `recall_telemetry` 該列有了 `utility_score`。 |

## 5. Key Algorithms（關鍵演算法）

### 5a. Reuse 訊號(無 embedding)

```
reuseScore(pendingRecall, turnText) =
    max_{hit ∈ pendingRecall.hits}  tokenCoverage(hit.snippet, turnText)
```

- `turnText` = 下一回合的 `user + assistant` 文本(在 adapter 的 Stop / 下一個 inject 手上就有)。
- `tokenCoverage` 是既有 decay-free 字面 token 重疊 [0,1],已在 `recall.ts` 用於 confidence,直接重用——**不新增評分邏輯,不引入依賴**。
- 取 `max` 而非平均:只要**任一**注入命中被沿用,這次召回就算「有用」。
- 誠實揭露:這是「字面被沿用」的 proxy,不是「因果有用」。它會漏掉「讀了但改寫」的情形(false negative),偏保守——這正是 Phase 0 要量的東西(§10)。

### 5b. Confidence 校準曲線(離線,Phase 2)

只在有 `utility_score` 的列上計算(其餘列略過):

```
把有 outcome 的列依 top_confidence 分成 N 桶(如十分位)
每桶輸出:count、mean(top_confidence)、mean(utility_score)
理想校準:mean(utility) 隨 mean(confidence) 單調上升
```

若曲線平坦或反向 → 證實 confidence 未反映真實效用(評估文件缺點 #3 被量化證實),為未來重新定義 confidence 提供根據。呈現在 `memoria stats` 與 `GET /v1/telemetry/recall`,**不自動改動 confidence 計算**。

## 6. Gating / Degradation Matrix（降級矩陣）

| 條件 | 行為 |
|------|------|
| 呼叫者不看 `recall_id` / 不回報 | 一切照舊,該列無 utility(絕大多數 SDK/HTTP 直接呼叫屬此) |
| `hook-state` 無 pendingRecall(冷啟、跨機) | 該回合不產生 outcome;無害 |
| outcome endpoint 逾時 / server 離線 | adapter 靜默略過(fail-open),不影響 agent |
| `recallId` 在 DB 找不到(已被 prune) | `recordRecallOutcome` no-op |
| Migration 6 尚未套用(舊 DB) | `recall_id` 照樣回傳,只是 outcome 寫不進去;`initDatabase` 下次會補上欄位 |
| reuseScore 演算法變更 | 只影響**新**寫入的 outcome;歷史列不動,`outcome_kind` 保留來源辨識 |

新增環境變數:`MEMORIA_UTILITY_SHADOW`(僅 Phase 0 spike 用,見 §10)。Phase 1 之後效用觀測預設開啟但完全 fail-open,無需開關;若需關閉,沿用 adapter 既有 `failOpen` 精神再議。

## 7. Latency / Fail-open Strategy（延遲與失效策略）

- `recall()` 熱路徑**零新增成本**:只多回一個已存在的字串 id。
- outcome 的計算(tokenCoverage)與寫回發生在 Stop / 下一回合,**不在使用者等待的召回路徑上**。
- outcome POST 對 adapter 設短逾時(沿用 client 既有逾時),失敗即棄。
- 這條迴路整體是「best-effort 觀測」,與 `hook-state.ts` 現有的 prompt buffering 同一哲學:壞了頂多少一筆資料,永不擋 agent。

## 8. Risks and Compatibility（風險與相容性）

| 風險 | 緩解 |
|------|------|
| `recall()` 是 CRITICAL blast radius(7 symbol / 5 flow) | 純加法:只在成功分支 meta 多一個 `recall_id`;其餘分支與所有既有欄位 byte-identical。commit 前跑 `gitnexus_detect_changes` 確認影響面。 |
| reuse 是弱/雜訊訊號,可能被誤當真值 | Phase 0 先量鑑別力(§10)才准進 Phase 1;MVP 只記錄不行動;任何決策都在**聚合**上做,絕不憑單筆 outcome。 |
| lexical reuse 漏掉「讀了但改寫」 | 已知 false-negative,偏保守;Phase 3 的明確回饋(`outcome_kind='explicit'`)作為高保真補充。 |
| 跨 process 關聯遺失(pendingRecall 對不上) | 沿用 `hook-state.ts` 既驗證過的磁碟關聯機制;對不上就當沒這筆,無害。 |
| 隱私 | 只存 `utility_score`(數字)、`outcome_kind`、hit id;**不存原始 turn 文本**,與既有 `query_hash` 的隱私立場一致。 |
| 非 adapter 呼叫者無 outcome | 預期內:utility 只在有標註的列上統計,分母排除未標註列(與 `zeroHitRate` 只算 non-skipped 同精神)。 |
| Migration 相容 | guarded ALTER,舊 DB 可讀;`test-migrations.sh` 覆蓋 backfill 與冪等。 |

## 9. Test Plan（測試計畫）

1. **關聯**:呼叫 `recall()` → `meta.recall_id` 非空;`POST /v1/recall/:id/outcome` → 該列 `utility_score` 寫入、`GET /v1/telemetry/recall` 讀得到。
2. **Reuse 端到端**(adapter e2e):inject 注入一筆可辨識記憶 → 下一回合 turn 文本含該記憶片段 → assert 該 `recall_id` 的 `utility_score` 明顯 > 0;turn 文本完全無關 → assert 接近 0。
3. **Fail-open**:server 離線時 POST outcome → adapter 不 throw、agent 流程不受影響;未知 `recallId` → endpoint no-op、回 `ok:true`。
4. **Migration**:`test-migrations.sh` 降級後重套 Migration 6,資料完好、冪等。
5. `pnpm run check` + `build` + `node dist/cli.mjs --help`;touched shell script 過 `bash -n`;commit 前 `gitnexus_detect_changes`。

## 10. Phased Delivery（分階段交付 / 分提示規劃）

每個 Phase 都是一個**可獨立 implement → verify → commit → release** 的單元,沿用本 session 的節奏。前一階段的 gate 未過,不進下一階段。

### Phase 0 — Spike：reuse 訊號可觀測且有鑑別力嗎？（~0.5d，不 ship）

- **提示**:在 adapter 加一段 shadow log,只受 `MEMORIA_UTILITY_SHADOW` 開啟;inject 時緩衝注入命中,下一回合用 `tokenCoverage` 算 reuseScore,把 `{recallId, top_confidence, reuseScore}` append 成 JSONL。**不動 schema、不動 recall()、不 ship。**
- **驗證**:跑既有 adapter e2e + 一段真實短對話,眼看 reuseScore 是否**非退化**:有些接近 0、有些明顯高,且與 confidence 至少有微弱正相關。
- **Gate**:若每筆都 ≈0(記憶從不被字面沿用)或都 ≈1(什麼都瑣碎重疊)→ **停,重設計訊號**(例如改用「下一輪 user prompt 是否延續主題」)。這一步就是「先驗證再建造」,對映語意 RFC 那次省下 1.5 天的 Phase 0。

### Phase 1 — MVP：關聯 + 持久化 + 單一生產者（~1–1.5d，ship）✅ 已完成 2026-07-06

- **提示**:`logRecallTelemetry` 回傳 id → `recall()` meta 加 `recall_id` → Migration 6 三欄 → `recordRecallOutcome` + `POST /v1/recall/:id/outcome`(Zod)→ SDK 方法 → adapter 緩衝 pendingRecall 並在下一回合 POST reuse outcome。全程 fail-open。
- **測試**:§9 的 1/2/3/4;擴 `test-migrations.sh` 與一支 adapter e2e。
- **DoD**:見 §12。這一版**只記錄,不改任何排序/保留**。
- **交付紀錄**:recall() 對成功分支純加 `recall_id`（前後 envelope 逐欄位比對確認：僅此一欄新增，skip/error 分支 byte-identical）。adapter 回報**預設開啟、fail-open**（`MEMORIA_UTILITY_SHADOW` 降級為可選 JSONL debug）；reuse 用 assistant-only（Phase 0 §14 決）。持久化採就地 UPDATE 三欄。測試：`test-http-api.sh`（outcome 契約+400+no-op）、`test-migrations.sh`（Migration 6 降級/重套）、`test-utility-shadow.sh`（write-back 鑑別力）。

### Phase 2 — Calibration：把效用呈現出來（~0.5–1d，ship）✅ 已完成 2026-07-06

- **提示**:`queryStats` / `queryRecallTelemetry` 加 §5b 的 confidence×utility 分桶校準;呈現在 `memoria stats` 與 `GET /v1/telemetry/recall`(或新 `/v1/telemetry/recall/calibration`)。
- **價值**:直接兌現評估文件缺點 #3——**你第一次能「看見」confidence 誠不誠實**。仍不自動改 confidence。
- **交付紀錄**:純函式 `buildCalibration`（`src/core/utils.ts`,無 better-sqlite3 依賴）依 `top_confidence` 分 4 桶（[0,1] 等寬）,對每桶算 `count`/`meanConfidence`/`meanUtility`,並判 `meanUtility` 是否隨 confidence 單調上升（`monotonic`）。只納入同時具 `top_confidence` 與 `utility_score` 的列;**無 scored 列時 `calibration` 欄位完全不出現**（純加法,既有輸出 byte-identical,已驗證）。呈現於 `StatsData.recallRouting.calibration` 與 `RecallTelemetryData.calibration`,`memoria stats` 文字輸出與 `GET /v1/stats`、`GET /v1/telemetry/recall` 皆帶出。測試:`test-http-api.sh` 斷言 outcome 寫回後兩端點皆出現 calibration 且桶形狀正確。實測捕捉到「高 confidence 桶效用反而較低 → monotonic=false」,證實訊號可揭露 confidence 未反映真實效用。

### Phase 3 — Act on utility：讓效用開始作用（later，需先有資料）

- **提示(擇一漸進)**:(a) 明確回饋 API(`outcome_kind='explicit'`,host 直接標註)作為高保真訊號;(b) 把聚合 utility 餵進 ranking(持續被忽略的記憶降權)與 prune(**utility-weighted retention**,對映評估文件缺點 #4 的 importance-based forgetting)。
- **前置**:必須累積足夠 Phase 2 資料、校準曲線可信才動;每項都在聚合上、可回退。
- **戰略收益**:此時本迴路正式成為 [RFC-semantic-recall.md](RFC-semantic-recall.md) 的**評測靶場**——用 utility uplift 客觀量測「語意召回是否勝過字面」,解掉語意 RFC「上線卻無法證明更好」的死結。

## 11. Open Decisions（待決事項）

1. **持久化形狀**:MVP 採「就地 `UPDATE recall_telemetry` 三欄」(推薦,最省、stats 直接 join);若日後單次召回需承載多種/多次回饋,再升級為 append-only `recall_feedback(recall_id, ...)` 表。此為可延後決定,不擋 Phase 1。
2. ~~**reuse `turnText` 範圍**~~ **[Phase 0 已決]**:用 **assistant-only**。Phase 0 實測顯示含 user prompt 的 `reuseScoreFull` 會被「query→recall 匹配」污染而退化(§14),assistant-only 才有鑑別力。
3. ~~**outcome 觸發點**~~ **[Phase 0 已決]**:在 `handleStop`(對 SDK 路徑即 `afterResponse`)算,turnText 用當回合 assistant 回覆。既然決策 2 選 assistant-only,就不需延到下一個 `handleInject`。
4. **confidence 是否最終重定義**:Phase 2 只呈現;是否用 utility 重新定義 `confidence` 留給資料說話,不在本 RFC 承諾。
5. **[Phase 0 新增] 停用詞底噪**:Phase 0 觀察到無關回覆仍有 ~0.14 的底噪(單一停用詞如 "the" 重疊)。Phase 1 可考慮對 `tokenCoverage` 的 reuse 用途過濾停用詞以壓低 floor;非阻擋項,聚合統計時也可用相對門檻吸收。

## 12. Definition of Done（完成定義,適用每個 ship 的 Phase）

1. `pnpm run check` 通過。
2. `pnpm run build` 成功且 `node dist/cli.mjs --help` 可跑。
3. 相關 `scripts/test-*.sh` 通過(至少 smoke + migrations + http-api + 一支 adapter e2e)。
4. 觸及的 shell script 過 `bash -n`。
5. CLI flag / 輸出與既有 UX 一致;新 endpoint 於 README 記載。
6. commit 前 `gitnexus_detect_changes` 確認影響面僅限預期 symbol。

## 13. 與語意召回 RFC 的關係

兩份 RFC 互補、且有明確先後:

- [RFC-semantic-recall.md](RFC-semantic-recall.md) 解「**召回得更準**」(語意),但 `blocked` 於 embedding-backend 決策,受外部依賴牽制。
- 本 RFC 解「**知道召回準不準**」(效用),**不被 blocked**、現在就能做,且是前者的**驗收標尺**。

理性順序:**先做本 RFC(建立標尺),再解語意 RFC(有標尺可證明其價值)**。沒有效用迴路,語意召回上線那天將無法客觀證明它比現有字面召回更好——這正是本 RFC 存在的戰略理由。

## 14. Phase 0 Spike 結果（2026-07-06）

**結論:Gate 通過。reuse 訊號非退化、具鑑別力,可進 Phase 1。**

### 做法

- 新增 `src/adapter/utility-shadow.ts`(僅 `MEMORIA_UTILITY_SHADOW=<jsonl 路徑>` 開啟,預設完全休眠、fail-open)。
- `recallForContext` inject 時把命中緩衝到 `hook-state` 的 `pendingRecall`;`handleStop` / `afterResponse` 用既有 `tokenCoverage` 算 reuseScore,append 一筆 JSONL。
- **未動 `recall()`、schema、或任何 shipped 行為**;`tokenCoverage` 由 `recall.ts` 提升到 `utils.ts`(純函式,讓 adapter 不必拉入 better-sqlite3,演算法不動)。

### 觀測(同一筆記憶注入,四種 assistant 回覆)

| 回覆型態 | reuseScore(assistant-only) | reuseScoreFull(user+assistant) |
|----------|---------------------------|-------------------------------|
| 高度重用 | **0.929** | 0.929 |
| 完全無關 | **0.143** | 0.667 |
| 部分重用 | **0.333** | 0.667 |
| 改寫重用 | **0.500** | 0.667 |

### 判讀

1. **assistant-only reuseScore 非退化**:0.14 / 0.33 / 0.50 / 0.93,spread 0.79,hi/mid/lo 三桶皆有 → **有鑑別力,Gate 通過**。
2. **`reuseScoreFull` 退化**:除高度重用外三筆全 0.667——因 user prompt 本就是召回的匹配依據,算進去等於自我實現。**故 Phase 1 用 assistant-only**(解 §11 決策 2/3)。
3. **停用詞底噪**:無關回覆 0.143 來自單一 "the" 重疊 → §11 新增決策 5。
4. confidence×utility 相關性樣本太小無法評(top_confidence 多為 0.333);那是 Phase 2 用真實資料量的事,不在 Phase 0 範圍。

### 固化

- `scripts/test-utility-shadow.sh`(掛 CI adapters 組):斷言重用回覆 reuseScore>0.6、無關 <0.4、gap>0.3,且 env 未設時完全不寫檔。防止 instrumentation 在 Phase 1 用到前 bitrot。
