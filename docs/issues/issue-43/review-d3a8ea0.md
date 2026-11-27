# 審查報告
- 範圍：完整交付範圍
- Reviewed BASE SHA：0eb4e8dd108407456e7c5c91444dc738429aefc2
- Reviewed HEAD SHA：d3a8ea051f18f5a2c420d1c84518e9d89faef5ad
- Reviewed patch-id：2fbd02ab0421ef99787db013d2f29777e36b4b13
- 獨立 reviewer：Claude（獨立 reviewer subagent，未參與實作）
- 增量覆審：上一份報告 review-b2cc42a.md，增量範圍 `b2cc42a..d3a8ea0`；處理上一份 PASS 的建議（使用者選修正：SHOULD FIX 1、NICE TO HAVE 1 做法 A、NICE TO HAVE 2、NICE TO HAVE 3、NICE TO HAVE 4，結論記在 README 待確認事項 TBD-4～8）

## 問題與風險

### MUST FIX
無。

### SHOULD FIX
無。

### NICE TO HAVE
1. **新的位置斷言沒測到「第一個」的判定與 astral 字元的 code point（`scripts/test-memory-attributes.sh:410`）**
   - 這是增量新增的行為。CHANGELOG 與 CLI 雙語文件都寫「指出第一個被拒絕的字元」，實作是對的：我用 tsx 直接呼叫，`a\nb​c` 回 `U+000A at character 2`，`a​b\nc` 回 `U+200B at character 2`，`git\u{E0001}x` 回 `U+E0001 at character 4`。
   - 但三個新案例都只含一種違規字元，違規字元也都在 BMP。我在 scratch 副本做變異測試：把 `Math.min(format, controlInRaw)` 改成 `Math.max`，或把 `raw.codePointAt(forbidden)!` 改成 `raw.charCodeAt(forbidden)`，`test-memory-attributes.sh` 都還是 exit 0。
   - 影響：只是證據持久性的問題，不影響這次判定。之後有人改壞這兩處，測試擋不下來。
   - 建議：加兩個案例，例如 `$'a​b\nc|U+200B at character 2'`（格式字元在前、控制字元在後），以及 `$'git\U000E0001x|U+E0001 at character 4'`（astral 的 Cf）。

2. **步驟 2 的 GitNexus impact 少了兩個被修改的 symbol（`docs/issues/issue-43/README.md:62`）**
   - SHOULD FIX 1 的 impact 部分沒有補齊。步驟 2 只記了 `startServer`、`registerRecallCommand` 是 LOW，但完整範圍也改了 `registerBriefCommand`（`src/cli/commands/brief.ts`）與 `registerWikiCommand`（`src/cli/commands/wiki.ts`）。我補跑了這兩個的 upstream impact，都是 LOW，直接呼叫者都只有 `src/cli.ts` 的 `run`。
   - 步驟 3 的修正證據也沒寫 d3a8ea0 修改 `normalizeVerifyCommand` 前有沒有重跑 impact。這次簽名與回傳值都沒變，新的 `firstForbiddenIndex` 只在模組內使用，所以沿用步驟 3 原有的 CRITICAL 說明是成立的。
   - 影響：只是紀錄不完整，實際風險已確認是 LOW。
   - 建議：步驟 2 補上這兩個 symbol 的等級。注意這段在凍結章節，審查之後補寫會讓 PASS 失效，所以也可以只記在待確認事項，或維持現狀，由使用者決定。

## 已查核維度
- **SHOULD FIX 1（README 步驟證據）**：大致修好了，impact 還缺兩個 symbol，見 NICE TO HAVE 2。
  - 步驟 1 補了被測版本（`0eb4e8d` 的 src，做法是 `git stash push -- src`）、三支腳本的命令、各自的 exit 1 與第一條失敗斷言，也寫明逐條看紅燈的副本怎麼做、跑完即刪。
  - 步驟 2～4 都有「精煉」行（步驟 4 寫 no-op）。步驟 1 只寫紅燈，沒有可精煉的實作，不缺這一段。
  - 步驟 2、3 補了 impact 等級，四個步驟都用 ✅。
  - 檢查命令 `grep -n '<' docs/issues/issue-43/README.md` 沒有輸出。
  - TBD-4～8 的狀態欄有結論、日期與使用者的選擇，`## 現況` 與 Timeline 的寫法也符合 docs/AGENTS.md。
  - 用 `diff` 比對 `## 驗收條件` 區塊在 `0eb4e8d` 與 HEAD 的內容：只有 `**核准 commit**` 從 `待提交` 回填成 SHA，這是上一輪就查過的；增量沒有動這一行，AC-1～4 的文字沒變。
