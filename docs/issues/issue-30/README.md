# Issue 30 - 商品級本機記憶瀏覽介面

## 概述

建立能方便閱讀與搜尋 Memoria 真實記憶的本機 UI，讓使用者看見內容、決策理由與來源脈絡，並以一致的視覺、完整操作狀態與可驗證的可及性作為交付要求。

使用者於 2026-10-25 提出「幫我分析一下如何發展成本可以簡易看記憶的 ui 界面呢？」、「那我要 uiux 的體驗要達到專業商品級別」，並以「$dev-cycle 開始這個 ui 需求吧」啟動開發流程。使用者隨後於同日對 Q1～Q3 回覆「全部照建議」，接受本版具體規格。

issue 編號沿用本機 `docs/issues/` 的序列；建檔時最高為 issue-29，GitHub issue 查詢為空。既有 issue-29 保持原狀。

## 文件清單

- [requirement-analysis.md](./requirement-analysis.md)
- [technical-analysis.md](./technical-analysis.md)
- [implementation-plan.md](./implementation-plan.md)

## 關鍵差異

| 項目 | 現況 | 本次提案 |
| --- | --- | --- |
| 啟動 | `memoria serve` 提供 HTTP JSON API | 額外以 `memoria serve --ui` 啟動本機 viewer；既有純 API 模式保持契約 |
| 瀏覽 | CLI 或已知 session ID 的摘要查詢 | 分頁列表、範圍／類型篩選、完整詳情與可分享的本機網址 |
| 搜尋 | recall 回傳截斷內容與檢索 metadata | UI 顯示結果並另取完整詳情；揭露語意降級，不將分數當正確率 |
| 發布 | 單一 CLI bundle，npm 與 release tar 兩種安裝 | UI 隨同 bundle 交付，離線可載入，兩種安裝入口均驗證 |

## 涉及檔案

以下是目前規劃的最小修改邊界；實作發現需要擴大時先說明原因。

- `src/ui/`（新增）：產品樣式、瀏覽狀態、列表／詳情／摘要元件與瀏覽器入口。
- `src/core/db/memory-browser.ts`（新增）、`src/core/db/index.ts`：記憶列表、範圍選項、完整詳情之參數化唯讀查詢。
- `src/core/memoria.ts`、`src/core/types.ts`、`src/core/index.ts`：瀏覽型別與 public Core 方法，維持 `MemoriaResult<T>`。
- `src/server.ts`、`src/cli/commands/serve.ts`：UI 模式、同源路由與本機存取限制；保留原 API 模式。
- `scripts/build.mjs`：前端 bundle 與靜態內容內嵌。
- `scripts/ui-browser-fixture.mts`（新增）：可重現的隔離瀏覽器資料與延遲／畫面回應計時探針，不隨產品發布。
- `scripts/check-installed-ui.mjs`（新增）：從安裝後 CLI、離開 checkout 驗證 UI 靜態資產與資料路由。
- `scripts/test-memory-browser.sh`（新增）、`scripts/test-ui-http.sh`（新增）：核心資料契約與 UI HTTP／限制／bundle 端到端驗證。
- `scripts/test-npm-install.sh`、`scripts/test-no-clone-install.sh`：從安裝產物驗證 UI 可用，避免僅原始碼 checkout 能執行。
- `README.md`、`README.zh-TW.md`、`docs/CLI.md`、`docs/CLI.zh-TW.md`、`docs/API.md`、`docs/API.zh-TW.md`、`docs/INSTALL.md`、`docs/OPERATIONS.md`：啟動方式、瀏覽 API、資料邊界與安裝說明。
- `AGENTS.md`、`docs/agents/architecture.md`、`.github/workflows/ci.yml`：新模組、驗證入口與公開契約同步。
- `docs/issues/issue-30/`：本次規格、唯一計畫及後續實際驗證／獨立審查證據。

本次不修改記憶 schema、recall 排名、向量模型、adapter、setup 接線或 prune 語意。既有 `work/ui-concept/` 為未接真實資料的設計探索，不是正式 UI 或驗收證據，不隨產品打包。

## Gherkin 驗收劇本

