# Issue 43 - top_k 與 --verify 的輸入驗證收緊 (Small)

## 概述

2026-11-27 待確認事項逐題確認時，有兩筆已知限制都是輸入驗證太寬，使用者決定合併成這個 issue：

- **`top_k` 沒有一致的驗證**（[issue-34](../issue-34/README.md) TBD-4）：
  - `POST /v1/recall` 與 `POST /v1/wiki/file-query` 的 `top_k` 只驗 `z.number()`（`src/server.ts` 的 `recallSchema`、`fileQuerySchema`），負數、小數、超大值都會直接進 recall 的 `slice(0, topK)`。負數得到沒有意義的筆數。recall 內部取 2 × `top_k` 的候選視窗，沒有上限時，一個超大值會讓單次查詢掃很多列。
  - `GET /v1/brief` 與 CLI 的三個 `--top-k`（`recall`、`brief`、`wiki file-query`）只擋非正數，`2.5` 這種小數照樣接受。
  - SDK 走 HTTP，跟著 server 的規則。
- **`--verify` 沒擋 Unicode 格式字元**（[issue-32](../issue-32/README.md) TBD-9）：`normalizeVerifyCommand`（`src/core/db/memory-attributes.ts` 的 `VERIFY_FORBIDDEN`）只擋控制字元與 U+2028／U+2029。U+202A～202E、U+2066～2069 這類 bidi 字元，會讓 brief 與 recall 顯示的命令和實際存下的不同；U+200B～200F、U+FEFF 等零寬字元也看不見。它們不能偽造新的一行，但查證命令是 agent 會讀來執行的內容，看到的和存下的必須一致。

2026-11-27 本機與下游傳的 `top_k` 都不超過 20，內部有一處用 50（`src/core/memoria.ts`，不經 HTTP 與 CLI）；本機已存的 94 筆查證命令都不含格式字元，不需要處理既有資料。

## 現況

**現行 review**: review-d3a8ea0.md

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

以下測試命令都加上 `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME` 前綴，避免讀到本機的向量設定與資料根；每次換程式版本都先 `pnpm run build`，因為 `./cli` 優先用 `dist/cli.mjs`。

1. ✅ **紅燈** — 為 AC-1～3 寫斷言：HTTP 三個入口、CLI 三個命令與 `remember --verify` 各對錯誤值與邊界值。相依：驗收條件核准。
   - 完成判準：錯誤值的斷言以現行程式失敗，失敗形態與概述相同；邊界值（1、100、省略、合法命令）的斷言以現行程式通過。
   - 完成證據：✅ 2026-11-27。斷言加在 `scripts/test-http-api.sh` 的 issue-43 AC-1 段、`scripts/test-cli-memory.sh` 的 issue-43 AC-2 段、`scripts/test-memory-attributes.sh` 的 (Q2) 段（AC-3）。被測的程式是 main `0eb4e8d` 的 src（新測試放在工作區，src 改動先 `git stash push -- src` 收起再 build）：
     - `bash scripts/test-http-api.sh`、`bash scripts/test-cli-memory.sh`、`bash scripts/test-memory-attributes.sh` 都 exit 1，各自停在第一條 issue-43 斷言：`POST /v1/recall top_k=-1` 回 200；`recall --top-k 0` 的訊息是 `Invalid --top-k '0'. Use a positive number`，沒有範圍；含 U+202E 的 `--verify` 寫入成功。
     - 為了看到每一條斷言，另把 issue-43 段的 `; exit 1; }` 改成 `; }`，複製成 `scripts/zz-red43-*.sh` 跑完即刪除。HTTP 副本的 13 條錯誤值斷言全部失敗：POST 兩個端點各 4 個值回 200（file-query 的 `0` 回 500）；brief 的 `2.5`、`101` 回 200，`-1`、`0`、`abc` 回 400 但訊息只寫 positive number。邊界值（1、100、省略）的斷言都通過。CLI 與 attributes 段用的是 `case … exit 1 ;;`，副本仍停在第一條，結果同上；attributes 的輸出把存下的命令顯示成 `git log‮1- enilno--`，畫面上的命令與存下的不同。
2. ✅ **共用規則與入口** — 定義 `top_k` 的上限與檢查一次，HTTP 的 schema 與查詢參數、CLI 的三個 `--top-k` 都使用它。相依：步驟 1。對應 AC-1、AC-2。
   - 完成判準：AC-1、AC-2 綠燈；HTTP 與 CLI 沒有各自寫一份範圍判斷。
   - 完成證據：✅ 2026-11-27。改動前跑 GitNexus impact：`startServer`、`registerRecallCommand` 都是 LOW；`registerBriefCommand`、`registerWikiCommand` 是 review-d3a8ea0 指出漏記後補跑的，也都是 LOW，直接呼叫者只有 `src/cli.ts` 的 `run`。`src/core/utils.ts` 定義 `TOP_K_MAX`（100）、`TOP_K_RANGE`、`isValidTopK` 與 CLI 用的 `parseTopKOption`。`src/server.ts` 兩個 body schema 共用 `topKSchema`（以 `isValidTopK` refine），brief 的查詢參數也改用 `isValidTopK`；`recall`、`brief`、`wiki file-query` 的 `--top-k` 改用 `parseTopKOption`。`bash scripts/test-http-api.sh`、`bash scripts/test-cli-memory.sh` exit 0。
   - 精煉：barrel 原本也匯出 `TOP_K_MAX`，但 core 以外沒有人用，拿掉後 `pnpm run check` 通過；其餘沒有可再簡化之處。
