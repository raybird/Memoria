# Issue 30 完整程式審查報告

- 範圍：完整本機交付 diff `f89d675..2777c31`，包含產品原始碼、資產、Core／HTTP／安裝測試、CI 與文件；不是只審查前次修正。
- Reviewed BASE SHA：`f89d6754a9eaa534c5ce018716698ddb70164721`
- Reviewed HEAD SHA：`2777c3142eead5171adbb6984257462af15778c7`
- Reviewed patch-id：`9691674908fb98bb95b352f0f8fd521ee520e2bf`
- 獨立 reviewer：宿主 subagent `/root/final_review`，未參與產品實作。
- Review artifact：`docs/issues/issue-30/review-2777c31.md`
- 日期：2026-10-26。
- 風險：High，本機完整記憶的瀏覽器存取入口；審查保留既有核准範圍，不新增功能需求。

## 問題與風險

### MUST FIX — 摘要連結已失效時，404 被放進隱藏的詳情區

位置：`src/ui/app.ts:334`～`:351` 的 `resolveMemory` catch；`syncChrome` 在 brief view 隱藏 `.reader`。

摘要載入後，若某筆記憶由另一個 CLI／程序清理，使用者點擊仍在畫面的摘要連結，來源 lookup 回傳 404。catch 只設定 `state.id`、`mobileReading` 並執行 `loadDetail`，沒有像成功分支的 `openMemory` 一樣從 brief 切換至 library。因此詳情雖產生「這則記憶已不存在」，仍然不可見，畫面保留過期摘要，也沒有可見返回／重試操作。這違反 SCN-005、SCN-009、SCN-010 的缺失來源與可恢復錯誤要求。

獨立函式邊界 probe 使用 reviewed `resolveMemory` 原文經現有 TypeScript transpiler 移除型別，模擬 API reject 404，輸出：`state.view="brief"`、`state.id="deleted-pinned"`、`readerHidden=true`、`detailCalls=1`。此 probe 不冒充 browser E2E。協調者另以真實隔離 UI 載入摘要、刪除該 fixture 記憶再點原連結，觀察相同 `readerHidden=true,briefHidden=false`，確認真實畫面缺失。

建議失敗分支也走共用的可見詳情導覽，再由詳情處理 404／斷線，不複製 brief→library 的狀態邏輯。補「摘要載入→記憶刪除→點原摘要連結→看見 404 並返回」證據。

### MUST FIX — 只含空白的網址查詢被當成有效搜尋，重試持續得到 400

位置：`src/ui/app.ts:37`～`:58` 的 `readState`。

`/ui/?q=%20%20` 被讀成 `query:"  "`、`invalid:false`。一般表單提交會 trim，但 URL 恢復沒有同樣正規化；它將空白送給 `memorySearchSchema` 的 `trim().min(1)`，回傳 400。`loadList` 把這個無效條件顯示成「暫時無法連線」，重新連線仍保留同樣非法查詢，與 SCN-009、SCN-010 的無效網址恢復不符。

獨立 probe 執行 reviewed `readState` 原文，輸出 `{"invalid":false,"view":"library","query":"  "}`；schema 的空白拒絕與 UI catch 路徑可由程式直接確認。協調者另以 Chrome 確認舊畫面顯示連線失敗。建議 URL query 與表單使用一致的 trim，純空白回到無搜尋並給無效條件提示；不能只隱藏錯誤或降低後端驗證。

### SHOULD FIX — UI 邊界測試持久力

現有 Core／HTTP／安裝測試是有效的行為測試，手動 browser 紀錄也有實際值；但 URL 正規化與來源導覽沒有持久的自動化守門，因而兩個上述 UI 失敗不會使現有綠燈轉紅。建議用現有工具為純狀態正規化及導航失敗路徑增加持久測試，或在每次 UI 交付的手動矩陣明列。這是證據持久力建議，不將有效的既有測試指為假綠燈。

### NICE TO HAVE — 可讀性與文件導覽

`style.css` 的 `.back` 在全域及 mobile media 重複相同規則；`serve.ts` 的 API 日誌區塊縮排可整理。兩者不造成當前語意分歧，不是 MUST FIX。根 AGENTS 的 CI parity 表尚可補入已實際加進 CI 的兩個 UI 腳本；目前測試清單與局部 UI 指引已列出它們，CI 仍是權威。

## 前次發現複核

- `review-code-ca19124.md` 的來源 lookup 晚回應覆蓋問題：已加入獨立 AbortController／意圖序號，refresh、openMemory、返回、popstate 經適當路徑失效，成功與 catch 皆先 guard；協調者延遲來源實測已通過。此次新問題是失敗後的可見導覽，不是舊競態未修。
- 空 `scope=project:`：共用 `validScope` 作檢查及回退，恢復 all；Chrome 記錄有 111 筆與提示。此次空白 q 是另一個 URL 邊界。
- readiness：啟動前真正查一筆列表，缺 events 會拒絕；新增斷言有 `Missing expected rejection` 紅燈及修後綠燈。沒有為探針呼叫 init／migration。
- 桌面焦點：詳情成功後聚焦可見返回按鈕，Escape 回原列，已取得桌面／手機操作證據。
- environment 多專案語意搜尋取消只停止 UI 呈現，後端可能繼續計算：已有明確限制揭露，沒有核准後端總耗時 SLA，不列本次 MUST FIX。

## 已查核維度

### 驗收與證據

