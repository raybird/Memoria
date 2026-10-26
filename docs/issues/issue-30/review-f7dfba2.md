# Issue 30 最終完整程式審查報告

- 範圍：完整本機交付 `f89d675..f7dfba2`；涵蓋產品原始碼、Core／HTTP／UI、資產打包、測試、CI 與文件，並複核歷次 RETURN 的所有修正。
- Reviewed BASE SHA：`f89d6754a9eaa534c5ce018716698ddb70164721`
- Reviewed HEAD SHA：`f7dfba28abec652fdcc3fbfb9fd6bb7cab970c82`
- Reviewed patch-id：`df2a3fadca196480338f41546a6bb2fab5d68d4f`
- 獨立 reviewer：宿主 subagent `/root/final_review`，未參與產品實作。
- Review artifact：`docs/issues/issue-30/review-f7dfba2.md`
- 日期：2026-10-26；風險 High（本機完整記憶的瀏覽器存取入口）。

## 問題與風險

**無剩餘 MUST FIX，無需使用者新增決策，無 gate 豁免。**

### SHOULD FIX — UI 邊界證據的持久力

網址／history／未知來源斷線恢復目前採真實 Chrome 手動證據；本次 reviewer 另用現有 TypeScript transpiler 執行原函式邊界 probe，沒有新增 browser 自動化依賴。`verification.md` 已新增可重現的手動邊界矩陣，fixture 加入常駐 skill，HTTP 增加無 type／錯誤 type 契約。建議後續將純狀態正規化與錯誤導覽納入持久自動化，或每次 UI 變更都執行該手動矩陣。這是防回歸的建議，既有測試與本次實測有效，不構成假綠燈或本次阻塞。

### NICE TO HAVE — 局部可讀性

`style.css` 的全域／mobile `.back` 規則有相同宣告，`serve.ts` 的普通 API 日誌區塊縮排可再整理；沒有發現造成行為分歧的重複邏輯。AGENTS 的 CI parity 表可補列兩個已加入 CI 的 UI 腳本；目前測試清單與局部 UI 指引已列出，實際 CI 與 package scripts 仍是權威。這些均不影響本次驗收。

## 歷次 MUST FIX 複核

| 發現 | 修正及有效證據 | 結論 |
| --- | --- | --- |
| 來源 lookup 晚回應改寫新導覽 | AbortController＋來源意圖序號；refresh、開啟、返回與 popstate 令舊 lookup 失效；成功／catch 都先 guard。Chrome 延遲來源後改導覽，及 reviewer 成功／失敗晚回應 probe 均不改新畫面。 | 已解決 |
| 空 `scope=project:` 沒有真正回退 | readState 共用 validScope 作驗證與正規化；111 筆與無效參數提示，沒有空 project 400。 | 已解決 |
| readiness 只查 facets | 啟動前真正唯讀查一筆列表，缺必要 events 表拒絕且有可行動錯誤；新增斷言紅燈後綠燈。 | 已解決 |
| 摘要引用已刪 ref，404落入隱藏 reader | 來源失敗也走共用 openMemory 導覽；Chrome 刪隔離 event 後點既有摘要，404可見且返回110筆。 | 已解決 |
| 純空白 q 被當有效搜尋 | URL query 與提交一致 trim；純空白 invalid 並回退空查詢。Chrome 由誤報斷線變成111筆、空輸入與提示。 | 已解決 |
| 未知來源斷線後猜 decision，重連誤404 | detailType 保留 undefined，未知 GET／URL不傳type，成功後以真實kind replace同一history entry；已知類型仍精確傳type。Chrome 常駐Session及skill真停／啟服務皆可重試；HTTP及reviewer原函式probe通過。 | 已解決 |

桌面焦點建議亦已修正：Enter 開詳情移至可見返回按鈕，Escape 返回原列；不是只在手機才處理焦點。

## 已查核維度

### 版本、核准與完整交付範圍

核准規格為 `31f4a6f:docs/issues/issue-30/README.md` 的 SCN-001～013，使用者 Q1～Q3「全部照建議」可追溯。核准集合與 Proof of Test 完全相等，無擅加編輯／刪除／雲端／service／hook，亦無新工具或 runtime 依賴。

