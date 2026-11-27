# Issue 43 - top_k 與 --verify 的輸入驗證收緊 (Small)

## 概述

2026-11-27 待確認事項逐題確認時，有兩筆已知限制都是輸入驗證太寬，使用者決定合併成這個 issue：

- **`top_k` 沒有一致的驗證**（[issue-34](../issue-34/README.md) TBD-4）：
  - `POST /v1/recall` 與 `POST /v1/wiki/file-query` 的 `top_k` 只驗 `z.number()`（`src/server.ts` 的 `recallSchema`、`fileQuerySchema`），負數、小數、超大值都會直接進 recall 的 `slice(0, topK)`。負數得到沒有意義的筆數。recall 內部取 2 × `top_k` 的候選視窗，沒有上限時，一個超大值會讓單次查詢掃很多列。
  - `GET /v1/brief` 與 CLI 的三個 `--top-k`（`recall`、`brief`、`wiki file-query`）只擋非正數，`2.5` 這種小數照樣接受。
  - SDK 走 HTTP，跟著 server 的規則。
- **`--verify` 沒擋 Unicode 格式字元**（[issue-32](../issue-32/README.md) TBD-9）：`normalizeVerifyCommand`（`src/core/db/memory-attributes.ts` 的 `VERIFY_FORBIDDEN`）只擋控制字元與 U+2028／U+2029。U+202A～202E、U+2066～2069 這類 bidi 字元，會讓 brief 與 recall 顯示的命令和實際存下的不同；U+200B～200F、U+FEFF 等零寬字元也看不見。它們不能偽造新的一行，但查證命令是 agent 會讀來執行的內容，看到的和存下的必須一致。

2026-11-27 本機與下游傳的 `top_k` 都不超過 20，內部有一處用 50（`src/core/memoria.ts`，不經 HTTP 與 CLI）；本機已存的 94 筆查證命令都不含格式字元，不需要處理既有資料。

## 涉及檔案

採 TBD-1～3 的選擇：所有 `top_k` 入口一致、上限 100、`--verify` 擋 Unicode 類別 Cf 的所有字元。

- `src/server.ts` - `recallSchema`、`fileQuerySchema` 的 `top_k`，`GET /v1/brief` 的 `top_k` 查詢參數
- `src/cli/commands/recall.ts`、`src/cli/commands/brief.ts`、`src/cli/commands/wiki.ts` - `--top-k` 的解析
- `src/core/utils.ts` - 預期：放 HTTP 與 CLI 共用的 `top_k` 上限與檢查，兩邊規則只定義一次
- `src/core/db/memory-attributes.ts` - `VERIFY_FORBIDDEN` 與錯誤訊息
- `docs/API.md`、`docs/API.zh-TW.md`、`docs/CLI.md`、`docs/CLI.zh-TW.md` - `top_k` 與 `--verify` 的限制
- `CHANGELOG.md` - 以前會回結果的錯誤輸入改回錯誤
- `scripts/test-http-api.sh`、`scripts/test-cli-memory.sh` - 預期：回歸測試；execute-task 依既有斷言的位置選定

## 驗收條件

1. **AC-1**：HTTP 的 `top_k` 必須是 1～100 的整數。`POST /v1/recall`、`POST /v1/wiki/file-query` 的 body 與 `GET /v1/brief` 的查詢參數，`top_k` 為 0、負數、小數或大於 100 時回 400，錯誤訊息指出 `top_k` 與允許的範圍；1、100 與省略時照常回 200，省略時沿用原本的預設值。
   - 失敗路徑：任一個端點仍對 `-1`、`2.5` 或 `101` 回 200；或 `100`、省略 `top_k` 的請求被拒。
2. **AC-2**：CLI 的 `top_k` 與 HTTP 同一規則。`recall`、`brief`、`wiki file-query` 的 `--top-k` 為 `0`、`-1`、`2.5`、`101` 或非數字時，以非零結束碼結束並在錯誤訊息指出允許的範圍；`1`、`100` 與省略時照常執行。
   - 失敗路徑：任一個命令接受 `2.5` 或 `101`；或 HTTP 與 CLI 對同一個值判定不同。
