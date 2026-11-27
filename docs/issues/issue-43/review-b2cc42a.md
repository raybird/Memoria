# 審查報告
- 範圍：完整交付範圍
- Reviewed BASE SHA：0eb4e8dd108407456e7c5c91444dc738429aefc2
- Reviewed HEAD SHA：b2cc42a137f5b7f66f5e7fc45679bbd67c71984f
- Reviewed patch-id：5d5e2683674e6797989e7fa556d19be50627e3ca
- 獨立 reviewer：general-purpose subagent（Claude Opus 5.5），未參與實作

## 問題與風險

### MUST FIX
無。

### SHOULD FIX
1. **README 的任務證據缺了幾段（`docs/issues/issue-43/README.md:52-66`）**
   - 步驟 1 的紅燈只寫了結果摘要，沒寫實際命令、被測的程式版本和 exit code。紅燈 log 只放在 session scratchpad（`red43full-*.log`），重開機就沒了。
   - 四個步驟都沒記精煉（code-simplify 檢查一次，或寫 no-op）。verification.md 要求的紅綠重構證據四段因此缺最後一段；execute-task 步驟 4 也要求記這一段。
   - project.md 的本地 gate 要求改 symbol 前跑 GitNexus impact。README 沒記 `normalizeVerifyCommand`、`recallSchema`、`fileQuerySchema` 等 symbol 的 impact 結果，issue-41 是有記的。
   - 任務狀態用「結果（…，已完成）」，沒用 docs/AGENTS.md 規定的 ✅ 符號。
   - 影響：這些都是證據紀錄的格式與持久性問題，不影響這次的判定。最終綠燈有效，我也在 HEAD 重跑過，並用變異測試確認斷言會抓到錯誤。不過 README 本身無法完整重現紅燈。
   - 建議：步驟 1 補上命令與 exit code，例如 `env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_HOME bash scripts/test-http-api.sh` 在原本的 src 下 exit 1，13 條斷言失敗。另外補一行精煉結果（no-op 也寫）、GitNexus impact 的風險等級，各步驟前加 ✅。注意：這幾段在凍結章節，審查後補寫會讓 PASS 失效，要不要補、什麼時候補由使用者決定。

### NICE TO HAVE
1. **adapter 的 `--recall-top-k` 改成靜默失效（`src/cli/commands/adapter.ts:73`）** `需決策`
   - 現況：hook handler 把 `Number(opts.recallTopK)` 原樣送進 `POST /v1/recall`。以前 `2.5` 或 `150` 會照常注入結果，現在 server 回 400，adapter 依 fail-open 設計回 `{}`，不注入任何記憶，也沒有任何訊息。
   - 範圍：這個旗標不在 TBD-1 的「三個 `--top-k`」之內，沒有文件記載，本機也不接 hooks，實際影響很小。
   - 待決：要不要處理。
     - 做法 A：在 CHANGELOG 的 Compatibility 加一句「hook adapter 的 `--recall-top-k` 也必須是 1～100」。
     - 做法 B：在 hook handler 用 `parseTopKOption` 先驗證。不過 fail-open 仍會吞掉錯誤，效果有限。
     - 做法 C：維持現狀。
   - 建議：A。
2. **`--verify` 的錯誤訊息沒指出是哪個字元（`src/core/db/memory-attributes.ts:148-149`）**
   - 格式字元本身看不見。使用者若在 grep 樣式裡帶了 U+200C（波斯文常用的 ZWNJ），或在 emoji 裡帶了 U+200D（ZWJ），只會看到「without control or format characters」，找不到是哪個字元。
   - 建議：在訊息裡附上第一個違規字元的 code point 與位置，例如 `U+200C at 12`。
3. **文件與 CHANGELOG 有兩處說得太滿**
   - `docs/API.md:57` 與 zh-TW 寫「anything else is `400` naming `top_k` and the range」。但 POST body 傳字串、`null` 或布林時，錯誤來自 zod 的型別檢查（`top_k: Expected number, received string`），訊息有 `top_k` 卻沒有範圍。
   - `CHANGELOG.md:8` 的標題「validated the same way everywhere」也太滿：直接呼叫 core（`MemoriaCore.recall`）不驗證，adapter 的旗標也不在列。
   - 建議：API 文件改成「a number outside 1–100 or a non-integer is `400` …」；CHANGELOG 標題改成「on every HTTP and CLI entry」。
   - AGENTS.md 的 HTTP API 段本來就沒描述 `top_k` 的型別，不更新可以接受。
4. **AC-3 錯誤訊息的斷言只比對一半（`scripts/test-memory-attributes.sh:405`）**
   - 斷言只比對 `*--verify*format*`。AC-3 要求訊息同時說明控制字元與格式字元，現行訊息兩者都有，所以這次的綠燈有效。
   - 這是證據持久性的問題：之後把「control」拿掉，斷言不會擋下來。
   - 建議：改成 `*--verify*control*format*`。

