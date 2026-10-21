# Review — issue-23 全域升級清空語意召回 helper 依賴：doctor fix 文字與文件

- **Reviewed BASE SHA**: `ba79a8b5b6d54d6cd4c0200031314d8985fc8b44`（`git merge-base main 45d6170`，等於 `main` 目前位置）
- **Reviewed HEAD SHA**: `45d6170c99b57984c8035b259a12068db9308ffc`（分支 `issue-23-vector-upgrade-docs`，審查結束時分支仍指向此 SHA）
- **Reviewed patch-id**: `a02b8ffd9adcdef592177ecfd0e1efd8993aea27`（`git diff ba79a8b 45d6170 | git patch-id --stable`）
- **TARGET**: `main`
- **獨立 reviewer**: Claude subagent（general-purpose，未參與實作）
- **審查日期**: 2026-10-21
- **判定**: **PASS**
- **報告位置**: `docs/issues/issue-23/review-45d6170.md`（尚未提交，由協調者以只新增報告的提交持久化）

## 審查範圍與風險

規格：`45d6170:docs/issues/issue-23/README.md`，Small／Low，AC-1～AC-4 於 2026-10-21 以「照建議」核准。

`BASE..HEAD` 共兩個提交（`817d69a` 建 issue、`45d6170` 實作），7 檔，+147／-7：

| 檔案 | 變更 |
| --- | --- |
| `src/cli/commands/doctor.ts` | `vectorChecks` 的 `vector embedder` 失敗分支：只改 `fix` 字串，補上 `npm i -g` 升級換掉目錄（連同模型）、「每次升級後再裝一次」、暖機命令 `echo '{"query":"warm up"}' \| node vector-recall.mjs` 與逾時提示 |
| `scripts/test-vector-recall.sh` | 新增案例：在 `$TMP_DIR` 組一個 helper 沒有 `node_modules` 的套件版面，跑 `doctor --json`，斷言 fix 含五個子字串 |
| `skills/memoria-vector/README.md` | 模型快取位置更正；新增升級後重裝與暖機的提示框 |
| `docs/OPERATIONS.md` | 模型快取位置更正；doctor 表格那一列的說明；標題 Two → Three things；新增第 3 點與升級後命令 |
| `docs/INSTALL.md` | Method A 補升級、重裝、暖機步驟 |
| `docs/issues/issue-19/README.md` | 一句 CUDA postinstall 說法更正 |
| `docs/issues/issue-23/README.md` | 新建 issue 文件 |

主要風險面：(1) 文件與 fix 的事實陳述是否正確（快取位置、暖機命令是否真的會載入模型、`cd` 命令能否定位 helper、「不需重新 ingest」）；(2) 新測試是不是真的會紅、在 CI 與開發者機器上是否穩定；(3) doctor 的判定邏輯與 JSON 結構有沒有被動到；(4) 公開 repo gate。

## 事實核對

