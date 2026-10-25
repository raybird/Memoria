# Issue 30 早期程式審查報告

- 範圍：完整 `f89d675..ca19124` diff 的早期程式審查；最終瀏覽器／離線／交付證據尚在進行中。
- Reviewed BASE SHA：`f89d6754a9eaa534c5ce018716698ddb70164721`
- Reviewed HEAD SHA：`ca191248c6873345c4982275edb317094d707ba5`
- Reviewed patch-id：`d31600a1ce70f29b6db86b86b43bfcb1b465c1eb`
- 獨立 reviewer：宿主隔離 subagent `/root/plan_review`，未參與產品實作。
- Review artifact：`docs/issues/issue-30/review-code-ca19124.md`
- 日期：2026-10-25。

## 問題與風險

### MUST FIX — 較晚完成的來源 lookup 可以覆蓋較新的導覽

位置：`src/ui/app.ts:330`～`:340`。

`resolveMemory` 在取得未知類型的來源記憶後直接呼叫 `openMemory`，沒有 AbortSignal 或導覽意圖序號。使用者點 brief／取代者連結後，若立即更換範圍、送出新搜尋或開啟其他列，舊 lookup 完成仍會改寫 `state.id`、`state.type`／view 並進入舊記憶。`loadList`／`loadDetail` 的 sequence guard 無法攔住呼叫它們之前的此層 mutation，catch 分支亦同。

以 reviewed HEAD 的函式原文移除型別後執行隔離 Promise probe：先呼叫 `resolveMemory("old-ref")`、將 state 改為 `new-selected-ref`，再完成舊 API Promise。結果 `opened=[{id:"old-ref",type:"decision"}]`，最後 `state.id="old-ref"`，驗證來源 lookup 會覆蓋新選擇。此 probe 測函式邊界，不冒稱為完整 browser E2E。

建議：來源 lookup 與其他導覽共用意圖失效機制；新導航、搜尋、返回、popstate 都應令舊 lookup 失效，成功與失敗分支均需檢查。補「延遲來源 lookup → 新範圍／新記憶／新搜尋」案例，確認舊回應不改新網址或畫面。對應 SCN-006、SCN-009。

### MUST FIX — 無效的空 project 網址未真正套用預設範圍

位置：`src/ui/app.ts:44`～`:57`。

`readState` 已把 `scope=project:` 判為 invalid，但回傳 scope 的條件只檢查 `startsWith('project:')`，沒有前述 `length > 8`。因此 `/ui/?scope=project:` 保留空 project；`initialize` 再添加「（無資料）」選項，列表 API 收到 `project=` 而回傳 400。畫面一面說「已套用可用的預設值」，一面誤報服務無法連線，重新連線仍使用同一非法條件。

建議：驗證與正規化共用一個 `validScope` 判斷，非法 scope 回退 all；在真實瀏覽器驗證此網址仍可讀取記憶且範圍控制項／網址提示一致。對應 SCN-009、SCN-010。

### MUST FIX — 啟動時的 schema readiness 只驗 facets，不足以拒絕未初始化資料根

位置：`src/server.ts:536`～`:538`、`src/core/db/memory-browser.ts:30`～`:36`。

存在 sessions.db 且只有 `sessions(project TEXT)` 的不完整 schema 時，`memoryFacets()` 可以成功，但列表所需的 events 及其他欄位不存在。UI 仍會綁定埠並印出成功網址，之後每次瀏覽皆失敗。這與 SCN-001「資料根未初始化時提供可行動錯誤」不一致。

實際隔離 probe：建立上述 SQLite，建構 Core 後呼叫 facets 與 list。輸出為 `facets.ok=true`，`list.ok=false,error="no such table: events"`。未修改真實記憶資料根。`startServer` 使用 facets 的現有分支會把此狀態當作 ready。

建議：以真正使用必要列表 schema 的唯讀探針，或明確必要 tables／columns 檢查作啟動驗證；保持無 migration／零業務寫入。測試存在但未初始化或缺必要表的 DB，CLI 應在印出成功狀態前失敗且資料不變。對應 SCN-001。

### SHOULD FIX — 桌面鍵盤開啟記憶後的焦點需確認

位置：`src/ui/app.ts:257`～`:272`、`:222`～`:227`。

`openMemory` 重建列表，原 focused row button 被移除；只有窄螢幕的 `loadDetail` 會明確聚焦返回按鈕，桌面沒有對應焦點恢復。應在桌面用 Enter 開記憶驗證 `document.activeElement`，確保焦點仍在合理位置，而非回到 body 使下一次 Tab 從導覽重新開始。建議保留所選列焦點或移到可見詳情區。這是尚待實際 browser 複核的具體風險，不把它偽稱為已觀察到的 UI 失敗。

