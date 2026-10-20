# Issue 22 - 實作計畫

README 的 Gherkin 為驗收來源。風險與首要驗證見 README「風險與首要驗證」。

## 設計方案

- **模板**：以維護者手寫的 `~/.claude/skills/memoria/SKILL.md` 為起點改寫 `DEPLOYED_SKILL.md`。去除機器特定路徑與下游專案名稱，保留四個觸發時機、每步的完成判準與收尾（向量 ingest、brief）。data root 判斷改為：`MEMORIA_HOME` 已設定就沿用，否則讀 skill 目錄內的 `DATA_ROOT` 檔。
  - **設計修訂（2026-10-20，實作時）**：原寫「由 skill 位置往上三層推導」只對 `<memoria-home>/.agents/skills/memoria` 成立；部署到 `~/.claude/skills/memoria` 的那份往上三層是 `$HOME`，會把記憶寫錯地方。改為 setup 在每份部署寫入 `DATA_ROOT`（內容為該次的 memoria home），模板以 `MEMORIA_HOME="${MEMORIA_HOME:-$(cat "$SKILL_ROOT/DATA_ROOT")}"` 取得。SCN-002 的 Gherkin（已設定 `MEMORIA_HOME` 時沿用）不變，只改了未設定時的來源，不需重新核准。
- **旗標**：`setup --agent <name>`，本次只接受 `claude-code`，其他值報錯並列出可用值。目標為 `$HOME/.claude/skills/memoria`。
- **覆蓋保護**：目標不存在或為空目錄 → 建立；目錄非空但沒有 SKILL.md、或目標不是目錄 → 拒絕（實作時收緊：原寫「SKILL.md 不存在 → 建立」會讓一個放著其他檔案的手寫目錄被 `rm -rf`）；存在且 frontmatter 同時含 `deployment_mode: installed` 與 `repository: Memoria` → 覆蓋；其他情況 → 拒絕、印出路徑與原因、非 0 結束，不寫入任何檔案。
- **`deployAgentSkill`**：抽出「複製模板到一個目標目錄」的內部函式，原目標與新目標共用；原目標維持現行的 `rm -rf` 後重建行為（那是 setup 自己擁有的目錄）。

## 實作步驟

1. ✅ **首要驗證：覆蓋保護測試** — SCN-006
   驗證：`test-bootstrap.sh` 以隔離 `HOME` 放一份無標記的 SKILL.md，執行 `setup --agent claude-code`，斷言非 0 結束、`cmp` 原檔不變。
   完成判準：測試先紅（旗標尚不存在），S3 後轉綠。
   完成證據（2026-10-20）：紅燈 `bash scripts/test-bootstrap.sh` → `✗ SCN-006: refusal does not name the target path`／`error: unknown option '--agent'`（原檔未被覆寫，因為命令根本不存在）。綠燈 `✓ SCN-006: hand-written skill left byte-identical, non-zero exit names the path`。因旗標不存在的紅燈只證明了「命令缺席」，另做變異檢查：讓 `checkHostSkillTarget` 永遠放行 → `✗ SCN-006: setup overwrote a hand-written skill (exit 0)`，還原後綠。實機（維護者機器，手寫的 `~/.claude/skills/memoria`，先備份）：`setup --agent claude-code --memoria-home <scratch>` → `✗ Host agent skill deployed: refusing to overwrite …/.claude/skills/memoria: its SKILL.md lacks the deployment marks …`，exit 1；4 個檔案 sha256 前後相同，`--memoria-home` 目錄沒有被建立（檢查發生在任何寫入前）。
