# Issue 28 - 將安裝、資料位置與語意召回整合為一次 setup

## 概述

使用者已能透過 npm 安裝 Memoria，但要真正讓 agent 跨會話使用記憶，還必須自行選擇資料根目錄、部署 host skill、保存環境設定、編接 AGENTS／CLAUDE、產生 brief；啟用向量時還要安裝模型、暖機、建立樹狀索引、ingest 並檢查 coverage。程式安裝成功與記憶可用之間仍有多個人工步驟。

目標是讓一般使用者執行 `npm install -g @raybird.chen/memoria` 後，在一次互動式 `memoria setup` 中選擇全域／專案使用、agent 與是否啟用本地語意召回。setup 保存選擇、完成接線與驗證，讓新程序可沿用設定。保留既有自動化用法，不另引入服務或 hooks。

## 文件清單

- [需求與現況分析](./requirement-analysis.md)
- [技術方案與取捨](./technical-analysis.md)
- [實作計畫與驗證策略](./implementation-plan.md)

## 快速導覽

| 階段 | v1.31.2 現況 | 目標 |
| --- | --- | --- |
| 安裝入口 | npm 安裝後仍需多個命令與環境變數 | npm 安裝＋一次 setup，使用者只選部署用途 |
| 資料位置 | setup 與一般命令有不同 fallback，依賴 cwd／環境 | 保存選擇，新程序顯示並沿用有效位置 |
| Agent | 資料根的 skill 不一定是 host 可發現的位置 | 所選 host 能發現 skill，且綁到相同資料根 |
| 規範與 brief | 手動新增讀取指令與 Claude imports | 有變更預覽、保護與備份的共用入口接線 |
| 語意召回 | 安裝／暖機與 ingest／驗證分開 | 一個明確的啟用選擇完成整條流程 |
| 完成判定 | 初始化成功可能被誤認為全部可用 | 分開顯示 core、agent、vector 的結果與未完成原因 |

## 範圍與邊界

包含：互動與非互動 setup、使用者設定保存與解析、Codex／Claude Code skill 與規範接線、本地向量啟用、brief、重跑／升級／失敗恢復，以及雙語使用文件。

維持：SQLite 是記憶真相來源；現有命令名、HTTP／SDK 契約、helper 路徑與 stdin/stdout、旁置 node_modules 優先、cache 雜湊規則與既有顯式環境覆寫。

本次不包含：自動匯入歷史對話、搬遷或合併既有資料庫、背景 ingest 排程、修改每次 remember 的行為、安裝 service／hooks、新增遠端 libSQL 帳號或雲端憑證管理、變更 recall 的預設模式、解除安裝工具與新套件依賴。後續新增記憶仍沿用 skill 的 doctor／coverage 補齊流程。

## 涉及檔案

以下是預計的最小修改邊界；新增模組名稱為提案，核准與拆解後才落實。

```text
src/
├── cli.ts                         # CLI 啟動時套用有效安裝設定
├── cli/commands/setup.ts           # 問答、明確選項與步驟編排
├── cli/runtime.ts                 # 沿用 skill 部署、覆蓋保護與模型安裝
├── cli/setup-plan.ts              # 新：唯讀預檢、變更計畫與結果
├── cli/agent-integration.ts        # 新：host 發現路徑、規範檔受管理區塊與備份
├── cli/commands/doctor.ts          # 設定來源與 requested/ready 的診斷
├── core/paths.ts                   # 共用有效資料位置解析
├── core/install-settings.ts       # 新：使用者安裝設定，與資料根 configs/config.json 分開
└── core/recall-vector.ts           # 共用 vector readiness/coverage 檢查；召回語意不變
skills/
├── memoria-memory-sync/scripts/   # 沿用 bridge payload，必要時抽共用的 ingest 入口
└── memoria-memory-sync/deployed/  # skill／REFERENCE 使用保存的設定與接線流程
scripts/
├── test-setup-onboarding.sh        # 新：隔離 HOME 的互動／非互動與保護驗收
├── test-bootstrap.sh              # 保留既有 JSON Lines／參數契約
├── test-npm-install.sh            # 真正 packed runtime 的新程序驗證
├── test-no-clone-install.sh       # tarball 與 npm 行為一致
├── test-vector-recall.sh          # coverage、真向量路由與失敗降級識別
└── test-brief-scope.sh            # 共用／專案 brief 接線不互相覆寫
.github/workflows/ci.yml           # 新測試納入現有 Ubuntu／macOS 與 Node 18 邊界
```

