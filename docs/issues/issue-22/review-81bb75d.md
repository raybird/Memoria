# Issue 22 獨立審查報告

- **Reviewed BASE SHA**: ac7610985fc07c068e284f4dc02b05c53e680576（`ac76109`，目前 `main`）
- **Reviewed HEAD SHA**: 81bb75d（分支 `issue-22-skill-deployment`，BASE 之上單一提交）
- **Reviewed patch-id**: `c62a6df9c5acb2f78928beebc1186ca694b53648`（`git diff ac76109 81bb75d | git patch-id --stable`）
- **獨立 reviewer**: Claude subagent（general-purpose，未參與實作）
- **審查日期**: 2026-10-20
- **報告位置**: `docs/issues/issue-22/review-81bb75d.md`
- **判定**: **RETURN TO execute-task**

## 審查範圍與風險

範圍是 `ac76109..81bb75d` 的完整 diff，共 10 個檔案：`src/cli/runtime.ts`、`src/cli/commands/setup.ts`、`scripts/test-bootstrap.sh`、`skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md`、`DEPLOYED_REFERENCE.md`、`README.md`、`README.zh-TW.md`、`docs/INSTALL.md`，以及 issue-22 的 README 與 implementation-plan。規格依據 `a79d3be:docs/issues/issue-22/README.md` 的 SCN-001～006。

最大風險沿用 issue README 的判斷：`setup` 第一次寫入 `~/.memoria` 以外的使用者目錄，覆蓋到使用者自己寫的 skill 會造成無聲、不可逆的資料遺失。審查重點放在覆蓋保護的判定條件與寫入時序、模板命令與實際 CLI 是否一致、與 issue-20／21 的合併順序，以及測試能不能抓到回歸。

審查過程完全沒有碰真實 `HOME`。所有 `setup` 都在 scratchpad 下的隔離 `HOME` 執行，並清掉 `LIBSQL_URL` 與 `MEMORIA_HOME`。真實 `~/.claude/skills/memoria/` 的 4 個檔案，審查前後 sha256 完全相同（E14）。

## 證據