```gherkin
Feature: 商品級本機記憶瀏覽

  @SCN-001
  Scenario: 明確啟動本機唯讀 UI 並維持既有 API 模式
    Given 已初始化的資料根，且沒有安裝任何 UI 背景服務
    When 使用者執行 memoria serve --ui 並開啟印出的 /ui/ 網址
    Then UI 模式僅監聽 127.0.0.1，前端與資料 API 由同一來源提供
    And 顯示真實資料根的記憶，啟動不修改全域安裝設定或安裝 service、hook
    And 不帶 --ui 的 serve 保持既有 API 行為
    And 資料根未初始化或埠被占用時提供可行動的錯誤，不自動初始化或改用其他資料根

  @SCN-002
  Scenario: 限制本機瀏覽模式的資料存取與可執行內容
    Given UI 模式已啟動，且記憶含 HTML、script、惡意網址或疑似檔案路徑
    When 瀏覽列表、詳情、摘要，或送出來源與 Host 不被允許的請求
    Then 記憶以安全文字或受限格式呈現，不執行 script、事件屬性或不安全網址
    And 不提供任意檔案路徑讀取，不載入外部 CDN、字型、分析或遙測服務
    And 不允許未知 Host、跨來源資料存取與 UI 模式的業務寫入路由
    And UI 模式只允許已列明的讀取操作及搜尋；搜尋既有 recall 遙測是唯一允許的記憶服務寫入例外

  @SCN-003
  Scenario: 按原始記憶類型穩定分頁瀏覽
    Given 資料根包含一般 session、CLI note、DecisionMade 與 SkillLearned 事件
    When 使用者瀏覽記憶庫、切換 session／決策／技能，並換頁
    Then 每頁最多 50 筆，按時間倒序與穩定 ID 次序排列
    And 決策與技能以原始事件為一筆，session 摘要在 session 類型下呈現
    And 同一 CLI note 的包裝 session 不在預設決策列表重複出現
    And 類型與筆數名稱明確，不把向量實體數或 session 數冒稱為全部記憶數
    And 空資料庫顯示如何以既有 CLI 寫入記憶的指引

  @SCN-004
  Scenario: 專案、環境共用與長期標記可被明確篩選
    Given 多個已註冊 repository、環境共用記憶，以及常駐與已取代記憶
    When 使用者切換範圍、類型、常駐或包含已取代項目的篩選
    Then 全部、特定 repository 與環境共用是明確的範圍選項
    And 特定 repository 的列表只包含該 project，環境共用可獨立選取
    And 常駐、一般與已取代狀態按原始記憶 ref 的標記顯示
    And 預設排除已取代記憶，明確開啟後才顯示並可追至取代者
    And 範圍名稱來自實際資料與 repository registry，不依賴有資料的最近一頁

  @SCN-005
  Scenario: 完整閱讀內容、理由與記憶來源
    Given 一筆長內容的決策、技能或 session，以及來源為 Git 摘要的記憶
    When 使用者開啟詳情並展開來源
    Then 可閱讀完整原始內容、已存在的理由、時間、專案與關聯 session
    And Git 來源存在時顯示 repository、摘要類型、branch 或 tag 及來源 commit 範圍
    And 沒有理由或來源時如實顯示未記錄，不以推測補成事實
    And 來源與取代者已不存在時提供明確提示及返回列表的操作

  @SCN-006
  Scenario: 明確搜尋並誠實呈現檢索能力
    Given 已選定專案範圍，且可選關鍵字或語意搜尋
    When 使用者提交搜尋、取消搜尋或改變查詢條件
    Then 搜尋將選定 project 傳給 recall，環境共用範圍另以確切條件排除 repository 結果
    And 結果保留真實記憶類型與來源並可開啟完整詳情
    And 語意不可用或逾時時清楚標示已使用關鍵字結果，仍可閱讀
    And confidence 為 null 時不顯示為 0，不將 RRF 排名或 relevance 顯示為正確率
    And 舊請求較晚完成時不覆蓋較新的搜尋，取消可立即恢復操作
    And 一般開頁、換頁、開啟詳情不觸發 recall 或自動效用回饋

  @SCN-007
  Scenario: 在 UI 閱讀現有 brief
    Given 記憶根含常駐約束、近期決策與 repository 狀態
    When 使用者開啟記憶摘要並選擇專案
    Then 內容由既有 brief Core 契約提供，包括該契約定義的環境共用資訊
    And 視覺上能區分常駐約束與近期決策，不自行推導另一套時間窗與排名
    And 開啟或重新整理 UI 不寫入 knowledge/BRIEF.md

  @SCN-008
  Scenario: 工作台提供一致的中文閱讀與主題體驗
    Given 使用者開啟 UI
    When 瀏覽列表、詳情與摘要並切換淺色或深色外觀
    Then 桌面採專案導覽、記憶列表與詳情的工作台方向
    And 全站使用同一套色彩、字體層級、間距、按鈕與文案規則
    And 長標題、中文與英文混排、長 ID 及長程式片段仍可閱讀
    And 外觀預設跟隨系統，可在瀏覽器本機保留使用者的明確選擇

  @SCN-009
  Scenario: 導覽與固定網址可恢復上下文
    Given 使用者已設定搜尋、篩選、頁碼並開啟某筆記憶
    When 重新整理、使用瀏覽器上一頁下一頁，或重新開啟該本機網址
    Then 可恢復有效的範圍、類型、查詢與所選記憶，不把瞬間載入狀態寫入網址
    And 從詳情返回時保留列表位置與焦點
    And 無效網址參數或已刪除記憶提供可恢復的提示，不產生空白畫面

  @SCN-010
  Scenario: 首次使用與異常狀態有明確下一步
    Given 資料尚在載入、記憶庫為空、查無結果、服務中斷或詳情已不存在
    When 使用者進入對應畫面
    Then 載入期間保留版面與操作上下文
    And 空資料、無結果、404 與連線失敗有不同文案與可行動的下一步
    And 重試不丟失搜尋條件，失敗不無限重試或重複通知

  @SCN-011
  Scenario: 鍵盤、可及性與窄螢幕可完成核心任務
    Given 320、768 與 1440 CSS px 的畫面，或僅使用鍵盤
    When 完成找一筆記憶、閱讀理由與來源、返回列表三個任務
    Then 主要操作可使用鍵盤，焦點可見且沒有焦點陷阱
    And 控制項有可理解的可及名稱，動態搜尋與錯誤適度宣告
    And 一般文字對比至少 4.5:1，大字與必要非文字控制項對比至少 3:1
    And 觸控主要操作目標至少 44 CSS px，尊重減少動態效果的系統偏好
    And 窄螢幕採列表到詳情再返回的流程，不因三欄壓縮產生整頁橫向溢出

  @SCN-012
  Scenario: 大量資料與長內容仍保持可操作
    Given Node 22、10000 筆決策／技能混合資料、含長內容與相同時間戳的隔離 fixture
    When 暖機兩次後對 50 筆列表執行 20 次查詢，並在瀏覽器搜尋與換頁
    Then 記錄機器、版本、資料量與取樣方法，列表查詢 p95 不超過 500 ms
    And 換頁不一次下載全部記憶，長內容在開啟詳情時才讀取
    And 搜尋提交後 100 ms 內出現可見回應；語意模型載入時間另列，不冒充列表延遲
    And 連續換頁沒有無理由的重複或遺漏，操作過程版面穩定

  @SCN-013
  Scenario: 不依賴原始碼 checkout 的安裝也能開啟 UI
    Given npm 安裝與 release tar 安裝各自位於隔離環境，且無原始碼工作目錄
    When 以安裝後的 memoria serve --ui 啟動，並停用外部網路
    Then UI 的 HTML、CSS、JavaScript 均正常載入，列表與詳情可使用
    And 發布包不夾帶開發用 prototype、測試 fixture 或前端開發伺服器
    And 既有 API、CLI smoke 與安裝契約仍通過
```

