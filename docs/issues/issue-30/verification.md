# Issue 30 - 驗證紀錄

## 版本與範圍

2026-10-26，核准規格基線 `31f4a6f`，原始碼 BASE `f89d6754a9eaa534c5ce018716698ddb70164721`。重驗使用 `ca19124` 後的修正工作區，六個有變動的程式／fixture 雜湊見文末；其餘實作與該提交相同。第一輪提交 `2777c31` 後的獨立審查又發現兩個導覽邊界，補修與證據見下節；最終報告必須綁定新的 HEAD。測試使用 Node v22.20.0、Linux x64 與隔離資料根；不在真實共用記憶庫寫入 fixture。正式 UI 原始碼與概念 prototype 分開，後者不屬產品交付。

## 首要紅燈與綠燈

- `bash scripts/test-memory-browser.sh` 初次在可執行環境 exit 1：`SCN-003: Core must expose a paged memory browser`，實際為 `undefined`。這是缺少目標能力的紅燈。沙箱中的 tsx IPC `EPERM` 另記為環境限制，不當作功能紅燈。
- `bash scripts/test-ui-http.sh` 初次 exit 1：`SCN-001 UI must bind only loopback`，實際 `::`、預期 `127.0.0.1`。
- 後續契約發現相同時間但不同 ISO 字串格式排序不一致；改用實際時間與穩定 ID 後，獨立 fixture 的分頁排序斷言通過。
- 頂層啟動契約先 exit 1：`static entry permits a top-level launch from another app`，實際 403。修正只允許無 Origin 的頂層 GET `/ui/` 外殼後，對應案例為 200；資料、腳本、iframe、未知 Host／Origin 仍為 403。
- 最新 `bash scripts/test-memory-browser.sh`、`bash scripts/test-ui-http.sh` 均 exit 0。覆蓋列表／詳情、完整理由、分類、精確範圍、常駐／已取代、分頁、舊 schema／孤兒事件唯讀與 HTTP 邊界。UI HTTP 比對一般瀏覽前後的 session、event、marker、source、skill、recall telemetry，內容完全相同。

## 效能樣本（SCN-012）

`bash scripts/test-memory-browser.sh`：同時間戳、混合 DecisionMade／SkillLearned 的 10000 個新增事件，另有原始 fixture；包含 100000 字元的長內容。先暖機兩次，再量測 20 次 50 筆列表。精煉後一次樣本（毫秒）：

```text
16.694 16.809 16.594 16.688 16.744 16.684 17.439 18.634 17.340 16.988
17.207 17.305 16.933 16.789 16.827 16.651 17.698 17.239 17.322 17.081
p95 = 17.698 ms，門檻 500 ms
```

列表回應不包含完整理由；50 筆換頁集合不重複，長內容按詳情讀取。這是本機暖查詢量測，不代表任何硬體或語意模型冷啟動時間。

## 真實瀏覽器檢查

可重現命令：`node --import tsx scripts/ui-browser-fixture.mts 48765`。此 helper 建立隔離資料、105 筆分頁事件、長內容與惡意文字，對「慢速」查詢注入 5 秒延遲。它使用正式 UI 原始碼與真實 Core；額外同源 timing probe 只量測 submit 到下一個畫面 frame，不隨發布。

