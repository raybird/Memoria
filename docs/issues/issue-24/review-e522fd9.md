# Review — issue-24：`release.sh publish` 的 npm 驗證改為最後、帶版本輪詢

- **Reviewed BASE SHA**: `f7312d81bda30cdeb268b75d86ad90dfa50ac313`（`git merge-base main e522fd9`，等於 `main` 目前位置）
- **Reviewed HEAD SHA**: `e522fd9e1c743f5c0db96097b28663708b29c3d5`（分支 `issue-24-release-npm-poll`，審查結束時分支仍指向此 SHA）
- **Reviewed patch-id**: `6c06814463e2016a7ed1680eba8457d804674c22`（`git diff f7312d8 e522fd9 | git patch-id --stable`）
- **TARGET**: `main`
- **獨立 reviewer**: Claude subagent（general-purpose，未參與實作）
- **審查日期**: 2026-10-21
- **判定**: **PASS**
- **報告位置**: `docs/issues/issue-24/review-e522fd9.md`（尚未提交，由協調者以只新增報告的提交持久化）

## 審查範圍與風險

規格：`e522fd9:docs/issues/issue-24/README.md`，Small／Low，AC-1、AC-2 於 2026-10-21 以「照建議」核准。

`BASE..HEAD` 共兩個提交，4 檔，+141／-4：

| 提交 | 內容 |
| --- | --- |
| `52f078d` | 建立 issue 文件（AC 核准） |
| `e522fd9` | 實作：`scripts/release.sh`、`RELEASE.md`、`docs/HANDOVER.md`，README 回寫證據 |

| 檔案 | 變更 |
| --- | --- |
| `scripts/release.sh` | Verify 段搬進 `verify_shipped <version> <tag>`；檢查順序改為 GitHub Release → 下載產物 parity → 以 `npm view @raybird.chen/memoria@<version> version` 輪詢（`NPM_POLL_ATTEMPTS`×`NPM_POLL_INTERVAL`，預設 30×10s，可由環境變數覆寫）；`case` 前加 source guard；開頭守門清單補一項 |
| `RELEASE.md` | publish 守門表新增一列 |
| `docs/HANDOVER.md` | §8 Release SOP 的守門敘述補上 npm 輪詢 |
| `docs/issues/issue-24/README.md` | 新增 issue 文件與證據（含 harness 原文） |

步驟 2（觀察真正的 v1.30.1 發版）相依合併，README 標為 ⏳、證據欄寫「（發版時回寫）」，狀態欄是「待審查」，描述誠實，本次不視為缺件。

主要風險面：(1) `set -euo pipefail` 下輪詢迴圈、`|| true`、`&& break` 的行為；(2) source guard 在直接執行與被 source 時是否正確；(3) `npm view <pkg>@<version> version` 的實際輸出格式；(4) 除了 Verify 段重排，`cmd_publish`／`cmd_prepare` 有沒有其他改變；(5) 逾時訊息是否符合 AC-2；(6) README 的紅綠燈能否重現；(7) 文件與公開 repo gate。

## 證據（實際命令與結果）

環境：`git worktree add --detach ~/.cache/rv24/wt e522fd9`（下文 `<W>`），在 worktree 內 `pnpm install --frozen-lockfile`、`pnpm run build`、`pnpm run release:package`（產出 `dist/release/memoria-linux-x64-v1.30.0.tar.gz`，package.json 版本 1.30.0）。harness 由 reviewer 以腳本從 `e522fd9:docs/issues/issue-24/README.md` 的 `<details>` 逐字抽出三段程式碼（`bin/npm`、`bin/gh`、`run.sh`）放到 `~/.cache/rv24/harness`（下文 `<H>`），`TMPDIR=~/.cache/rv24/tmp`（ext4，不是 `/tmp`）。沒有執行真正的 `prepare`／`publish`，沒有 push、tag、建立 release 或 `npm publish`；對 registry 只用唯讀 `npm view`。審查後已 `git worktree remove --force`、刪除 `~/.cache/rv24`、`git worktree prune`；主工作區只剩原本就有的 `.serena/project.yml` 修改，分支仍在 `e522fd9`。