| # | 陳述 | 核對方式 | 結論 |
| --- | --- | --- | --- |
| F-1 | transformers.js 在 Node 下把模型快取在自己的套件目錄 `.cache/`，不在 `~/.cache/huggingface` | 讀 checkout 內 `@huggingface/transformers@4.2.0` 的 `dist/transformers.node.mjs`：第 87–96 行 `dirname__ = path.dirname(path.dirname(fileURLToPath(import.meta.url)))`，`DEFAULT_CACHE_DIR = path.join(dirname__, "/.cache/")`，即套件根目錄下的 `.cache/`。整份 dist 只讀 `HF_TOKEN`／`HF_ACCESS_TOKEN`／`TESTING_REMOTELY` 三個環境變數，沒有 `HF_HOME`／`TRANSFORMERS_CACHE` 覆寫。checkout 內實際存在 `.cache/Xenova/multilingual-e5-small`（含 `onnx/`、tokenizer）。本機 `~/.cache/huggingface` 雖存在，但裡面沒有 e5 模型 | 正確 |
| F-2 | stdin 空的話 `vector-recall.mjs` 直接回空結果、不載入模型，所以暖機命令要帶查詢 | 原始碼：`if (!query) { console.log({hits:[]}); exit 0 }` 在 `embedTexts` 之前。實測（helper 複本，見 E-6）：空 stdin 0.07 秒回 `{"hits":[]}` | 正確 |
| F-3 | 照文件寫的暖機命令會載入模型 | 原始碼順序：query 檢查 → `LIBSQL_URL` 檢查 → `embedTexts`（載入模型）→ 開 DB → 查表。實測帶查詢、`LIBSQL_URL` 指向暫存新檔：1.04 秒（快取已在）回 `{"hits":[]}`、exit 0，沒有 `memoria_vectors` 表也會先完成 embed | 正確，但**前提是環境裡有 `LIBSQL_URL`**：沒有的話 0.07 秒就 exit 1、stderr 印 `LIBSQL_URL is required`，模型沒載入。會出錯但不是靜默，見 N-1 |
| F-4 | `cd "$(dirname "$(readlink -f "$(which memoria)")")/../skills/memoria-vector"` 能找到 npm 全域安裝的 helper | `package.json` 的 `bin.memoria = dist/cli.mjs`，`files` 有收 `skills/memoria-vector/*.mjs`、`package.json`、`package-lock.json`。本機（nvm）`which memoria` → `<prefix>/bin/memoria`，`readlink -f` → `<prefix>/lib/node_modules/@raybird.chen/memoria/dist/cli.mjs`，`cd` 後 `pwd -P` = 套件內的 `skills/memoria-vector`，看得到 `vector-recall.mjs`（只讀檢查）。同一條命令在 BASE 的 OPERATIONS.md 已經有，不是這次新增的寫法 | 正確（macOS 要 12.3 以上 `readlink` 才有 `-f`；這是既有寫法，不屬本次範圍） |
| F-5 | 「向量存在 `LIBSQL_URL`，不在套件裡，不需要重新 ingest」 | `vector-ingest.mjs`／`vector-recall.mjs` 只透過 `createClient({ url: LIBSQL_URL })` 讀寫；文件範例的 URL 是 `file:$MEMORIA_HOME/.memory/vectors.db` 或遠端。升級後模型一樣（`MEMORIA_EMBED_MODEL` 預設不變），向量空間不變 | 正確（除非使用者把 `LIBSQL_URL` 指進套件目錄，這種用法不合理，不用特別寫） |
| F-6 | 依賴缺少時 recall 會退回 `vector_timeout`／`vector_unavailable` | `memoria.ts:585`：`status==='timeout' ? 'vector_timeout' : 'vector_unavailable'`；helper import 失敗會 exit 1，歸到後者；重裝後還沒暖機則是前者 | 正確 |
| F-7 | 重裝後第一次約 14 秒，比 recall 逾時長 | 逾時預設 4000ms（`MEMORIA_VECTOR_TIMEOUT_MS`，OPERATIONS 已有說明）；14.13 秒／17.58 秒是維護者實測，reviewer 不能重現冷啟動（不能動全域套件的模型），見 AC-3 | 合理 |

## 證據（實際命令與結果）

Worktree：`git worktree add --detach ~/.cache/rv23/wt 45d6170`，root `node_modules` 用 symlink 指回 checkout，helper **不放** `node_modules`，讓測試自己跑 `npm install --omit=dev`，跟 CI 一樣。所有命令都 `env -u LIBSQL_URL -u MEMORIA_HOME -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_VECTOR_RECALL_CMD`，`TMPDIR=~/.cache/rv23/tmp`（ext4，不是 tmpfs）。審查後已 `git worktree remove --force` 並刪掉 `~/.cache/rv23`；主工作區只剩原本就有的 `.serena/project.yml` 修改，分支沒動。

