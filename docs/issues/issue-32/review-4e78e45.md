# 審查報告
- 範圍：完整 issue 分支 diff（本 repo 不開 PR，審查後 fast-forward 進 main），第二輪；前一輪為 review-5657988
- Reviewed BASE SHA：c35df0bac4429bdf003f1781fd8687ac99ec8c74（`git merge-base main HEAD`）
- Reviewed HEAD SHA：4e78e456c68bcc35034858bab517e2fe1e4cf269
- Reviewed patch-id：8cfcde6dec0ef4ea9ef1d1db58e68d2e07d2be23（`git diff c35df0b 4e78e45 | git patch-id --stable`，審查時重算一致）
- 核准 commit：README 填 `ccc4b7a`。依 acceptance.md §規格修訂的查核，以 `git log -1 -G '…\*\*核准來源\*\*…' 4e78e45` 推導出的基線也是 ccc4b7aa08bf66fb24b128a10e6259c60a3ea276。`git diff ccc4b7a 4e78e45 -- docs/issues/issue-32/README.md` 顯示 Gherkin 在核准之後有實質修訂（SCN-005 多一個 Or 條件，新增 SCN-011、SCN-012），見 M-1
- 獨立 reviewer：Claude Code 隔離 subagent（general-purpose），非原實作者
- Review artifact：docs/issues/issue-32/review-4e78e45.md

## 問題與風險

### MUST FIX

- **M-1 規格修訂後，核准紀錄沒有照 acceptance.md 更新**（`docs/issues/issue-32/README.md:160-165`）
  - 現況：4e78e45 修改了已核准的 Gherkin，SCN-005 多了拒絕條件，另外新增 SCN-011、SCN-012。核准紀錄只在第 165 行加了一段敘述。`**核准 commit**` 仍是 `ccc4b7a`，`**核准來源**` 欄位行沒動，第 163 行仍寫「全部 Scenario 於 2026-11-10 核准」，也沒有展開核准表。
  - 影響：
    - acceptance.md 規定「出現分批或修訂時展開表格」，也規定「重新核准後更新日期、狀態、核准來源與基線提交」，而且「狀態只讀本表，歷史敘述不改變判定」。照這份權威文件，現在的紀錄有兩個問題。第一，SCN-011、SCN-012 被單行摘要寫成 2026-11-10 核准，與事實不符。第二，核准基線 ccc4b7a 裡根本沒有這兩個 Scenario，用 `git diff ccc4b7a` 做規格修訂查核時，SCN-005、011、012 都會被判成核准後的實質變動，也就是 `待重新核准`。
    - 審查之後無法再用記帳補正。`verify-artifact.py` 只接受 `**核准 commit**` 由 `待提交` 改成被審查提交或其祖先，`## Gherkin 核准紀錄` 屬於凍結內容。所以如果帶著這個紀錄 PASS，之後要嘛帶著錯誤的核准紀錄合併，要嘛還是得重審。
    - 核准來源本身有記錄：README 寫了使用者 2026-11-11 對 S-3、N-1、N-2 三題的選擇，TBD-8 也記錄了同一組決策。我無法查證原始對話，但修訂內容與 review-5657988 的 S-3 選項 B、N-1、N-2 的建議一致，沒有看到未經記錄的規格變動（見「驗收與證據」）。所以這是紀錄形式的缺口，不是缺少核准。
  - 建議（只改文件，照 issue-31 的前例）：
    1. 把第 165 行併進 `**核准來源**` 欄位行，寫明 2026-11-11、題號（S-3 選 B、N-1、N-2）以及對應的 SCN-005、011、012。
    2. 把第 163 行換成核准表：SCN-001～004、006～010 為 2026-11-10 已核准；SCN-005（修訂）、SCN-011、SCN-012 為 2026-11-11 已核准。
    3. `**核准 commit**` 改成 `待提交`，第三輪審查時依 `核准來源` 欄位推導出修正提交，保存報告的提交再回填該 SHA。
  - `需決策`（替代做法）：使用者也可以決定接受現有紀錄形式，不再修改。那就要依 docs/AGENTS.md 在 README 加 `## Gate 豁免紀錄`，寫明核准基線 ccc4b7a 不含 SCN-011、SCN-012 與 SCN-005 的修訂，以及接受的理由。合併後核准 SHA 就不再是 gate，殘餘影響只在歷史紀錄。reviewer 建議照上面三步修正，成本是一次只改文件的提交，加上一次很快的第三輪審查。

