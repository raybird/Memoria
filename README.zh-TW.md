# Memoria

[English](README.md) ｜ **繁體中文**

讓 AI Agent 擁有跨會話、可追溯、可自託管的持久記憶。

Memoria 將決策、踩坑經驗與學到的技能保存到本地 SQLite，在 agent 需要時召回相關記憶。Markdown 筆記與編譯後的 brief 讓記憶可讀，也能在下次 session 直接載入。

## 能力概覽

| 能力 | 用途 |
| --- | --- |
| 持久記憶 | 匯入 session，或用 `remember` 保存單筆筆記；SQLite 與 markdown 保留來源 |
| 召回 | Keyword、tree、hybrid 檢索，以及選用的本地 embedding 語意召回 |
| 長期上下文 | Durable 記憶、明確取代舊記憶，以及由 `AGENTS.md` 指引讀取的專案 brief |
| Git 記憶 | 唯讀觀察 repository，增強變更摘要，召回時附上 commit 來源 |
| 效用回饋 | 回報召回是否有用，讓觀測效用影響排序與保留 |
| Wiki | 匯入 markdown/text、編譯 wiki 頁面、歸檔有價值的查詢結果 |
| 記憶工作台 | 透過本機唯讀介面瀏覽、搜尋與閱讀完整記憶、理由及來源 |
| 整合 | CLI、HTTP API、原始碼層級 Node.js SDK 與 agent adapter 共用核心 |

核心在本地執行，只有 `better-sqlite3`、`commander`、`zod` 三個 runtime 依賴。MCP/libSQL 為選用功能，SQLite 始終是資料真相來源。需要語意索引或跨系統圖譜投射時，請見 [MCP/libSQL 指南](docs/MCP_INTEGRATION.md)。

## 快速開始

需要 **Node.js ≥ 18**。安裝後執行互動式 `memoria setup`（或直接傳入旗標一次完成）：

```bash
npm install -g @raybird.chen/memoria
memoria setup
# 非互動一次到位（全域記憶 + Claude Code 與 Codex skills + 本地語意召回）：
# memoria setup --scope global --agent both --vector --yes

memoria remember "使用 pnpm" --project Memoria --rationale "以 lockfile 為準"
memoria recall "為什麼用 pnpm" --project Memoria --mode vector --json
memoria brief --project Memoria
```

這些命令直接存取本地資料，server 為選用。全域 setup 會將預設資料根目錄（`~/.memoria`）與本地向量設定寫入使用者設定檔（`install.json`），新開的終端機不需要手動 `export MEMORIA_HOME` 或 `LIBSQL_URL` 即可共用同一份記憶庫。專案範圍（`--scope project`）會使用目前專案的 `./memoria`，而顯式傳入的 `MEMORIA_HOME` 或 `--memoria-home` 永遠優先。

`setup` 也會產生初始 brief，並在備份既有檔案後，將受管理區塊（`<!-- memoria:managed:start -->` ... `<!-- memoria:managed:end -->`）接進共用的 `AGENTS.md` 與 `CLAUDE.md`。記憶更新後請執行 `memoria brief` 重新產生 brief。專案辨識、durable 標記與效用回饋詳見 [CLI 指南](docs/CLI.zh-TW.md)。

## 使用介面瀏覽記憶

需要 v1.33.0 或更新版本。原始碼 checkout 可執行 `pnpm run build` 與 `node dist/cli.mjs serve --ui`。

完成 setup 後執行：

```bash
memoria serve --ui
```

開啟印出的 `http://127.0.0.1:3917/ui/`。工作台提供決策、技能與 Session 分類、專案篩選、完整理由與來源、搜尋、摘要、淺深色與鍵盤操作。它使用與 CLI 相同的已初始化資料根，也可明確指定 `MEMORIA_HOME=/path/to/data-root memoria serve --ui`。

介面在前景執行，按 Ctrl+C 關閉；資產隨程式內嵌，可離線瀏覽，明確搜尋會保留本地 recall 遙測。範圍、語意搜尋與存取邊界詳見 [本機工作台指南](docs/CLI.zh-TW.md#本機記憶工作台)。

## 搭配 Agent 使用

Setup 會將 **memoria** skill 部署到 `<memoria-home>/.agents/skills/memoria/SKILL.md`，並依選擇同步部署到 host 的標準探索目錄（Claude Code 為 `~/.claude/skills/memoria`，Codex 為 `~/.codex/skills/memoria` 或 `$CODEX_HOME/skills/memoria`）：

```bash
memoria setup --scope global --agent both --yes
```

Skill 引導 agent 在工作前召回記憶，並在做出決策或完成變更後寫回。部署路徑、備份與獨立安裝方式見 [安裝指南](docs/INSTALL.md)。

選用的下一步：

- **HTTP 或 hooks：** 執行 `memoria setup --serve --json`，接著參考 [API 文件](docs/API.zh-TW.md) 或 [SDK 與 Agent 整合](docs/INTEGRATIONS.zh-TW.md)。
- **語意召回：** 在 `memoria setup` 選擇 `--vector` 會一次完成依賴安裝、本地模型暖機、樹狀索引建立、全量記憶寫入 `<memoria-home>/.memory/vectors.db` 以及就緒驗證。進階診斷與修復流程見 [Semantic Recall Operations](docs/OPERATIONS.md#semantic-recall-operations-optional)。
- **Repository 記憶：** 從 `memoria repo add /path/to/project` 開始，詳見 [Git-Aware Memory Operations](docs/OPERATIONS.md#git-aware-memory-operations)。

## 文件導覽

| 指南 | 內容 |
| --- | --- |
| [安裝](docs/INSTALL.md) | npm、獨立安裝包、資料路徑、部署 skill 與背景服務 |
| [CLI](docs/CLI.zh-TW.md) · [English](docs/CLI.md) | 命令、記憶標記、brief 產生與範圍 |
| [HTTP API](docs/API.zh-TW.md) · [English](docs/API.md) | 端點、請求範例與回傳語意 |
| [SDK 與 Agent 整合](docs/INTEGRATIONS.zh-TW.md) · [English](docs/INTEGRATIONS.md) | 原始碼 SDK 用法與 hook 設定 |
| [維運](docs/OPERATIONS.md) | 索引、向量修復、清理、備份與治理 |
| [MCP/libSQL](docs/MCP_INTEGRATION.md) | 選用的圖譜投射與增量同步 |
| [AGENTS.md](AGENTS.md) · [CLAUDE.md](CLAUDE.md) | 架構、開發命令與 agent 約定 |
| [規格](SPEC.md) · [路線圖](RFC.md) | 已實作行為與未來方向 |
| [版本紀錄](CHANGELOG.md) · [發版 SOP](RELEASE.md) | 版本歷史與維護者流程 |

最後驗證：2026-10-26，對照 issue-30 實作、CLI help 與文件檢查。工作台需要 v1.33.0 或更新版本。

## 授權

MIT