本 reviewer 已在 [2777c31 完整報告](./review-2777c31.md) 查核完整原始碼、安全、資料、打包及文件；本次逐一比對其後完整 delta，未受變動內容可重用同一證據。`96b9421..f7dfba2` 只有前端未知類型處理、HTTP字面fixture、手動fixture及驗證／歷史報告；後端／排名／schema／安全gate／CI／依賴未改。六個最終程式／fixture SHA-256 與驗證紀錄一致，其中 app 為 `c1f60333566aa5cb88fff5464f868c40267690c45792114e789b1f3015b37424`。沒有把原先 RETURN 或規劃 PASS 當成本版本的程式 PASS。

### 13 項驗收覆核

證據詳見 [verification.md](./verification.md) 的首要紅綠、真實瀏覽器檢查、安裝／斷網、導覽補修與 Proof of Test；固定規格來源如上。

| SCN | 可觀察行為及覆蓋 | 結論 |
| --- | --- | --- |
| SCN-001 | 明確serve --ui、127.0.0.1、真實資料根；缺資料／必要schema／埠衝突先失敗，不自動init、換root或裝服務；普通API契約有回歸。 | PASS |
| SCN-002 | 真實HTTP Host／Origin／Fetch Metadata／寫入／任意路徑負向矩陣；固定資產及CSP；Chrome惡意原文未產生script/img；一般瀏覽前後業務與telemetry相等。 | PASS |
| SCN-003 | 原始decision／skill事件及session分類，note包裝session不混入預設decision；上限50、實際時間＋穩定ID、同時間翻頁不重複、空集合與明確計數。 | PASS |
| SCN-004 | exact project、registry外environment、durable／superseded依原始ref；所有session project提供facets，沒有只取最近頁的範圍。 | PASS |
| SCN-005 | 完整理由／原文／父session與Git來源、tag／commit範圍；缺理由／來源明示；已刪摘要ref與未知skill／session斷線恢復均有最終實測。 | PASS |
| SCN-006 | 明確提交搜尋、scope在top-k前限定；多於top-k的projecthits不餓死environment；語意降級、null語意、無虛構概率、取消及晚回應guard；瀏覽不recall或feedback。 | PASS |
| SCN-007 | 使用既有BriefData與project／environment政策，不複製renderer或排名；HTTP及UI瀏覽不寫BRIEF.md。 | PASS |
| SCN-008 | 中文工作台、深淺／系統外觀、本機保存、完整長內容及混合字串；750字標題／5000字理由與無溢出有真實DOM證據。 | PASS |
| SCN-009 | URL／reload／back／forward恢復查詢與詳情；列表焦點／位置；空project／空白q／missingref提示；未知kind恢復後replace網址而非猜類型。 | PASS |
| SCN-010 | 載入、空資料／零命中、404、斷線分流；真停／啟服務重試保留條件；摘要失效及跨類型來源重試有紅綠且不無限自動重試。 | PASS |
| SCN-011 | 320／768／1440核心任務、鍵盤／可見焦點、一般文字≥4.5及控制項≥3；coarse 44px與reduced-motion樣式核對。實體觸控／螢幕閱讀器未冒稱測過。 | PASS（限制明示） |
| SCN-012 | 10004事件、混合10000新增、長100000字內容；兩次暖機＋20樣本，50筆列表p95 19.866ms；提交下一frame 9.0/13.8ms，長內容按詳情讀取。 | PASS |
| SCN-013 | npm／tar安裝在checkout外；最終兩種產物於network none、唯讀掛載、只有lo的Node22容器成功讀HTML／CSS／JS、列表及詳情；無prototype／fixture入包。 | PASS |

### 獨立重驗與失敗面

本次於固定 HEAD 執行 `pnpm run check && bash scripts/test-ui-http.sh`，exit 0，後者輸出 `PASS UI HTTP: loopback, assets, CSP, routes, scopes, host/origin/fetch-site, read-only, missing root, legacy`。新增 literal fixture 明確驗 `ui-skill` 無type為skill、`ui-sample`無type為session，錯誤type=decision仍404；保留真正類型區分，未放寬邊界來換綠燈。

