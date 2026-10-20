# Issue 22 獨立審查報告（第二輪）

- **Reviewed BASE SHA**: ac7610985fc07c068e284f4dc02b05c53e680576（`ac76109`，目前 `main`，亦為 `git merge-base main HEAD`）
- **Reviewed HEAD SHA**: ccf0d94548a9dd0a72329d4e1e247853aa9ee985（`ccf0d94`，分支 `issue-22-skill-deployment`）
- **Reviewed patch-id**: `74cc85cc03f8c4d9c8f1b3c3ecaf85871756af44`（`git diff ac76109 ccf0d94 | git patch-id --stable`）
- **獨立 reviewer**: Claude subagent（general-purpose，未參與實作）
- **審查日期**: 2026-10-20
- **報告位置**: `docs/issues/issue-22/review-ccf0d94.md`
- **判定**: **RETURN TO execute-task**

## 審查範圍與風險

完整範圍是 `ac76109..ccf0d94`，共三個提交：`81bb75d`（首輪被審查的實作）、`8c87bfb`（只加首輪報告）、`ccf0d94`（退回後的修正）。本輪的重點是 `git diff 81bb75d ccf0d94`：`src/cli/runtime.ts`、`src/cli/commands/setup.ts`、`scripts/test-bootstrap.sh`、`DEPLOYED_SKILL.md`、`DEPLOYED_REFERENCE.md`、`README.md`、`README.zh-TW.md`、`docs/INSTALL.md`，以及 issue-22 的 README 與 implementation-plan。另外用完整範圍確認首輪通過的部分沒有被破壞。

最大風險與首輪相同：`setup --agent` 寫進 `~/.memoria` 以外的使用者目錄，誤刪使用者的 skill 會是無聲且不可逆的遺失。本輪的修正（M-1 的 (A)）讓「帶標記但被改過」的副本先備份再覆蓋，所以審查重點放在三件事：備份的時機、位置與失敗路徑；承載 M-1 證據的測試是否可靠；文件是否如實描述。

所有 `setup` 都在 scratchpad 下的隔離 `HOME` 執行，換 HOME 前先固定 `COREPACK_HOME`，命令一律用 `env -u LIBSQL_URL -u MEMORIA_HOME`。真實 `~/.claude/skills/memoria/` 的 4 個檔案，審查前後 sha256 完全相同（E14）。worktree `rv22b` 用完後已經 `worktree remove --force`。主 repo 的工作區只剩審查前就存在的 `.serena/project.yml` 修改，沒有其他變動。

## 證據