- Chrome 顯示惡意 `<script>` 與 `<img onerror>` 原文；詳情中 DOM `script=0`、`img=0`，文字仍存在。
- 深色 1440px：正文對比 13.72、次要文字 8.26、已選列標題 9.66、來源操作 9.00。2026-10-26 最終淺色量測：正文 14.71、次要文字 6.12；必要控制項邊界淺色 3.55、深色 4.74。以實際 DOM computed style 的 sRGB 相對亮度比計算，均達核准門檻；不是完整 WCAG 認證。
- 320px：DOM 寬度 305px（含瀏覽器捲軸），無整頁橫向溢出；已驗列表→詳情→返回。手機換頁首筆曾位於可視區外 `-6162.84px`，修正後為 `42.16px`，返回時焦點恢復 `page-010`。
- 鍵盤 `/` 聚焦搜尋；Tab 走過方式、搜尋、取消、包含已取代後到結果列，`focusOutline=solid`；Enter 開啟詳情，Escape 返回 `qa-compatibility`。
- 延遲「慢速」搜尋後立即提交「相容」，只顯示相容記憶，未被晚回應覆蓋。timing probe 量到 9.0ms 與 13.8ms 的下一 frame 回應，均低於 100ms。
- 確定不匹配的 ASCII 查詢 `zzqnohit7392` 顯示無結果與清除操作；中文查詢是既有 ANY-token 檢索語意，不用包含已存在詞彙的句子假定零命中。
- 語意不可用時可見「語意搜尋暫不可用，已顯示關鍵字結果。」；不顯示 confidence 正確率。重新整理恢復 query、scope、mode 與本機外觀選擇。
- 2026-10-26 停止 fixture 服務，在仍開啟的畫面提交「相容」：顯示「暫時無法連線」與「重新連線」。重啟同命令後按重試，可打開相容決策；輸入框與網址仍保留「相容」，沒有自動重試迴圈。瀏覽器上一頁恢復列表且焦點為 `qa-compatibility`，下一頁恢復該詳情。
- `/ui/?id=missing-qa&type=decision` 顯示「這則記憶已不存在」與返回列表，與連線錯誤不同。`/ui/?scope=project:` 現在顯示預設值提示並成功列出 111 筆，不再把 400 誤報為斷線。
- 長內容詳情包含完整 750 字元混合標題與 5000 字元理由；1440px 的 scrollWidth/clientWidth 均為 1440。重新走過 320／768px 找記憶、展開來源、返回：320 的 clientWidth/scrollWidth 均為 305（瀏覽器捲軸），768 均為 768；Enter 開詳情後焦點為可見 `.back`，Escape 返回 `qa-sandbox`。來源顯示 `product-session`，無 Git 時明列「未記錄 Git 來源」。
- 桌面 Enter 開啟詳情後焦點移至可見返回按鈕，Escape 回原列；來源 lookup 注入 5 秒延遲後立即切記憶庫，晚回應不改新網址、111 筆列表或選取狀態。原先未保護此層的行為已由早期獨立審查 probe 證明失敗。
- CSS 靜態核對：`pointer:coarse` 對 button／summary／select／checkbox label 設最小 44px 高；`prefers-reduced-motion:reduce` 關閉 transition 與平滑捲動。此次 viewport 工具未模擬實體觸控與螢幕閱讀器；操作名稱、polite status、focus-visible 由 DOM／鍵盤實測及樣式確認，不冒稱完整輔具認證。驗證後已還原 viewport override。

## 回歸與安裝

以下命令均已實際 exit 0，對應當時相同業務行為；後續有關聯變更再重驗。

- `pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`。
- `pnpm run release:docs-check`；四支觸及 shell 的 `bash -n`；`git diff --check`。
- 依序 `test-pure-functions`、`test-smoke`、`test-cli-memory`、`test-memory-attributes`、`test-brief-scope`。
- 依序 `test-http-api`、`test-vector-recall`（stub 向量契約；未將其宣稱為 live 模型品質驗證）。
- `bash scripts/test-npm-install.sh`：隔離 npm prefix，UI 在 checkout 外啟動、內嵌資產與列表／詳情可用。
- `pnpm run release:package`、`bash scripts/test-no-clone-install.sh`：tar 交付 parity、checksum 與隔離安裝通過，安裝後 UI helper 通過。

2026-10-26 最終修正工作區重驗：check、build、help、release:docs-check、四支 shell 的語法及 diff --check 均 exit 0；依序 memory-browser → ui-http → http-api → vector-recall 全部 exit 0。最新效能 20 次樣本（毫秒）為：

```text
17.327 17.374 19.828 19.903 16.998 18.107 17.799 18.095 17.158 17.974
17.003 17.364 16.989 16.998 17.255 19.866 17.382 17.215 17.140 18.371
p95 = 19.866 ms，events = 10004
```

