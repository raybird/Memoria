# Review — issue-23 第二輪：審查修正（S-1、N-1～N-4）與完整範圍複核

- **Reviewed BASE SHA**: `ba79a8b5b6d54d6cd4c0200031314d8985fc8b44`（`git merge-base main b840514`，等於 `main` 目前位置）
- **Reviewed HEAD SHA**: `b840514ceffa684897a33da5756345de01ad285b`（分支 `issue-23-vector-upgrade-docs`，審查結束時分支仍指向此 SHA）
- **Reviewed patch-id**: `6e9850b52b3b9e7620c06fcfd2da07c932305d06`（`git diff ba79a8b b840514 | git patch-id --stable`）
- **TARGET**: `main`
- **獨立 reviewer**: Claude subagent（general-purpose，未參與實作，也未參與第一輪審查）
- **審查日期**: 2026-10-21
- **判定**: **PASS**
- **報告位置**: `docs/issues/issue-23/review-b840514.md`（尚未提交，由協調者以只新增報告的提交持久化）

## 審查範圍與風險

規格：`b840514:docs/issues/issue-23/README.md`，Small／Low，AC-1～AC-4 於 2026-10-21 以「照建議」核准。條文與第一輪審查時（`45d6170`）相同，`345fb7f..b840514` 只在完成證據、Timeline 與狀態欄位加字，沒有改 AC。

`BASE..HEAD` 共四個提交，8 檔，+304／-7：

| 提交 | 內容 |
| --- | --- |
| `817d69a` | 建立 issue 文件 |
| `45d6170` | 實作（第一輪 PASS） |
| `345fb7f` | 只新增 `review-45d6170.md`（`--name-status` 為 `A`） |
| `b840514` | 依第一輪發現修正：測試、`doctor.ts` fix 字串、INSTALL／OPERATIONS／helper README、issue README |

`b840514` 不是只加報告的提交，第一輪 PASS 不延續到這個 HEAD，所以重審完整範圍，重點放在 `345fb7f..b840514`（6 檔，+21／-8）：

| 檔案 | 變更 |
| --- | --- |
| `scripts/test-vector-recall.sh` | `ISO_PKG` 改成 `"$(cd "$TMP_DIR" && pwd -P)/pkg-no-embedder"`；斷言清單加入 `vector_timeout` |
| `src/cli/commands/doctor.ts` | fix 字串：`every "npm i -g" upgrade` 前面加上 `on a global install` |
| `docs/INSTALL.md`、`docs/OPERATIONS.md` | 升級步驟寫明要在設了 `LIBSQL_URL` 的 shell 執行，並說明少了它會怎樣（暖機失敗，doctor 顯示 `not enabled` 卻算通過） |
| `skills/memoria-vector/README.md` | 暖機那句加上「with `LIBSQL_URL` set」 |
| `docs/issues/issue-23/README.md` | 審查修正紀錄、`detect_changes` 紀錄、Timeline 一列、狀態改為「待審查」 |

主要風險面：(1) 第一輪的發現是否真的修好，特別是 S-1 的 `pwd -P` 能不能讓 symlink 的 `TMPDIR` 轉綠；(2) 修正有沒有帶進新問題，例如測試變成無法失敗、doctor 判定邏輯被動到；(3) 新加的文件說法是否正確（「暖機會失敗」「doctor 顯示 `not enabled` 而且算通過」）；(4) README 的證據說法是否和 reviewer 重現的結果一致；(5) 公開 repo gate。

## 證據（實際命令與結果）

環境：`git worktree add --detach ~/.cache/rv23b/wt b840514`（下文以 `<R>` 代表 `~/.cache/rv23b`），在 worktree 內 `pnpm install --frozen-lockfile`。helper 照 CI 的方式由測試腳本自己跑 `npm install --omit=dev`，裝完 `skills/memoria-vector/node_modules/@huggingface/` 是空目錄，`transformers` 不存在。所有命令都加 `env -u LIBSQL_URL -u MEMORIA_HOME -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_VECTOR_RECALL_CMD -u MEMORIA_VECTOR_ENABLE`（開發者 shell 確實有 export 前四個），`TMPDIR=<R>/tmp`（ext4，不是 tmpfs）。沒有碰 `~/.memoria`、真正的向量庫或全域套件。審查後已 `git worktree remove --force`、刪除 `<R>`、`git worktree prune`；主工作區只剩原本就有的 `.serena/project.yml` 修改，分支仍在 `b840514`。