2. ✅ **S1 模板改寫** — SCN-001、002
   驗證：`test-bootstrap.sh` 斷言部署出的 SKILL.md 含四個觸發時機、`--mode vector` 與 `MEMORIA_HOME` 判斷段落。
   完成判準：斷言全綠；依 writing-rules 檢查每段答得出服務哪個分支、每步有完成判準、逐句通過 no-op 測試。
   完成證據（2026-10-20）：`DEPLOYED_SKILL.md` 由手寫 skill 改寫為英文通用版：description 以觸發時機開頭；正文依序為定位 data root、doctor fail-closed、四個時機（recall／feedback／remember／repo sync 與 merge 摘要）與收尾（vector coverage、brief），各附命令與 `Done when:` 判準；merge 步驟直接用 `repo summarize --merge`（相依 issue-20），他人骨架用 `--dismiss-pending`（相依 issue-21）。`DEPLOYED_REFERENCE.md` 補 payload 格式、部署布局與覆蓋規則。對照（換回 HEAD 的舊模板）：`✗ SCN-001: description lacks trigger 'before starting work on an issue or feature'`；把 data root 行改成只讀 `DATA_ROOT` → `✗ SCN-002: deployed skill has no MEMORIA_HOME fallback line`；新模板 SCN-001、SCN-002 皆 ✓。`node scripts/check-deployed-skill-sync.mjs` → `deployed_skill_check=ok version=1.29.1`（版本、`deployment_mode`、禁用 token）。模板與兩份 README、INSTALL 以機器路徑及下游專案名稱 grep 皆無命中。
3. ✅ **S2 旗標骨架** — SCN-003
   驗證：隔離 `HOME` 執行不帶旗標的 `setup`，斷言 `$HOME/.claude` 不存在；未知旗標值報錯。
   完成判準：兩條斷言全綠，既有 `test-bootstrap.sh` 案例不變。
   完成證據（2026-10-20）：`✓ SCN-003: no --agent → ~/.claude untouched; unknown value rejected`；未知值輸出 `unknown agent 'nope'; valid values: claude-code`，exit 1，也在任何寫入前停下。既有 Step 1～3b、4 以後不變且通過。測試以 `COREPACK_HOME` 固定 corepack 快取，因為換掉 `HOME` 後 corepack 版 pnpm 會找不到快取而使 preflight 失敗。
4. ✅ **S3 寫入與覆蓋保護** — SCN-004、005、006
   相依：步驟 1、S2。
   驗證：隔離 `HOME` 跑三個情境（不存在、有標記、無標記）。
   完成判準：三個情境斷言全綠，步驟 1 的測試由紅轉綠。
   完成證據（2026-10-20）：`deployAgentSkill` 抽出內部 `writeSkillCopy`（原目標與新目標共用，並寫入 `DATA_ROOT`）；新增 `deployHostAgentSkill`、`assertHostSkillTarget` 與 `HOST_AGENTS`（旗標值可擴充，見 TBD-2）。SCN-004 ✓（`cmp` 與模板相同、`DATA_ROOT` 正確、`bin/memoria` 可執行）、SCN-005 ✓（有標記且被改過的副本被更新回模板）、SCN-006 ✓。GitNexus impact：`deployAgentSkill` LOW（直接呼叫者僅 `registerSetupCommand`）、`registerSetupCommand` LOW。
5. ✅ **S4 文件**
   依 [project.md](../../agents/project.md)：`README.md`、`README.zh-TW.md`、`docs/INSTALL.md` 記載 `--agent` 與觸發時機；`setup --help` 與文件一致。
   完成判準：三份文件與 `--help` 的旗標描述一致。
   完成證據（2026-10-20）：`README.md`、`README.zh-TW.md` 的 setup 段與 `docs/INSTALL.md` 第一節加入 `--agent claude-code`、觸發時機、`MEMORIA_HOME` 優先順序與覆蓋規則；`setup --help` 顯示 `--agent <name>  Also deploy the skill into a host agent's own skill directory (claude-code)`，與文件一致。
   回歸：`pnpm run check` 無錯；CI 全套（依 `ci.yml` 順序 34 支，清除開發者環境變數，`pnpm run build` 後執行）全數 PASS、exit 0，被測為 `ac76109` 加上本次提交內容的工作區，2026-10-20T21:16。精煉：拒絕訊息原本在 setup 與 runtime 各組一次，收斂為 `assertHostSkillTarget` 單一來源，重跑 `test-bootstrap.sh` 仍全綠。