| # | 命令 | 結果 |
| --- | --- | --- |
| V-1 | `pnpm run check` | exit 0 |
| V-2 | `pnpm run build`；`node dist/cli.mjs --help` | `✓ Built dist/cli.mjs`；help exit 0 |
| V-3 | `bash -n scripts/release.sh` | exit 0 |
| V-4 | `pnpm run release:docs-check` | `Release doc sync check passed for v1.30.0`，exit 0 |
| V-5（AC-1 綠燈） | `bash <H>/run.sh <W> 3` | 依序 `Delivery parity check passed` → `── Wait for npm to serve 1.30.0 ──` → `✓ npm serves 1.30.0 (attempt 4)` → `── Released v1.30.0 ──`、`npm: 1.30.0`、`GitHub Release: https://example.invalid/releases/v1.30.0`；`rc=0 npm_calls=4` |
| V-6（AC-2 綠燈） | `bash <H>/run.sh <W> 999 4` | parity 通過後 `✗ npm does not serve 1.30.0 after 0s.`／`The release workflow already published it and the GitHub Release and artifact parity checks passed;`／`the public tag v1.30.0 must NOT be reused. Confirm once the registry catches up:`／`  npm view @raybird.chen/memoria@1.30.0 version`；`rc=1 npm_calls=4` |
| V-7（立即可用） | `bash <H>/run.sh <W> 0` | `✓ npm serves 1.30.0 (attempt 1)`，`rc=0 npm_calls=1` |
| V-8（實際間隔） | 同 V-6，`NPM_POLL_INTERVAL=1 NPM_POLL_ATTEMPTS=2` | `✗ npm does not serve 1.30.0 after 2s.`，rc=1，總耗時 3 秒（含 parity），間隔確實生效 |
| V-9（紅燈：修正前邏輯） | BASE 沒有 `verify_shipped`，reviewer 自己做「只重構」變體：取 `f7312d8:scripts/release.sh`，只在 `step "Verify what actually shipped"` 前插入 `verify_shipped "$version" "$tag"`／`}`／`verify_shipped() { local version="$1" tag="$2"`，並在 `case` 前加同一行 source guard。`diff` 確認它與 BASE 只差這兩處，與 HEAD 只差 Verify 內容與註解／常數。以同一份 harness（只把 source 的檔名換掉）跑三種情境 | 三種情境都是 `✗ npm reports 1.29.1, expected 1.30.0`，`rc=1 npm_calls=1`，沒有出現 parity 或 GitHub Release 的輸出——與 README 記錄的紅燈、與 v1.30.0 發版當下的訊息一致。注意「立即可用」情境在舊邏輯也紅，是因為假 npm 的 `latest` 永遠回 1.29.1（模擬 registry 落後），不代表實際環境中舊邏輯永遠失敗 |
| V-10（變異：順序） | 假 `gh` 讓 `release view` 失敗，其餘同 V-7 | `✗ no GitHub Release for v1.30.0`，`npm_calls` 為空：npm 一次都沒查，確認 GitHub Release 檢查在 npm 之前 |
| V-11（變異：查詢改回 `latest`） | 把 HEAD 第 225 行改成 `npm view @raybird.chen/memoria version`，`run.sh <W> 3 4` | `✗ npm does not serve 1.30.0 after 0s.`，`rc=1 npm_calls=4`：harness 擋得住「帶版本查詢」被改回去 |
| V-12（真實 registry，唯讀） | `npm view "@raybird.chen/memoria@1.30.0" version`；`@9.9.9`；`od -c` | 1.30.0：rc 0，stdout 正好是 `1.30.0\n`（7 bytes），經 `$(...)` 後是 `1.30.0`；9.9.9：rc 1，stdout 空，stderr `npm error code E404`／`No match found for version 9.9.9`；不存在的套件同樣 E404、rc 1。對照：range（`@^1.29`）才會輸出多行帶引號的 `<pkg>@<v> '<v>'`，而腳本傳的是 `pkg_version` 的精確版本，不會走到那個格式 |
| V-13（npm 快取） | 讀 npm 10.9.3 `lib/commands/view.js` | `packument(spec, { …, preferOnline: true })`：每次 `npm view` 都向 registry 重新驗證，本機快取不會讓輪詢一直讀到舊 packument |
| V-14（邊界：環境變數） | `NPM_POLL_ATTEMPTS=0`；`=abc`；`=`（空字串）；`NPM_POLL_INTERVAL=abc` | 0：不查詢，直接 AC-2 訊息、rc 1；`abc`：`seq: invalid floating point argument`，接著 `line 229: abc: unbound variable`，rc 1（沒有 AC-2 訊息）；空字串：`${…:-30}` 回到預設，`attempt 1` rc 0；`INTERVAL=abc`：第一次沒查到後 `sleep: invalid time interval`，`set -e` 讓腳本 rc 1 結束（沒有 AC-2 訊息）。全部都是失敗關閉，見 N-2 |
| V-15（直接執行） | `bash scripts/release.sh`；`bash scripts/release.sh bogus` | 都是 `✗ usage: release.sh <prepare|publish> [args]`，rc 1：guard 條件為真，`return` 不會被執行 |
| V-16（被 source 的副作用） | `cd ~; bash -c 'source <W>/scripts/release.sh; echo $- ; set -o \| grep pipefail; echo $PWD; type -t verify_shipped cmd_publish'` | `opts=ehuBc`、`pipefail on`、`PWD=<W>`、兩個函式都是 `function`：source 會把 `set -euo pipefail` 與 `cd "$ROOT_DIR"` 帶進呼叫端 shell，harness 用 `bash -c` 子 shell 所以不受影響。見 N-1 |
| V-17（`cmd_publish` 其他部分沒動） | V-9 的兩份 `diff` | HEAD 與「只重構」變體的差異只有：開頭守門註解兩行、`NPM_POLL_*` 常數與註解、Verify 內刪掉開頭的 npm 三行、parity 之後新增的輪詢段、source guard 上方的註解。`cmd_prepare`、Preconditions、Guards、Gate tests、Commit/tag、Push、Wait、Watch 都沒有改；`rm -rf "$tmp"`、`gh release download` 失敗時由 `set -e` 中止等既有行為也照舊 |
| V-18（release.yml） | 讀 `e522fd9:.github/workflows/release.yml` | `Publish to npm` 是無條件的 `npm publish --provenance --access public`，`Create or update GitHub Release` 在它之前；`gh run watch --exit-status` 綠表示 npm publish 已執行，逾時訊息「workflow already published it」的說法成立。沒有 `--tag`，`latest` 會跟著移動（見 N-3） |
| V-19（CI 是否跑 release.sh） | `grep -rn release.sh .github/workflows/*.yml scripts/test-*.sh` | 沒有結果：CI 與既有測試都不執行 `release.sh`，README「沒有重跑 CI 全套」的理由成立 |
| V-20（依賴） | `git diff f7312d8 e522fd9 -- package.json pnpm-lock.yaml skills/memoria-vector/package*.json .github \| wc -l` | `0` |
| V-21（署名） | `git log --format='%H%n%B' f7312d8..e522fd9 \| grep -inE 'co-authored\|claude\|anthropic'` | 沒有結果（exit 1） |
| V-22（公開 repo gate） | `git diff f7312d8 e522fd9 \| grep '^+' \| grep -nE '/home\|/Users\|<本機使用者名>\|<外部專案名>\|\.memoria'` | 沒有結果（exit 1） |
| V-23（GitNexus） | `detect_changes(scope=compare, base_ref=f7312d8)` | `risk_level: low`，`affected_count: 0`，`affected_processes: []`；變動符號只有 `RELEASE.md` 的段落。bash 不在索引內，與 README 說法一致 |