- **NICE TO HAVE 1 做法 A（CHANGELOG 補 hook adapter）**：已修好，內容正確。
  - `src/cli/commands/adapter.ts` 把 `Number(opts.recallTopK)` 原樣送進 `POST /v1/recall`。範圍外的值或小數會回 400，adapter 是 fail-open，所以 hook 輸出 `{}`、不注入記憶。這和 CHANGELOG 寫的一致。
- **NICE TO HAVE 2（錯誤訊息指出字元與位置）**：已修好。我用 tsx 直接呼叫 `normalizeVerifyCommand` 測了 23 個輸入：
  - 空字串、`   `、`\n` 仍是原本的訊息，沒有附加說明。
  - 結尾帶換行、開頭帶換行、Tab 都照常接受。
  - astral 的 Cf（U+E0001、U+1D173）印出完整的 code point。位置以 code point 計，用 `[...raw.slice(0, forbidden)]` 算，emoji 算一個字元；`\p{Cf}` 帶 `u` flag，比對位置不會落在代理對中間。
  - 控制字元的位置有加上前導空白的長度：`  git status\nrm x` 回 `character 13`。` ﻿ a\rb` 回 `U+FEFF at character 2`，因為 trim 與 trimStart 去掉的是同一組字元，位移一致。
  - 兩類字元都有時取位置較前的那個。
  - 只有 U+FEFF 的輸入，trim 後是空字串，訊息會附上 `U+FEFF at character 1`，資訊比較多，不是錯誤。
  - 兩個 regex 都沒有 `g` flag，`exec` 不帶狀態。
  - 孤立代理字元不屬於 Cf，本來就不擋，增量沒有改變這一點，也不在 AC-3 範圍內。
  - 三個位置斷言是真的紅燈：我用 `b2cc42a` 的 src 搭配 HEAD 的測試，build 後跑 `test-memory-attributes.sh`，exit 1，停在 `錯誤沒有指出 U+200B at character 4`，和 README 寫的一致。
  - 變異測試：拿掉前導空白位移，失敗在 `U+000A at character 13`；位置改用 UTF-16 index，失敗在 `U+200D at character 2`。兩種都抓得到，抓不到的見 NICE TO HAVE 1。
- **NICE TO HAVE 3（API 文件與 CHANGELOG 措辭）**：已修好。
  - API 雙語文件改成「超出範圍或不是整數的數字回 400」，括號註明 body 裡不是數字的值先被型別檢查擋下。這和 `src/server.ts` 的 `topKSchema`（`z.number().refine(isValidTopK)`）以及 brief 的 `isValidTopK` 判斷一致。
  - CHANGELOG 標題改成 on every HTTP and CLI entry。
  - EN 與 zh-TW 兩份（API、CLI）的意思一致，CLI 文件的例子 `found U+200B at character 4` 和實際輸出相同。
- **NICE TO HAVE 4（AC-3 訊息斷言）**：已修好。
  - 斷言改成 `*--verify*control*format*`。變異測試：把訊息裡的 `control or` 拿掉，exit 1，失敗在這條斷言。
  - 現行訊息仍符合 AC-3，也仍符合 (Q) 段既有的 `*--verify*` 斷言（空字串與空白的訊息沒變）。
- **AC-4 與回歸**
  - 用 `git diff --numstat 0eb4e8d d3a8ea0 -- scripts/` 檢查，三支測試檔的刪除數仍是 0。d3a8ea0 改的兩行都是本 issue 在 `b2cc42a` 新增的，既有斷言沒有改值。
  - 錯誤訊息的其他使用者：`normalizeVerifyCommand` 的唯一呼叫者是 `rememberNote`，scripts 裡沒有其他斷言比對這段訊息，HTTP 的 `/v1/remember` 也沒有 verify 欄位。
  - 我在 HEAD 的 `git archive` 副本先跑 `pnpm run build`，再用指定的 env 前綴跑以下項目，全部 exit 0：`pnpm run check`、`node dist/cli.mjs --help`、`bash -n install.sh`、`pnpm run release:docs-check`、CI core 組 10 支、`test-http-api.sh`。
  - http-mcp 組其餘 4 支沒有重跑：增量沒有改到它們走的程式路徑。我看過實作者的 inc43-test-*.log，5 支結尾都是 ok 或 PASS，`inc43.log` 也記錄都是 exit=0。
  - 跑完後確認 `~/.memoria` 沒有在本輪之後被修改的檔案。
- 其餘沿用 review-b2cc42a.md
- 豁免、待確認與限制：沒有新增。

## 流程判定
PASS

PASS 只適用於上列 Reviewed HEAD SHA；之後提交 README 記帳區段與本報告以外的檔案會讓它失效，提交前先告知使用者（review-evidence.md「審查之後的提交」）。
