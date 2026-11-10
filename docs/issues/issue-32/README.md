# Issue 32 - 狀態類記憶附查證命令：記憶不再成為另一份會過時的狀態副本

## 文件清單
- [implementation-plan.md](./implementation-plan.md)

## 概述

2026-11-10 dev-rules-kit 詢問 issue 歷史文件與記憶對 agent 的影響。兩個下游專案的結論一致：真正讓 agent 得出錯誤結論的，幾乎都是過時的外部狀態（merge、推送、部署、平台狀態），而且同一份狀態常有好幾個副本，沒人回頭更新。

Memoria 這邊的實測（2026-11-10，本機資料根唯讀查詢）：

- 記憶標記只有 durable、supersedes、sensitivity 三種，沒有辦法標出「這是會變的狀態」，也沒有地方寫怎麼重新查證。
- 改版最多的兩則記憶都是常駐約束（durable）裡夾帶隨版本變動的快照：「語意召回 helper 裝在哪」從 2026-08-09 到 10-21 改了 6 版（其中一版數字寫錯），「向量 ingest 步驟」到 11-10 改了 4 版。durable 不衰減、不會被 prune，又每次都進 BRIEF，快照一過時就一直留在每個 session 的 context 裡。
- BRIEF 的產生時間只寫在第一行 HTML 註解。2026-11-10 在 Claude Code session 中觀察到：以 `CLAUDE.md` 的 `@` 引入的 BRIEF 從 `# Memoria Brief` 開始，前兩行註解不在 context 裡，agent 看不出這份快照是什麼時候產生的。

本 issue 讓寫入者在記一則狀態時附上查證命令。recall 與 brief 會把它顯示成「截至某日；據以行動前先跑某命令」，由 agent 自己決定要不要跑。BRIEF 正文也會顯示產生時間。

**硬性前提（使用者 2026-11-10）**：走 skill 型整合，agent 主動呼叫 CLI。不接 hooks、不裝 service，Memoria 任何時候都不執行查證命令，也不在 recall、brief 或 doctor 時自動重跑，以免與特定 agent 深度綁定。只要 agent 能執行 shell、讀得到 skill，就能使用這個能力。

## 關鍵差異

| 項目 | 變更前 | 變更後 |
|------|--------|--------|
| 記一則狀態 | 只能寫成一般決策，或誤用 `--durable` 讓它常駐 | `remember "<狀態>" --verify "<唯讀查證命令>"`，不可同時 `--durable` |
| recall 顯示 | 時間戳與標記 | 狀態類的 hit 多一行「截至 YYYY-MM-DD；據以行動前先跑：<命令>」 |
| brief 顯示 | 決策與理由 | 狀態類多一行「截至 YYYY-MM-DD；據以行動前先跑 `<命令>`」，命令完整、不截斷 |
| BRIEF 產生時間 | 只在 HTML 註解 | 正文也顯示，註解原樣保留 |
| 誰執行查證命令 | — | 只有 agent；Memoria 只存字串、只顯示 |

## 涉及檔案