## 驗收對照（HEAD `e522fd9`）

| AC | 可觀察結果 | 證據 | 結論 |
| --- | --- | --- | --- |
| AC-1 | 先 GitHub Release 與 parity，再以 `npm view @raybird.chen/memoria@<version> version` 輪詢（預設 10s×30）；查到即 `Released <tag>`、exit 0；`latest` 仍是舊版不再造成失敗 | V-5、V-7 綠；V-9 修正前邏輯紅；V-10 證明順序；V-11 證明帶版本查詢被鎖住；V-12 證明真實 registry 的輸出就是版本字串；預設值由第 49–50 行讀出 | 通過 |
| AC-2 | 上限內查不到 → 非 0，訊息說明 workflow 已發布、tag 不可重用，列出確認命令 | V-6 全文含三項要素；V-8 實際間隔；V-9 修正前邏輯的訊息不含確認命令 | 通過 |

## 測試真偽

- **紅燈是目標行為造成的**：V-9 的失敗訊息就是 `latest` 落後的那一句，npm 只被呼叫一次、parity 沒跑，對應 issue 描述的缺陷，不是語法或環境錯誤。
- **不是同義反覆**：harness 的期望（`attempt 4`、`Released`、訊息字樣、`npm_calls`）是規格與 issue 描述的字面值，假 npm 的回應由呼叫次數決定，與腳本的迴圈寫法無關；V-11 的變異證明它可以和實作意見不合。
- **mock 的範圍**：假 npm 只接管 `view`，parity 用的 `npm pack --dry-run` 交給真的 npm；parity 跑的是真的 `check-delivery-parity.mjs` 與本機打包的產物。被驗收的核心行為（順序、輪詢、逾時訊息）沒有被 mock。
- 腳本本身沒有自動測試，harness 只保存在 README；這是 README 已揭露的限制，屬證據持久力，不是缺失。