6. ✅ **審查退回修正**（[review-81bb75d](./review-81bb75d.md)）— SCN-003、005、006
   完成證據（2026-10-20）：
   - M-1（依 TBD-4，(A)＋(C)）：紅燈 `bash scripts/test-bootstrap.sh` → `✗ SCN-005: replaced copy was not backed up`（fixture：帶標記、正文被改過、另有 `NOTES.md` 的副本）。實作 `deployHostAgentSkill` 在目標非空時先把整個目錄複製到 `<memoria-home>/.agents/skill-backups/claude-code-<時間戳>/` 再覆蓋，step log 帶 `backup`，文字模式另印 `previous copy backed up to <path>`。備份刻意不放在 `~/.claude/skills/` 旁：放在那裡 Claude Code 會把它當成第二個 memoria skill 載入。綠燈：`✓ SCN-005: an edited marked copy is backed up outside ~/.claude/skills, then replaced`（備份含 `NOTES.md`、SKILL.md 與被替換前 `cmp` 相同、輸出含備份路徑、目標已換成模板）。README、README.zh-TW、INSTALL、`DEPLOYED_REFERENCE.md` 與模板的「只覆蓋 setup 自己部署的版本」改為如實描述標記與備份。
   - S-2：紅燈 `✗ SCN-003: --agent toString accepted`；`resolveHostAgentSkillDir` 改用 `Object.hasOwn`；綠燈，且未建立 `[object Object]/` 或 data root。
   - S-3：模板與 REFERENCE 的 `--submit` 範例加 `--json`，完成判準寫明看 `--json` 輸出；英文模板中的「待增強」改為 "the brief's pending count"。
   - S-4：新增四個拒絕 fixture（只有一個標記、標記只在正文、目標是檔案、目標是 symlink），斷言非 0 結束且 data root 未建立，全綠。變異檢查：把兩個標記的 `&&` 改成 `||` → `✗ SCN-006: a SKILL.md with only one mark was overwritten (exit 0)`，還原後綠。
   - S-1（依 TBD-3）：README「風險與首要驗證」新增阻擋性相依，合併前 issue-20、issue-21 須已在 main。
   - GitNexus：`deployHostAgentSkill` 為本 issue 新增、尚未進索引（impact 回 not found）；grep 確認唯一呼叫者為 `registerSetupCommand`。
   - 未處理（NICE）：frontmatter 沒有結尾 `---` 而正文另有 `---` 分隔線時，正文會被當成 frontmatter 判讀；權限錯誤訊息格式與其他拒絕不一致；SCN-001 的完成判準只檢查總數。
   - 回歸：CI 全套（依 `ci.yml` 順序 34 支）全數 PASS、exit 0，被測為 `8c87bfb` 加上本次提交內容的工作區，2026-10-20。

## 使用方式對照

| 情境 | 變更前 | 變更後 |
|------|--------|--------|
| 讓 Claude Code 使用 Memoria | 手動複製 skill 到 `~/.claude/skills/` 並自行補觸發時機 | `memoria setup --agent claude-code` |
| 已有手寫的 skill | — | setup 拒絕覆蓋並說明，使用者自行決定是否移走 |

## 測試策略

| Scenario | 層級 | 位置 |
|----------|------|------|
| SCN-001、002 | 部署產物內容斷言 | `scripts/test-bootstrap.sh` |
| SCN-003～006 | CLI 端到端（隔離 `HOME`） | `scripts/test-bootstrap.sh` |

SCN-001 的「agent 實際會在該時機觸發」屬行為觀測，無法在 CI 斷言；以模板內容斷言作為等價證據，並在發布後以 recall telemetry 的使用量變化另行觀察（不列為本 issue 的通過條件）。

## 檢查清單

- [x] 所有 Scenario 已核准（2026-10-20）
- [x] 步驟 1 的測試先紅後綠
- [x] 模板不含任何機器特定路徑或下游專案名稱
- [x] 改 symbol 前已跑 GitNexus impact，commit 前已跑 detect_changes
