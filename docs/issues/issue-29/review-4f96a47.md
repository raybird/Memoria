# Issue 29 需求與規劃審查報告

- 範圍：局部需求／規劃審查；僅 `docs/issues/issue-29/README.md` 與 `implementation-plan.md`。現行程式與測試作為相容性參考，並非此次交付程式。
- Reviewed BASE SHA：`a820af67a9398b613e961f9330037d4d9296f9a4`（`88c77b2^`）
- Reviewed HEAD SHA：`4f96a47d8b0fbf74e84e61fcf113e59b36803830`
- Reviewed patch-id：`69e72ebe83b6930903374dab6e578c22a5e93aa4`
- 獨立 reviewer：Codex 獨立 subagent `/root/review_issue29`；非規格原作者。
- Review artifact：`docs/issues/issue-29/review-4f96a47.md`
- 審查日期：2026-10-23

## 問題與風險

### MUST FIX M-1：補上 host 與 canonical 路徑重合的處置，避免刪掉 canonical 後建立自循環連結

位置：`implementation-plan.md:12-18`、`implementation-plan.md:56-64`。

現行 `resolveHostAgentSkillDir` 明確支援任意 `$CODEX_HOME`（`src/cli/runtime.ts:108-113`）。當 `CODEX_HOME=<dataRoot>/.agents`，Codex host target 就等於 canonical `<dataRoot>/.agents/skills/memoria`。現行 `assertSetupPlanSafe` 分別檢查兩個目標，沒有檢查這個重合（`src/cli/setup-plan.ts:345-349`）。依計畫先部署 canonical，再將非空 host 目錄備份、刪除並連回 canonical，結果會把唯一 canonical 實體目錄改成指向自己的 symlink；`DATA_ROOT`、launcher 與 skill 讀取均失敗。備份仍存在，問題是破壞部署可用性，而非沒有備份的資料遺失。

建議：計畫明訂預檢處理此種重合。最小安全做法是在寫入前拒絕並指出衝突；若要支援共用路徑，應視為直接使用 canonical，禁止刪除或建立自連結。新增隔離 `$CODEX_HOME` 重合案例，檢查失敗前不寫入，或成功後 canonical 仍是實體目錄且 launcher 可執行。

### MUST FIX M-2：空目錄被預檢放行，但部署計畫沒有移除它

位置：`implementation-plan.md:48-50`、`implementation-plan.md:58-64`。

規則明確放行既有空目錄；部署流程只刪除舊 symlink 或非空實體目錄，隨後對仍存在的空目錄呼叫 `fs.symlink`，會得到 `EEXIST`。這也會退化現行可接受空目錄的行為（`src/cli/runtime.ts:236`、`src/cli/runtime.ts:274-277`）。

建議：明訂空目錄在建立連結前移除且不備份，並在紅燈測試中加入該既有狀態；不可只涵蓋完全不存在的 host target。

### MUST FIX M-3（需決策）：Memoria symlink 的辨識條件存在互斥版本

位置：`README.md:32`、`implementation-plan.md:32-47`。

README 以「部署標記或 canonical 路徑結構」描述放行；計畫先列 A（路徑尾端相符，即使目標不存在）／B（有部署標記），B 又保留「或我們限定」的未定方案，最後第 44 行改成「必須 canonical 尾端，且存在時必須有標記」。例如帶部署標記但位於 `link-target` 的目錄，在 B 可放行、在第 44 行必須拒絕。這是本次最大安全邊界的可觀察差異，不能交由實作者任選版本。

待決問題：是否統一採用「canonical 尾端必須符合；存在的目標必須是具兩項標記的目錄；不存在的 canonical 目標允許修復」？建議採此較窄規則，刪除互斥 A／B 草案，並把相對連結、斷鏈、相符尾端但無標記／為一般檔案、外部有標記但尾端不相符等正負例列入測試表。路徑與公開模板標記只是受管理目標的辨識慣例，不能證明連結必由 setup 建立；文件應避免「100%」來源保證。若這個收斂改變已核准 Q1 的語意，依流程只重核受影響 Scenario。

### MUST FIX M-4：風險等級與專案 High 判定規則不符

位置：`README.md:98-101`、`README.md:113`。

README 明述涉及家目錄覆寫與刪除，卻因可透過測試保護而評為 Medium；`docs/AGENTS.md` 的風險分級明訂安全／權限或不可逆操作符合 High 任一條件就採較高級。測試能降低風險，不會使規劃時的風險來源變成 Medium。文件自身第 101 行也稱其為高風險邊界。

建議：維持規模 Medium，風險改為 High；首要驗證加入 M-1 的路徑重合與 M-3 的辨識決策，再明確記錄何種證據才足以進入刪除／遷移實作。

### SHOULD FIX S-1：補上部署主 skill 模板的常青文件責任

位置：`README.md:43`、`implementation-plan.md:86-92`。

清單只列 `deployed/DEPLOYED_REFERENCE.md`，但真正部署給 agent 的 `skills/memoria-memory-sync/deployed/DEPLOYED_SKILL.md:104` 仍承諾既有 deployed copy 會先備份，沒有區分首次實體副本遷移與後續 symlink 重跑。它是 agent 日常讀取的入口，應一併更新為實際連結與備份行為。

