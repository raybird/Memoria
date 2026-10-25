# Issue 30 - 驗證紀錄

## 版本與範圍

2026-10-25，核准規格基線 `31f4a6f`，原始碼 BASE `f89d675`。本紀錄隨實作更新，未標完成的證據不作為驗收通過。測試使用 Node v22.20.0、Linux x64 與隔離資料根；不在真實共用記憶庫寫入 fixture。正式 UI 原始碼與概念 prototype 分開，後者不屬產品交付。

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

## 真實瀏覽器檢查（進行中）

可重現命令：`node --import tsx scripts/ui-browser-fixture.mts 48765`。此 helper 建立隔離資料、105 筆分頁事件、長內容與惡意文字，對「慢速」查詢注入 5 秒延遲。它使用正式 UI 原始碼與真實 Core；額外同源 timing probe 只量測 submit 到下一個畫面 frame，不隨發布。

- Chrome 顯示惡意 `<script>` 與 `<img onerror>` 原文；詳情中 DOM `script=0`、`img=0`，文字仍存在。
- 深色 1440px：正文對比 13.72、次要文字 8.26、已選列標題 9.66、來源操作 9.00。控制項邊界另增專用色，最終淺色與邊界量測待回寫。
- 320px：DOM 寬度 305px（含瀏覽器捲軸），無整頁橫向溢出；已驗列表→詳情→返回。手機換頁首筆曾位於可視區外 `-6162.84px`，修正後為 `42.16px`，返回時焦點恢復 `page-010`。
- 鍵盤 `/` 聚焦搜尋；Tab 走過方式、搜尋、取消、包含已取代後到結果列，`focusOutline=solid`；Enter 開啟詳情，Escape 返回 `qa-compatibility`。
- 延遲「慢速」搜尋後立即提交「相容」，只顯示相容記憶，未被晚回應覆蓋。timing probe 量到 9.0ms 與 13.8ms 的下一 frame 回應，均低於 100ms。
- 確定不匹配的 ASCII 查詢 `zzqnohit7392` 顯示無結果與清除操作；中文查詢是既有 ANY-token 檢索語意，不用包含已存在詞彙的句子假定零命中。
- 語意不可用時可見「語意搜尋暫不可用，已顯示關鍵字結果。」；不顯示 confidence 正確率。重新整理恢復 query、scope、mode 與本機外觀選擇。

## 回歸與安裝（已執行部分）

以下命令均已實際 exit 0，對應當時相同業務行為；後續有關聯變更再重驗。

- `pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`。
- `pnpm run release:docs-check`；四支觸及 shell 的 `bash -n`；`git diff --check`。
- 依序 `test-pure-functions`、`test-smoke`、`test-cli-memory`、`test-memory-attributes`、`test-brief-scope`。
- 依序 `test-http-api`、`test-vector-recall`（stub 向量契約；未將其宣稱為 live 模型品質驗證）。
- `bash scripts/test-npm-install.sh`：隔離 npm prefix，UI 在 checkout 外啟動、內嵌資產與列表／詳情可用。
- `pnpm run release:package`、`bash scripts/test-no-clone-install.sh`：tar 交付 parity、checksum 與隔離安裝通過，安裝後 UI helper 通過。

安裝 helper 驗證所有資產都是同源路徑及 CSP 不允許外部資源，沒有新增網路資產依賴；這是資源契約證據，不冒稱已關閉作業系統網卡。最終原始碼、瀏覽器失敗恢復與交付安裝重驗尚待收斂。

## 精煉與限制

依 code-simplify 將搜尋範圍與聚合由 HTTP 搬回 Core，前端不複製排名；新 TS／CSS 以現有 TypeScript printer 與 esbuild 整理可讀格式，沒有新增工具或依賴。Core／HTTP 精煉後綠燈如上。整體商品驗收與獨立產品審查尚未完成，規劃審查的 PASS 不代表產品 PASS。
