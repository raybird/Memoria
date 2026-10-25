# Issue 30 - 實作計畫

本檔是實作任務的唯一來源。風險與首要驗證只維護於 [README](./README.md#風險與首要驗證)，核准狀態只讀 README 的 Gherkin 核准表。

## 設計方案

Core 預計新增以下能力；最終命名與等價內部拆分可依既有風格調整，不影響外部驗收：

- `listMemories(filter): MemoriaResult<MemoryPage>`：類型、project／共用範圍、retention、superseded 與分頁。
- `getMemory(refId): MemoriaResult<MemoryDetail>`：完整內容、理由、標記、父 session 與 Git 來源。
- `memoryFacets(): MemoriaResult<MemoryFacets>`：從權威資料取得可用範圍與類型選項。

HTTP 以 `/v1/memories`、`/v1/memories/:ref` 與 `/v1/memory-facets` 等明確路由轉接，保留既有 result envelope。UI 路由與資產在 `/ui/` 下，搜尋與 brief 重用現有 Core。具體 query 參數、非法值與 404／400 契約在實作前與核准 SCN 對齊，不以新增欄位偷偷擴張需求。

## 使用方式對照

- 現況：`memoria recall ...` 或 `memoria serve` 加手動 HTTP 查詢。
- 本次提案：使用既有已初始化資料根，明確執行 `memoria serve --ui`，開啟輸出的 loopback 網址；停止程序即停止 UI，不安裝背景服務。`serve` 無旗標行為保持原樣。

## Phase 1 — 存取邊界與權威查詢

### Task 1.1 — 首要契約驗證與資料查詢
- 產出與範圍：隔離 fixture、瀏覽 Core 查詢／型別與 HTTP 契約測試；只讀取原始 session／event、registry、marker 與 Git provenance。
- 相依：核准基線已提交。
- 驗收責任：SCN-003、SCN-004、SCN-005；支援 SCN-001、SCN-002、SCN-006。
- 完成判準：先取得缺少列表／詳情的行為紅燈，完成分頁與篩選矩陣、完整理由與來源、無理由／缺失 ref、舊資料契約；原有記憶語意不變。
- 驗證：Core fixture 與 HTTP 分別驗證不同失敗面；字面預期不重算被測查詢。
- 狀態：✅ 已完成
- 證據：[驗證紀錄](./verification.md)，Core／HTTP 契約與首要紅燈。

### Task 1.2 — 本機唯讀 HTTP 與打包入口
- 產出與範圍：serve --ui、loopback／Host／Origin／固定資產與路由 allowlist、查詢參數驗證及內嵌資產。
- 相依：Task 1.1；前置安全拒絕契約先於 HTTP 實作。
- 驗收責任：SCN-001、SCN-002；支援 SCN-006、SCN-007、SCN-013。
- 完成判準：未知 Host／Origin、寫入與任意路徑請求拒絕；未初始化／埠衝突可行動失敗；既有 serve 契約保持。
- 驗證：真實 HTTP 正負向矩陣與惡意內容 browser 檢查；缺少功能紅燈到綠燈。
- 狀態：✅ 已完成
- 證據：[驗證紀錄](./verification.md)，Core／HTTP 契約與首要紅燈。

## Phase 2 — 商品介面與閱讀流程

### Task 2.1 — 工作台、閱讀與完整狀態
- 產出與範圍：正式 src/ui、列表／詳情／來源／brief、搜尋、主題、URL 導覽、手機與鍵盤。
- 相依：Task 1.1、Task 1.2。
- 驗收責任：SCN-006、SCN-007、SCN-008、SCN-009、SCN-010、SCN-011。
- 完成判準：使用真實隔離資料完成找記憶→理由來源→返回三任務；過期 response、降級、無結果、斷線／404 可恢復；320／768／1440 與深淺色有實際證據。
- 驗證：HTTP／Core 契約加真實瀏覽器互動與焦點／對比量測；視覺採手動等價證據，不以概念原型驗收正式產品。
- 狀態：📝 待實作
- 證據：執行時回寫。

## Phase 3 — 效能、安裝與交付

### Task 3.1 — 大資料與兩種安裝驗證
- 產出與範圍：萬筆 fixture 的原始取樣、npm／release tar 安裝後 UI 與離線資產測試。
- 相依：Task 2.1。
- 驗收責任：SCN-012、SCN-013。
- 完成判準：50 筆列表 20 次暖查詢 p95 ≤500ms；提交回應 ≤100ms；隔離安裝離開 checkout 可瀏覽；不含 prototype／fixture。
- 驗證：實際安裝 E2E、指定統計與 browser timing，保留機器／版本／資料樣本資訊。
- 狀態：📝 待實作
- 證據：執行時回寫。

### Task 3.2 — 文件、精煉、回歸與獨立審查
- 產出與範圍：中英 CLI／API／README、安裝與架構文件、CI、Proof of Test 與固定 BASE／HEAD 的獨立審查。
- 相依：Task 3.1。
- 驗收支援：SCN-001～SCN-013；各 SCN 責任仍在上列 Task，不新增第二份狀態清單。
- 完成判準：typecheck／build／smoke／相關回歸通過，精煉與風險限制可追溯，GitNexus detect_changes 完成；不開 PR、不自行合併或發版。
- 驗證：既有 CI 入口與文件一致性；獨立 reviewer 保存報告。
- 狀態：📝 待實作
- 證據：執行時回寫。

## 測試策略

| SCN | 外部行為驗證 | 底層／等價證據 |
| --- | --- | --- |
| 001、002 | 安裝後 CLI 與真實 HTTP 請求；Host／Origin／寫入拒絕與惡意內容的瀏覽器檢查 | UI 模式 router 的正負向矩陣、已知內容前後比較；記憶查詢參數化與固定資產 allowlist |
| 003～005 | 從隔離 DB 經 HTTP 到畫面，驗事件、session、共用、標記與來源 | 獨立建立 note／Git／技能／未知 project fixture；時間同值與分頁邊界、缺少理由／取代者 |
| 006 | 真實 recall 契約、語意降級及前端較晚 response 不覆蓋新搜尋 | 查詢範圍、null confidence、取消、一般瀏覽前後 telemetry 比較；模型不可用不冒充模型正常 |
| 007 | UI brief 內容與既有 structured brief 比對；BRIEF.md 前後不變 | 沿用現有 brief-scope 與 HTTP brief 回歸，不複製 renderer 演算法作斷言 |
| 008～011 | 真實瀏覽器測淺／深色、320／768／1440、鍵盤三任務、狀態恢復、惡意與長內容 | 保存尺寸、對比值、焦點路徑、實際狀態與結果；沒有未執行的工具檢查假稱 WCAG 認證 |
| 012 | 指定 fixture 與取樣規則量測列表、頁面載入量及提交回應 | 記錄機器、Node、資料量、版本與原始樣本，p95 用獨立統計，不把模型冷啟動混入列表 |
| 013 | 隔離 npm 安裝及 release tar 安裝後開啟 UI；切斷外部網路仍載入資產 | build、已存在的安裝／交付 parity 測試；確保離開 checkout 仍可運作 |

依 verification.md 採對應層級的紅綠重構證據。Core 資料映射與 HTTP／瀏覽器有不同失敗面，保留各自責任；單一直接 HTTP 行為若無另一層責任可說明後合併。視覺與可及性採可重複手動檢查及前後差異，精煉無必要時記 no-op 理由，不為同一綠燈重複跑測試。

使用現有 shell、Node／tsx 與連接的真實瀏覽器驗證，初版不新增測試框架或 browser 套件。前端純邏輯可由現有環境中的 Node assertions 驗證；手動瀏覽器證據與可重跑的 API／Core 自動測試分開記錄，不能互相冒稱。

## 必要回歸與文件

靜態檢查先於回歸：`pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`、受影響 shell 的 `bash -n`、`pnpm run release:docs-check`。執行 smoke 與本次新增瀏覽／UI HTTP 測試；受影響的 memory attributes、brief scope、HTTP、vector 契約及安裝／no-clone 回歸按 CI 各組順序安排。最終清單由實際變更與已核准 SCN 決定，在原 Task 記錄，不把規劃的命令當作執行證據。

新增測試同步 AGENTS 與 CI；API、CLI 與 README 同步中英文件。安裝與架構更新依 project.md。正式 UI 不包含目前本機概念原型的個人路徑或範例記憶。

## 檢查清單

- [x] 建立現況調查、方案取捨、驗收提案與唯一計畫來源。
- [x] 明確記錄 High 風險與首要契約驗證；計畫未將待核准內容列成可執行 Task。
- [x] Q1～Q3 取得明確答案，回寫 SCN 核准狀態與可追溯來源。
- [x] Large 計畫由 decompose 細化；初始規格提交後回填基線。
- [ ] 各 Task 有有效行為／等價證據與精煉紀錄。
- [ ] 雙語文件、安裝產物、視覺與可及性證據齊備。
- [ ] GitNexus detect_changes 核對範圍，獨立 reviewer 保存對交付 BASE／HEAD 的審查。

## 初版規劃檢查

2026-10-25，以 `f89d675` 為原始碼基線，對新增的四份未提交文件執行 Python 靜態檢查：13 個 Scenario ID 唯一、核准表集合相等且全部待核准、Q1～Q3 存在、相對連結均指向存在檔案、四個階段均明列不可執行，結果通過。另對每份新文件以 `git diff --no-index --check /dev/null <file>` 檢查新增內容的空白錯誤；這比僅檢查尚未追蹤檔案不會出現的 `git diff --check` 更完整。

以上是文件一致性證據，尚未執行產品測試、效能測試或正式 UI 驗收，也尚無獨立審查報告。待核准規格不構成實作綠燈。