| 編號 | 命令 | 結果 |
|---|---|---|
| E1 | `diff` 比對 `a79d3be` 與 `ccf0d94` 的 README Gherkin 區塊 | 完全相同。核准 commit 仍是 `a79d3be`，六個 Scenario 都是「已核准」 |
| E2 | worktree `rv22b` @ccf0d94：`pnpm run check` | exit 0 |
| E3 | `pnpm run build`；`node dist/cli.mjs --help` | `✓ Built dist/cli.mjs`；help exit 0 |
| E4 | `node scripts/check-deployed-skill-sync.mjs` | `deployed_skill_check=ok version=1.29.1` |
| E5 | 隔離 HOME，`bash scripts/test-bootstrap.sh`，`TMPDIR` 未設定，`/tmp` 是 **tmpfs**；連跑 3 次 | 3 次都 exit 0。SCN-006、003、004、005（refresh）、005（M-1 備份）、006（四個拒絕 fixture）、001、002 全部 ✓，Step 4 之後的 serve、remember、recall 也 ✓ |
| E6 | 同一支測試，`TMPDIR` 改指向 **ext4** 上的目錄（CI 是 `ubuntu-latest`，`/tmp` 在 ext4 上）；連跑 6 次 | **3／6 失敗**，失敗訊息都是 `✗ SCN-005: replaced copy was not backed up`；另外 3 次 exit 0。原因見 M-1 |
| E7 | 在 tmpfs 與 ext4 各建 `claude-code-…T12-00-00-100Z`、`claude-code-…T12-00-01-200Z` 兩個目錄，再跑 `find -mindepth 1 -maxdepth 1 -type d \| head -1` | tmpfs 回傳**較新**的目錄（反向建立順序）。ext4 依名稱雜湊排序：6 組時間戳裡，一半回傳較舊、一半回傳較新 |
| E8 | 只把測試裡的 `BACKUP=` 改成讀 setup 輸出的 `previous copy backed up to <path>`，在 ext4 上連跑 6 次（驗完以 `git checkout` 還原） | 6／6 exit 0，每次 `skill-backups` 底下都有 **2** 個備份。確認 E6 的失敗只出在測試挑錯備份，產品行為是正確的 |
| E9 | `pnpm run release:package` 之後跑 `bash scripts/test-no-clone-install.sh`（隔離 HOME） | 打包 exit 0；測試 exit 0，最後一行 `[no-clone] ok` |
| E10 | 變異檢查（`rv22b-mut.sh`：perl 改 → build → tmpfs 上跑 `test-bootstrap.sh` → `git checkout` 還原） | 見下表，7＋1 個變異全部被抓到 |
| E11 | 備份失敗路徑的探針（installed 與 dev 的程式路徑相同，用 dev CLI） | P1：先把 `<data root>/.agents/skill-backups` 建成一般檔案 → `✗ Host agent skill deployed: EEXIST … mkdir …skill-backups`，exit 1，目標目錄（含使用者加的 `USER.md`）的 stat 與 sha256 快照完全相同。P2：在目標目錄放一個 FIFO → `Cannot copy a FIFO pipe … skill-backups/claude-code-…/zz.fifo`，exit 1，目標目錄快照完全相同，留下一個空的備份目錄。兩者都證明 `fs.cp` 拋錯時 `writeSkillCopy` 的 `rm -rf` 不會執行 |
| E12 | 其他探針：重複執行、`--json`、空目錄、symlink | 連跑 4 次 `setup --agent claude-code --json`：第 1 次沒有 `backup` 欄位，第 2～4 次各帶一個 `backup` 路徑，最後累積 3 份，每份 108K，合計 324K；`~/.claude/skills/` 底下始終只有 `memoria`。目標是空目錄時不建立 `skill-backups`。目標裡放絕對 symlink、相對 symlink、指向目錄的 symlink：備份裡三者都保持為 symlink，連結文字原樣保留（`verbatimSymlinks`），指向的目錄沒有被遞迴複製；外部的目標檔案與目錄內容都沒變 |
| E13 | `--agent` 傳 `toString`／`constructor`／`valueOf`／`__proto__`／`hasOwnProperty`／空字串 | 全部 exit 1，訊息都是 `unknown agent '<值>'; valid values: claude-code`，隔離 HOME 下沒有寫入任何東西（首輪 E9 的問題已修正） |
| E14 | 真實 `~/.claude/skills/memoria`：審查前後各跑一次 `find -type f -exec sha256sum`，排序後 `cmp` | 4 個檔案完全相同 |
| E15 | `git diff --name-status 81bb75d 8c87bfb`；`git ls-tree` | 只有 `A docs/issues/issue-22/review-81bb75d.md`，檔案模式 100644 |
| E16 | `git diff ac76109 ccf0d94` 的新增行 grep 本機路徑、使用者名稱與下游專案名；`git log --format=%B` grep `co-authored` | 唯一命中的是首輪報告 E16 自己列出的搜尋詞（`/home/` 只是字面字串）；沒有 AI 署名（`claude` 只出現在 `--agent claude-code` 這個功能描述） |
| E17 | 用 grep 找模板與 REFERENCE 裡的 CJK 字元；讀 `repo.ts:205-216`、`memoria.ts:1188-1223` | 兩份英文模板都沒有中文。`--submit … --json` 輸出的是完整 envelope，`data.summary.status` 與 `data.promoted` 都在裡面，模板寫的判準在 `--json` 下觀察得到 |
| E18 | `bash -n scripts/test-bootstrap.sh` | ok |