文件：`README.md`／`README.zh-TW.md`、`docs/INSTALL.md`、`docs/CLI.md`／`.zh-TW.md`、`docs/INTEGRATIONS.md`／`.zh-TW.md`、`docs/OPERATIONS.md`、`AGENTS.md`、`docs/agents/architecture.md`。更新觸發依 [project.md](../../agents/project.md)，不把提案提前寫成現有功能。

## Gherkin 驗收劇本

下列為已核准的具體行為規格；命令選項與設定格式的設計見 [technical-analysis.md](./technical-analysis.md)。

```gherkin
Feature: 安裝後透過一次 setup 取得可供 agent 使用的記憶

  @SCN-001
  Scenario: 一般使用者在終端完成引導
    Given 使用者已持久安裝 npm 套件且尚未設定 Memoria
    When 在互動終端執行 memoria setup
    Then 可以選擇全域或專案資料位置、Codex 或 Claude Code 或兩者、是否啟用本地語意召回
    And 寫入前顯示實際路徑、預計修改的檔案與是否需要下載模型
    And 確認後一次完成所選項目，不要求手動編輯設定或另抄 ingest 命令
    And 取消確認不改寫既有資料或使用者設定

  @SCN-002
  Scenario: 全域資料選擇在新程序中仍有效
    Given 已完成全域 setup
    When 從沒有本地記憶的其他工作目錄啟動新 CLI 程序且未設定 Memoria 環境變數
    Then doctor、remember、recall 與 brief 使用保存的同一資料根目錄
    And doctor 顯示有效資料位置及其來源
    And 使用者不需要 source shell 檔或 export MEMORIA_HOME

  @SCN-003
  Scenario: 專案記憶與既有明確路徑保持隔離
    Given 有全域設定，且某專案存在原有的本地記憶
    When 在該專案執行 CLI，或在 setup 明確選擇專案模式
    Then 保留既有本地資料的優先權，並顯示所用範圍
    And 專案 setup 不把全域預設切到該專案，不搬遷其他資料
    And 明確的 MEMORIA_HOME 與 MEMORIA_DB_PATH 等路徑覆寫仍優先

  @SCN-004
  Scenario: 所選 host 可發現相同記憶 skill
    Given setup 選擇 Codex 與 Claude Code
    When setup 完成後由各 host 的標準 skill 位置讀取 memoria
    Then skill 可發現且 launcher 可執行
    And 兩者都綁定所選資料根與已安裝 runtime
    And 更新套件及重跑 setup 後，launcher 仍指向有效 runtime

  @SCN-005
  Scenario: 共用規範與 brief 接線保留原有內容
    Given 所選 host 的規範檔含既有使用者規則
    When 使用者確認 setup 的規範接線計畫
    Then 變更前有可定位的備份，既有規則完整保留
    And 共用 AGENTS 入口含 brief 的讀取指令
    And Claude 以 @ 引入共用規範與正確的 brief
    And 全域與專案範圍使用各自正確的路徑，含空白路徑可用

  @SCN-006
  Scenario: 選擇本地語意召回即完成向量啟用
    Given 資料根已有記憶且向量索引尚未建立
    When setup 選擇啟用本地語意召回
    Then 安裝與暖機 local provider，保存本地向量庫設定
    And 補齊樹狀索引與完整語料的向量索引，不受既有增量游標遮蔽
    And doctor 顯示 embedded 等於 expected 且 missing 為 0
    And 以已知相關的改述查詢驗證 route_mode 為 vector 或 hybrid_vector 且 fallback_used 為 false
    And 設定可由新程序與所選 host 沿用

  @SCN-007
  Scenario: 基本模式與空記憶庫也有誠實的完成判定
    Given 使用者未選語意召回，或所選資料根沒有任何記憶
    When setup 執行完成驗證
    Then 未選語意召回時不下載模型且明示基本模式可用
    And 空記憶庫不因沒有命中就被判定失敗，也不宣稱 corpus 查詢已驗證
    And 選擇語意召回的空庫以隔離的暫存測試驗證模型與向量鏈路
    And 完成後真實記憶庫沒有測試記憶或測試回饋殘留

  @SCN-008
  Scenario: 重跑或升級後刷新設定不重複或遺失資料
    Given 已完成 setup 且已有真實記憶與使用者規範
    When 以相同選擇重跑 setup，或套件升級後刷新部署
    Then 真實記憶及原有規範仍在，受管理接線不重複
    And 未變更依賴時沿用既有模型與依賴快取
    And 顯示已沿用、已更新與仍未完成的項目

  @SCN-009
  Scenario: 衝突或不安全寫入在開始修改前被攔下
    Given 目標存在手寫 skill、佔用安裝專用位置的其他檔案、來源不明的 symlink 或不可寫路徑
    When setup 預檢整份變更計畫
    Then 明示衝突路徑與可採取的處理方式
    And 未解決時以非 0 結束，既有檔案與資料逐位元組不變
    And 不因部分 host 可寫就先修改它們

  @SCN-010
  Scenario: 安裝或索引失敗可以辨認與重試
    Given 已選語意召回
    When 依賴下載、暖機、ingest 或驗證其中一步失敗
    Then setup 以非 0 結束，顯示失敗步驟與重試方法
    And 明示 core 與 vector 各自狀態，不把 core 成功宣稱為 vector ready
    And 既有記憶保持可讀，未完成安裝不成為有效依賴快取
    And 重跑可沿用已成功部分並補齊失敗步驟

  @SCN-011
  Scenario: 自動化命令不等待問答
    Given 既有腳本使用 setup 的明確參數、--json 或非互動 stdin
    When 執行原有命令
    Then 不出現互動問題，既有明確參數的意義與 JSON Lines 契約維持可用
    And 新的非互動完整安裝入口可用明確選項表示所有選擇
    And 互斥或不完整的新選項以非 0 與可定位錯誤結束

  @SCN-012
  Scenario: 環境覆寫不被保存設定悄悄替換
    Given 已保存全域資料與本地語意設定
    When 新程序明確設定 MEMORIA_HOME、LIBSQL_URL 或 embedding provider 等覆寫
    Then 明確設定的值保持優先，持久設定不記錄或輸出認證 token
    And 資料根已切換且未明確指定向量庫時，本地向量庫跟隨有效資料根
    And MEMORIA_DB_PATH 不符合 ingest 可讀資料根時，setup 在 ingest 前明確失敗，不寫入另一份 corpus

  @SCN-013
  Scenario: 完成驗證不污染使用者記憶
    Given 使用者確認的目標資料根與 agent 設定
    When setup 執行寫入、召回與接線驗證
    Then 確認真實目標可寫入與可讀取，驗證所選 runtime 和 launcher
    And 若使用合成記憶驗證，該記憶只存在隔離的暫存資料根與向量庫
    And 不依靠一次 ok=true 或僅有依賴目錄就宣稱整合完成

  @SCN-014
  Scenario: 既有部署與未選擇的整合維持原行為
    Given 使用 repo 模式、tarball、Node 18，或下游旁置 helper 依賴
    When 使用原有的明確 setup 與 recall 入口
    Then 命令名、HTTP 與 SDK 回應、helper 路徑與 stdin/stdout 契約維持
    And 未選擇的 host 不被修改，沒有自動安裝 service 或 hooks
    And 選擇本地語意召回不需要建立遠端帳號
```