`bash scripts/test-npm-install.sh` exit 0；`pnpm run release:package` exit 0 後，`bash scripts/test-no-clone-install.sh` exit 0，兩者皆輸出 `PASS installed UI: outside checkout, embedded local assets, list and detail, restrictive network CSP`。打包首次被沙箱 `spawnSync tar EPERM` 阻擋，在沙箱外原樣重跑通過；一次提前啟動 tar 測試因包尚未產生失敗，依相依順序重跑通過，沒有修改斷言。

### 實際斷網（SCN-013）

本機先 `npm pack --ignore-scripts --silent --pack-destination /tmp/memoria-ui-offline-npm-pack`，以 `npm install --silent --no-audit --no-fund --prefix /tmp/memoria-ui-offline-npm-runtime <tgz>` 安裝；release 取上列打包 stage。再分別把完整 npm prefix、完整 tar stage 唯讀掛入既有 Node 22 Linux image，使用 `docker run --pull never --rm --network none --read-only --tmpfs /tmp:rw,exec,size=64m`。未拉取新 image、未修改既有容器；公開文件以 `existing-node22-image` 代稱該 image。

兩次皆設定獨立 `MEMORIA_HOME=/tmp/ui-data`、user config，清空 DB/session/config/vector overrides；依序執行 Node CLI 的 init、remember，再 `node /check-installed-ui.mjs <installed-cli> /tmp/ui-data`。npm CLI 位於 `/installed/node_modules/@raybird.chen/memoria/dist/cli.mjs`，tar CLI 位於 `/runtime/lib/cli.mjs`；helper 也以唯讀掛載提供。實際輸出皆為：

```text
v22.23.3 [ 'lo' ]
✓ 初始化完成: /tmp/ui-data
✓ 已記住: note-7e9a61c35d27b16d
PASS installed UI: outside checkout, embedded local assets, list and detail, restrictive network CSP
exit 0
```

`networkInterfaces()` 只有 lo，因此這是實際停用外部網路後的 HTML／CSS／JS、列表與詳情證據。第一次 npm 掛載只掛 node_modules 內容至錯誤父層，導致模組解析失敗；改掛完整 prefix 後通過，未改產品或依賴。不將此斷網測試宣稱為語意模型可離線冷啟動的驗證。

## 精煉與限制

依 code-simplify 將搜尋範圍與聚合由 HTTP 搬回 Core，前端不複製排名；新 TS／CSS 以現有 TypeScript printer 與 esbuild 整理可讀格式，沒有新增工具或依賴。Core／HTTP 精煉前後皆綠燈，最終重驗如上。UI 的列表、詳情與來源 lookup 有各自不同的請求生命週期，保留分開的失效序號，避免抽象化掩蓋導覽意圖；本輪其餘精煉 no-op。

早期 [程式審查](./review-code-ca19124.md) 的三項 MUST FIX 已修：來源 lookup 取消／序號、空 project 正規化、真正列表 schema readiness。readiness 新斷言先失敗 `Missing expected rejection`，修正後 ui-http 全綠；桌面焦點建議也已修正。其餘建議的限制：取消會立即停止 UI 呈現及後續回應覆蓋，但已在 Core 執行的 environment 多專案語意召回不會隨 HTTP abort 終止，可能繼續計算；未修改既有 recall 排名或模型逾時契約。此版未承諾全平台／所有硬體延遲，macOS、Node 18 與 live 模型品質另由既有 CI／整合驗證處理。規劃 PASS 或早期程式報告不代表最終 PASS，最終門檻以新的固定 HEAD 獨立報告為準。

## 最後審查的導覽補修

2026-10-26，獨立 reviewer 對 `2777c31` 找到兩個 SCN-009／010 的失敗面，均在隔離正式 UI 以 Chrome 重現，沒有修改真實資料或弱化測試：