| # | 命令 | 結果 |
| --- | --- | --- |
| V-1 | `pnpm run check` | exit 0 |
| V-2 | `pnpm run build`；`node dist/cli.mjs --help` | `✓ Built dist/cli.mjs`；help exit 0 |
| V-3 | `bash -n scripts/test-vector-recall.sh` | exit 0 |
| V-4（綠燈） | `TMPDIR=<R>/tmp bash scripts/test-vector-recall.sh` | exit 0；第 25 行 `enabled + embedder missing -> fix names the upgrade wipe and the warm-up`，最後 `[vector] ok`。build 後另跑一次（V-4b），結果相同 |
| V-5（symlink TMPDIR，S-1） | `ln -sfn <R>/tmp <R>/tmplink`；`TMPDIR=<R>/tmplink bash scripts/test-vector-recall.sh`（先確認 `mktemp -d` 回傳的是 `<R>/tmplink/tmp.*`，沒有解析 symlink） | **exit 0**，`[vector] ok`。第一輪的 V-6 在同樣條件下是紅的 |
| V-6（S-1 對照） | 把測試改回 `45d6170` 的版本（`git checkout 45d6170 -- scripts/test-vector-recall.sh`），doctor 用 HEAD，同樣用 symlink 的 `TMPDIR` | exit 1：`Error: embedder fix must mention "inside <R>/tmplink/tmp.HWSH1DERKF/pkg-no-embedder/skills/memoria-vector", got: …`。可見 V-5 轉綠確實是 `pwd -P` 造成的，不是環境不同。之後還原成 HEAD |
| V-7（變異：移除逾時字樣，N-3） | `sed -i 's/ (route_mode=vector_timeout)//' src/cli/commands/doctor.ts`（改完後檔內 `vector_timeout` 出現 0 次）→ build → 測試 | exit 1：`Error: embedder fix must mention "vector_timeout", got: MEMORIA_EMBED_PROVIDER=local needs …`。之後 `git checkout -- src/cli/commands/doctor.ts` |
| V-8（變異：doctor 回到 BASE） | `git checkout ba79a8b -- src/cli/commands/doctor.ts` → build → 測試 | exit 1：`Error: embedder fix must mention "npm i -g", got: … both skip it. Run "npm install" (without --omit=dev) in…`。前面四個 doctor 案例都通過，只在升級成因這條失敗。之後改回 `b840514` 並重新 build，`git status --short` 為空 |
| V-9 | `bash scripts/test-npm-install.sh`（HEAD） | exit 0，`[npm-install] ok`（doctor 全綠的 gate） |
| V-10（新文件說法） | 臨時 `MEMORIA_HOME`，沒有 `LIBSQL_URL`：`memoria init`、`memoria doctor`、`doctor --json` | 人看的輸出：`✓ vector recall: not enabled (LIBSQL_URL unset)`；JSON：`ok=true`，向量相關的 check 只有 `{"name":"vector recall","ok":true,"value":"not enabled (LIBSQL_URL unset)"}` |
| V-11（新文件說法） | 在 worktree helper 目錄、沒有 `LIBSQL_URL`：`echo '{"query":"warm up"}' \| node vector-recall.mjs >/dev/null` | stderr `LIBSQL_URL is required`，exit 1 |
| V-12 | `grep -rln "vector embedder" scripts/ src/` | 只有 `doctor.ts` 和 `test-vector-recall.sh`，沒有其他測試斷言這段 fix 文字，所以改字串不會影響其他測試 |
| V-13（AC-2） | `git show b840514:skills/memoria-vector/README.md \| grep -n cache/huggingface`；OPERATIONS 同樣檢查 | 都沒有結果（exit 1） |
| V-14（依賴） | `git diff ba79a8b b840514 -- package.json pnpm-lock.yaml skills/memoria-vector/package.json skills/memoria-vector/package-lock.json \| wc -l` | `0` |
| V-15（署名） | `git log --format='%H%n%B' ba79a8b..b840514 \| grep -inE 'co-authored\|claude\|anthropic'` | 沒有結果（exit 1） |
| V-16（GitNexus） | `detect_changes(scope=compare, base_ref=ba79a8b)` | `risk_level: low`，`affected_count: 0`，`affected_processes: []`；變動的符號只有 INSTALL／OPERATIONS／helper README 的文件段落。`vectorChecks` 不在索引裡，和 README 的說明一致 |