| # | 命令 | 結果 |
| --- | --- | --- |
| V-1 | `pnpm run check` | exit 0 |
| V-2 | `pnpm run build`；`node dist/cli.mjs --help` | `✓ Built dist/cli.mjs`；help exit 0 |
| V-3 | `bash -n scripts/test-vector-recall.sh` | exit 0 |
| V-4（綠燈） | `bash scripts/test-vector-recall.sh`（HEAD，helper 由腳本以 `--omit=dev` 安裝） | exit 0，`enabled + embedder missing -> fix names the upgrade wipe and the warm-up`，最後 `[vector] ok`。裝完 helper 的 `node_modules/@huggingface/` 是空目錄，`transformers` 不存在，確實走到 `embedderInstalled === false` |
| V-5（紅燈） | `git checkout ba79a8b -- src/cli/commands/doctor.ts` → `pnpm run build` → 同一支測試 | exit 1，`Error: embedder fix must mention "npm i -g", got: MEMORIA_EMBED_PROVIDER=local needs @huggingface/transformers, … both skip it. Run "npm install" (without --omit=dev) inside <tmp>/pkg-no-embedder/skills/memoria-vector, or set MEMORIA_EMBED_PROVIDER=stub.`。前面四個 doctor 案例照常通過，只在新斷言失敗，和 README 紅燈證據一樣。之後把 doctor.ts 改回 HEAD、重新 build |
| V-6（symlink TMPDIR） | `ln -s ~/.cache/rv23/tmp ~/.cache/rv23/tmplink`，用 `TMPDIR=~/.cache/rv23/tmplink` 跑 HEAD 的同一支測試 | **exit 1**：`embedder fix must mention "inside <tmplink>/…/pkg-no-embedder/skills/memoria-vector", got: … inside <tmp>/…/pkg-no-embedder/skills/memoria-vector …`。見 S-1 |
| V-7 | `bash scripts/test-npm-install.sh`（HEAD） | exit 0，`[npm-install] ok` |
| V-8 | `grep -rln "vector embedder" scripts/ src/`；`grep -rn "\.fix" scripts/*.sh`（排除 test-vector-recall） | 只有 `doctor.ts` 和 `test-vector-recall.sh`；其他測試都沒有斷言這段 fix 文字 |
| V-9 | `grep -rn "cache/huggingface" --exclude-dir=node_modules --exclude-dir=.git .` | 只剩 `docs/issues/issue-23/README.md` 三處，都是在描述舊說法與 AC-2 的檢查命令。AC-2 指定的兩個檔案沒有結果 |
| V-10 | `grep -rn "Two things\|Three things" …` | 只有 OPERATIONS.md 新標題，和 `DEPLOYED_SKILL.md` 一句無關的「Two things stay separate」；沒有錨點連到舊標題 |

### 暖機命令探測（E-6）

把 HEAD 的 helper `*.mjs` 和 `package.json` 複製到 `~/.cache/rv23/helper`，`node_modules` 用 symlink 指向 checkout helper 的完整安裝（模型已在快取），`LIBSQL_URL` 只指向暫存新檔，沒碰真的向量庫。

| 輸入 | 結果 |
| --- | --- |
| 空 stdin、無 `LIBSQL_URL` | `{"hits":[]}`、exit 0、0.07s（沒載入模型） |
| `{"query":"warm up"}`、無 `LIBSQL_URL` | stderr `LIBSQL_URL is required`、exit 1、0.07s（沒載入模型） |
| `{"query":"warm up"}`、`LIBSQL_URL=file:<暫存>/warm.db` | `{"hits":[]}`、exit 0、1.04s（有載入模型） |

跑完用 `find … -newer` 檢查 checkout 的 `.cache`，沒有新寫入的檔案。

### AC-3 實機證據的可信度（只讀檢查，沒有重跑）