## 已查核維度

### 驗收與證據
- **核准基線**：`git diff 0eb4e8d b2cc42a -- docs/issues/issue-43/README.md` 的 `## 驗收條件` 區塊只動了 `**核准 commit**`，從 `待提交` 回填成 `0eb4e8d…`，AC-1～4 的文字沒變。核准來源與 TBD-1～3 的答案一致。
- **AC-1**（`scripts/test-http-api.sh:294-323`）
  - `POST /v1/recall` 與 `POST /v1/wiki/file-query` 都測了 `-1`、`0`、`2.5`、`101`。`GET /v1/brief` 多測了 `abc`。這些值都要求 400，且訊息要符合 `400 *top_k*1*100*`。`1`、`100` 與省略 `top_k` 時三個入口都要求 200。
  - 紅燈：`red43full-test-http-api.log` 有 13 條失敗。POST 兩個端點各 4 個值都回 200（file-query 的 `0` 回 500）。brief 的 `2.5`、`101` 回 200。`-1`、`0`、`abc` 雖回 400，但訊息只寫 positive number，所以不符合斷言，這條斷言能區分新舊行為。
  - 我在 HEAD 重跑 exit 0。
  - 變異測試：只把 `fileQuerySchema` 的 `top_k` 改回 `z.number()`，`test-http-api.sh` exit 1，失敗在 `POST /v1/wiki/file-query top_k=-1`。這證明兩個 POST 端點各自有被測到。
  - 錯誤訊息來源：`formatZodError` 產生 `top_k: must be an integer from 1 to 100`，brief 產生 `Invalid top_k query param; expected an integer from 1 to 100`，都符合斷言。
  - 結論：通過。
- **AC-2**（`scripts/test-cli-memory.sh:552-578`）
  - `recall`、`brief`、`wiki file-query` 三個命令都測了 `0`、`-1`、`2.5`、`101`、`abc`，要求非零結束碼，且輸出符合 `*--top-k*1*100*`。`1`、`100` 要求 exit 0。
  - 省略 `--top-k` 的情況由同一支腳本前面的段落和 core 組的大量呼叫涵蓋，這些既有斷言沒改。
  - 紅燈：log 只記到第一個失敗，`recall --top-k 0` 的訊息沒有範圍。
  - 變異測試：只把 `wiki.ts` 改回舊的解析，`test-cli-memory.sh` exit 1，失敗在 `wiki --top-k 0`。這證明三個命令各自有被測到，不是只測到第一個。
  - 我在 HEAD 重跑 exit 0。
  - 結論：通過。
- **AC-3**（`scripts/test-memory-attributes.sh:395-412`）
  - 我逐 byte 核對過測試字串，確實含 U+202E、U+2066、U+2069、U+200B、U+FEFF（放在開頭，正好測到 trim 前檢查的路徑）、U+00AD。
  - 測試要求非零結束碼、訊息含 `--verify` 與 `format`，且 sessions、events、memory_attributes 三表筆數不變。ASCII 命令、含中文與 Tab 的命令都要求寫入成功。
  - 紅燈：`red43full-test-memory-attributes.log` 顯示含 U+202E 的命令被寫入了。
  - 我在 HEAD 重跑 exit 0。
  - 結論：通過。訊息斷言的持久性見 NICE TO HAVE 4。
- **AC-4**
  - 三支測試檔都只有新增行，numstat 的刪除數都是 0，既有斷言沒有改值。
  - 實作者的 `ci43.log` 顯示 core 組 10 支、http-mcp 組 5 支都 exit 0。
  - 我在 HEAD 先 `pnpm run build`，再跑以下項目，全部 exit 0：`pnpm run check`、`node dist/cli.mjs --help`、`pnpm run release:docs-check`、三支 AC 腳本、adapters 組 5 支（它們經 HTTP 帶 `top_k`，屬於受影響的鄰近路徑），以及 `test-wiki-query-fileback.sh`。
  - 合法值的行為不變：`parseTopKOption` 和舊程式一樣用 `Number(raw)`，1～100 的整數得到同一個值。`normalizeVerifyCommand` 對不含 Cf 的輸入仍回傳 trim 後的同一字串。
  - 雙語文件與 CHANGELOG 都有寫。
  - 結論：通過，措辭的建議見 NICE TO HAVE 3。

### 相關失敗面
- **HTTP 與 CLI 對同一個值的判定**
  - 我用 tsx 直接呼叫 `parseTopKOption`，並模擬 GET 的 `isValidTopK(Number(raw))`，測了 `1e2`、` 5 `、空字串、`0x10`、`1.0`、`100.0`、`Infinity`、`-0`、`1.5e1`、`0b11`。兩邊判定完全一致：空字串、`Infinity`、`-0` 都拒絕，其餘接受成對應的整數。
  - JSON body 的 `1e2` 與 `100.0` 解析後是數字 100，也接受。
  - 只有 POST 傳字串時會被型別檢查擋下，CLI 和 GET 本來就收字串，這個差異是既有的、屬於型別層級。
  - 結論：沒有不一致。接受 hex、指數寫法比較寬鬆，但兩邊一致，AC 也沒有禁止。
