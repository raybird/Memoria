# Issue 30 規劃審查報告

- 範圍：規劃／決策審查；僅審查四份 issue 文件，不是產品程式驗收。
- Reviewed BASE SHA：`f89d6754a9eaa534c5ce018716698ddb70164721`
- Reviewed HEAD SHA：`31f4a6f29a0b145aaf1b59fc62309a272c841d5b`
- Reviewed patch-id：`83997ed65d165e20190aff3a5af67cdf4dd1b1da`
- 獨立 reviewer：宿主隔離 subagent `/root/plan_review`；未參與本版規格撰寫或產品實作。
- Review artifact：`docs/issues/issue-30/review-plan-31f4a6f.md`
- 審查日期：2026-10-25。

## 問題與風險

本次規劃範圍無 MUST FIX。以下為實作前應落入原 Task 的具體查核建議，未要求擴充核准產品範圍：

1. **SHOULD FIX — 環境共用搜尋要防止先截斷再排除造成漏項。** `README.md:99` 要求環境共用的確切範圍；`implementation-plan.md:77` 已規劃範圍測試，但還未明列候選被其他 project 擠出的案例。既有 recall 接受單一 `project` 並在內部取 top-k（`src/core/memoria.ts:528`、`:543`～`:551`），所以無範圍 recall 後才排除 repositories 可能回傳零筆，即使存在符合條件的共用記憶。Task 1.1／2.1 應以「repository 匹配多於 top-k、另有共用匹配」fixture 證明不漏項；可採原始條件篩選或逐確切 project 搜尋後合併，不應單純放大 top-k 當正確性保證。這是已核准 SCN-006 的實作邊界，不是新增使用情境。
2. **SHOULD FIX — 新增唯讀查詢要驗證初始化／讀取的真實副作用。** `README.md:189` 的資料前後比較與 readonly 安全目標合理，但現有多個 Core 讀方法會呼叫 `initDatabase`。新 viewer 不應因套用慣例而在一般列表／詳情階段執行 migration 或任意建表；應讓未初始化資料根依 SCN-001 失敗，對可讀舊資料使用明確 optional-table fallback。將已存在記憶的內容／標記／來源與 recall telemetry 分開比較，才能發現非預期業務寫入。
3. **NICE TO HAVE — 核准基線與文件歷史說明保持可辨識。** Reviewed HEAD 的 `README.md:169` 仍為「待提交」，應按既定流程回填本次規格基線 `31f4a6f`，比對 Gherkin 語意未變後才執行 Task。`implementation-plan.md:103` 起的初版靜態檢查記錄描述核准前的歷史狀態，後續應追加本次核准／拆解的一致性結果，避免讀者誤認目前仍有待核准 Scenario。

## 已查核維度

### 驗收、核准與任務覆蓋

- 使用者對 Q1～Q3 的「全部照建議」與本版方案相符：本機唯讀、工作台及品質門檻、決策為主且 session／技能分開。未見把編輯／刪除、雲端或背景服務混入首版。
- 以 `git show 31f4a6f:<path>` 的固定版本擷取 Gherkin、核准表與責任 Task；Python 集合檢查結果為：13 個 Scenario 全部已核准，每個恰有一個責任 Task，沒有漏項或重複責任。
- Task 相依為 1.1 → 1.2 → 2.1 → 3.1 → 3.2，無循環；安全與資料契約早於正式 HTTP／UI。資料 fixture、Core／HTTP／browser 不同失敗面各有責任，未用 prototype 取代產品驗證。
- 目前文件沒有把計畫命令、效能目標或尚未取得的產品測試宣稱為通過。SCN-001～SCN-013 的產品證據都仍須在後續 Task 取得。

### 安全與輸入／狀態失敗面

| 失敗面 | 規劃中的預期與覆蓋 | 判定 |
| --- | --- | --- |
| 未初始化資料根／埠衝突 | SCN-001；拒絕且不改資料根、不自動初始化 | 已納入 Task 1.2；仍待實證 |
| 未知 Host／Origin、業務寫入與任意路徑 | SCN-002；loopback、allowlist、拒絕寫入／任意檔案；既有 API 模式保持 | 安全方向適當；驗收需用真實 HTTP 請求 |
| 記憶含 HTML／script／事件屬性 | SCN-002；安全文字或受限呈現、CSP、無外部資源 | 方向可行；瀏覽器不執行的證據不可用字串掃描代替 |
| note 包裝 session、技能彙整、marker／Git 映射 | SCN-003～005；原始事件、session 分類、ref 標記及來源 | 保留既有權威資料與關係，避免推導另一套記憶 |
| repository／共用搜尋與排序 | SCN-004、006；精確範圍、回傳真實 metadata | 上述候選截斷風險需列入 fixture |
| confidence null／語意逾時 | SCN-006；不當作零分或正確率，明確降級 | 符合現有 recall 契約 |
| 較晚 response／取消／斷線／404 | SCN-006、009、010；避免覆蓋新結果、可恢復狀態 | 已有可觀察完成判準 |
| 兩種安裝、離開 checkout、外部斷網 | SCN-013；UI 隨 bundle，兩種實際安裝均驗證 | 方向合理；需區分真實離線驗證與僅檢查資產無外部 URL |

### 架構與商品品質

- Core → HTTP → 瀏覽器責任分離明確；前端不讀 SQLite 或任意路徑，不改 recall 排名、schema 或 adapter。
- 對同源／獨立服務、內嵌／外部分發、現有工具／新框架的比較有實質取捨。沿用 TypeScript／esbuild 沒有違反現有依賴政策。
- 視覺與 UX 驗收涵蓋主題、長內容、固定網址、瀏覽器歷史、焦點／位置、錯誤恢復與 320／768／1440；可及性與效能有明確門檻。商品級品質仍需實際畫面與操作證據，規劃審查不代表這些結果已成立。
- 未發現必須先改既有 schema、引入新 runtime 依賴或增加第二份任務清單的理由。

### 豁免、待確認與限制

- Q1～Q3 均有使用者核准來源，無新的必要產品決策，也無 gate 豁免。
- 審查只針對 `f89d675..31f4a6f` 的規劃文件。其後的未提交基線回填、產品實作、測試與 UI 不在本次審查範圍內。
- 未執行產品測試、效能測試或 browser 驗收；無法將本報告當作交付程式的獨立 PASS。

## 流程判定

**PASS（規劃／決策審查）**：本版規劃可作為已核准 Task 的執行依據；上列建議應落入既有測試／資料邊界責任。此判定不代表產品 SCN-001～SCN-013 已通過，也不取代完成實作後對固定交付 BASE／HEAD 的獨立程式審查。