## Gherkin 核准紀錄

- **核准 commit**: `741ba85`
- **核准來源**：
  - 2026-10-23 使用者先詢問「目前的安裝與設定的方式是不是不太容易」，在「npm 安裝＋一次互動 setup，保存資料位置、接線、向量 ingest 與實測」的方向建議後要求「那把這個開一個完整的 issue」。
  - 2026-10-23 逐題確認：Q1（`TBD-2` 與部分 `TBD-3`，影響 `SCN-002`、`SCN-003`、`SCN-012`）使用者回覆「核准」採建議方案 A；Q2～Q4（`TBD-1`、`TBD-3`、`TBD-4`、`TBD-5` 與 `SCN-001`～`SCN-014` 全部驗收劇本）使用者回覆「全部照建議」，核准 `SCN-001`～`SCN-014` 及各項設計建議。

| Scenario | 核准日期 | 狀態 |
| --- | --- | --- |
| SCN-001 | 2026-10-23 | 已核准 |
| SCN-002 | 2026-10-23 | 已核准 |
| SCN-003 | 2026-10-23 | 已核准 |
| SCN-004 | 2026-10-23 | 已核准 |
| SCN-005 | 2026-10-23 | 已核准 |
| SCN-006 | 2026-10-23 | 已核准 |
| SCN-007 | 2026-10-23 | 已核准 |
| SCN-008 | 2026-10-23 | 已核准 |
| SCN-009 | 2026-10-23 | 已核准 |
| SCN-010 | 2026-10-23 | 已核准 |
| SCN-011 | 2026-10-23 | 已核准 |
| SCN-012 | 2026-10-23 | 已核准 |
| SCN-013 | 2026-10-23 | 已核准 |
| SCN-014 | 2026-10-23 | 已核准 |