```text
src/core/
├── db/schema.ts             # 可改：migration 17，memory_attributes 加查證命令欄位
├── db/memory-attributes.ts  # 可改：讀寫查證命令，recall 後處理附到 hit
├── types.ts                 # 可改：RecallHit、MemoryAttributes、brief 資料項加 verify
├── memoria.ts               # 可改：rememberNote 驗證與互斥；markMemory 拒絕對狀態類設 durable
├── db/brief.ts              # 可改：決策／環境／高效用項帶 verify；正文顯示產生時間
├── db/recall.ts             # 不可觸及：排序、衰減與 UFL 不變
├── db/prune-export.ts       # 不可觸及：prune 規則與 export 格式不變
└── db/memory-browser.ts     # 不可觸及：本機 UI 不顯示查證命令（TBD-5）
src/cli/commands/
├── remember.ts              # 可改：--verify 旗標
├── recall.ts                # 可改：人讀輸出加查證行
└── service.ts               # 不可觸及：不裝 service
src/server.ts                # 不改：/v1/recall、/v1/brief 經 core 自動帶新欄位
src/adapter/                 # 不可觸及：不接 hooks、不改任何 adapter
src/ui/                      # 不可觸及
skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md  # 可改：何時加 --verify、看到查證行要先查證
scripts/
├── test-memory-attributes.sh            # 可改：SCN-001、003～006
├── test-cli-memory.sh                   # 可改：SCN-007，brief 穩定性比對排除可見產生時間
├── test-migrations.sh                   # 可改：SCN-008
├── test-http-api.sh                     # 可改：SCN-002、SCN-006 的 HTTP 部分
└── fixtures/brief-zero-marker.golden.md # 可改：只多正文的產生時間
docs/CLI.md、docs/CLI.zh-TW.md、docs/API.md、docs/API.zh-TW.md、docs/agents/architecture.md、docs/OPERATIONS.md、AGENTS.md  # 常青文件
```

## Gherkin 驗收劇本

```gherkin
Feature: 狀態類記憶附查證命令，agent 據以行動前自己重新查證

  @SCN-001
  Scenario: recall 顯示狀態類記憶的截至日期與查證命令
    Given 一個已初始化的資料根
    When 執行 remember "demo 的 release 分支已併入 main" --project demo --verify "git log main --oneline -1"
    Then 命令成功，回傳 created: true
    When 執行 recall 查到這則記憶
    Then 該 hit 下方多一行「截至 <該記憶時間戳的日期>；據以行動前先跑：git log main --oneline -1」，命令原樣、不截斷
    And 沒有 --verify 的記憶，recall 的人讀輸出與變更前相同

  @SCN-002
  Scenario: 機器可讀出口帶查證命令
    Given SCN-001 的狀態類記憶與一則一般記憶
    When 執行 recall --json，以及 serve 下呼叫 POST /v1/recall
    Then 狀態類記憶的 hit 帶 verify 欄位，值與寫入的命令完全相同
    And 一般記憶的 hit 沒有 verify 欄位
    When 呼叫 GET /v1/brief
    Then 回傳的 markdown 與 CLI brief 一樣含查證行，對應的資料項帶 verify 欄位

  @SCN-003
  Scenario: brief 顯示截至日期與完整命令
    Given 一則帶 --verify 的決策與一則不帶的決策都在 brief 的時間窗口內
    When 執行 brief
    Then 近期決策中帶 verify 的那則下方有「截至 YYYY-MM-DD；據以行動前先跑 `<命令>`」，命令完整、不截斷
    And 不帶 verify 的那則格式與變更前相同
    And 帶 verify 的記憶出現在高效用區塊或環境紀律區塊時，同樣附上這一行
    And 資料庫沒有任何查證命令時，brief 除了正文的產生時間以外，與變更前的 golden 相同

  @SCN-004
  Scenario: 查證命令與 durable 互斥
    When 執行 remember "<文字>" --durable --verify "<命令>"
    Then 命令以非 0 結束，錯誤說明狀態類記憶不可設 durable，並建議把約束與快照拆成兩則
    And 資料庫沒有新增任何記憶或標記
    Given 一則已標 durable 的筆記
    When 用相同文字重跑 remember 並加上 --verify
    Then 命令以非 0 結束，該筆記的標記不變
    Given 一則帶查證命令的筆記
    When 執行 mark <它的 id> --durable
    Then 命令以非 0 結束，該筆記不出現在 brief 的常駐約束區

  @SCN-005
  Scenario: 無效的查證命令被拒絕
    When 執行 remember 時 --verify 為空字串、只有空白，或含換行
    Then 命令以非 0 結束，並指出 --verify 無效
    And 資料庫沒有新增任何記憶或標記

  @SCN-006
  Scenario: Memoria 不執行查證命令
    Given 查證命令為「touch <暫存目錄>/ran」
    When 用它寫入一則狀態類記憶，再依序執行 recall（keyword、hybrid、--json）、brief、doctor、stats、mark --sensitivity private
    And serve 下呼叫 POST /v1/recall 與 GET /v1/brief
    Then <暫存目錄>/ran 始終不存在

  @SCN-007
  Scenario: BRIEF 正文顯示產生時間
    When 執行 brief
    Then BRIEF.md 在 HTML 註解之外的正文含這次的產生時間，與第一行 generated-by 註解的時間相同
    And 第一行 generated-by 註解維持原格式
    And 連續兩次產生 brief，除了產生時間以外內容相同

  @SCN-008
  Scenario: 舊資料庫升級後既有標記的行為不變
    Given 以本 issue 之前的版本建立、已有 durable、superseded 與 private 標記的資料庫
    When 新版第一次開啟它
    Then 升級成功，資料庫多一筆 migration 紀錄
    And 既有標記的 recall 結果、brief 常駐約束區與 stale prune 豁免，都與升級前相同

  @SCN-009
  Scenario: 升級後的資料庫仍可被前一版讀寫
    Given SCN-008 升級後的資料庫，以及同一份資料升級前的副本
    When 以本 issue 之前的發布版分別在兩份上執行 recall、brief、remember --durable 與 mark
    Then 都成功，兩份的結果除時間戳與查詢 id 外相同

  @SCN-010
  Scenario: 兩種 agent 依 skill 指引先查證再陳述（維護者機器，手動觀測）
    Given 一個隔離的資料根，內有一則帶查證命令的狀態類記憶，且查證命令目前的結果與記憶內容不同
    And Claude Code 與 Codex 讀到的都是本 issue 更新後的 skill
    When 各開一個新 session，詢問這則記憶描述的狀態
    Then 兩個 agent 都在回答前執行了該查證命令，並以命令結果為準回答，而不是照記憶內容
```