- 摘要已載入後，以 sqlite3 刪除 fixture 的 `qa-sandbox`，點畫面中仍存在的摘要按鈕。紅燈：readerHidden=true、briefHidden=false，404 實際在不可見區域。改以 `openMemory(id)` 重用導覽路徑，避免 catch 複製不完整狀態操作；綠燈：readerHidden=false、view=library，顯示「這則記憶已不存在」與返回操作，返回後列表為 110 筆。
- 網址 `/ui/?q=%20%20`。紅燈：空白字串被當成搜尋，畫面誤報「暫時無法連線」。readState 先 trim，再把純空白 query 視為無效並回退空查詢；綠燈：111 筆決策、輸入為空，顯示已套用預設值提示。

兩個函式的 upstream impact 都為 LOW（readState 一個直接引用、resolveMemory 無直接引用）；無額外 execution flow。補修後 check／build／help 及 UI HTTP 重驗 exit 0。這兩項是可由真實畫面完整判定的導覽邊界，本次以瀏覽器紅綠合併同層內外迴圈；Core／HTTP 沒有新增語意，原先資料與安全契約證據仍有效。來源錯誤分支縮成既有 openMemory 呼叫是本輪精煉，未另增抽象層；其餘精煉 no-op。

補修後依序重跑 `test-ui-http`、`test-npm-install`、`release:package`、`test-no-clone-install` 全部 exit 0；新建 `/tmp/memoria-ui-offline-final-prefix` 安裝最後 npm 包，並對它與最新 tar stage 重跑上述 Docker 斷網案例，兩者再次只有 lo 且 `PASS installed UI`／exit 0。Proof of Test 以 Python 比對核准規格與表格 ID 集合，結果 `13 unique approved scenarios, exact set`。

### 未知來源類型遇斷線

`96b9421` 的 [獨立複審](./review-96b9421.md) 又以原函式與真實 Core 證明：來源 lookup 斷線失敗後，預設 kind 把仍存在的 skill／session 猜為 decision；恢復服務後 typed GET 誤報404。這是 SCN-005／009／010 的紅燈，沒有改需求或放寬後端 enum。

修正使 detailType 可以未確認：未知來源不把 kind 寫入網址或 GET，真正讀到詳情後才以實際 type 替換同一 history entry；已知類型仍保留精確查詢。沿用原有請求序號／取消及 openMemory 導覽，未新增另一套恢復流程。readState／updateUrl／openMemory／loadDetail／renderRows／resolveMemory 的 upstream impact 均 LOW，直接引用分別 1／4／1／3／2／0，沒有新增後端 flow。

Chrome 隔離實測兩種資料：

1. 摘要常駐 Session `note-5e5c41b325f490ee`：先載入摘要，再停止 fixture，點「所有專案共用同一份記憶」。可見「無法讀取記憶／重試」，網址保留 id 而無 detail_type；重新啟動同命令後按重試，顯示 `preferences / Session`、完整原文及「未記錄理由」，網址替換為 `detail_type=session`；重新整理仍正確。
2. fixture 新增 `core.markMemory('qa-skill',{retention:'durable'})`：同樣在摘要載入後停服務，點「以隔離資料驗證介面」。錯誤可見且網址無 detail_type；重啟後按重試，顯示 `Memoria / 技能`、常駐與完整 pattern，沒有誤報404。

新增 HTTP 字面 fixture：`ui-skill` 無 type 解析為 skill、`ui-sample` 無 type 解析為 session；兩者指定錯誤 `type=decision` 仍404。`test-ui-http` exit 0。check／build／help／release:docs-check、npm-install → release:package → no-clone-install 均 exit 0。最後 npm 包另裝 `/tmp/memoria-ui-offline-unknown-prefix`，與最新 tar stage 分別重跑 network none：Node v22.23.3、只有 lo、`PASS installed UI`、exit 0。此輪變更只涉及前端與 fixture，未改 Core／排名／安全 gate；既有底層回歸與視覺量測仍有效。精煉保留既有導覽與失效機制，其他 no-op。

### 後續 UI 交付的手動邊界矩陣

以下項目列為此 fixture 的可重現交付檢查，補足 reviewer 提醒的手動證據持久力；目前沒有新增 browser 自動化依賴：