## 第一輪發現的處置

| 編號 | 第一輪發現 | `b840514` 的修正 | 驗證 | 結論 |
| --- | --- | --- | --- | --- |
| S-1 | `TMPDIR` 含 symlink 時新斷言會誤紅（doctor 回報 realpath，測試拿未解析的路徑比對） | `ISO_PKG="$(cd "$TMP_DIR" && pwd -P)/pkg-no-embedder"`，並加註原因 | V-5 綠、V-6（舊測試）紅；V-4 一般 `TMPDIR` 仍綠。版面裡其他用到 `ISO_PKG` 的地方（`mkdir`、`cp`、`node_modules` symlink、執行 `dist/cli.mjs`）都改走已解析的路徑，doctor 從 `import.meta.url` 推出的 `embedderDir` 和斷言用的 `process.argv[2]` 現在是同一個字串。`cd` 在 `$(...)` subshell 裡，不影響腳本的工作目錄 | 已修正 |
| N-1 | 升級步驟沒寫要有 `LIBSQL_URL`；少了它時暖機會失敗、doctor 看起來全綠 | INSTALL、OPERATIONS 寫明「在設了 `LIBSQL_URL` 的 shell 裡執行」，並說明少了它的結果；helper README 加上「with `LIBSQL_URL` set」 | V-10、V-11 重現：暖機 exit 1、`LIBSQL_URL is required`；doctor `✓ vector recall: not enabled`、`ok=true`。兩份文件的說法和實際行為一致 | 已修正（helper README 只寫了前提、沒寫後果，見 N-1） |
| N-2 | fix 寫「every npm i -g upgrade」，但 checkout 安裝不適用 | 改為「on a global install every "npm i -g" upgrade replaces this directory」 | 讀 `b840514:src/cli/commands/doctor.ts`：只改字串字面值，`name`／`ok`／`value` 與分支條件都沒變；OPERATIONS doctor 表格寫的「a global `npm i -g` upgrade」本來就有限定詞，和 fix 一致 | 已修正 |
| N-3 | AC-1(c) 只靠 `vector-recall.mjs` 鎖住，刪掉逾時半句測試仍綠 | 斷言清單加上 `vector_timeout` | V-7：拿掉 `(route_mode=vector_timeout)` 後測試紅，失敗訊息直接指出這個字串。`vector_timeout` 在 fix 裡只出現在逾時那半句 | 已修正 |
| N-4 | README 狀態仍是「進行中」；沒記錄 `detect_changes` | 狀態改「待審查」；補上「提交前 `detect_changes`：`45d6170` 為 low，affected processes 0」；Timeline 加一列 | V-16 由 reviewer 對完整範圍重跑，結果一致（low、0） | 已修正（紀錄只寫到 `45d6170`，見 N-2） |

## 驗收對照（HEAD `b840514`）