### SHOULD FIX
無。

### NICE TO HAVE

- **N-8 雙向文字控制字元與零寬字元仍可寫入** `需決策`（`src/core/db/memory-attributes.ts:115`）。`VERIFY_FORBIDDEN` 已經擋下 SCN-005 列出的所有字元，我逐一做變異測試都抓得到（見下方）。但 Unicode Cf 類的格式字元不在範圍內。我實測 `--verify $'git log ‮etats tig'`（U+202E RIGHT-TO-LEFT OVERRIDE）與只有 `$'​'`（零寬空白）的值都寫入成功（exit 0）。前者在支援雙向文字的編輯器裡，人看到的命令和實際存下的不一樣（Trojan Source 手法），後者是一個看不見的「命令」。這正是上一輪 N-1 想防的情況。不過只有本機 CLI 寫得進去，agent 讀到的是原始碼位，風險低。
  - 待決問題：要不要把 U+061C、U+200B～U+200F、U+202A～U+202E、U+2060～U+2064、U+2066～U+2069、U+FEFF 也列為拒絕？
  - 選項：(A) 維持 SCN-005 現有的範圍；(B) 擴大拒絕範圍，但要再修訂 SCN-005。
  - 建議：A，留到之後的 issue。B 會改到已核准的規格，風險又不高，不值得為它延後這次交付。
- **N-9 前後的換行會被 trim 掉，然後接受**（`src/core/db/memory-attributes.ts:122`）。`$'git status\n'` 與 `$'\ngit status'` 都存成 `git status`，exit 0。存下的值確實是單行，安全目的有達到；shell 的 `$(…)` 本來也會去掉結尾換行，所以這樣處理合理。只是和 SCN-005「含換行 → 被拒」字面上不一致。這是第一輪就有的行為。建議在 CLI 文件補半句「前後空白與換行會被去掉」，或者不處理。
- **N-10 issue 文件沒有跟上第二輪的範圍**（`docs/issues/issue-32/README.md:38`、`:50-55`、`:199-201`）
  - 「涉及檔案」的 `db/brief.ts` 仍寫「決策／環境／高效用項帶 verify」，少了常駐項與固定說明。
  - 本輪改到的 `scripts/memory-browser-driver.mts`（由 `test-memory-browser.sh` 執行）不在清單裡，「關鍵差異」表也沒提 SCN-011 的固定說明。
  - Timeline 把「審查 review-5657988 PASS…」插在「TBD-7 選 A；步驟 8…全部步驟完成」之前，時間順序顛倒（5657988 的 Timeline 已經有步驟 8 那一列），也沒有「步驟 10 完成」的紀錄。
  - Timeline 屬於記帳區段，可以在保存報告的提交裡順手修正；另外兩項如果要改，就併進 M-1 的修正提交。
- **N-11 常駐項同時有 note 與查證行的順序沒有測試**（`src/core/db/brief.ts:439-440`）。(V) 的狀態類常駐項沒有 note。我手動建了一則同時有 note 與 verify 的常駐項（環境專案，scoped 與 `--global` 都測），輸出順序是主行、note、查證行，符合預期。目前只有程式碼和這次手動結果可以佐證，屬於證據持久力的建議。
- **N-12 architecture.md 寫 brief 加的是「the same line」**（`docs/agents/architecture.md:72`）。brief 的查證行沒有 `⟳`，冒號後面也沒有全形冒號，命令放在 code span 裡，和 recall 的那一行不一樣。這是第一輪的措辭，本輪又改過這一格，可以順手改成「a matching line」。