| 編號 | 命令 | 結果 |
|---|---|---|
| E1 | `git diff a79d3be 81bb75d -- docs/issues/issue-22/README.md` | Gherkin 區塊（SCN-001～006）沒有任何差異。變動只在「關鍵差異」表的 data root 列（「由 skill 位置推導」→「讀部署時寫入的 `DATA_ROOT`」）、回填核准 commit、步驟狀態、新增一列 Timeline 與狀態欄 |
| E2 | worktree `rv22` @81bb75d：`pnpm run check` | exit 0 |
| E3 | `pnpm run build`；`node dist/cli.mjs --help` | `✓ Built dist/cli.mjs`；help exit 0 |
| E4 | `node scripts/check-deployed-skill-sync.mjs`；`pnpm run release:docs-check` | `deployed_skill_check=ok version=1.29.1`；`Release doc sync check passed for v1.29.1` |
| E5 | `HOME=<隔離> COREPACK_HOME=… env -u LIBSQL_URL -u MEMORIA_HOME bash scripts/test-bootstrap.sh` | exit 0。SCN-006、003、004、005、001、002 全部 ✓，原有的 Step 1～7 也 ✓。隔離 HOME 下沒有產生 `.claude` |
| E6 | `pnpm run release:package` 之後跑 `bash scripts/test-no-clone-install.sh`（隔離 HOME） | 打包 exit 0；測試 exit 0，最後一行 `[no-clone] ok`。不先打包時會因 `Missing release artifact` exit 1，這是環境前置條件，不是缺陷，CI 的順序也是先 package 再跑 |
| E7 | 用 release tarball 安裝成 installed mode，再跑 `setup --agent claude-code --memoria-home <d1> --json` | 7 個 step 全部 ok，exit 0。`SKILL.md` 與模板 `cmp` 相同，`DATA_ROOT`=`<d1>`，`bin/memoria` 指向 installed 的 `lib/cli.mjs` |
| E8 | 覆蓋保護的邊界測試（installed runtime，每個情境各用一個隔離 HOME，見下表） | 見下表 |
| E9 | `setup --agent` 傳入原型鏈鍵名：`toString`／`constructor`／`valueOf`／`hasOwnProperty`／`__proto__`／空字串 | `toString`：exit 0，印出 `✓ Host agent skill deployed: [object Object]`，**在 cwd 建了 `./[object Object]/` 並寫入整份 skill**，data root 也被初始化。`constructor`、`valueOf`：data root 與 `.agents` 那份 skill 都已寫入後才報 `The "path" argument must be of type string…`，exit 1。`__proto__`：未捕捉的 `HOST_AGENT_SKILL_DIRS[agent] is not a function`，exit 1，沒有寫入。`hasOwnProperty` 與空字串：正確拒絕，沒有寫入 |
| E10 | 自建一份 v1.28.1 模板（`git show f41c504:…/DEPLOYED_SKILL.md`）放到隔離 HOME 的 `~/.claude/skills/memoria/SKILL.md`，追加一段使用者自寫的觸發段落，旁邊再放 `NOTES.md`；接著執行 `setup --agent claude-code` | exit 0。使用者追加的段落（`grep -c user-written` = 0）與 `NOTES.md` **都被刪掉，沒有任何提示**。`git log -S'deployment_mode: installed' -- skills` 顯示這兩個標記從 `e22753d`（v1.8.0）起就在每一份部署模板裡 |
| E11 | 用 `./cli <cmd> --help` 逐一核對模板引用的旗標 | `feedback --score/--used/--hits`、`remember --project/--rationale/--durable/--supersedes`、`recall --mode vector --project`、`repo summarize --merge/--submit/--file/--json`、`brief --global`、`setup --memoria-home/--agent` 在 81bb75d 都存在。`doctor --json` 輸出有 `homeSource`（`doctor.ts:138`）、名為 `sessions.db` 的 check，`vector coverage` 的值是 `embedded=… expected=… missing=…`。**`repo summarize --dismiss-pending` 不存在**：`error: unknown option '--dismiss-pending'`，exit 1 |
| E12 | 讀程式碼：`repo.ts:205-216`、`memoria.ts:1188-1223` | `--submit` 不加 `--json` 時只印 `status=`，不印 `promoted`；`promoted` 只出現在 JSON envelope 的 `data.promoted` |
| E13 | 依賴分支：`git log main..issue-20-merge-source-ref`、`git grep dismiss-pending issue-21-dismissed-summaries -- src` | issue-20（AC-1：`--merge` 回傳 sync 既有那筆的 `summaries[0].id`）與 issue-21（`--dismiss-pending --type merge,release`）都還沒合進 main。81bb75d 的父提交就是 main，**現在可以直接 fast-forward** |
| E14 | 真實 `~/.claude/skills/memoria`：審查前後各跑一次 `find … -type f -exec sha256sum` 再 `cmp` | 4 個檔案完全相同。只讀過 frontmatter 的前 12 行：沒有 `deployment_mode` 與 `repository` 標記，所以會被拒絕，與實作者在步驟 1 的實機紀錄一致 |
| E15 | 變異檢查（`rv22-mut.sh`：perl 改 → build → 隔離 HOME 跑 `test-bootstrap.sh` → `git checkout` 還原） | 見下表 |
| E16 | `git diff ac76109 81bb75d` 的新增行 grep 本機路徑與下游專案代稱（`/home/`、使用者名、下游專案名、`/tmp/`）；`git show -s --format=%B 81bb75d \| grep -ci co-authored` | 0 筆命中；AI 署名 0 |
| E17 | 讀文件：`README.md`、`README.zh-TW.md`、`docs/INSTALL.md` 與 `setup --help` | 三份文件的旗標都寫 `--agent claude-code`，`--help` 是 `--agent <name>  Also deploy the skill into a host agent's own skill directory (claude-code)`，彼此一致。覆蓋規則的描述見 M-1 |

### E8 覆蓋保護邊界