### E10 變異檢查

| 變異 | 結果 |
|---|---|
| 拿掉備份的 `fs.cp` | `✗ SCN-005: replaced copy was not backed up` |
| 備份改放在目標旁邊（`path.dirname(targetDir)`，也就是 `~/.claude/skills/` 底下） | `✗ SCN-005: replaced copy was not backed up` |
| 先 `writeSkillCopy` 再備份 | `✗ SCN-005: replaced copy was not backed up` |
| 拿掉 `Object.hasOwn`，改回 `HOST_AGENT_SKILL_DIRS[agent]?.()` | `✗ SCN-003: --agent toString accepted` |
| 兩個標記的 `&&` 改成 `\|\|` | `✗ SCN-006: a SKILL.md with only one mark was overwritten (exit 0)` |
| 標記改成對整份 SKILL.md 比對，不限 frontmatter | `✗ SCN-006: a SKILL.md with the marks only in its body was overwritten (exit 0)` |
| `fs.lstat` 改成 `fs.stat` | `✗ SCN-006: a symlink at the target was overwritten (exit 0)` |
| 文字模式不印備份路徑 | `✗ SCN-005: output does not name the backup path` |

### 規格核對（重點 1）

- **TBD-3、TBD-4 的紀錄合規**：兩列都記了原話「一律都照建議」、日期 2026-10-20、對應的審查題號（S-1、M-1）、採用的建議內容與影響。TBD-4 寫明 SCN-005 不變，TBD-3 寫明 rebase 後要重新審查。符合 acceptance.md「逐題確認」對「照建議」的記錄要求。S-1 的阻擋性相依也已寫進「風險與首要驗證」。
- **(A) 沒有改變 SCN-005 的已核准行為**：SCN-005 的 Then 是「檔案更新為目前模板」，E5 與 E12 顯示更新後的目標與模板 `cmp` 相同。備份是額外的副作用：寫在 data root 內，不在 `~/.claude` 底下，不改變任何 Scenario 的 Given、When、Then。SCN-006 的拒絕行為也不變（E10 的拒絕類變異都被抓到）。Gherkin 沒有任何改動（E1），不需要重新核准。
- **備份位置**：首輪 (A) 舉的例子是 `memoria.bak-<UTC>` 放在目標旁邊，實作改成 `<memoria-home>/.agents/skill-backups/`，理由是放在 `~/.claude/skills/` 底下會被 Claude Code 當成第二個 `name: memoria` 的 skill 載入。這屬於「等價實作的選擇」，可觀察結果（先備份、印出路徑、可以還原）與使用者接受的建議一致，TBD-4 的結論也寫了確切位置，可以接受。

### 實作核對（重點 2）