另以 `node --input-type=module`、現有 TypeScript transpiler 對本 HEAD 的 `resolveMemory`、`openMemory`、`loadDetail` 原文執行隔離函式 probe，字面斷言輸出如下；不是browser E2E，也未修改產品：

```text
unknownRecovery: PASS
knownTypedGet: PASS
lateDetailGuard: PASS
sourceSuccessGuard: PASS
sourceFailureGuard: PASS
```

其中 unknown 先模擬 Failed to fetch，確認仍無detailType且錯誤可見；恢復後 GET 無type並讀到skill／完整pattern，replace URL為skill；再讀則精確用 `?type=skill`。晚detail及來源成功／失敗回應均在序號失效後丟棄，不改新id或類型。真實Chrome跨類型停／啟服務、reload與最終npm／tar實際斷網結果，另核對協調者持久化紀錄。Core／HTTP不變，前次獨立memory-browser p95 18.702ms及完整HTTP／vector／smoke回歸可按版本重用；未宣稱reviewer自行跑過所有CI或所有平台。

### 安全與權限

- 獨立受限router只掛明列讀取與explicit search；普通API的mutation不掛入UI。exact 127.0.0.1 Host／port、Origin及Fetch Metadata拒絕跨來源資料讀取與hostname rebinding。
- 外部app頂層啟動只例外允許無Origin的GET `/ui/` shell，其內無記憶。script、iframe、data無例外；CSP禁止framing、inline／外部script及外部資源，另有no-store／no-referrer／nosniff。
- 固定資產allowlist，不讀任意本機路徑；所有記憶輸出escape為文字，沒有將內容放入可執行HTML／URL。私人資料可由本機擁有者查看，未宣稱多人授權。
- SQL參數化、enum種類、分頁上限與16KiB搜尋body限制齊備。一般列表／詳情readonly/fileMustExist，不init或migration；唯一允許資料服務寫入是明確搜尋的既有routing telemetry，無自動utility feedback。

### 架構、資料及精煉

業務在Core，HTTP轉接，browser只匯入Core型別。原始events／sessions及ref markers為權威，沒有把彙整skills或vector數混算；Git provenance讀取與缺失提示保留原始關係。舊optional tables與孤兒事件可讀，fixture有byte comparison，沒有先修DB才宣稱唯讀。列表只送短display欄位，詳情才送全文。

brief／recall的可選初始化參數預設維持舊行為，既有排名未改。環境搜尋聚合在Core，沒有前端或HTTP的第二套排名／confidence。資產以現有esbuild內嵌，production不需esbuild或frontend server，npm／tar從同一bundle交付。未知來源重用openMemory與loadDetail，明確保留unknown事實；不再複製不完整錯誤導覽，也沒有新增不必要抽象層。其餘局部CSS重複只屬可讀性建議。

### 測試真偽、豁免與限制

沒有刪除、略過或弱化既有測試。ID、全文、scope、marker、來源與錯誤type用獨立字面fixture判定，非複製實作算期望；Core、HTTP、browser、安裝各有不同失敗面。先前紅燈為可觀察功能失敗，沙箱EPERM、提前測tar或錯誤mount等環境失敗已分開揭露。browser frame timing不冒充模型或總查詢延遲。

取消立即停止UI呈現及晚回應覆蓋，但已執行的environment多專案語意召回可能在後端繼續計算；未承諾後端取消SLA。效能為目前Node22 Linux硬體暖查詢；Node18／macOS、live模型冷啟動與品質、實體輔具未在本次冒稱全面驗證。這些與核准範圍相容且已揭露，無需新增豁免。沒有未處理的必要需求決策。

## 流程判定

**PASS**。完整交付的13項核准驗收有有效證據，所有MUST FIX已修，獨立報告已保存。Task 3.2 的最後獨立審查 gate 完成，dev-cycle 狀態為 **等待合併**；目前 **尚未 merged、未開PR、未發版**，不將等待合併寫成已完成結案。

此PASS只綁定上述Reviewed HEAD。協調者可依`review-evidence.md`新增唯一一個只加入本報告的直接後繼提交，並用review skill的verify-artifact.py驗證例外；其他程式／測試／文件變更或改寫歷史必須重新核對審查有效性。
