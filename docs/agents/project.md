# 專案客製規範

本檔由專案維護，初始化只在不存在時建立，更新上游時保留。規劃與交付前讀取；未填內容從 repo 的設定、現有文件與命令取得，不為填表猜測。

共用規範以根目錄 `AGENTS.md` 為準；`CLAUDE.md` 以 `@AGENTS.md` 引入，只保留需要的 Claude 專用內容。

## 專案邊界與驗證入口

- **模組邊界**：業務邏輯全在 `src/core/`（CLI、HTTP、SDK 共用）；`src/cli/commands/` 一個命令一個檔；git-aware 記憶在 `src/core/git/` 與 `src/core/db/git-*.ts`；語意召回 helper 在 `skills/memoria-vector/`（不屬核心依賴，以 child process 呼叫）。修改核心與記憶語意前讀 [架構與記憶契約](architecture.md)。
- **命令**：根目錄 `AGENTS.md`「Build, Lint, and Test Commands」與「CI Parity Checklist」；`package.json` scripts 與 `.github/workflows/ci.yml` 為準，兩者與文件不一致時照 CI。
- **測試**：沒有測試框架，全部是 `scripts/test-*.sh` 端到端腳本；本機依 CI 的順序跑。
- **完成定義**：根目錄 `AGENTS.md`「Definition of Done for Agent Changes」五項（`pnpm run check`、build + `node dist/cli.mjs --help`、相關 `test-*.sh`、觸及的 shell 過 `bash -n`、CLI 旗標與輸出維持既有 UX）。
- **環境限制**：local embedding（`MEMORIA_EMBED_PROVIDER=local`）CI 不跑，相關驗收以維護者機器的手動證據補，並在 issue 文件記錄量測值。

## 提交與交付

- **提交格式**：`type(scope): 中文摘要`，scope 用模組名（`brief`、`recall`、`release`）或 `issue-N`。**不附任何 AI 署名或 `Co-Authored-By` 尾行**（根目錄 `AGENTS.md`「Commit Messages」）。本 repo 不使用 `Refs:` footer，issue 關聯寫在 scope 或內文。
- **分支**：`issue-N-<描述>`（例：`issue-18-vector-coverage`）；遠端是 GitHub `origin`（`git@github.com:raybird/Memoria.git`，SSH）。
- **併入方式與判定**：不開 PR、沒有 merge commit，issue 分支 rebase 後 fast-forward 進 `main`，原分支名因此不會出現在 `git branch --merged`。合併判定以 `git log main --grep "issue-N"` 有該 issue 的提交，加上 issue README 狀態為準；發版後另以 `docs/HANDOVER.md` §2 出貨紀錄有該版本列為準。
- **發版**：`pnpm run release:prepare <level>` → 編 CHANGELOG → `pnpm run release:publish`，細節與守門在 `RELEASE.md` 與 `scripts/release.sh`。npm 以 OIDC trusted publishing 發佈，沒有 token 可輪替。

## 常青文件更新責任

README 保留介紹、快速開始與導覽；完整用法放在下表對應指南。修改 CLI、API 或整合指南時，同步其 `.zh-TW.md` 版本；修改 README 時同步 `README.zh-TW.md`。

| 變更 | 更新的文件 |
| --- | --- |
| 新增或改名 CLI 命令、旗標、輸出格式 | `docs/CLI.md`、`docs/CLI.zh-TW.md`；影響快速開始時同步中英文 README；`AGENTS.md`「What Not to Change Implicitly」命令清單 |
| 架構、模組切分、資料流、recall 語意 | `docs/agents/architecture.md`、`AGENTS.md` |
| HTTP 端點契約 | `docs/API.md`、`docs/API.zh-TW.md`、`AGENTS.md`（HTTP API 段）、`scripts/test-http-api.sh` |
| SDK 用法、adapter 或 hook 整合 | `docs/INTEGRATIONS.md`、`docs/INTEGRATIONS.zh-TW.md`；安裝接線另同步 `docs/INSTALL.md` |
| schema／migration、維運程序（index、prune、ingest） | `docs/OPERATIONS.md` |
| 安裝路徑、交付清單、部署的 skill | `docs/INSTALL.md`、`skills/memoria-memory-sync/deployed/` |
| 發版流程或守門 | `RELEASE.md`、`docs/HANDOVER.md` §8 |
| 每次發版 | `CHANGELOG.md`、`docs/HANDOVER.md` §2 出貨列（`release.sh publish` 會擋缺列） |
| 新增測試腳本 | `AGENTS.md` 測試清單、`.github/workflows/ci.yml` |

## 本地 gate 與案例

每個 issue 都適用：

- **版控文件只用代稱**：本 repo 公開，issue 文件、CHANGELOG、commit 訊息提到外部專案時用代稱（如 `external-repo`）、外部分支名與 commit sha 用佔位符；量化數據可保留。本機記憶（`~/.memoria`）用真實名稱，兩層分開。
- **不新增工具或 runtime 依賴**（linter、formatter、測試框架、套件）除非使用者要求；現有依賴只有 `better-sqlite3`、`commander`、`zod`。
- **不改 CLI 命令名**（含子命令）：它們是 agent 契約。
- **schema 向後相容**：只加 migration，舊 DB 必須可讀。
- **改 symbol 前跑 GitNexus impact，commit 前跑 detect_changes**（根目錄 `AGENTS.md`「GitNexus」），HIGH／CRITICAL 先告知使用者。
- **Memoria 部署形態**：本機整合走 skill 型，不接 hooks、不裝 service；任何讓 Memoria 自動觸發的提案先確認是使用者要求的。

**地雷位置**：既有的開發與發版雷區在 `docs/HANDOVER.md` §8「開發 SOP 速查」，規劃涉及 release、交付清單、recall 索引或下游契約時先讀。以下為新增、尚未併入 §8 的條目：

| 編號 | 症狀 | 觸發情境 | 怎麼查 | 證據 |
| --- | --- | --- | --- | --- |
| M-1 | （2026-10-21 起失效：v1.30.0 起 embed 分批）`vector-ingest.mjs` 的 node 行程被 OOM kill，向量庫停在舊筆數 | 語料成長到數百筆以上後直接執行 ingest；容易被踩是因為小語料一直成功 | `journalctl -k` 找 `Killed process (node)`；`doctor` 的 vector coverage `missing>0` | [issue-19](../issues/issue-19/README.md) |
| M-2 | （2026-10-21 起失效：v1.30.0 起 `--merge` 回傳 sync 既有摘要；之前留下的重複需手動 dismiss）對同一個 merge 出現兩筆摘要，一筆永遠 pending | 先 sync 後再 `repo summarize --merge`（或反序）；兩條路徑算出的 fingerprint 不同 | `git_summaries` JOIN `git_summary_ranges` 以 `head_sha` 查，同 head 多於一筆 | [issue-20](../issues/issue-20/README.md) |