### SHOULD FIX — 共用語意搜尋的取消與總時間限制

位置：`src/core/memoria.ts:243`～`:248`。

逐 exact project 呼叫 recall 正確排除了 top-k 之前的範圍餓死，但大量 environment project 時會序列啟動多個向量 helper；瀏覽器取消 fetch 不會停止 Core 後續迴圈。此版並未核准特定 project 數量的效能門檻，故不是本次 MUST FIX；建議清楚揭露取消僅停止呈現，或後續加入 HTTP 斷線／總預算取消，避免看似已取消的查詢長時間持續計算。

## 已查核維度

### 正確性與資料語意

- 列表依原始 session／DecisionMade／SkillLearned 分類，沒有把 skills 彙整或 vector entity 混作記憶計數；note 包裝 session 不在決策頁重複。
- project 用參數化確切條件，environment 在 SQL 或每個 scoped recall 之前限定。HTTP fixture 含超過 top-k 的 repository hits 與環境命中，覆蓋前次規劃審查提出的餓死風險。
- marker 綁原始 ref，不把同 session 的無關事件共同標記。detail 保留完整 rationale／原文、父 session 及 Git 來源缺失提示。
- optional marker／repository／provenance 表不存在時有明確 fallback；core fixture 以缺 optional tables、孤兒事件及檔案 byte 比較驗證唯讀，沒有以 initDatabase 修補後再宣稱零寫入。
- 新 `brief`／`recall` 第二參數保留預設初始化，UI 明確使用 `{initialize:false}`。本次 diff 未修改 recall 排名演算法；搜尋 telemetry 是明列的寫入例外。
- 搜尋結果保留 confidence null 語意，前端未顯示虛構正確率。主要 list／detail request 有 AbortController 與 sequence，漏掉的是上列來源 lookup 層。

### 安全與 HTTP 邊界

- UI 使用獨立 router，普通 serve 的 mutation routes 不會被掛到 UI。UI 明確監聽 `127.0.0.1`；Host 比對到確切 port，Origin／Fetch Metadata 驗證與 CSP／no-store／no-referrer／nosniff 齊備。
- 允許跨站頂層啟動的例外只適用無 Origin、GET、document navigation 的 `/ui/` 外殼；外殼沒有記憶，腳本與資料仍受原 gate。未發現此例外可直接讀取記憶或允許 iframe。
- 記憶值以 HTML escape 進入靜態模板，沒有直接把記憶放進 script、CSS、未限制 URL 或原始 HTML。資產路由固定，不解讀任意本機路徑。
- 獨立執行 16385 bytes 與 100000 bytes 的搜尋 body 請求：兩者均收到完整 `413` JSON。先前擔心 for-await 提早退出導致 reset，未在此 probe 重現，不列為缺失。沙箱第一次 listen EPERM 只屬環境限制，沙箱外隔離測試正常。

### 架構、維護與測試

- UI imports Core types，資料由 public Core 提供；HTTP 沒有複製搜尋排名。資產透過現有 esbuild 內嵌，不新增框架或 runtime 依賴。
- 測試用字面 fixture 驗 ID、來源、marker、長內容、分頁與環境 scope；未發現同義反覆或弱化既有測試。Core、HTTP、安裝與手動 browser 各有不同責任。
- npm 與 tar 安裝 helper 從 checkout 外讀同源資產、列表與詳情；它目前證明資源契約，沒有冒稱實際關閉網路。最終離線驗收仍由協調者補證據。
- 本次 diff 的 TS 使用分號與格式化型別區塊，和鄰近既有風格略不同，但非正確性阻塞。CSS 有局部重複宣告，屬可讀性改善，不影響本次判定。
- 核准基線 `31f4a6f` 與使用者「全部照建議」可追溯；未新增編輯、刪除、雲端、service 或 hook。無新 `需決策` 發現，以上 MUST FIX 均屬已核准行為的修正。

### 驗收與證據狀態

`verification.md` 已有 Core／HTTP 行為紅燈與綠燈、萬筆資料樣本，以及部分真實 browser 觀察；目前明列最終 browser／離線／交付尚在進行中。未完成的證據保持未完成，不因本次審查而作產品 PASS。這是進度限制，與已取得證據是否真實分開判定。

## 流程判定

**RETURN TO execute-task**。修正三項 MUST FIX，完成正式 browser／離線及交付證據後，應對新的固定 HEAD 重新獨立審查。本報告不代表尚未取得的商品驗收已失敗，也不把規劃 PASS 沿用為程式 PASS。