3. ✅ **`--verify` 格式字元** — `VERIFY_FORBIDDEN` 加入 Unicode 類別 Cf，錯誤訊息一併更新。相依：步驟 1。對應 AC-3。
   - 完成判準：AC-3 綠燈。
   - 完成證據：✅ 2026-11-27。改動前跑 GitNexus impact：`normalizeVerifyCommand` 標為 CRITICAL，但直接呼叫者只有 `rememberNote`；CRITICAL 來自 setup 等流程以信心 0.5 的邊推算，這裡只讓它多拒絕一類字元，簽名與回傳值不變。`src/core/db/memory-attributes.ts` 新增 `VERIFY_FORMAT_CHARS`（`\p{Cf}`）。它檢查 trim 之前的原始值，因為 `String.prototype.trim()` 會把 U+FEFF 當空白去掉，第一版只檢查 trim 之後的值時，開頭的 U+FEFF 漏網，`test-memory-attributes.sh` 因此失敗；控制字元仍檢查 trim 之後的值，原本接受的、結尾帶換行的命令不受影響。`bash scripts/test-memory-attributes.sh` exit 0。
   - 完成證據（review-b2cc42a 修正）：✅ 2026-11-27。錯誤訊息附上第一個被拒絕字元的 code point 與位置（以字元計，例如 `found U+200B at character 4`），由 `firstForbiddenIndex` 找出；(Q2) 段加三個位置斷言（U+200B、emoji 後的 U+200D、前導空白後的換行），訊息斷言改為同時比對 control 與 format。以 `b2cc42a` 的 src 跑 `bash scripts/test-memory-attributes.sh` exit 1，停在 `錯誤沒有指出 U+200B at character 4`；修正後 exit 0。
   - 完成證據（review-d3a8ea0 修正）：✅ 2026-11-27。(Q2) 段的位置斷言再加兩個案例：格式字元在控制字元之前（`a`、U+200B、`b`、換行、`c`，期望 `U+200B at character 2`），以及 astral 的格式字元 U+E0001（期望 `U+E0001 at character 4`）。變異測試：把取較前位置的 `Math.min` 改成 `Math.max`，`bash scripts/test-memory-attributes.sh` exit 1，停在 `錯誤沒有指出 U+200B at character 2`；把 `codePointAt` 改成 `charCodeAt`，exit 1，停在 `錯誤沒有指出 U+E0001 at character 4`（印出的是代理字元 U+DB40）。還原後 exit 0。這輪只改測試，src 與 `d3a8ea0` 相同。
   - 精煉：位置計算第一版寫成行內 IIFE，改成獨立的 `firstForbiddenIndex`，`normalizeVerifyCommand` 只負責組訊息。
4. ✅ **文件與回歸** — API、CLI 雙語文件與 CHANGELOG；跑 CI 的 core 與 http-mcp 組。相依：步驟 2、3。對應 AC-4。
   - 完成判準：兩組全綠，`release:docs-check` 通過。
   - 完成證據：✅ 2026-11-27。`docs/API.md`、`docs/API.zh-TW.md` 在信封說明後加 `top_k` 的範圍；`docs/CLI.md`、`docs/CLI.zh-TW.md` 加 `--top-k` 的範圍並更新 `--verify` 不接受的字元；`CHANGELOG.md` `[Unreleased]` 的 Fixed 兩項，Compatibility and upgrade 寫明以前會回結果的錯誤輸入改回 400 或錯誤。`pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`、`bash -n install.sh`、`pnpm run release:docs-check` 通過；CI core 組 10 支與 http-mcp 組 5 支全部 exit 0。三支測試檔的改動只有新增行（numstat 的刪除數都是 0），既有斷言沒有改值。
   - 精煉：no-op，文件改動沒有可再精簡之處。
   - 完成證據（review-b2cc42a 修正）：✅ 2026-11-27。API 雙語文件改寫 `top_k` 的錯誤說明（TBD-7），CLI 雙語文件寫明 `--verify` 的錯誤會指出字元與位置，CHANGELOG 標題改為 on every HTTP and CLI entry，Compatibility 補上 hook adapter 的 `--recall-top-k`（TBD-5）。在修正後的工作區重跑 `pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`、`bash -n install.sh`、`pnpm run release:docs-check`，以及 CI core 組 10 支與 http-mcp 組 5 支，全部 exit 0。

## 待確認事項