## 已查核維度

### 上一輪問題的處理

| 編號 | 處理 | 查核 |
|---|---|---|
| S-1 | `scripts/memory-browser-driver.mts` 新增一個 migration 16 的資料庫（DROP COLUMN 後刪掉 migration 17 紀錄），以 `initialize:false` 跑 recall 與 brief | 成立。我在 scratch 副本把 `memory-attributes.ts:80` 的欄位探測改成固定 `'verify_cmd'`，`test-memory-browser.sh` exit 1，`AssertionError: pre-17 recall keeps durable`；HEAD exit 0。斷言還檢查讀取路徑沒有加上 `verify_cmd`，也沒有記下 migration 17。`test-migrations.sh` 在同一個變異下仍是綠的，但 plan 已改由 memory-browser 承擔這個覆蓋，有揭露 |
| S-2 | DEPLOYED_SKILL 的完成判準改成「重查過，或命令不是唯讀時說明尚未重查」 | 成立。第 49 行本來就寫「run it only if it is a read-only check」，第 51 行的判準現在有不執行的出口，兩句不再互相拉扯。`test-setup-onboarding` 綠燈 |
| S-3 | 使用者選 B（TBD-8），新增 SCN-011、`VERIFY_NOTE` | 成立，見 SCN-011 |
| N-1 | `VERIFY_FORBIDDEN` 擋 U+0000–0008、U+000A–001F、U+007F–009F、U+2028、U+2029，保留 Tab | 成立。正規式範圍正確：`\u0009` 排除在外，NEL U+0085 落在 C1 範圍內。Cf 類字元見 N-8 |
| N-2 | 使用者選擇新增 SCN-012；常駐項帶 `verify`／`verify_as_of` 並渲染查證行 | 成立，見 SCN-012 |
| N-3 | 維持 UTC；CLI.md 與 CLI.zh-TW.md 註明截至日期是 UTC | 與 TBD-8 一致 |
| N-4 | 發版時再寫 | 與 TBD-8 一致；`CHANGELOG.md` 的 `[Unreleased]` 仍是空的，符合 project.md「發版時編寫」 |
| N-5 | `AGENTS.md:243` 的 HTTP API 段補上 `verify` 與 `verify_as_of` | 成立，內容與 API.md 一致 |
| N-6 | `src/core/db/index.ts` 拿掉 `verifyColumnExists` 匯出 | 成立。函式只在模組內使用（`memory-attributes.ts:80`），模組層仍有 `export` 關鍵字，但沒有任何外部 import，無害 |
| N-7 | 不改 | 與 TBD-8 一致；`README.md:8` 仍寫原名，風險同上一輪的判斷 |

### 驗收與證據（逐一 SCN-001～SCN-012）

規格查核：`git diff ccc4b7a 4e78e45 -- docs/issues/issue-32/README.md` 在 Gherkin 區只有三處變動：SCN-005 新增 Or 條件、新增 SCN-011、新增 SCN-012。三處都對應 README 第 165 行與 TBD-8 記錄的使用者 2026-11-11 決策，沒有未經記錄的規格變動。紀錄形式的問題見 M-1。

我先 `pnpm run build`，再在 HEAD 4e78e45 上重跑測試。所有命令都去掉 `LIBSQL_URL`、`MEMORIA_EMBED_PROVIDER`、`MEMORIA_EMBED_MODEL`，`MEMORIA_HOME` 指到 scratch。會跑 `setup` 的腳本另外把 `HOME` 指到 scratch 的假家目錄。變異測試在 scratch 的 `git ls-files` 副本進行。