| 情境 | 結果 | data root 是否建立 | 結論 |
|---|---|---|---|
| 目標是 symlink，指向帶標記的目錄 | 拒絕，原因 `it exists and is not a directory`，exit 1；stat 與內容雜湊都沒變 | 否 | 安全（`lstat` 生效） |
| 目標是一般檔案 | 拒絕，exit 1，內容沒變 | 否 | 安全 |
| 空目錄 | 寫入，exit 0 | 是 | 符合設計 |
| frontmatter 只有 `deployment_mode` 一個標記 | 拒絕，exit 1，沒變 | 否 | 安全 |
| 兩個標記都寫在正文，不在 frontmatter | 拒絕，exit 1，沒變 | 否 | 安全 |
| CRLF 換行、兩個標記都有 | 覆蓋，exit 0 | 是 | 符合設計 |
| frontmatter 沒有結尾 `---`，標記寫在正文，後面接一條 `---` 分隔線 | **覆蓋**，exit 0，手寫內容消失 | 是 | 邊角缺口（N-1） |
| 非空目錄，但沒有 SKILL.md | 拒絕，exit 1 | 否 | 安全（實作時收緊的部分） |
| 目錄權限 000 | `EACCES … scandir`，exit 1，內容沒變 | 否 | 安全；錯誤訊息不像其他拒絕那樣格式化 |
| 檔頭有 BOM，兩個標記都有 | 拒絕 | 否 | 偏保守，可接受 |
| 標記值加了單引號 `'installed'` | 拒絕 | 否 | 偏保守，可接受 |
| SKILL.md 是 symlink，指向外部一份帶標記的檔案，旁邊另有使用者的 `extra.md` | 覆蓋：`extra.md` 被刪，外部那份檔案本身沒動 | 是 | 屬於 M-1 那一類 |

TOCTOU：`setup.ts` 在任何寫入前先預檢一次，`deployHostAgentSkill` 在 `rm` 之前再檢一次，剩下的競爭窗口只有「第二次檢查到 `fs.rm`」這一小段，不必再處理。`--agent` 沒給時，`resolveHostAgentSkillDir` 根本不會被呼叫（E5 的 SCN-003 與 E15 的變異都印證了這點）。

### E15 變異檢查

| 變異 | 結果 |
|---|---|
| `assertHostSkillTarget` 永遠放行 | `✗ SCN-006: setup overwrote a hand-written skill (exit 0)`，測試抓到 |
| 只要求 `deployment_mode` 一個標記 | **exit 0，測試沒抓到**（S-4） |
| 沒給 `--agent` 時也預設成 claude-code | `✗ SCN-003: setup without --agent created ~/.claude`，測試抓到 |
| 模板的 data root 行改成忽略已設定的 `MEMORIA_HOME` | `✗ SCN-002: exported MEMORIA_HOME not kept`，測試抓到 |
| `DATA_ROOT` 改寫成錯的路徑 | `✗ SCN-004: DATA_ROOT does not name the data root`，測試抓到 |
| recall 範例拿掉 `--mode vector` | `✗ SCN-001: recall example lacks --mode vector`，測試抓到 |
| 刪掉 feedback 那段的 `Done when:` | `✗ SCN-001: fewer than 5 done criteria`，測試抓到 |
| description 拿掉「after a merge … or a release」 | `✗ SCN-001: description lacks trigger 'after a merge'`，測試抓到 |

### 規格核對（重點 1）

- Gherkin 本身沒有改（E1）。
- **data root 改讀 `DATA_ROOT`**：SCN-002 只約束「已設定 `MEMORIA_HOME` 時沿用它，不由 skill 位置推導」，未設定時從哪裡取值不在任何 Scenario 的 Then 裡。原本「往上三層」的推導對 `~/.claude/skills/memoria` 那份會得到 `$HOME`，這是計畫本身的錯誤，修正它不改變任何已核准的可觀察行為。依 acceptance.md，不需要重新核准，Timeline 也已記錄。
- **覆蓋保護收緊**：「非空、沒有 SKILL.md、或目標不是目錄」都改成拒絕，只往更保守的方向走，不影響 SCN-004（目標不存在）、SCN-005、SCN-006 的結果，不需要重新核准。
- 已核准的部署標記本身有缺口，見 M-1。

### 模板（重點 3）