### SHOULD FIX S-2：把不帶 --agent 更新仍能同步 host 的核心收益加入驗收

位置：`README.md:8`、`README.md:58-63`、`implementation-plan.md:107-110`。

目前 SCN-002 只覆蓋重跑 `setup --agent both` 或切換 root；尚未直接驗證本 issue 最初要解決的「只更新 canonical，host 就同步」：先完成 host 部署，接著不帶 `--agent` 重跑 setup，從原 host 路徑觀察更新後的 skill／DATA_ROOT／launcher，且不新增備份。建議增加此案例，避免只證明 link 形態而漏掉實際收益。

## 已查核維度

- **固定版本與核准**：BASE..HEAD 僅新增上述兩份文件，共 231 行；`88c77b2..HEAD` 的 README 差異只有將核准 commit 從「待提交」回填為 `88c77b2`，未觀察到驗收語意漂移。Q1～Q3 的原始對話未交付給 reviewer，核准來源依 README 記載，未另行推定新授權。
- **SCN-001**：新部署、canonical 實體目錄、host symlink 與 launcher 成功路徑已有規劃。現行 launcher 使用絕對 runtime invocation（`src/cli/runtime.ts:280-289`），未依 `$0` 推算位置，因此 source audit 未見 symlink 造成 launcher 相對定位問題；DATA_ROOT 透過 host 路徑讀取可自然循連結。本次未驗證真實宿主的 skill discovery。
- **SCN-002**：重跑、切換 root、不新增備份已有規劃；斷鏈處理語意受 M-3 影響，核心同步收益見 S-2。
- **SCN-003**：一般檔案、手寫目錄、外部帶模板 symlink、深層祖先 symlink 與 canonical target symlink 的拒絕均有列入規劃；放行規則仍須 M-3 收斂。現行 setup 在 init 前呼叫整體預檢（`src/cli/commands/setup.ts:213-240`），計畫應維持此順序；M-1 也應在此預檢處理。
- **SCN-004**：有標記且含自訂修改的舊實體目錄先完整備份，再轉為連結，責任與測試策略明確。現行 bootstrap 已有備份檔內容逐位元組比較，可沿用其真實內容斷言，測試 fixture 應另建舊實體目錄，避免在首次部署已改成 symlink 後，錯將 canonical 當成舊 host 副本修改。
- **平台**：Windows junction 已有設計，現有 CI 與本次隔離 FS 探針均不能證明 Windows 實機行為；這是證據限制，未列為「未實作功能測試失敗」。
- **架構與品質**：canonical 寫入與 host discovery link 的分工合理，未引入 schema、服務或 runtime 依賴；不需要為此額外設計新資料庫。主要缺口是邊界狀態與相互矛盾的條件，而非跨 Task 重複程式邏輯。
- **豁免與限制**：未見本次 gate 豁免。未修改 production symbol，未執行程式驗收、完整 CI 或 GitNexus impact；未實作的功能不要求測試先通過。本次僅新增審查報告，未變更需求與程式，也未提交。

## 可重複靜態查核與探針

2026-10-23，工作區 HEAD 為被審查 SHA，以下唯讀版本查核皆 exit 0：

```bash
git rev-parse 88c77b2^ HEAD
git diff a820af67a9398b613e961f9330037d4d9296f9a4 4f96a47d8b0fbf74e84e61fcf113e59b36803830 --stat
git diff 88c77b2 4f96a47d8b0fbf74e84e61fcf113e59b36803830 -- docs/issues/issue-29/README.md
git diff a820af67a9398b613e961f9330037d4d9296f9a4 4f96a47d8b0fbf74e84e61fcf113e59b36803830 -- docs/issues/issue-29/README.md docs/issues/issue-29/implementation-plan.md | git patch-id --stable
```

獨立 reviewer 以 `node --input-type=module` 在 `fs.mkdtemp('/tmp/issue29-review-independent-')` 隔離目錄建立最小 FS 探針，exit 0；未呼叫產品 setup，也未寫入真實 HOME：

1. 對已存在的空目錄呼叫 `fs.symlink(canonical, emptyHost, 'dir')`，結果 `empty-directory=EEXIST`。
2. 將 host 設為與 canonical 同一路徑，依計畫 `fs.cp(..., {recursive:true, verbatimSymlinks:true})` 備份、`fs.rm(..., {recursive:true, force:true})` 後 `fs.symlink(canonical, host, 'dir')`，結果 `host-equals-canonical=true`、讀 DATA_ROOT 得 `self-link-read=ELOOP`、備份仍為 `backup-content=original`。

探針只證明上述 FS 操作與計畫邊界的問題，不代表尚未實作的程式已被執行或驗收。

## 流程判定

**RETURN TO execute-task**（此處意為退回需求／規劃修訂）：M-1～M-4 尚待處理，M-3 含需決策的規格收斂。這是一份需求與規劃審查，**未給程式驗收 PASS**，也不能作為 issue 實作完成或交付通過的證據。