## Gherkin 核准紀錄

- **核准 commit**: 31f4a6f（2026-10-25 Q1～Q3 已核准；基線內容未變）。
- **需求來源**: 2026-10-25 對話原話見概述；已核准的高階目標為「可方便看記憶的 UI」及「專業商品級 UI/UX」。
- **具體規格來源**: 使用者於 2026-10-25 對 README Q1～Q3 與對應 SCN-001～SCN-013 回覆「全部照建議」；接受唯讀本機、工作台與品質門檻、決策為主與確切範圍的建議。

| Scenario | 核准日期 | 狀態 |
| --- | --- | --- |
| SCN-001 | 2026-10-25 | 已核准 |
| SCN-002 | 2026-10-25 | 已核准 |
| SCN-003 | 2026-10-25 | 已核准 |
| SCN-004 | 2026-10-25 | 已核准 |
| SCN-005 | 2026-10-25 | 已核准 |
| SCN-006 | 2026-10-25 | 已核准 |
| SCN-007 | 2026-10-25 | 已核准 |
| SCN-008 | 2026-10-25 | 已核准 |
| SCN-009 | 2026-10-25 | 已核准 |
| SCN-010 | 2026-10-25 | 已核准 |
| SCN-011 | 2026-10-25 | 已核准 |
| SCN-012 | 2026-10-25 | 已核准 |
| SCN-013 | 2026-10-25 | 已核准 |