- `?scope=project:`、`?q=%20%20`：提示預設值且可讀列表；一般 missing id 顯示404與返回。
- 摘要先載入、再刪 fixture event、點原連結：404 必須可見；來源 lookup 延遲後改導覽：舊回應不得改網址或選取。
- 預設 decision → 摘要常駐 skill／session → 停 fixture → 點來源 → 重啟 → 重試 → 重整：讀到實際 kind、原文與正確 detail_type，失敗期間不猜類型。

## Proof of Test

固定規格為 `31f4a6f:docs/issues/issue-30/README.md`，以下每列對應同名 SCN；最終被測版本以本紀錄雜湊與獨立報告的 HEAD 交叉確認。無豁免及未決需求。

| SCN | 可觀察結果 | 測試／等價證據 | 結果 |
| --- | --- | --- | --- |
| SCN-001 | loopback、未初始化／不完整 schema／埠衝突失敗；普通 serve 保持 | test-ui-http；本紀錄首要紅綠及回歸 | PASS |
| SCN-002 | Host／Origin／路徑／寫入拒絕；惡意原文不執行；瀏覽零業務寫入 | test-ui-http、Chrome DOM script=0/img=0 | PASS |
| SCN-003 | 原始類型、note 不重複、穩定 50 筆分頁及空集合 | test-memory-browser；Chrome 分類／換頁 | PASS |
| SCN-004 | exact project／environment、durable、superseded 的正負向矩陣 | test-memory-browser、test-ui-http | PASS |
| SCN-005 | 完整理由／原文、marker、父 session、Git／缺失來源 | test-memory-browser；Chrome 詳情／來源／404 | PASS |
| SCN-006 | 明確搜尋、scope、降級、null 語意、取消與晚回應保護 | test-ui-http、test-vector-recall；Chrome 延遲搜尋／來源 probe | PASS |
| SCN-007 | 現有 brief 內容與 scope；不寫 BRIEF.md | test-ui-http、test-http-api、test-brief-scope；Chrome 摘要 | PASS |
| SCN-008 | 中文工作台、深淺色、長內容完整且不溢出、本機外觀保存 | Chrome 1440px／主題重整／750 字標題與 5000 字理由 | PASS |
| SCN-009 | 網址／history 恢復查詢與詳情；返回焦點；無效網址可恢復 | Chrome back/forward、空 project、missing ref、來源 race | PASS |
| SCN-010 | 載入、無結果、404、斷線分流；重試保留相容條件 | Chrome 狀態檢查；停止／重啟隔離服務實測 | PASS |
| SCN-011 | 320／768／1440 三任務、鍵盤焦點、對比門檻及觸控／減動樣式 | Chrome DOM／鍵盤／對比量測；coarse/reduced-motion CSS 核對 | PASS（輔具實測限制如上） |
| SCN-012 | 萬筆 p95 19.866ms、50 筆資料、提交畫面回應 9.0/13.8ms | test-memory-browser 原始樣本；Chrome timing probe／換頁位置 | PASS |
| SCN-013 | npm／tar 在 checkout 外、只有 lo 的斷網容器均可用 | test-npm-install、release:package、test-no-clone-install；Docker 實測 | PASS |

## 被測修正工作區雜湊

```text
a2b7a7adf43e509b71fb895d7102048919436e384469b076c1b92fe91b7e5acb  src/server.ts
c1f60333566aa5cb88fff5464f868c40267690c45792114e789b1f3015b37424  src/ui/app.ts
f7a567fae79080d0dc1d18a8a7d5d93cab281bb59024ba6ca0e4cb49b4f7c6b5  src/ui/router.ts
4f449452321014de0c22212c0539d7d12b7ca8f75aac6bed940890657c960580  src/ui/style.css
9e8fb3f57d3482405f44bccbd96bf163b4d04dc4dbf530543bacd126264dcf20  scripts/ui-http-driver.mts
3eec763d59bfc1db23d9d0a2021c66dff74cdfc1f86e9f606ae536aec6bc7514  scripts/ui-browser-fixture.mts
```