依硬性限制，reviewer 沒有刪除或重裝全域 helper，也沒有用真的 `LIBSQL_URL`，所以 `doctor` 全綠與 `route_mode=hybrid_vector` 這兩項沒有重現，只對全域套件的現況做只讀檢查，看是否和 README 描述一致：

- `$(npm root -g)/@raybird.chen/memoria/package.json` 版本 `1.30.0`，和「全域 1.30.0」相符。
- helper `node_modules` 目錄 mtime 是 `2026-10-21 10:00:28`，模型目錄 `.cache/Xenova/multilingual-e5-small` 是 `10:00:35`：先重裝、後暖機下載，順序正確，也和回歸測試時間 `10:02` 相近。
- 在 `09:00` 之後建立的 `package.json`（深度 3）有 64 個，和「裝回 65 個套件」差不多（npm 計數包含 root 與巢狀套件，差一兩個合理）。
- 模型目錄 `du` 是 130M（磁碟用量）；README 寫 121MB（檔案大小），兩者口徑不同，不算矛盾。
- README 另外主動揭露「在既有安裝上直接執行只要 1.03 秒，不能當升級後狀態的證據」，所以才重做了刪除 `node_modules` 的重現，這個判斷是對的。

結論：描述合理，和可觀察的檔案系統狀態一致。屬於 project.md 允許的「local embedding 以維護者機器手動證據補」。

## 驗收對照

| AC | 可觀察結果 | 證據 | 結論 |
| --- | --- | --- | --- |
| AC-1 | `--omit=dev` 的 helper：`vector embedder` `ok:false`，fix 含 `--omit=dev`、`NODE_ENV=production`、`npm i -g`、`vector-recall.mjs`、`inside <embedderDir>` | V-4 綠、V-5 紅（在 BASE 字串上只有升級成因那條失敗） | 通過 |
| AC-2 | 兩個檔案沒有 `cache/huggingface`，改寫為套件內 `.cache/`，並說明跟著 `node_modules` 一起被清掉 | V-9；F-1 確認新說法正確；人工讀過 README 第 24–26 行與 OPERATIONS 第 303 行 | 通過 |
| AC-3 | INSTALL Method A 與 OPERATIONS 第 3 點各有升級後的步驟：重裝、暖機、doctor | 人工閱讀，兩邊命令一字不差；F-2～F-5；實機證據可信度見上 | 通過（實機部分依維護者證據） |
| AC-4 | issue-19 不再寫「不加 skip 會失敗」，改記為偶發與兩次重現成功 | diff 只改這一句，並連到 issue-23 | 通過 |

## 測試真偽

- **不是同義反覆**：期望值是規格寫明的固定字面子字串（`npm i -g`、`vector-recall.mjs` 等），和 doctor 組字串的方式無關；`inside <path>` 的期望值由測試自己組的路徑決定，不是從 doctor 輸出回推。
- **紅燈是目標行為造成的**：V-5 只在升級成因那條失敗，不是環境或語法錯誤。
- **真的走到 `embedderInstalled === false`**：測試先斷言 `vector embedder` check 存在而且 `ok:false`，才檢查 fix 內容；另外四個 doctor 分支（未啟用、helper 缺少、override、stub）會產生別的 check 或不產生這個 check，不可能誤過。
- **環境隔離**：腳本開頭已 unset `LIBSQL_URL`、`MEMORIA_EMBED_PROVIDER`、`MEMORIA_VECTOR_RECALL_CMD`、`MEMORIA_VECTOR_TIMEOUT_MS`、`MEMORIA_HOME` 等；新案例明確給 `MEMORIA_HOME=$TMP_DIR/home` 和 `LIBSQL_URL=file:$VECDB`（暫存檔）。版面自己組，所以不管 checkout 的 helper 有沒有完整安裝，結果都一樣（V-4 是在 helper 只有 `--omit=dev` 的 worktree 跑的，實作者是在完整安裝的 checkout 跑的，兩邊都綠）。
- **`|| true`**：doctor 失敗時其實不會改 exit code（`doctor.ts` 沒有 `process.exit`／`exitCode`），所以這只是防禦性寫法、沒有害處；doctor 如果崩潰，`JSON.parse` 會失敗，測試一樣會紅。
- 沒有刪除、弱化或略過任何既有測試。