## 計畫入口

階段、相依、驗收對應、Task 拆解與測試證據維護於 [implementation-plan.md](./implementation-plan.md)。

## 風險與首要驗證

- **最大風險**：setup 從初始化資料擴大到使用者層級設定、host 規範與跨程序路徑解析；若覆蓋手寫內容或選錯資料根，會遺失設定或把新記憶寫進另一份資料庫。向量 ingest 若誤用資料根，可能「成功」索引錯 corpus。
- **風險等級與理由**：High。涉及使用者檔案保護與核心路徑外部行為，不因 feature 為安裝體驗就降低風險。
- **首要驗證**：核准後，先以隔離 HOME／設定目錄與已知內容建立保護及路徑解析的 characterization／負向案例；在正式接線前驗證完整計畫預檢、環境覆寫、local/global 切換與 DB 路徑不符的阻擋。
- **選擇理由**：先將不可接受的副作用釘住，比先做好開心路徑的互動 demo 更直接降低此風險。既有函式可用不代表多目標整合寫入安全。
- **完成證據**：SCN-003／009／012 的紅燈直接來自缺少保護或解析行為；實作後通過相同案例，衝突前後原檔 hash 與 DB 資料不變，並有新程序讀取正確資料根的證據。

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
| --- | --- | --- | --- |
| TBD-1 | 核准 SCN-001～014；建議採本文件的基本／語意分開判定、安全預檢與重試語意 | 已解決 | 2026-10-23 使用者回覆「全部照建議」，核准 SCN-001～014 及分項完成判定與失敗重試語意 |
| TBD-2 | 資料與設定優先序；建議明確參數／環境 > 既有本地記憶 > 保存的全域預設，保留舊 repo 行為 | 已解決 | 2026-10-23 使用者回覆「核准」（Q1 建議方案 A）：明確旗標／環境 > 既有本地記憶 > 保存的全域預設 > runtime fallback，本地向量庫跟隨有效資料根，影響 SCN-002／003／012 |
| TBD-3 | 寫入邊界；建議原生 JSON 設定供 CLI 自行讀取、不預設改 shell 啟動檔，agent 接線採預覽＋備份＋受管理區塊 | 已解決 | 2026-10-23 使用者回覆「核准」與「全部照建議」（Q1／Q2 建議方案 A）：原生 JSON 安裝設定（不預設改 shell 啟動檔、不存 token），規範檔與 host skill 採多目標預檢＋可定位備份＋受管理區塊，影響 SCN-001／004／005／008／009 |
| TBD-4 | 自動化介面；建議新完整流程為明確 opt-in，既有 --json／無 TTY 呼叫維持非互動；選項拼法待設計核准 | 已解決 | 2026-10-23 使用者回覆「全部照建議」（Q3 建議方案 A）：既有 `--json`／無 TTY／明確參數維持非互動；無參數互動 TTY 或 `--interactive` 進引導；新增 `--scope <global\|project>`、`--global`、`--project`、`--agent <claude-code\|codex\|both\|none>`、`--vector`／`--no-vector`、`--yes`，影響 SCN-001／011／014 |
| TBD-5 | OS 驗證；建議 Linux／macOS 的實際安裝與 host 接線納入現有 CI，Windows 保留 npm 基本模式並先驗平台路徑，不宣稱完整新引導已驗證 | 已解決 | 2026-10-23 使用者回覆「全部照建議」（Q4 建議方案 A）：Linux／macOS 納入 CI（stub + 真 libSQL）並補維護者實機 local 模型驗證，Windows 驗證路徑解析與基本 npm 安裝相容性，影響 SCN-014 |

## Timeline

| 日期 | 異動 | 負責人 |
| --- | --- | --- |
| 2026-10-23 | 使用者要求建立完整 issue；依 v1.31.2 程式與同日實機安裝整理四份草案，具體 Scenario 待核准 | - |
| 2026-10-23 | 逐題確認完成（Q1「核准」、Q2～Q4「全部照建議」），核准 SCN-001～014 與 TBD-1～5，執行 decompose 拆解可執行 Task | - |
| 2026-10-23 | 完成 Phase 1～5（Task 1.1～5.2）實作、自動化驗收（SCN-001～014）、實機 `MEMORIA_EMBED_PROVIDER=local` 跨語言向量召回驗證與雙語文件同步 | - |

---
**建立日期**: 2026-10-23  
**分級**: Large  
**風險**: High  
**狀態**: 已實作（待審查）
