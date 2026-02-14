# Memoria

讓 AI Agent 擁有跨會話、可追溯、可自託管的持久記憶。

- TypeScript CLI（`init`, `sync`, `stats`, `doctor`, `verify`）
- SQLite 本地真實資料層 + Markdown 知識輸出
- 可選 MCP/libSQL 語意增強（`mcp-memory-libsql`）

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