## 風險與首要驗證

- **最大風險**：將本機記憶暴露到非預期來源，或把記憶中的 HTML／連結當成可執行內容；其次是 session／event／note 與標記映射錯誤，造成重複、漏項或隱藏已取代資訊。
- **風險等級與理由**：High — 新增可讀取完整記憶的瀏覽器入口，涉及存取權限與私人資料邊界；風險與 Large 規模分開判定。
- **首要驗證**：在主要實作前建立隔離資料根的 HTTP 限制與內容呈現契約，以及已知 session／event／note／Git／marker fixture 的查詢矩陣；先檢查未初始化資料根與既有 API 相容性。
- **選擇理由**：邊界拒絕與資料映射能透過確切請求和獨立 fixture 直接驗證；完整端到端切片或先做精緻畫面無法更直接排除這些失敗。
- **完成證據**：UI 模式限制和瀏覽契約的目標行為紅燈；實作後正負向契約全綠；惡意內容在真實瀏覽器不執行，既有 API 模式不受影響。記錄邏輯資料前後比較，將明確搜尋產生的 recall telemetry 與任何非預期業務資料寫入分開判定。

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
| --- | --- | --- | --- |
| Q1 | 首版限本機唯讀 viewer，以 serve --ui 明確啟動、僅 loopback、限制來源與業務寫入；允許既有搜尋遙測，不新增編輯／刪除／雲端／service／hook | 已解決 | SCN-001、SCN-002、SCN-006、SCN-013；決定執行與安全邊界 |
| Q2 | 採工作台方向與中文介面；完整詳情、brief、狀態保存、淺深色、錯誤恢復、鍵盤與手機體驗及上述量測門檻納入首版 | 已解決 | SCN-005、SCN-007～SCN-012；決定首版品質與驗收範圍 |
| Q3 | 預設以決策事件瀏覽，技能與 session 分類檢視；CLI note 不另重複其包裝 session；特定專案嚴格篩選、共用另列，已取代預設隱藏 | 已解決 | SCN-003、SCN-004、SCN-006；決定「一筆記憶」與範圍語意 |

Q1～Q3 結論：2026-10-25 使用者「全部照建議」，均採上述建議；追蹤：無，決策已納入本次 SCN 與唯一計畫。

技術採現有 TypeScript／esbuild 與內嵌靜態資產，不新增 runtime 依賴。若必須新增工具或套件，另依 project.md 取得明確授權，不將商品級品質要求解讀為套件增設授權。

## Timeline

| 日期 | 異動 | 負責人 |
| --- | --- | --- |
| 2026-10-25 | 使用者明確啟動 dev-cycle；建立 issue-30 初版調查、驗收提案與實作計畫，待 Q1～Q3 決策 | - |
| 2026-10-25 | Q1～Q3「全部照建議」核准 SCN-001～SCN-013，開始分解與實作 | - |

---
**建立日期**: 2026-10-25

**分級**: Large — 新增 UI 模組並跨 Core、HTTP、CLI、打包與安裝契約

**風險**: High

**狀態**: 實作中