3. **AC-3**：`--verify` 拒絕 Unicode 格式字元。`remember --verify` 的值含任一 Unicode 類別 Cf 的字元時（例如 U+202E、U+2066、U+200B、U+FEFF、U+00AD），以非零結束碼結束、不寫入任何記憶，錯誤訊息說明不接受控制字元與格式字元；一般 ASCII 命令、含中文與 tab 的命令照常寫入。
   - 失敗路徑：含 U+202E 或 U+200B 的命令被寫入；或原本接受的合法命令被拒。
4. **AC-4**：其他行為不變。合法的 `top_k` 與 `--verify` 值，回傳結果與寫入內容跟改動前相同；`scripts/test-http-api.sh`、`scripts/test-cli-memory.sh`、`scripts/test-memory-attributes.sh` 以及 CI 的 core 與 http-mcp 組照常通過；API、CLI 雙語文件寫明 `top_k` 的範圍與 `--verify` 不接受的字元，CHANGELOG 寫明以前會回結果的錯誤輸入現在改回 400 或錯誤。
   - 失敗路徑：既有測試的斷言需要改值才能通過（為錯誤輸入新增的拒絕斷言除外）。

- **核准日期**: 2026-11-27
- **核准 commit**: `0eb4e8dd108407456e7c5c91444dc738429aefc2`
- **核准來源**: 使用者 2026-11-27 逐題確認時 TBD-1 選所有入口一致、TBD-2 選 100、TBD-3 選 Cf 全擋，對 AC-1～4 回「核准並在 main 提交推送」

## 風險與首要驗證

- **最大風險**：把下游正在傳的值擋掉。外部呼叫端若曾傳小數或大於 100 的 `top_k`，改動後會從拿到結果變成 400。
- **風險等級與理由**：Low。只改入口的驗證，合法輸入的行為不變；2026-11-27 查到的本機與下游呼叫都在 1～20 之間，內部唯一用到 50 的地方不經這些入口。
- **首要驗證**：先寫 AC-1 的 HTTP 斷言，以現行程式取得紅燈：`POST /v1/recall` 對 `top_k: -1`、`2.5`、`101` 回 200。
- **選擇理由**：HTTP 是最寬的入口，也是下游實際在用的介面。
- **完成證據**：步驟 1 的紅燈：以原本的程式，`POST /v1/recall`、`POST /v1/wiki/file-query` 對 `-1`、`0`、`2.5`、`101` 都回 200，`GET /v1/brief` 對 `2.5`、`101` 回 200，錯誤值的 13 條斷言全部失敗，邊界值（1、100、省略）的斷言都通過。

## 實作與驗證步驟

1. **紅燈** — 為 AC-1～3 寫斷言：HTTP 三個入口、CLI 三個命令與 `remember --verify` 各對錯誤值與邊界值。相依：驗收條件核准。
   - 完成判準：錯誤值的斷言以現行程式失敗，失敗形態與概述相同；邊界值（1、100、省略、合法命令）的斷言以現行程式通過。
   - 結果（2026-11-27，已完成）：斷言加在 `scripts/test-http-api.sh`（AC-1）、`scripts/test-cli-memory.sh`（AC-2）、`scripts/test-memory-attributes.sh` 的 (Q2) 段（AC-3）。以原本的程式跑失敗不中斷的副本：
     - HTTP：錯誤值的 13 條斷言全部失敗（POST 兩個端點各 4 個值回 200；brief 的 `2.5`、`101` 回 200，`-1`、`0`、`abc` 回 400 但訊息只寫 positive number）；邊界值的斷言都通過。
     - CLI：`recall --top-k 0` 的錯誤訊息是 `Use a positive number`，沒有寫範圍。
     - `--verify`：含 U+202E 的命令被寫入，輸出顯示成 `git log‮1- enilno--`，畫面上的命令與存下的不同。