| 編號 | 事項 | 狀態 | 影響 |
|---|---|---|---|
| TBD-1 | `top_k` 的驗證套用到哪些入口。可選：所有入口一致（HTTP 三處與 CLI 三個 `--top-k` 都要求正整數與上限，CLI 傳小數會從可用變成錯誤）；只改 HTTP；只補 POST 兩處沒擋的非正數。建議所有入口一致 | 已解決（2026-11-27 使用者選所有入口一致） | AC-1、AC-2 |
| TBD-2 | `top_k` 的上限。可選：100；50（與內部最大用法相同）；不設上限。建議 100：比現有最大用法高一個數量級，又能擋住意外的超大值 | 已解決（2026-11-27 使用者選 100） | AC-1、AC-2 |
| TBD-3 | `--verify` 擋哪些字元。可選：Unicode 類別 Cf 全擋（含 bidi、零寬字元、U+FEFF、軟連字號等）；只擋 U+200B～200F、U+202A～202E、U+2066～2069、U+FEFF。建議 Cf 全擋：命令幾乎不會用到，也不必維護清單 | 已解決（2026-11-27 使用者選 Cf 全擋） | AC-3 |
| TBD-4 | review-b2cc42a SHOULD FIX 1：README 的步驟證據缺紅燈的實際命令與 exit code（紅燈 log 只在 session 暫存目錄）、缺精煉結果、缺 GitNexus impact 的風險等級，任務也沒用 ✅ 符號 | 已解決（2026-11-27 使用者選修正）。步驟 1～4 補上命令、被測版本、exit code、impact 等級、精煉結果與 ✅ | 無 |
| TBD-5 | review-b2cc42a NICE TO HAVE 1（需決策）：hook adapter 的 `--recall-top-k`（`src/cli/commands/adapter.ts`）原樣送進 `POST /v1/recall`，超出 1～100 時 server 回 400，adapter 依 fail-open 設計不注入任何記憶也沒有訊息；這個旗標不在 TBD-1 的三個 `--top-k` 之內 | 已解決（2026-11-27 使用者選在 CHANGELOG 補一句）。CHANGELOG 的 Compatibility and upgrade 寫明 hook adapter 的 `--recall-top-k` 也必須是 1～100，超出時 hook 不注入記憶；程式不改 | AC-4 |
| TBD-6 | review-b2cc42a NICE TO HAVE 2：`--verify` 被拒時訊息沒指出是哪個字元，格式字元看不見，使用者找不到它 | 已解決（2026-11-27 使用者選修正）。訊息附上第一個被拒絕字元的 code point 與位置，見步驟 3 | AC-3 |
| TBD-7 | review-b2cc42a NICE TO HAVE 3：API 文件寫「其他值回 400 並指出範圍」，但 body 傳非數字時是型別錯誤，訊息沒有範圍；CHANGELOG 標題寫 everywhere，直接呼叫 core 不驗證 | 已解決（2026-11-27 使用者選修正）。API 雙語文件改為超出範圍或不是整數的數字回 400，非數字先被型別檢查擋下；CHANGELOG 標題改為 on every HTTP and CLI entry | AC-4 |
| TBD-8 | review-b2cc42a NICE TO HAVE 4：AC-3 的訊息斷言只比對 `--verify` 與 format，之後拿掉 control 不會被擋下 | 已解決（2026-11-27 使用者選修正）。斷言改為同時比對 control 與 format | AC-3 |
| TBD-9 | review-d3a8ea0 NICE TO HAVE 1：新的位置斷言都只含一種違規字元，而且都在 BMP；把取較前位置改成取較後、或把 `codePointAt` 改成 `charCodeAt`，測試仍通過 | 已解決（2026-11-27 使用者選修正）。補兩個案例並以變異測試確認抓得到，見步驟 3 | AC-3 |
| TBD-10 | review-d3a8ea0 NICE TO HAVE 2：步驟 2 的 GitNexus impact 少記 `registerBriefCommand` 與 `registerWikiCommand` | 已解決（2026-11-27 使用者選和位置斷言一起修）。補跑後兩個都是 LOW，記在步驟 2 | 無 |

## Timeline

| 日期 | 異動 |
|------|------|
| 2026-11-27 | 建立（來源：2026-11-27 待確認事項逐題確認，使用者對 issue-34 TBD-4 與 issue-32 TBD-9 選「合併開一個 Small issue」）；TBD-1～3 使用者照建議選定；撰寫 AC-1～4，待核准 |
| 2026-11-27 | 使用者核准 AC-1～4 |
| 2026-11-27 | 步驟 1～4 完成：紅燈後實作共用的 `top_k` 規則與 `--verify` 格式字元檢查，CI core 與 http-mcp 組全綠 |
| 2026-11-27 | 獨立審查 review-b2cc42a：PASS，SHOULD FIX 1 項、NICE TO HAVE 4 項待使用者決定 |
| 2026-11-27 | 使用者對 review-b2cc42a 的建議全部照建議處理（結論記在 TBD-4～8）；修正後送增量覆審 |
| 2026-11-27 | 增量覆審 review-d3a8ea0：PASS，NICE TO HAVE 2 項待使用者決定 |
| 2026-11-27 | 使用者對 review-d3a8ea0 的建議都選修正（結論記在 TBD-9、TBD-10）；修正後送增量覆審 |

---
**建立日期**: 2026-11-27  
**分級**: Small  
**風險**: Low\
**狀態**: 審查中