核准來源為 `31f4a6f:docs/issues/issue-30/README.md` 及使用者 Q1～Q3「全部照建議」。13 項核准與 Proof of Test 的 ID 集合相等，無 gate 豁免或需決策發現。未發現偷加編輯、刪除、雲端、service、hook 或依賴。

| SCN | 查核與判定 |
| --- | --- |
| SCN-001 | loopback、確切 Host、缺資料／必要 schema／埠衝突與原 API 模式均有真實 HTTP 契約；通過。 |
| SCN-002 | 獨立 allowlist、Host／Origin／Fetch Metadata、CSP、固定資產、內容 escape、一般瀏覽前後業務／telemetry 比較；Chrome 惡意原文 DOM 檢查；通過。 |
| SCN-003 | 原始事件／session 分類、預設不重複 note session、上限50、同時間穩定分頁；fixture 字面 ID 斷言與 UI 分類可追溯；通過。 |
| SCN-004 | exact project、registry 外 environment、durable／superseded 按原 ref；含多於 top-k 的 repository hit 不餓死共用資料；通過。 |
| SCN-005 | 原文、長 rationale、父 session、Git tag／commit 與來源缺失由 Core fixture 覆蓋；一般詳情可讀，但摘要引用失效的錯誤不可見，需修。 |
| SCN-006 | Core 先 scope 再 top-k，沿用 recall；列表／詳情不 recall、無自動 feedback；null 不呈現概率、向量降級及晚回應 guard；通過。 |
| SCN-007 | 直接使用既有 BriefData 與 scope，無 renderer／排名複製；BRIEF.md 不寫入；通過。 |
| SCN-008 | 真實產品／隔離資料，中文深淺色、750字標題與5000字理由、主題保存均有紀錄；通過。 |
| SCN-009 | history、返回焦點／位置及一般 missing ref 有證據；上述摘要失效與空白 q 邊界需修，不能以其他成功情境覆蓋。 |
| SCN-010 | 實際停止／重啟服務重試、載入／零命中／404 的不同文案有證據；上述兩個失敗路徑仍不完整，需修。 |
| SCN-011 | 320／768／1440 核心流程、鍵盤／焦點、正文與必要控制項對比有實際值；coarse 44px 與 reduced-motion 靜態核對；輔具／實體觸控未冒稱測過，通過且保留限制。 |
| SCN-012 | 10004事件、混合10000新增、長100000字內容、2次暖機＋20樣本、50筆transport、p95 19.866ms及submit下一frame 9.0/13.8ms；通過。 |
| SCN-013 | npm／tar 隔離安裝 helper 與只有lo的Docker network none實測可追溯，資產內嵌且不夾原型／fixture；通過。 |

本 reviewer 另執行 `pnpm run check && bash scripts/test-memory-browser.sh && bash scripts/test-ui-http.sh`，exit 0；Core 樣本 p95 18.702ms，兩個腳本均輸出 PASS。協調者並行修前端時，未將此執行冒稱為新前端版本的 browser 驗收；固定 reviewed HEAD 的六個工作區雜湊已與 `git show` 及驗證紀錄交叉核對。其他 HTTP／vector／smoke／安裝重驗依協調者持久化紀錄查核，未宣稱 reviewer 自己重跑全部 CI。

### 安全、資料與架構

- UI 的商業寫入不掛到 router；唯一 POST 是明確搜尋。普通 serve 的既有功能不因 UI 模式縮限。127.0.0.1 固定 Host／Origin 防止 hostname rebinding 或跨來源資料讀取。
- 跨站入口例外限無 Origin 的頂層 `/ui/` shell；沒有記憶、沒有 iframe／script／data 例外。CSP 禁 framing、inline script、外部資產，另有 no-store、no-referrer、nosniff。
- SQL 使用參數，種類來自 enum；列表在 SQL 只取短 display fields，完整內容按詳情載入。readonly/fileMustExist，舊 optional tables 不建立，孤兒來源明示且 byte comparison 有效。
- Git provenance 按 memory ref／父 session 讀取，標記不任意套到同 session 所有事件。已刪 provenance 與取代者保持可追溯，不以推測補內容。
- 業務邏輯在 Core，HTTP 為驗證與轉接，前端只匯入型別，沒有另一套 confidence／排名。brief／recall optional 初始化旗標預設保留舊呼叫者行為。
- 架構及工具選擇適合當前範圍，無新 schema／runtime 依賴。未發現為未來設計的額外資料層；來源失敗分支與 openMemory 的狀態重複已造成分歧，故列 MUST FIX 並建議共用現有導覽。

### 測試真偽與限制

Core fixture 的期望 ID、來源、完整文字與 markers 是字面獨立資料；HTTP 測真實 request、拒絕路徑及資料前後比較；沒有刪除／弱化既有斷言或以 mock 核心能力冒充安裝。效能統計用20樣本的第19順位，與95百分位門檻一致。browser timing probe 僅量submit→下一frame，不宣稱包含模型冷啟動。

實際斷網證據用完整安裝產物、readonly mount及 network none；先前錯誤掛載導致模組解析失敗有揭露，後續修正環境通過，未以改測試掩蓋。Node18／macOS／live模型與實體輔具限制明確；不是未經授權的需求豁免。商品視覺為目前實測環境的驗收，非全平台認證。

## 流程判定

**RETURN TO execute-task**。兩項 MUST FIX 都屬既有核准 SCN 的正確性修正，無需新增需求決策。修正並補齊紅綠證據、提交新 HEAD 後重新獨立審查；本報告不沿用至後續修改，也不把局部綠燈當作完整產品 PASS。