| AC | 可觀察結果 | 證據 | 結論 |
| --- | --- | --- | --- |
| AC-1 | `--omit=dev` 的 helper：`vector embedder` 為 `ok:false`，fix 含 `--omit=dev`、`NODE_ENV=production`、`npm i -g`、`vector-recall.mjs`、`vector_timeout`、`inside <embedderDir>` | V-4／V-5 綠；V-7、V-8 紅，各自只在目標字串失敗 | 通過 |
| AC-2 | 兩個檔案都沒有 `cache/huggingface`，改寫成套件內的 `.cache/`，並說明會跟著 `node_modules` 一起被清掉 | V-13；人工閱讀 helper README 第 24–26 行、OPERATIONS 的模型快取段落；`b840514` 沒有改到這兩段 | 通過 |
| AC-3 | INSTALL Method A 與 OPERATIONS 第 3 點各有升級後的步驟：重裝、暖機、doctor | 人工閱讀：兩邊命令區塊一字不差，前提句現在寫明 `LIBSQL_URL`；V-10、V-11 確認新增的後果說明正確。實機重現（doctor 全綠、`route_mode=hybrid_vector`）照硬性限制不重跑，沿用維護者證據，第一輪已用只讀檢查確認和檔案系統狀態一致，`b840514` 沒有改到這段證據 | 通過（實機部分依維護者證據） |
| AC-4 | issue-19 不再寫「不加 skip 會失敗」 | `git diff ba79a8b b840514 -- docs/issues/issue-19/README.md` 只改這一句，改成偶發並記錄兩次重現成功，連到 issue-23 | 通過 |

## 測試真偽

- **不是同義反覆**：新增的 `vector_timeout` 是規格 AC-1(c) 指名的症狀、固定字面值，跟 doctor 組字串的方式無關。`pwd -P` 只決定測試自己組的路徑怎麼寫；期望的 `inside <path>` 仍是測試傳入的值，不是從 doctor 輸出回推，所以 doctor 回報錯的目錄時還是會紅。
- **修正沒有讓斷言變弱**：`pwd -P` 只把測試這邊的路徑正規化成 realpath，doctor 這邊照舊；V-8 證明舊字串仍會被擋下。
- **紅燈是目標行為造成的**：V-6、V-7、V-8 的失敗訊息都指向特定的缺失字串，不是語法或環境錯誤。
- 沒有刪除、略過或弱化任何既有斷言（`345fb7f..b840514` 的測試 diff 只有兩行：一行改路徑、一行在陣列加元素）。

## 範圍與 project.md gate

| Gate | 結果 |
| --- | --- |
| 不新增依賴 | 符合（V-14） |
| 不改 CLI 命令名或旗標 | 符合 |
| doctor 判定邏輯與 JSON 結構 | 沒變，只改 fix 字串字面值；V-9、V-12 |
| 版控文件只用代稱、沒有本機絕對路徑 | 符合：`git diff ba79a8b b840514` 的新增行 grep `/home`、`/Users`、本機使用者名、外部專案名稱，沒有命中。命中的只有已提交的 `review-45d6170.md` 裡的 `~/.cache/rv23/…`（以 `~` 開頭的暫存路徑，不含使用者名稱）和「本機（nvm）」（工具名稱，不是外部專案），兩者都不違反規則。`b840514` 新增的行沒有這類內容 |
| 提交格式、沒有 AI 署名 | 符合（V-15） |
| 常青文件 | 符合：沒有新增測試腳本，不用改 CLAUDE.md 的 Tests 清單或 `ci.yml` |
| GitNexus | `detect_changes` low／0（V-16） |
| Definition of Done | 1–4 項由 V-1～V-4 重現；第 5 項 CLI 輸出格式沒變 |
| 本機 artifact 有效性 | `345fb7f` 只新增 `review-45d6170.md`（`A`），但後面接了 `b840514`，第一輪 PASS 只對 `45d6170` 有效，所以需要這次重審 |

## 失敗面覆蓋