- **時機**：`assertHostSkillTarget` 通過，代表目標只可能是「不存在」「空目錄」「帶兩個標記的目錄」三種之一。之後只有 `readdir` 結果非空時才備份，不存在時 `catch(() => [])` 回傳空陣列。空目錄不備份（E12）。
- **位置**：`path.join(memoriaHome, '.agents', 'skill-backups', '<agent>-<ISO 時間戳，: 與 . 換成 ->')`，例如 `claude-code-2026-10-20T13-33-02-616Z`，不在 `~/.claude/skills/` 底下（E12）。這個子目錄與 `.agents/skills` 同層，不在 `skills` 裡面，所以不會被當成 skill 掃描。
- **`verbatimSymlinks: true`**：symlink 原樣保存，指向目錄的 symlink 也不會被展開複製（E12）。代價是相對 symlink 搬到備份位置後可能變成懸空連結，但它原本指向的檔案不在目標目錄裡，`rm -rf` 不會跟著 symlink 刪除，所以使用者資料沒有遺失。這是合理的取捨。
- **備份失敗**：`mkdir` 或 `cp` 拋錯時，例外直接從 `deployHostAgentSkill` 拋出，`writeSkillCopy`（裡面第一行是 `fs.rm`）不會執行；`setup` 印出 `✗` 並 exit 1。原目錄逐位元組不變（E11）。
- **同一毫秒的命名衝突**：只有兩個 `setup` 行程同時執行才會撞名。單一行程連續執行時，每次 setup 都要經過 init 與 verify，間隔是數百毫秒（E12 的時間戳相差約 300ms）。撞名時 `fs.cp` 預設 `force: true`，會把兩份合併進同一個目錄。兩個行程同時 `rm`、`cp` 同一個目標本身就是競爭狀態，屬於 v1 已揭露的跨行程並行限制，不另外處理。見 N-2。
- **重複執行會累積備份**：每次重跑都會再備份一次，即使內容就是上一次部署的模板。每份約 108K（E12），只有手動重跑 setup 才會長大，也不影響 recall 或 Claude Code。可以接受；改善建議見 N-1。
- **`Object.hasOwn`**：E13 的六種原型鍵都在寫入前被拒絕。Node ≥16.9 才有 `Object.hasOwn`，`engines` 要求 ≥18，沒有相容性問題。
- **`--submit … --json` 與完成判準**：模板與 REFERENCE 的 submit 命令都已加上 `--json`，判準寫成「`--json` submit result shows `status: enriched` and `promoted: true`」，在 envelope 裡觀察得到（E17）。
- **英文模板不再夾中文**：「待增強」已改成 "the brief's pending count"，兩份模板都沒有 CJK 字元（E17）。
- **文件**：README、README.zh-TW、INSTALL、`DEPLOYED_REFERENCE.md` 與模板都已改成如實描述：兩個標記不代表檔案沒被改過，覆蓋前會先備份到 `<memoria-home>/.agents/skill-backups/`（INSTALL 與 REFERENCE 還寫出 `claude-code-<時間戳>/`），並印出路徑。這與 E12 的行為一致；`--json` 模式下路徑放在 step log 的 `backup` 欄位。用詞上的小落差見 N-3。

### 完整範圍（重點 4）

`8c87bfb` 只新增首輪報告（E15）。`ccf0d94` 改到的程式只有 `runtime.ts` 的 `resolveHostAgentSkillDir` 與 `deployHostAgentSkill`、`setup.ts` 的 Step 5b，加上測試與文件。預檢順序（`setup.ts` 在任何寫入前先跑 `assertHostSkillTarget`）、沒給 `--agent` 時完全不碰 `~/.claude`、`DATA_ROOT` 綁定、模板的 SCN-001／002 內容，在 E5 都仍然全綠。E10 的變異也證明首輪那些關鍵斷言仍然有效。`check`、build、skill 同步、`test-no-clone-install.sh` 都通過（E2～E4、E9）。

## 發現

### MUST FIX

**M-1：承載本輪 M-1 修正證據的測試，在 CI 的檔案系統上約有一半機率失敗**