| SCN | 證據位置 | 結論 |
|---|---|---|
| SCN-001 | `test-memory-attributes.sh` (R) | 成立。本輪沒改 recall，HEAD 綠燈；上一輪的紅燈與變異結論仍適用 |
| SCN-002 | (R) `--json`、`test-http-api.sh` issue-32 段 | 成立。HEAD 綠燈。本輪 `/v1/brief` 的 markdown 多了固定說明，既有斷言是逐行比對，不受影響 |
| SCN-003 | (S)、(J) golden | 成立。golden 相對 BASE 只改了 `- 範圍:` 那一行（`git diff c35df0b 4e78e45 -- scripts/fixtures/…golden.md`）。變異 m3（固定說明一律輸出）讓 (J) 紅燈：`✗ 零標記的 brief 產出已改變` |
| SCN-004 | (P) | 成立。本輪沒改互斥邏輯。第 374 行用寫死的 `截至 2026-11-10` 判斷，但那是筆記正文自己的字串，不是日期依賴的假綠燈 |
| SCN-005（含修訂） | (Q) | 成立。8 種無效值都拒絕且沒有寫入，Tab 可以寫入。變異：m4 改回 `/[\r\n]/` → `✗ --verify 'git status rm -rf /tmp/x' 應該失敗`（U+2028）；m5 從 C1 範圍拿掉 U+0085 → 紅燈；m8 拿掉 ESC → `✗ --verify 'git status[2Krm…' 應該失敗`；m6b 連 Tab 一起擋 → `✗ 含 Tab 的 --verify 不該被拒絕`。我也確認 bash 在 C locale 下 `$' '` 一樣產生 UTF-8 位元組，CI locale 不同不會讓案例失效。範圍外的字元見 N-8、N-9 |
| SCN-006 | (T)、`test-http-api.sh` SCN-006 段 | 成立。本輪沒有新增任何執行外部程序的程式碼（`git diff c35df0b 4e78e45 -- src` 沒有 `child_process`、`spawn`、`exec`），HEAD 綠燈 |
| SCN-007 | `test-cli-memory.sh` (P)、(G) | 成立，HEAD 綠燈。固定說明放在統計行之後，不影響「範圍行帶產生時間」與「兩次只差產生時間」的斷言 |
| SCN-008 | `test-migrations.sh` | 成立，HEAD 綠燈；本輪沒改 schema |
| SCN-009 | plan 步驟 2 手動證據；上一輪 reviewer 補測 | 成立（手動）。本輪改的是渲染與驗證，舊 runtime 讀寫路徑不受影響。新欄位 `BriefPinned.verify` 只存在新版的回傳資料裡 |
| SCN-010 | plan 步驟 8 觀測紀錄 | 成立（依紀錄，我無法重跑兩個 host）。本輪 skill 只改完成判準一句，指引的觸發句（第 49 行）沒動，所以觀測結論仍適用 |
| SCN-011 | (U)、(V) 最後一個斷言、(J) golden | 成立。期望值是手寫的字面值 `NOTE_U`，不是從實作重算的；位置用 awk 取 `- sessions:` 的下一行，並斷言剛好一行；沒有查證行時不出現（負向案例＋golden）。變異：m1 拿掉輸出 → `✗ 統計行之後不是固定說明: []`；m2 讓 `hasVerifyLine` 不看常駐項 → `✗ 只有常駐區有查證行時，缺少固定說明`；m3 一律輸出 → golden 紅燈。手動：scoped（`--project demo`，含環境紀律區）與 `--global` 都只出現一次，都緊接在統計行之後 |
| SCN-012 | (V)；`test-memory-attributes.sh:326-338` 的常駐區格式斷言 | 成立。狀態類常駐項的下一行逐字比對查證行，日期取自 DB；一般常駐項沒有查證行；`brief --json` 的常駐項帶 `verify` 與 `verify_as_of`，一般常駐項斷言 `!('verify' in plain)`。變異 m7 拿掉常駐區的 `verifyLine` → `✗ 常駐區的狀態類記憶沒有查證行`。測試直接用 SQL 寫出 durable 加 verify 的組合，對應 Given「之前的版本可以寫出這種狀態」，合理。note 與查證行並存的順序見 N-11 |