## Gherkin 核准紀錄
- **核准 commit**: 待提交
- **核准來源**: 使用者 2026-11-10 對話。方向：「那這邊開 verify 的 issue 前先確認不要深入 hooks 的方式，走 skill 方式才不會與特定 agent 深度綁定」，指的是同一則對話中的提議（`remember --verify` 附查證命令與記錄日期、標成狀態類；recall 與 brief 顯示「截至 YYYY-MM-DD；據以行動前先跑 <命令>」；Memoria 不替 agent 執行命令）。逐題確認：Q1 --verify 與 --durable「互斥」（SCN-004）；Q2 BRIEF「完整顯示命令」（SCN-003）；Q3 範圍只納入「BRIEF 產生時間移到正文」（SCN-007），其餘三項不納入（TBD-2～4）。SCN-008 的來源是 [project.md](../../agents/project.md) 本地 gate「schema 向後相容：只加 migration，舊 DB 必須可讀」。SCN-002、005、009、010 是規劃時推導出的行為（TBD-1），使用者 2026-11-10 對這四項回覆「核准，提交文件」。

全部 Scenario 於 2026-11-10 核准。

## 重構步驟概要

任務清單與狀態只在 [implementation-plan.md](./implementation-plan.md)「實作步驟」維護。

## 風險與首要驗證