## 範圍與 project.md gate

| Gate | 結果 |
| --- | --- |
| 不新增依賴 | 符合（V-20） |
| 不改 CLI 命令名或旗標 | 符合；`release:prepare`／`release:publish` 入口與 `prepare`／`publish` 子命令不變（V-15、V-17） |
| 版控文件只用代稱、沒有本機絕對路徑 | 變更的行符合（V-22）。README 的 harness 用 `$REPO`、`$(mktemp -d)`、`example.invalid`，沒有本機路徑 |
| 提交格式、沒有 AI 署名 | 符合（V-21）；`fix(issue-24): …`、`docs(issue-24): …` |
| 常青文件 | 符合：發版守門變更已更新 `RELEASE.md` 與 `docs/HANDOVER.md` §8（project.md 常青文件表要求的兩份），`release.sh` 開頭清單也補上 |
| GitNexus | `detect_changes` low／0（V-23） |
| Definition of Done | 1–4 項由 V-1～V-3 重現；第 5 項：`publish` 的輸出只在 Verify 段新增一個 step 與一行 `✓ npm serves … (attempt N)`，`Released` 區塊格式不變 |

**範圍外觀察**：`docs/HANDOVER.md` 第 40 行有一個本機絕對路徑（專案位置），是 BASE 之前就存在的內容，不在本次 diff 內，不列入發現；之後整理 HANDOVER 時可以一併改成相對描述。

## 失敗面覆蓋

| 失敗面 | 輸入／狀態 | 預期 | 覆蓋與結論 |
| --- | --- | --- | --- |
| registry 落後數次後可用（v1.30.0 實際情境） | 前 3 次 E404 | 等到第 4 次、rc 0 | V-5，通過 |
| registry 一直不可用 | 一律 E404，上限 4 | rc 1，AC-2 訊息 | V-6、V-8，通過 |
| 版本一開始就可用 | 第 1 次即回版本 | `attempt 1`、rc 0、不多等 | V-7，通過 |
| `latest` 仍是舊版 | 假 npm 的 `latest` 固定 1.29.1 | 不影響結果 | V-5～V-7 綠；V-11 證明若改回 `latest` 會紅，通過 |
| E404 在 `set -euo pipefail` 下 | npm rc 1、stderr 有錯誤 | 不中止腳本，繼續輪詢 | `2>/dev/null \|\| true` 吃掉狀態與雜訊；`[ … ] && break` 在 `&&` 串列左側失敗不觸發 `set -e`。V-5、V-6 實測，通過 |
| npm 輸出格式 | 真實 registry，精確版本 | 正好是版本字串 | V-12，通過 |
| 本機快取讓輪詢讀到舊資料 | 第一次查詢後 registry 更新 | 下一次能看到新版本 | V-13：`npm view` 用 `preferOnline`，通過 |
| GitHub Release 不存在 | `gh release view` 失敗 | 在 npm 之前失敗 | V-10，通過 |
| `published`／`attempt` 在迴圈後的值 | break 之後 | `Released` 區塊印出版本、`attempt` 是實際次數 | V-5 `npm: 1.30.0`、`attempt 4`，通過 |
| 直接執行 | `bash scripts/release.sh [bogus]` | 照舊印 usage、rc 1 | V-15，通過 |
| 被 source | `source scripts/release.sh` | 只用來驅動單一階段 | V-16：函式可用；同時帶進 shell 選項與 cwd，見 N-1 |
| 覆寫值不合法或為 0 | `NPM_POLL_*` 設 0／非數字 | 失敗關閉 | V-14：全部 rc 1，非數字時訊息不友善，見 N-2 |
| workflow 綠但 npm 沒發布 | release.yml 跳過 publish | 逾時訊息不應宣稱已發布 | V-18：publish 步驟無條件執行，不存在這個路徑，通過 |
| 實際發版 | v1.30.1 | 不用人工補驗跑到 `Released` | 依外部事件（合併後發版），README 步驟 2 以 ⏳ 誠實標示，不在本次範圍 |