### 相關失敗面（輸入／狀態、預期、現有覆蓋、判定）

| 輸入／狀態 | 預期 | 現有覆蓋 | 判定 |
|---|---|---|---|
| 零查證命令的資料庫 | brief 與 golden 相同，不出現固定說明 | (J)、(U) 負向、m3 | 成立 |
| 只有常駐區有查證行（其他區塊都沒有） | 固定說明仍出現 | (V)、m2 | 成立 |
| scoped brief，狀態類記憶在另一個已註冊專案（不列出） | 沒有查證行，所以也沒有固定說明 | 由構造保證：`hasVerifyLine` 只看已渲染的資料項 | 成立（依程式判讀） |
| scoped brief，狀態類常駐項屬於環境專案 | 常駐區附查證行，固定說明出現一次 | 我手動測試 | 成立 |
| 常駐項同時有 note 與 verify | 主行、note、查證行 | 我手動測試 | 成立（N-11：沒有自動化） |
| `collapseNotePairs` 選到 session 半或 event 半 | 兩半都帶 `verify_cmd`，任一半都查得到 | (V) 對兩半都設 durable；寫入路徑對兩半都寫 verify | 成立 |
| 常駐項的 `verify_as_of` | 記憶自己的時間戳（`resolveRefTexts`） | (V) 用 DB 的 `substr(timestamp,1,10)` 比對 | 成立 |
| 常駐項已被取代 | 不出現（durableRows 已濾掉） | 沿用 issue-17 測試 | 成立 |
| `--verify` 含 U+2028／U+2029／U+0085／ESC／CR／LF | 拒絕，不寫入 | (Q)、m4／m5／m8 | 成立 |
| `--verify` 含 Tab（中間、前後） | 中間保留；前後被 trim | (Q)、m6b；前後是我實測 | 成立 |
| `--verify` 只有全形空白、只有 U+FEFF、只有 U+00A0 | trim 後變空字串，拒絕 | 我實測（exit 1） | 成立 |
| 前後全形空白包住的命令 | trim 後存下內容 | 我實測 | 成立 |
| 前後換行 | trim 後接受 | 我實測 | 見 N-9 |
| `\v`、`\f` | 拒絕 | 我實測 `\v` 為 exit 1 | 成立 |
| U+202E、只有 U+200B | — | 沒有覆蓋；我實測可以寫入 | 見 N-8 |
| 唯讀開啟 migration 16 的資料庫 | 保留標記，不遷移 | S-1 的新斷言、m9 | 成立 |
| `/v1/brief` 帶固定說明與常駐項 `verify` | markdown 與 CLI 相同 | 同一個 `renderBrief`；HTTP 測試綠燈 | 成立（HTTP 沒有針對常駐項的斷言，屬結構保證） |
| 本機 UI 的 brief 頁 | 不顯示查證命令（TBD-5） | `src/ui/app.ts:263` 只取 snippet、note 等欄位；`src/ui` 沒有任何變更 | 成立 |

### 需求、架構、安全、品質