2. **共用規則與入口** — 定義 `top_k` 的上限與檢查一次，HTTP 的 schema 與查詢參數、CLI 的三個 `--top-k` 都使用它。相依：步驟 1。對應 AC-1、AC-2。
   - 完成判準：AC-1、AC-2 綠燈；HTTP 與 CLI 沒有各自寫一份範圍判斷。
   - 結果（2026-11-27，已完成）：`src/core/utils.ts` 定義 `TOP_K_MAX`（100）、`TOP_K_RANGE`、`isValidTopK` 與 CLI 用的 `parseTopKOption`。`src/server.ts` 兩個 body schema 共用 `topKSchema`（以 `isValidTopK` refine），brief 的查詢參數也改用 `isValidTopK`；`recall`、`brief`、`wiki file-query` 的 `--top-k` 改用 `parseTopKOption`。AC-1、AC-2 的斷言綠燈。
3. **`--verify` 格式字元** — `VERIFY_FORBIDDEN` 加入 Unicode 類別 Cf，錯誤訊息一併更新。相依：步驟 1。對應 AC-3。
   - 完成判準：AC-3 綠燈。
   - 結果（2026-11-27，已完成）：`src/core/db/memory-attributes.ts` 新增 `VERIFY_FORMAT_CHARS`（`\p{Cf}`）。它檢查 trim 之前的原始值，因為 `String.prototype.trim()` 會把 U+FEFF 當空白去掉，開頭的 U+FEFF 在 trim 之後就看不到了；控制字元仍檢查 trim 之後的值，原本接受的、結尾帶換行的命令不受影響。AC-3 的斷言綠燈。
4. **文件與回歸** — API、CLI 雙語文件與 CHANGELOG；跑 CI 的 core 與 http-mcp 組。相依：步驟 2、3。對應 AC-4。
   - 完成判準：兩組全綠，`release:docs-check` 通過。
   - 結果（2026-11-27，已完成）：`docs/API.md`、`docs/API.zh-TW.md` 在信封說明後加 `top_k` 的範圍；`docs/CLI.md`、`docs/CLI.zh-TW.md` 加 `--top-k` 的範圍並更新 `--verify` 不接受的字元；`CHANGELOG.md` `[Unreleased]` 的 Fixed 兩項，Compatibility and upgrade 寫明以前會回結果的錯誤輸入改回 400 或錯誤。`pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`、`bash -n install.sh`、`pnpm run release:docs-check` 通過；CI core 組 10 支與 http-mcp 組 5 支全部 exit 0。三支測試檔的改動只有新增行（numstat 的刪除數都是 0），既有斷言沒有改值。

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
|---|---|---|---|
| TBD-1 | `top_k` 的驗證套用到哪些入口。可選：所有入口一致（HTTP 三處與 CLI 三個 `--top-k` 都要求正整數與上限，CLI 傳小數會從可用變成錯誤）；只改 HTTP；只補 POST 兩處沒擋的非正數。建議所有入口一致 | 已解決（2026-11-27 使用者選所有入口一致） | AC-1、AC-2 |
| TBD-2 | `top_k` 的上限。可選：100；50（與內部最大用法相同）；不設上限。建議 100：比現有最大用法高一個數量級，又能擋住意外的超大值 | 已解決（2026-11-27 使用者選 100） | AC-1、AC-2 |
| TBD-3 | `--verify` 擋哪些字元。可選：Unicode 類別 Cf 全擋（含 bidi、零寬字元、U+FEFF、軟連字號等）；只擋 U+200B～200F、U+202A～202E、U+2066～2069、U+FEFF。建議 Cf 全擋：命令幾乎不會用到，也不必維護清單 | 已解決（2026-11-27 使用者選 Cf 全擋） | AC-3 |

## Timeline

| 日期 | 異動 |
|------|------|
| 2026-11-27 | 建立（來源：2026-11-27 待確認事項逐題確認，使用者對 issue-34 TBD-4 與 issue-32 TBD-9 選「合併開一個 Small issue」）；TBD-1～3 使用者照建議選定；撰寫 AC-1～4，待核准 |
| 2026-11-27 | 使用者核准 AC-1～4 |
| 2026-11-27 | 步驟 1～4 完成：紅燈後實作共用的 `top_k` 規則與 `--verify` 格式字元檢查，CI core 與 http-mcp 組全綠 |

---
**建立日期**: 2026-11-27  
**分級**: Small  
**風險**: Low\
**狀態**: 審查中