## 發現

### MUST FIX

無。

### SHOULD FIX

無。

### NIT

- **N-1 source guard 上方的註解說法比實際窄。** 第 242 行寫「Sourcing (instead of executing) only defines the functions」，但 source 時第 34–50 行也會執行：`set -euo pipefail` 與 `cd "$ROOT_DIR"` 會作用在呼叫端 shell，常數也會定義（V-16）。README 的 harness 用 `bash -c` 子 shell，不受影響；若之後有人在互動 shell 直接 source，`set -e` 會讓第一個失敗命令關掉那個 shell。建議改成「Sourcing runs only the setup above (set -euo pipefail, cd to the repo root, constants) and defines the functions — source it in a subshell」。
- **N-2 `NPM_POLL_*` 覆寫值沒有驗證。** 設成 0 時一次都不查就以 AC-2 訊息失敗；非數字時是 `abc: unbound variable` 或 `sleep: invalid time interval` 加 rc 1，沒有 AC-2 的說明與確認命令（V-14）。全部失敗關閉、預設路徑不受影響，而且只有刻意 export 時才會發生。若要更穩，可在函式開頭加 `[[ "$NPM_POLL_ATTEMPTS" =~ ^[1-9][0-9]*$ && "$NPM_POLL_INTERVAL" =~ ^[0-9]+$ ]] || die "…"`。另外最後一次查不到之後仍會 sleep 一次才 die，逾時時多等一個間隔（預設 10 秒），影響可以忽略。
- **N-3 `latest` dist-tag 不再被驗證。** `需決策`。舊的檢查雖然誤報，但同時隱含驗證了 `latest` 已指向新版；改成帶版本查詢後，若 publish 沒有移動 `latest`（例如日後 workflow 加了 `--tag`），腳本仍會報成功，而不帶版本的 `npm i -g @raybird.chen/memoria` 會裝到舊版。目前 release.yml 的 `npm publish` 沒有 `--tag`（V-18），`latest` 會照預設移動，腳本最後的升級提示也是帶版本的 `@$version`，所以現況沒有實際風險；AC-1 也已明確核准以帶版本查詢取代。待決問題：是否要接受「不驗 `latest`」這個殘餘風險。可選做法：(a) 照現狀接受；(b) 輪詢成功後再查一次 `npm view @raybird.chen/memoria version`，不一致時只印警告、不 die。reviewer 建議 (a)，有需要時再做 (b)；不影響本次判定。
- **N-4 HANDOVER 新增的句子混用全形括號。** 該行其餘部分用半形 `,`、`(`，新增的「（最多 5 分鐘；…，issue-24）」用全形括號與分號。純排版，不影響內容。

## 判定

**PASS**：獨立審查完成，沒有 MUST FIX，也沒有 SHOULD FIX。reviewer 從 README 逐字抽出 harness 重現了 AC-1（`attempt 4`、rc 0）、AC-2（rc 1、訊息含三項要素與確認命令）與立即可用（`attempt 1`）三個情境（V-5～V-7），並以自己做的「只重構」變體重現修正前邏輯在第一次查詢就失敗、parity 沒跑（V-9）。兩個變異（V-10 順序、V-11 改回 `latest`）都會紅，真實 registry 對精確版本的輸出就是版本字串（V-12），`cmd_publish` 除了 Verify 段之外沒有變動（V-17）。四個 NIT 是註解精確度、覆寫值驗證、`latest` 殘餘風險（`需決策`，建議照現狀接受）與排版，不影響合併。步驟 2（v1.30.1 實際發版觀察）相依合併，README 已誠實標示為待辦。