- **範圍**：`git diff --stat c35df0b 4e78e45 -- src/adapter src/cli/commands/service.ts src/ui src/server.ts src/core/db/recall.ts src/core/db/prune-export.ts src/core/db/memory-browser.ts package.json pnpm-lock.yaml` 沒有輸出。沒有新增依賴、沒有新增或改名命令，schema 只有 migration 17，本輪沒有再改 schema。
- **架構**：本輪的邏輯都在 `src/core/db/brief.ts` 與 `memory-attributes.ts`，CLI 與 HTTP 都經過同一個 `renderBrief`。`timestampOf` 往前移，讓常駐項與高效用項共用；verify 查詢仍然只對列出的 ref 做一次 `loadAttributes`，沒有新增查詢。
- **安全**：Memoria 仍然沒有任何執行查證命令的路徑。固定說明把「只在唯讀時才跑」寫進自動載入的 brief，補上上一輪 S-3 指出的缺口。固定說明本身含有 `<命令>` 佔位符，有 code span 包住，也不是 `截至 <日期>` 的形式，不會被當成一則查證行。
- **品質（code-simplify 標準）**：新增的是一個常數、一個判斷函式，常駐區沿用既有的 `verifyLine`，沒有過度設計。`hasVerifyLine` 以 `item.verify` 判斷，常駐項與高效用項的渲染條件則是 `verify && verify_as_of`。兩者在 `queryBrief` 裡永遠成對設定，不會分歧。跨步驟的重複只有 `.slice(0, 10)` 取日期這一處，不值得抽出來。
- **中英文文件一致性**：CLI.md 與 CLI.zh-TW.md（固定說明、UTC、控制字元與 Tab）、API.md 與 API.zh-TW.md（常駐項的 `verify_as_of`、固定說明出現條件）、AGENTS.md、architecture.md 彼此一致，`release:docs-check` 通過。措辭小問題見 N-12。

### 豁免、待確認與限制

- 沒有 Gate 豁免紀錄。TBD-8 已解決，紀錄與現況一致（N-3、N-4、N-7 的處理見上表）。TBD-2～5 是範圍外，TBD-6 是資料整理，都不影響 Scenario。
- 限制：
  - 使用者 2026-11-11 的原話我無法直接查證，只核對了 README 與 TBD-8 的紀錄是否和修訂內容一致。
  - SCN-009、SCN-010 依維護者機器上的手動證據。
  - 我沒有跑完整 CI。npm-install、node18-smoke、release、repo 組的其他腳本、antigravity adapter 都沒跑，依 plan 步驟 10 的紀錄。
- 我實際執行的命令：
  - 靜態檢查：`pnpm run check`、`pnpm run build`、`node dist/cli.mjs --help`、`pnpm run release:docs-check`、四支腳本的 `bash -n`。
  - 測試腳本，全部 exit 0：`test-memory-attributes`、`test-cli-memory`、`test-migrations`、`test-brief-scope`、`test-memory-browser`、`test-smoke`、`test-http-api`、`test-ui-http`、`test-vector-recall`、`test-setup-onboarding`、`test-prune`、`test-wiki-query-fileback`、`test-repo-promotion`、`test-pure-functions`、`test-utility-ranking`、`test-claude-code-adapter`、`test-codex-adapter`、`test-wiki-build`。
  - 變異測試：m1、m2、m3、m4、m5、m6b、m7、m8、m9 都紅燈（m9 用 `test-memory-browser`，其他都是 `test-memory-attributes`）。m6 是我自己寫錯的變異（正規式多出一個 `-`），已重做成 m6b。
- 審查期間：
  - 沒有讀寫 `~/.memoria` 的內容。為了確認沒有誤寫，開始時讀過一次兩個資料庫檔的修改時間（stat）。
  - 沒有碰任何 host skill 目錄。
  - 跑 `setup` 的腳本一律用 scratch 的假 HOME。
  - 暫存檔都放在 scratchpad 的 `r2/`。
  - 除了本報告，沒有修改任何受版控的檔案；`dist/` 由 build 重新產生，不受版控。

## 流程判定
RETURN TO execute-task

程式與測試這一面沒有 MUST FIX：上一輪的 S-1、S-2、S-3、N-1、N-2、N-5、N-6 都確實處理好，SCN-001～SCN-012 都有證據，新測試在功能缺失時都會紅燈。退回的唯一原因是 M-1：規格修訂後的核准紀錄沒有照 acceptance.md 更新，而且這個缺口無法在審查後用記帳提交補正。M-1 只需要改 README 的 `## Gherkin 核准紀錄`，可以順便處理 N-10。修完後第三輪只要核對文件差異，並確認 `git diff 4e78e45 <新 HEAD>` 沒有動到程式。如果使用者選擇以 Gate 豁免接受現有紀錄（M-1 的 `需決策`），依 review-evidence.md，這一項就不再阻擋 PASS。