- **位置**：`scripts/test-bootstrap.sh` 的 `BACKUP=$(find "$TMP/data-scn4/.agents/skill-backups" -mindepth 1 -maxdepth 1 -type d … | head -1 …)`。
- **事實**：前一段 SCN-005 的 refresh（在有 `stale line` 的帶標記副本上再跑一次 `setup --agent`）因為目標非空，**本身就會產生第一份備份**。所以 M-1 那段執行時，`skill-backups/` 底下有兩份備份：舊的那份沒有 `NOTES.md`，新的那份才是要驗的（E8：`backups now: 2`）。`find | head -1` 取的是 readdir 的第一筆。在 tmpfs 上第一筆是最新建立的那份，所以實作者與本輪 E5 都是綠燈。在 ext4 上順序由名稱雜湊決定，6 次裡有 3 次挑到舊的那份，結果是 `✗ SCN-005: replaced copy was not backed up`（E6、E7）。CI 跑在 `ubuntu-latest`，`/tmp` 在 ext4 上，所以這支被 CI 執行的測試會隨機變紅。
- **為何列 MUST**：產品行為是正確的（E8 改成確定性挑選後 6／6 綠燈），所以這不是假綠燈，而是測試邏輯錯誤造成的隨機假紅燈。它承載本輪 M-1 修正（TBD-4）的必要證據，而且會讓 Definition of Done 第 3 項「相關 `test-*.sh` 通過」在 CI 上無法穩定成立。plan 步驟 6 記錄的「CI 全套 34 支全數 PASS」只在 tmpfs 上重現得出來。
- **修法**：從這次 setup 的輸出取得備份路徑，例如 `BACKUP=$(sed -n 's/^  previous copy backed up to //p' "$TMP/scn5b.out")`，或改跑 `--json` 讀 `backup` 欄位。另外建議在 SCN-005 refresh 之後斷言已經有一份備份，在 M-1 段之後斷言備份數剛好變成 2，把「每次覆蓋都會備份」這個行為也釘住。修正後請在 ext4 的 `TMPDIR` 上重跑數次，作為這次修正的證據。

### SHOULD FIX

無。

### NICE TO HAVE

- **N-1（累積備份）**：目標內容如果與本版本即將寫入的內容完全相同（典型情況是重跑 setup），可以不備份；或者只保留最近 N 份。目前每次重跑約多 108K，可以接受（E12）。
- **N-2（失敗訊息與殘留）**：備份失敗時，錯誤訊息是 Node 原始的 `EEXIST …` 或 `Cannot copy a FIFO pipe …`，沒有說明這是備份步驟、也沒說原目錄沒動；而且會留下一個不完整的備份目錄（E11）。建議包成 `backing up <target> to <backup> failed (target left untouched): …`，失敗時清掉不完整的備份。同一毫秒撞名的問題，可以在名稱加上 pid，或用 `errorOnExist: true, force: false` 讓衝突直接失敗，而不是合併。
- **N-3（用詞）**：`runtime.ts` 的 doc comment 寫 "a non-empty target is **moved** into …"，實際是複製後再由 `writeSkillCopy` 刪除。`DEPLOYED_REFERENCE.md` 寫 "Anything without both marks (a hand-written skill, a file, a symlink)"，但 symlink 不論帶不帶標記都會被拒絕，「非空但沒有 SKILL.md」也會被拒絕。README 系列寫「只覆蓋帶兩個標記的」，沒提到空目錄也會直接寫入（這點首輪就存在）。都不影響安全，只是不夠精確。
- **N-4（沿用首輪）**：frontmatter 沒有結尾 `---` 時，regex 會把正文當成 frontmatter 判讀（首輪 N-1）；權限錯誤的訊息格式與其他拒絕不一致（首輪 N-2）；SCN-001 的 `Done when:` 只檢查總數（首輪 N-4）。plan 步驟 6 已經把這幾項列為未處理，有揭露，不構成缺失。

## 判定

**RETURN TO execute-task**：有一項 MUST FIX（M-1，測試挑備份的方式不確定，在 CI 的 ext4 上約一半機率變紅）。

首輪的 M-1（備份）、S-2（`Object.hasOwn`）、S-3（`--submit --json`）、S-4（拒絕 fixture）在產品程式碼與文件上都已正確處理：備份只在目標非空時進行，位置在 data root 而不在 `~/.claude/skills/`，失敗時原目錄不會被刪（E11），symlink 原樣保存（E12），E10 的 8 個變異全部被測試抓到。S-1 已經記為阻擋性相依。TBD-3、TBD-4 的紀錄合規，(A) 沒有改變 SCN-005，Gherkin 也沒有改動，不需要重新核准。

修正只需要改測試的備份挑選方式，加上在 ext4 上的重跑證據。修正後 HEAD 會改變，要重新審查，但範圍可以限定在新增的那個提交。