## 範圍與 project.md gate

| Gate | 結果 |
| --- | --- |
| 不新增依賴 | 符合（root／helper 的 `package.json` 與 lockfile 都沒動） |
| 不改 CLI 命令名 | 符合 |
| doctor 判定邏輯與 JSON 結構 | 沒變：diff 只動 `fix` 字串字面值，`name`／`ok`／`value` 與分支條件都一樣；V-8 確認沒有其他測試依賴這段文字；V-7 PASS |
| 版控文件只用代稱、沒有本機絕對路徑 | 符合：`git diff ba79a8b 45d6170` 的新增行 grep `/home`、`/Users`、本機使用者名、nvm、外部專案名稱，只有測試裡的 `"$TMP_DIR/home"`（暫存目錄下的相對子路徑，不是本機路徑）。文件裡的套件名 `@raybird.chen/memoria` 是本專案自己的 npm 名稱 |
| 提交格式／沒有 AI 署名 | 符合：`docs(issue-23): …`、`fix(issue-23): …`，`git log ba79a8b..45d6170` 沒有 `Co-Authored-By` 或 Claude 尾行 |
| 常青文件 | 符合：安裝路徑改動有更新 INSTALL.md，維運程序有更新 OPERATIONS.md；沒有新測試腳本，不用改 CLAUDE.md Tests 清單或 ci.yml |
| GitNexus | README 有記錄 impact（`registerDoctorCommand` LOW），沒有記錄 detect_changes，見 N-4 |
| Definition of Done | 1–4 項由 V-1～V-4 重現；第 5 項 CLI 旗標沒變，fix 只加長字串，人看的輸出照常是 `↳ fix: …` 一行 |

## 失敗面覆蓋

| 失敗面 | 輸入／狀態 | 預期 | 覆蓋與結論 |
| --- | --- | --- | --- |
| CI 的 helper 只有 `--omit=dev` | worktree 不放 helper `node_modules`，由腳本安裝 | 新案例走到 embedder missing 並通過 | V-4，通過 |
| 開發者 checkout 有完整 helper 安裝 | 實作者環境 | 新案例一樣走到 missing（版面自己組） | README 證據 + 設計核對，通過 |
| 舊字串回歸 | BASE 的 `doctor.ts` | 紅 | V-5，通過 |
| TMPDIR 路徑含 symlink（macOS 預設 `/var` → `/private/var`） | `TMPDIR` 指向 symlink | 應該要綠 | **V-6 紅**：doctor 回報的是 Node 解析過 symlink 的 `embedderDir`，測試拿未解析的路徑比對。CI 只在 ubuntu 跑這支，所以 CI 不受影響。見 S-1 |
| 開發者 shell 的向量環境變數滲入 | `LIBSQL_URL` 等有 export | 不影響結果，也不碰真的向量庫 | 腳本開頭有 unset，新案例明確指定暫存 `VECDB`；通過 |
| doctor 其他使用者 | `test-npm-install.sh`、`test-no-clone-install.sh` | 不受影響 | V-7 PASS；V-8 確認沒人斷言這段 fix；no-clone 只斷言 `vector helper`，沒有重跑（實作者的 34 支回歸有涵蓋） |
| 暖機命令空轉 | 空 stdin／沒有 `LIBSQL_URL` | 要真的載入模型 | E-6：帶查詢、有 `LIBSQL_URL` 時會載入；沒有 `LIBSQL_URL` 時大聲失敗、不會假裝成功。見 N-1 |
| 文件位置錯誤 | `cd` 命令、快取位置 | 指到正確目錄 | F-1、F-4，通過 |
| 升級後要重新 ingest 嗎 | 向量庫在 `LIBSQL_URL` | 不需要 | F-5，通過 |

