# Memoria

讓 AI Agent 擁有跨會話、可追溯、可自託管的持久記憶。

- TypeScript CLI（`init`, `sync`, `stats`, `doctor`, `verify`）
- SQLite 本地真實資料層 + Markdown 知識輸出
- 可選 MCP/libSQL 語意增強（`mcp-memory-libsql`）

## Implemented vs Planned

| 項目 | 狀態 | 說明 |
|---|---|---|
| CLI 匯入與同步（`init/sync/stats/doctor/verify`） | Implemented | 目前主流程，已在 CI 驗證 |
| SQLite + Markdown 持久化 | Implemented | `sessions/events/skills` + Daily/Decisions/Skills |
| MCP/libSQL 增強流程 | Implemented (Optional) | bridge + request bundle + auto-ingest |
| 上下文壓縮引擎（core 內建） | Planned | 目前未作為核心 CLI 功能 |
| 內建語意檢索引擎（core 內建） | Planned | 目前主要透過 MCP 增強 |
| OpenCode plugin（repo 內） | Planned | 目前提供配置模板與整合指引 |

對照文件：

- 已落地規格：`SPEC.md`
- 規劃/RFC：`RFC.md`
- 歷史願景規格：`PERSISTENT_MEMORY_SYSTEM_SPEC.md`

## Quick Start

### 1) 安裝

```bash
git clone https://github.com/raybird/Memoria Memoria
cd Memoria
./install.sh
```

極簡容器（例如無 git）可用：

```bash
./install.sh --minimal
```

### 2) 初始化與同步

```bash
MEMORIA_HOME=$(pwd) ./cli init
MEMORIA_HOME=$(pwd) ./cli sync examples/session.sample.json
MEMORIA_HOME=$(pwd) ./cli verify
```

### 3) 可選：MCP/libSQL 增強

```bash
export LIBSQL_URL="file:/path/to/memory-tool.db"
bash skills/memoria-memory-sync/scripts/run-sync-with-enhancement.sh examples/session.sample.json
```

## 常用命令

```bash
./cli init
./cli sync <session.json>
./cli sync --dry-run <session.json>
./cli stats
./cli doctor
./cli verify
./cli verify --json
./cli prune --all --dry-run
./cli export --type all --format json
```

## 安裝完成定義

滿足以下條件可視為完成安裝：

- `./cli init` 成功
- `./cli sync examples/session.sample.json` 成功
- `./cli verify` 回報 `ok: yes`
- `./cli verify --json` 可輸出機器可讀結果
- （若啟用 MCP）`bash scripts/test-mcp-e2e.sh` 成功

## 文件導覽

- 安裝與路徑設定：`docs/INSTALL.md`
- 容器部署：`docs/CONTAINER.md`
- MCP/libSQL 整合：`docs/MCP_INTEGRATION.md`
- Agent Skill 使用：`docs/SKILL_USAGE.md`
- 日常維運與驗證：`docs/OPERATIONS.md`
- 發版流程：`RELEASE.md`
- 已落地規格：`SPEC.md`
- 規劃與 RFC：`RFC.md`
- 變更記錄：`CHANGELOG.md`
- 安全政策：`SECURITY.md`

## 專案結構（精簡）

```text
.
├── src/cli.ts
├── cli
├── dist/cli.mjs
├── install.sh
├── scripts/
│   ├── test-smoke.sh
│   └── test-mcp-e2e.sh
├── skills/memoria-memory-sync/
├── docs/
├── RELEASE.md
└── CHANGELOG.md
```

## 授權

MIT