- **其他會帶 `top_k` 的入口**
  - SDK（`src/sdk.ts`）走 HTTP，套用 server 的規則。
  - `serve --ui` 的 router（`src/ui/router.ts`）沒有 `top_k` 參數。
  - MCP 是外部的 libSQL server，不是 Memoria 的 `top_k` 入口。vector helper 的 `topK` 是內部參數，並有 `Math.max(1, …)` 防護。
  - core 內部呼叫：`memoria.ts:329` 用 50，`setup-plan.ts` 用 3 和 10，都在範圍內。
  - adapter 的 `--recall-top-k` 見 NICE TO HAVE 1。
  - 結論：在核准範圍內沒有可繞過驗證的入口。
- **`--verify` 的其他寫入路徑**
  - `upsertMemoryAttributes` 帶 verify 的呼叫只有 `applyNoteAttributes`，它只從 `rememberNote` 進來，而 `rememberNote` 在任何寫入之前就先呼叫 `normalizeVerifyCommand`。
  - `mark` 命令與 `markMemory` 不帶 verify。HTTP `/v1/remember` 收的是 session JSON，沒有 verify 欄位。
  - 結論：沒有繞過驗證的寫入路徑。
- **Cf 檢查原始值、控制字元檢查 trim 後的值，兩者會不會互相矛盾**
  - `trim()` 會去掉、又屬於 Cf 的字元只有 U+FEFF。U+180E 在現行 V8 不算空白。
  - 因此唯一的差異是：開頭或結尾帶 U+FEFF 會被拒絕，結尾帶換行仍然接受。
  - AC-3 寫明「含任一 Cf 字元」就要拒絕，所以前者是 AC 要求的行為，後者維持既有相容性，兩者不矛盾。我實測 `git status\n` 得到 `git status`，開頭或結尾帶 U+FEFF 都被拒絕。
  - 結論：可以接受。
- **`\p{Cf}` 會不會誤擋合法命令**
  - 實測：含 ZWNJ 的波斯文 grep 樣式、含 ZWJ 的 emoji 都會被拒絕。
  - TBD-3 使用者選了 Cf 全擋，並接受「命令幾乎不會用到」這個代價，所以這是已核准的取捨，不列為缺陷。改善訊息的建議見 NICE TO HAVE 2。
  - `u` flag 的 property escape 在 Node 18 可以用。
- **既有資料**：之前已存下、含格式字元的命令，顯示時不會被清理。README 記了本機 94 筆查證命令都不含格式字元，這屬於範圍外的限制。

### 需求、架構、安全、品質（含跨 Task 重複與過度設計）
- **規則只定義一次**：範圍檢查只寫在 `isValidTopK`、`TOP_K_RANGE`、`parseTopKOption`（`src/core/utils.ts:440-452`），並經 barrel 匯出。server 的兩個 body schema 共用 `topKSchema`。HTTP 與 CLI 沒有各自寫一份範圍判斷，符合步驟 2 的完成判準。
- **重複**：brief 的 GET 仍自己寫 `Number(topKRaw)`，和 `parseTopKOption` 的解析重複一行。兩邊錯誤訊息的格式本來就不同，可以接受。
- **過度設計**：沒有。模組邊界符合 project.md：規則放在 core，入口只負責呼叫。
- **安全**：拒絕 bidi 與零寬字元，正好處理了「顯示的命令和存下的不同」這個風險。命令仍然不會被執行。沒有新的權限面。
- **風險等級 Low 是否正確**：正確。只收緊入口的驗證，沒有 schema 或資料變更，合法值的行為不變，下游實際傳的值都在 1～20。

### 豁免、待確認與限制
- 沒有 Gate 豁免。
- TBD-1～3 的狀態都以「已解決（2026-11-27 使用者選…）」開頭，符合規定。README 全文沒有 `<` 字元。`**狀態**` 寫「審查中」是合法值。README 還沒有 `## 現況`，可以在保存報告的提交新增。
- **限制**：
  - CI 的 core 與 http-mcp 組是採用實作者在 working tree 上跑的 log，時間是 17:37，早於提交時間 17:38。我在 HEAD 自己重跑的是三支 AC 腳本、adapters 組、wiki-query-fileback 與靜態檢查，沒有重跑完整的 core 與 http-mcp 組。
  - 紅燈 log 放在 session scratchpad，不持久，見 SHOULD FIX 1。
  - 變異測試是在 scratchpad 用 `git archive` 解出的副本上做的，沒有動到 repo。

## 流程判定
PASS

PASS 只適用於上列 Reviewed HEAD SHA；之後提交 README 記帳區段與本報告以外的檔案會讓它失效，提交前先告知使用者（review-evidence.md「審查之後的提交」）。