## 發現

### MUST FIX

無。

### SHOULD FIX

- **S-1 新斷言在 TMPDIR 含 symlink 時會誤紅**（V-6 實測重現）。`node "$ISO_PKG/dist/cli.mjs"` 執行時，Node 會把主模組路徑解析成真實路徑，所以 `import.meta.url`，連帶 `resolveHelperScript()` 算出的 `embedderDir`，都是解析過的路徑；測試傳入的 `"$ISO_PKG/skills/memoria-vector"` 則是 `mktemp -d` 回傳的原始路徑。macOS 的 `mktemp -d` 預設在 `/var/folders/…`，而 `/var` 是 `/private/var` 的 symlink，所以 macOS 開發者在本機跑這支測試一定會紅。CI 的 `test-vector-recall.sh` 只在 `ubuntu-latest` 跑，`/tmp` 不是 symlink，所以 CI 不受影響；這是測試穩定性的問題，不是假綠燈。建議在建版面時先把路徑解析掉，例如 `ISO_PKG="$(cd "$TMP_DIR" && pwd -P)/pkg-no-embedder"`，或在 node 斷言裡用 `fs.realpathSync(process.argv[2])` 比對。

### NIT

- **N-1 暖機與 doctor 都要求 shell 裡有 `LIBSQL_URL`，INSTALL／OPERATIONS 的命令區塊沒寫出來。** INSTALL 的前一句是「有啟用語意召回（設了 `LIBSQL_URL`）時」，OPERATIONS 前面的安裝段落也有 `export LIBSQL_URL=…`，所以算是隱含交代了；只是 `LIBSQL_URL` 如果只設在某個腳本、沒有在互動 shell 裡，暖機會 exit 1（stderr 會說明，不算靜默），但接著的 `memoria doctor` 會顯示 `vector recall: not enabled` 而且是通過，看起來像全綠。doctor 的 fix 本身沒有這個問題：它只會在 doctor 的環境有 `LIBSQL_URL` 時出現。可以在命令區塊加一句「在設有 `LIBSQL_URL` 的 shell 執行」，或在 doctor 那行註解寫「`vector recall: enabled`、embedder 已安裝…」。
- **N-2** fix 寫的是「every "npm i -g" upgrade replaces this directory」，但 `embedderDir` 也可能是 checkout（例如以 checkout 的 `./cli` 執行時），那種情況不適用。後面接著寫的「--omit=dev／NODE_ENV=production」本來就是並列的可能成因，讀者分得出來，影響很小。
- **N-3 證據持久力**：AC-1 的 (c)「第一次查詢可能逾時、先暖機」只靠 `vector-recall.mjs` 這個子字串鎖住，有人刪掉逾時那半句，測試還是會綠。可以多斷言 `vector_timeout`（也是 fix 裡的固定字面）。
- **N-4** issue README 的狀態還是「進行中」，三個步驟都已 ✅；GitNexus 只記錄了 impact，沒有記錄 commit 前的 `detect_changes`。由協調者在交付時一起補上即可。

## 判定

**PASS**：獨立審查完成，沒有 MUST FIX。AC-1 的紅燈（V-5）與綠燈（V-4）都由 reviewer 在 CI 的 `--omit=dev` 條件下重現；AC-2、AC-4 經 grep 與人工閱讀確認；AC-3 的命令經 F-2～F-5 逐項核對，實機重現依維護者證據，和只讀檢查到的檔案系統狀態一致。doctor 的判定邏輯與 JSON 結構沒有變。S-1 是測試在 macOS 本機的穩定性問題，不影響 CI 結果，也不影響本次驗收的有效性，建議在合併前或下一個 issue 順手修掉。