| 失敗面 | 輸入／狀態 | 預期 | 覆蓋與結論 |
| --- | --- | --- | --- |
| CI：helper 只有 `--omit=dev` | worktree 由腳本以 `--omit=dev` 安裝 | 走到 embedder missing 並通過 | V-4，通過 |
| macOS／`TMPDIR` 經過 symlink | `TMPDIR=<R>/tmplink` | 綠 | V-5 綠；V-6 證明是修正造成的。macOS 實機沒有跑，但機制相同（`mktemp` 回傳未解析的路徑，Node 解析主模組 realpath），已用 Linux 的 symlink 重現 |
| 逾時說明被刪 | 拿掉 `(route_mode=vector_timeout)` | 紅 | V-7，通過 |
| 舊字串回歸 | `doctor.ts` 回到 BASE | 紅 | V-8，通過 |
| 開發者 shell 的向量環境變數滲入 | `LIBSQL_URL` 等有 export | 不影響結果、不碰真的向量庫 | 腳本開頭有 unset，新案例指定暫存的 `VECDB`；reviewer 執行時也另外 unset。通過 |
| 照文件升級，但 shell 沒有 `LIBSQL_URL` | 沒有 `LIBSQL_URL` 的 shell | 文件要警告：暖機失敗、doctor 看起來全綠 | V-10、V-11 確認文件描述的就是實際行為。通過 |
| 照 helper README 暖機但沒有 `LIBSQL_URL` | 同上 | 有前提說明 | README 寫了「with `LIBSQL_URL` set」，沒寫後果；helper 會大聲失敗（stderr、exit 1），不是靜默。見 N-1 |
| doctor 的其他使用者 | `test-npm-install.sh` | 不受影響 | V-9 PASS；V-12 |
| checkout 安裝看到 fix 被誤導 | 以 checkout 的 `./cli` 執行 | fix 不應宣稱 checkout 也會被升級清掉 | `b840514` 加上「on a global install」限定，通過 |

## 發現

### MUST FIX

無。

### SHOULD FIX

無。

### NIT

- **N-1 issue README 對 N-1 修正的描述比 helper README 的實際改動多一點。** README 寫「INSTALL.md、OPERATIONS.md 與 helper README 的升級步驟改為寫明『在設了 `LIBSQL_URL` 的 shell 裡執行』，並說明少了它會發生什麼」，但 helper README 只加了「with `LIBSQL_URL` set」，沒說後果。helper README 的讀者已經在 helper 目錄裡，而且 helper 沒有 `LIBSQL_URL` 時會印 `LIBSQL_URL is required`、exit 1，不是靜默失敗，所以實際影響很小。可以把 README 那句改成「INSTALL.md、OPERATIONS.md 寫明前提與後果，helper README 寫明前提」，或在 helper README 補半句。
- **N-2 `detect_changes` 的紀錄只到 `45d6170`。** README 寫「提交前 `detect_changes`：`45d6170` 為 low」，`b840514` 本身提交前跑的結果沒有記錄。reviewer 已對完整範圍 `ba79a8b..b840514` 重跑（V-16：low、affected 0），協調者交付時可以引用這筆結果補上。
- **N-3 `b840514` 的綠燈證據只有文字。** README 寫「改完後 `pnpm run check`、build、`test-vector-recall.sh` 皆通過」，沒有附命令輸出或 exit code；34 支全套回歸的被測對象是修正前的工作區（`817d69a` 加上當時的改動，2026-10-21T10:02）。這次的改動只有一段字串和這支測試的兩行，V-12 確認沒有其他測試依賴這段文字，reviewer 也重現了 V-1～V-9，所以證據對本次驗收是足夠的。這屬於證據持久力，不是假綠燈；之後補紀錄時把 exit code 和最後一行輸出寫上就好。

## 判定

**PASS**：獨立審查完成，沒有 MUST FIX，也沒有 SHOULD FIX。第一輪的 S-1、N-1～N-4 都已修正，其中 S-1 由 reviewer 用 symlink 的 `TMPDIR` 重現：修正後綠、修正前紅（V-5、V-6）。N-3 新增的斷言經變異測試確認擋得住（V-7）。doctor 回到 BASE 仍然會紅（V-8）。新增的文件說法和實際行為一致（V-10、V-11）。doctor 的判定邏輯、JSON 結構與依賴都沒有變。AC-1～AC-4 在 `b840514` 上仍然成立；AC-3 的實機部分照硬性限制沿用維護者證據。三個 NIT 都是紀錄的精確度問題，不影響合併。