SCN-001 的要求都滿足：description 第一句就以三個觸發時機開頭；recall、feedback、remember、repo sync 各有命令與 `Done when:`；recall 帶 `--mode vector`。模板與文件沒有本機絕對路徑，也沒有下游專案名稱（E16）。旗標與實際 CLI 的對照見 E11；與 81bb75d 不一致的地方見 S-1、S-3。

## 發現

### MUST FIX

**M-1（`需決策`）：部署標記分不出「setup 寫的」和「從部署版複製來再改過的」，後者會被整個目錄靜默刪掉**

- **事實**：`deployment_mode: installed` 與 `repository: Memoria` 從 v1.8.0 起就在每一份部署模板裡（E10）。本 issue 的「使用方式對照」把變更前的做法寫成「手動複製 skill 到 `~/.claude/skills/` 並自行補觸發時機」，照這個做法產生的正是一份帶標記、而且被使用者改過的 SKILL.md。對這種副本，`setup --agent claude-code` 會 `rm -rf` 整個目錄：使用者的段落與同目錄的其他檔案都消失，exit 0，沒有任何提示（E10，以及 E8 最後一列）。這正是 README「風險與首要驗證」列為唯一不可逆的失敗面。測試只涵蓋「完全沒有標記」這一種情況。
- **文件與事實不符**：`README.md` 寫「`setup` only replaces an existing `~/.claude/skills/memoria/` that it wrote itself」，`docs/INSTALL.md` 寫「（也就是 `setup` 自己部署的版本）」，`DEPLOYED_REFERENCE.md` 寫「the marks of a copy `setup` wrote」。實際上，任何從部署版複製過去的檔案都算數。
- **為何列 MUST**：實作符合已核准的 SCN-005 字面，但核准時的前提（帶標記就等於 setup 部署的）與事實不符，而且落在 issue 自己宣告的最大風險上，屬於風險覆蓋缺口。
- **待決問題**：帶標記但被改過的副本要怎麼處理？
- **可選做法**：
  - (A) 覆蓋前先把整個目錄改名備份（例如 `memoria.bak-<UTC 時間>`），並在 step log 印出備份路徑。SCN-005 的結果（檔案更新為目前模板）不變，所以不需要重新核准；失敗從不可逆變成可逆。
  - (B) 收緊判定：SKILL.md 必須與某個已出貨模板版本的內容雜湊相同才覆蓋，否則拒絕。這會改變 SCN-005 的語意，需要重新核准。
  - (C) 接受風險，只把三份文件改成如實描述（帶這兩個標記的任何副本都會被整個取代），並依 docs/AGENTS.md 記錄 Gate 豁免。
- **reviewer 建議**：(A)，加上 (C) 的文件更正，並補一個「帶標記但被改過」的測試，斷言備份存在且內容逐位元組相同。

### SHOULD FIX

**S-1（`需決策`）：與 issue-20／21 的合併順序只寫在 Timeline，沒有任何機制擋住；而 81bb75d 現在就能 fast-forward 進 main**

- 在 81bb75d 單獨存在時：模板要 agent 執行的 `repo summarize --dismiss-pending --type merge,release` 會直接報 `unknown option` 失敗（E11）。`--merge <sha> --json` 會新建一筆重複的 pending 摘要，而不是回傳 sync 那筆。agent 照模板回寫後，sync 那筆會永遠留在 pending，正是地雷 M-2 的情境（E13）。
- 揭露情況：相依只出現在 README Timeline 的一句話，以及 plan 步驟 2 的括號；「風險」與「待確認事項」都沒有，commit 訊息也沒提。專案的併入方式是 rebase 後 fast-forward，81bb75d 的父提交就是 main，所以現在 ff 並不會被擋下（E13）。
- **待決問題**：以什麼方式確保 issue-20／21 先合？
- **可選做法**：(A) 在 README 的「待確認事項」或「風險」加一列阻擋性的相依：「須在 issue-20、issue-21 之後 rebase，rebase 後重跑 test-bootstrap 並重新審查」；(B) 先把 issue-22 rebase 到含 issue-20／21 的 main 上再交付。
- **reviewer 建議**：(A)。另外提醒：rebase 後 HEAD 與 patch-id 都會改變，依 review-evidence.md，本報告不能直接沿用到新的 HEAD。