- **最大風險**：改動 recall 與 brief 共用的兩個函式後，既有標記或零標記的輸出跟著改變；或 migration 17 套用後，前一版 runtime 讀寫同一份資料庫出錯。GitNexus 影響分析（2026-11-10）：`applyMemoryAttributes` 為 HIGH（recall 四種模式、HTTP、wiki file-query 都經過它），`renderBrief` 為 HIGH（CLI brief 與 `/v1/brief`）。本機的 skill 啟動器用的是全域安裝的 runtime，開發版若指向同一資料根，兩個版本會共用同一份資料庫。
- **風險等級與理由**：High。屬於廣泛影響：每次 recall、每份自動載入的 brief 都經過這兩個函式。另外，這次會把可執行命令放進自動載入的 context，與安全相關（由 SCN-006 與 skill 指引約束）。資料面只加欄位、不刪資料，可從備份回復。
- **首要驗證**：在本機資料根的副本上做對比基線。動任何程式之前，先用目前 HEAD 跑一組固定查詢（含 durable、superseded 與一般記憶的 recall --json、brief、stats），並確認對比腳本自己穩定、也抓得到刻意製造的差異。之後每一步都用同一組查詢比對。
- **選擇理由**：要防的是「既有行為被改掉」，對真實資料做對比比合成測試更直接。合成資料涵蓋不到本機 54 列標記與 37 列取代鏈的實際組合。
- **完成證據**：基線在同一 runtime 上重跑兩次，正規化後 diff 為空；刻意改一則標記後 diff 不為空。之後步驟 2、4、5 完成時，零查證命令的輸出與基線 diff 為空，前一版 runtime 在升級後副本上的輸出與升級前相同。

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
|------|------|------|------|
| TBD-1 | 規劃時推導出的行為，需使用者確認：SCN-002（`recall --json`、`/v1/recall`、`/v1/brief` 帶 `verify` 欄位）、SCN-005（空白或多行的 `--verify` 被拒）、SCN-009（升級後前一版仍可讀寫）、SCN-010（Claude Code 與 Codex 手動觀測） | 已解決 | 使用者 2026-11-10 回覆「核准，提交文件」，四項依建議納入並列為已核准 |
| TBD-2 | 狀態類記憶的有效期限（過期標 stale） | 不影響本次交付 | 追蹤：無。查證行已顯示日期；非 durable 記憶本來就依 90 天半衰期衰減，30 天後離開 brief 近期決策。使用者 2026-11-10 未選入範圍 |
| TBD-3 | `mark --verify`（替既有記憶補查證命令） | 不影響本次交付 | 追蹤：無。既有的狀態類記憶改寫成新筆記並 `--supersedes` 舊的；git 促升的摘要錨定 commit，不屬於狀態類。使用者 2026-11-10 未選入範圍 |
| TBD-4 | 寫入時偵測「已部署、PASS、待…」等狀態詞並警告 | 不影響本次交付 | 追蹤：無。改由 skill 指引說明何時要加 `--verify`；中英文詞表誤報多。使用者 2026-11-10 未選入範圍 |
| TBD-5 | 本機 UI（`serve --ui`）與 `export` 不顯示查證命令 | 不影響本次交付 | 追蹤：無。`export` 現況本來就不輸出任何標記；UI 給人瀏覽，據以行動的是 agent 讀的 recall 與 brief。2026-11-10 |
| TBD-6 | 本機兩則夾帶快照的常駐約束（向量 ingest、helper 安裝位置）要不要改寫成「約束＋狀態」兩則 | 待確認 | 是資料整理，不是程式變更；交付後由使用者決定，不影響任何 Scenario |
| TBD-7 | SCN-010 讓兩個 host 讀到新版 skill 的隔離方式：不得改動使用者實際的 host skill 連結與資料根 | 待確認 | 影響 SCN-010 的執行方式；SCN-010 核准後、步驟 8 開始前確認 |

## Timeline

| 日期 | 異動 | 負責人 |
|------|------|--------|
| 2026-11-10 | 建立；SCN-001、003、004、006、007、008 依使用者方向與逐題確認核准 | - |
| 2026-11-10 | SCN-002、005、009、010 核准（TBD-1），全部 Scenario 已核准 | - |

---
**建立日期**: 2026-11-10  
**分級**: Medium（migration 加 1 欄 + remember 旗標 + recall／brief 顯示 + skill 指引；零新依賴，不新增命令）  
**風險**: High — recall 與 brief 共用函式的影響分析為 HIGH，且會把可執行命令放進自動載入的 context\
**狀態**: 待實作