**S-2：`--agent` 的值驗證被原型鏈鍵名繞過，與計畫寫的「其他值報錯並列出可用值」不一致**

- 位置：`runtime.ts` 的 `resolveHostAgentSkillDir` 用 `HOST_AGENT_SKILL_DIRS[agent]?.()` 查表。
- 影響（E9）：`--agent toString` 會在 cwd 建立 `./[object Object]/`，而且 exit 0。`constructor`／`valueOf` 會先寫 data root 與 `.agents` 那份 skill 才失敗，違反「`--agent` 有問題時，在任何寫入前停下」的設計。`__proto__` 是未捕捉的例外。
- 修法：改用 `Object.hasOwn(HOST_AGENT_SKILL_DIRS, agent)`，或改用 `Map`。在 `test-bootstrap.sh` 的 SCN-003 段補一個 `--agent toString` 的拒絕斷言。

**S-3：merge 步驟的完成判準在模板給的命令下觀察不到**

- 模板的 `Done when: the submit result shows status: enriched and promoted: true` 對應的命令是 `repo summarize <repo> --submit <id> --file <payload.json>`，沒有加 `--json`。人類可讀的輸出只有 `status=…`，沒有 `promoted`（E12）。
- 修法：在 `DEPLOYED_SKILL.md` 與 `DEPLOYED_REFERENCE.md` 的 submit 命令補上 `--json`，判準改寫成 `data.summary.status` 與 `data.promoted`。

**S-4（證據持久力）：覆蓋保護的測試只涵蓋「完全沒有標記」**

- 把判定放寬成只要一個標記，測試仍然全綠（E15）。
- 修法：在 SCN-006 段用一個 for 迴圈補 fixture：只有一個標記、標記在正文、非空但沒有 SKILL.md、目標是檔案、目標是 symlink。每個都斷言非 0 結束且 `cmp` 不變。若採用 M-1 的 (A)，再加上帶標記但被改過的那一例。
- 這一項不構成假綠燈：本次紅綠燈確實由目標行為驅動。

### NICE TO HAVE

- **N-1**：frontmatter 的 regex `/^---\r?\n([\s\S]*?)\r?\n---/` 在沒有結尾 `---` 時，會一路吃到正文後面的分隔線，於是正文裡的標記也被算進去（E8）。建議結尾要求 `\r?\n---\s*(\r?\n|$)`，並限制 frontmatter 不能跨越空行；或改成逐行解析，找到第一個獨立的 `---` 行就停。
- **N-2**：`EACCES` 這類錯誤原樣拋出，訊息沒有 `refusing to overwrite <path>` 的格式。行為是安全的，只是與其他拒絕訊息不一致。
- **N-3**：英文模板裡夾了一個中文詞「待增強」（`clears the rest from the 待增強 count`），建議改成 `pending count`。另外，`--merge` 那一步只說明 `enriched`，沒提到 issue-21 合併後可能出現的 `dismissed`。照 issue-21，dismissed 仍可以再 `--submit`，建議補一句。
- **N-4**：SCN-001 的 `Done when:` 只檢查總數不少於 5，沒有綁到各段。刪掉一個、在別處多加一個仍會通過。可以改成每個 `###` 段落各斷言一次。

## 判定

**RETURN TO execute-task**：有一項 MUST FIX（M-1，`需決策`）。其餘部分：SCN-001～006 的測試在 81bb75d 全綠，SCN-006、003、002、001 的關鍵斷言經變異檢查證明會失敗；`check`、build、`--help`、skill 同步檢查、`test-bootstrap.sh`、`test-no-clone-install.sh` 都通過；預檢確實發生在任何寫入之前（原型鍵名例外，見 S-2）；沒給 `--agent` 時完全不碰 `~/.claude`；三份文件與 `--help` 的旗標一致；Gherkin 沒有被改。

M-1 若選 (A) 或 (B)，修正後需要重新審查。若使用者選 (C)，以 Gate 豁免紀錄放行。S-1 必須在合併前處理或明確接受。
