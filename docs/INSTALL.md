# Install Guide

最後驗證：2026-10-23，對照 setup 的 runtime／skill 部署流程、全域安裝與共用指令入口；未重新下載模型。

## Environment

- Node.js `>=18`（建議 20/22）
- npm 安裝跨平台（Linux / macOS / Windows，`better-sqlite3` 自帶 prebuilt binaries）
- no-clone release artifact 支援 Linux/macOS 的 x64 與 arm64；installer 依目前 Node runtime 自動選擇
- repo 開發模式需要 `pnpm`

## Method A: npm Install (Recommended)

一般使用者建議持久安裝，讓 deployed skill wrapper 有穩定的 runtime 可以呼叫：

```bash
npm install -g @raybird.chen/memoria
memoria setup
```

在互動終端執行 `memoria setup` 時，引導流程會依序詢問：

1. **記憶範圍**：全域共用（預設 `~/.memoria`，寫入使用者層級 `install.json`）或目前專案（`./memoria`）
2. **Host agent skill 部署**：`both`（Claude Code + Codex）、`claude-code`、`codex` 或 `none`
3. **語意召回**：是否啟用本地語意召回（`multilingual-e5-small` + `<memoria-home>/.memory/vectors.db`）

寫入前會顯示完整變更預覽與路徑並請求確認。也可使用非互動旗標一次完成：

```bash
memoria setup --scope global --agent both --vector --yes
```

Agent automation 可使用 JSON Lines step log，並選擇直接啟動 server（無 TTY 或帶 `--json` 時不會等待問答）：

```bash
memoria setup --serve --json
```

一次性試用可使用 `npx @raybird.chen/memoria setup --json`；正式長期使用仍建議安裝套件。packed npm artifact 與 deployed skill wrapper 會在 Ubuntu、macOS CI 實際安裝及執行。

### 資料根目錄與設定優先序

當未明確傳入 `--memoria-home` 或 `MEMORIA_HOME` 時，Memoria 依下列優先序決定有效資料根目錄：

1. 明確旗標 `--memoria-home` 或環境變數 `MEMORIA_HOME`（`homeSource: "env"`）
2. 目前工作目錄已存在的本地記憶（`./.memory/sessions.db`、`./knowledge` 或 `./memoria/.memory/sessions.db`，`homeSource: "detected"`）
3. 全域安裝設定檔保存的 `defaultDataRoot`（Linux/macOS 於 `${XDG_CONFIG_HOME:-~/.config}/memoria/install.json` 或 macOS `~/Library/Application Support/memoria/install.json`，Windows 於 `%APPDATA%\memoria\install.json`；可用 `MEMORIA_USER_CONFIG_PATH` 覆寫，`homeSource: "global-config"`）
4. Runtime fallback（非互動 `setup` 預設為 `./memoria`）

因此完成一次 `memoria setup --scope global` 後，新開終端機不需要手動 `export MEMORIA_HOME` 或 `LIBSQL_URL`，執行 `memoria remember`、`memoria recall`、`memoria brief`、`memoria doctor` 都會自動對齊同一個全域記憶庫；若進入已有獨立 `./memoria` 的專案目錄，則優先使用該專案記憶而不會串庫。

### 啟用本地語意召回

在 `memoria setup` 選擇語意召回（或傳入 `--vector`）會一次完成：

```bash
memoria setup --scope global --agent both --vector --yes
```

1. 安裝向量依賴至 `${XDG_CACHE_HOME:-~/.cache}/memoria/vector/<雜湊>/` 並下載／暖機本地模型
2. 將該資料根的本地向量庫路徑 `file:<memoria-home>/.memory/vectors.db` 寫入 `install.json`（不保存任何遠端 `LIBSQL_AUTH_TOKEN`）
3. 建立樹狀索引（`buildMemoryIndex`）並以專用 `--sync-target` 執行全量向量 ingest
4. 驗證 `vector coverage`（`missing=0`）與實際語意召回路由（空記憶庫會以隔離暫存庫探測鏈路後自動清除，不污染真實記憶庫）

後續新增記憶後，若 `memoria doctor` 顯示 `vector coverage missing>0`，可直接執行它印出的 `Run:` 命令補齊，或重跑 `memoria setup --vector --yes`。遠端 libSQL 或自訂 helper 的覆蓋率會顯示 `not measured`；這不代表索引已完整。自訂 `MEMORIA_DB_PATH` 指向非 `<home>/.memory/sessions.db` 時，setup 與 doctor 都會拒絕執行向量 ingest 並指出路徑不符，詳見 [Operations](OPERATIONS.md#semantic-recall-operations-optional)。

依賴與模型都放在使用者快取目錄（`XDG_CACHE_HOME`，預設 `~/.cache`），全域升級不會碰到（issue-25）。目錄名稱的雜湊取自 helper 的 `package-lock.json`，只有新版本改了 helper 依賴時，doctor 才會顯示 vector embedder 失敗，這時再跑一次 `setup --vector` 即可。舊雜湊的目錄（每份約 720MB）不會自動清除，確認沒有任何已安裝版本使用後可直接刪除。向量本身存在 `<memoria-home>/.memory/vectors.db`（或自訂 `LIBSQL_URL`），不在套件裡，升級後不需要重新下載模型。細節見 [OPERATIONS.md](OPERATIONS.md)「Semantic Recall Operations」。

### 部署 Host Skill（Claude Code 與 Codex）

`--agent` 支援 `claude-code`、`codex`、`both` 或 `none`。實體 skill 只有一份，在 `<memoria-home>/.agents/skills/memoria/`；所選 host 的探索目錄是指向它的 symlink（Windows 為 junction）：

- Claude Code：`~/.claude/skills/memoria/`
- Codex：`~/.codex/skills/memoria/`（設定 `CODEX_HOME` 時為 `$CODEX_HOME/skills/memoria/`）

```bash
memoria setup --scope global --agent both --yes
```

host 目標已存在時，依現況處理：

- **已是 Memoria 的連結**：連結目標路徑以 `.agents/skills/memoria` 結尾，且該目錄的 `SKILL.md` frontmatter 同時帶 `deployment_mode: installed` 與 `repository: Memoria`，或目標已不存在（斷鏈）。直接改連到這次的資料根目錄，不備份，舊連結指向的內容不動；重跑或切換 `--memoria-home` 都走這條。
- **空目錄**：移除後建立連結，不備份。
- **帶兩項標記的實體目錄**（舊版 `setup` 複製的副本）：每份部署模板都帶這兩個標記，從部署版手動複製再改過的副本也一樣，所以先把整個目錄備份到 `<memoria-home>/.agents/skill-backups/<agent>-<時間戳>/` 並印出路徑，再換成連結。只會發生在第一次升級。
- **其他一律拒絕**：手寫的 skill、一般檔案、指向其他位置的 symlink（即使目標帶標記）、祖先路徑含使用者 symlink，以及資料根目錄的 `.agents/skills/memoria` 本身是 symlink。`setup` 在寫入任何檔案前就以非 0 結束並印出路徑與原因，原內容不動。

host 路徑與資料根目錄的 skill 是同一個目錄，或其中一個位於另一個之內時（例如 `CODEX_HOME=<memoria-home>/.agents`），`setup` 同樣在寫入前拒絕，不會建立指向自己的連結。判斷依據是實際目錄（裝置與 inode），bind mount 或大小寫不同的寫法也算同一個；預檢時還不存在的目錄只能比對路徑，部署刪除前會再以實際目錄確認一次。

不帶 `--agent` 重跑 `setup` 只更新資料根目錄那一份；已連結的 host 透過連結直接讀到新內容。也因為是連結，經 `~/.claude/skills/memoria` 或 `~/.codex/skills/memoria` 改的檔案其實寫進了資料根目錄那一份，下一次 `setup` 會直接覆蓋、不備份。部署的 skill 由 `setup` 管理；要自訂觸發時機或指令，請另外建立一個 skill 目錄。

### 共用規範與 brief 自動接線

在互動引導或指定 `--scope global|project` 時，`setup` 會自動產生初始 brief，並在修改前將既有規範檔備份至 `<memoria-home>/.agents/instruction-backups/`，接著以受管理區塊（`<!-- memoria:managed:start -->` ... `<!-- memoria:managed:end -->`）更新：

- 共用規範 `AGENTS.md`（全域為 `~/.codex/AGENTS.md` 或 `$CODEX_HOME/AGENTS.md`；專案為 `<project>/AGENTS.md`）：寫入 brief 讀取指令。
- Claude 入口 `CLAUDE.md`（全域為 `~/.claude/CLAUDE.md`；專案為 `<project>/CLAUDE.md`）：引入共用規範 `@AGENTS.md` 與產生的 brief `@/path/to/BRIEF.md`。

受管理區塊外的所有手寫內容都會逐位元組保留，重跑 `setup` 只會原地刷新受管理區塊而不會重複堆疊。日常記憶更新後請執行 `memoria brief` 重新整理 brief。完整範例見 [共用專案規範與 brief](INTEGRATIONS.zh-TW.md#共用專案規範與-brief)（[English](INTEGRATIONS.md#shared-project-instructions-and-brief)）。

### 更新全域安裝

`npm install -g` 更新的是 runtime 套件；資料根目錄中的 skill 是上次 `setup` 複製的內容，host skill 目錄連結到它。升級後重跑一次 `setup`，即可刷新已部署的 skill、REFERENCE、wrapper 與 brief：

```bash
npm install -g @raybird.chen/memoria@<版本>
memoria setup --scope global --agent both --vector --yes
# 或針對特定既有資料根目錄：
memoria setup --memoria-home /absolute/path/to/existing/memoria --agent both
```

後續執行 `memoria doctor` 可確認 `homeSource`、skill 與向量覆蓋率皆為就緒狀態。GitHub `main` 上的提交不會自動進入已發布的 npm 版本；先確認包含所需變更的版本已發布，再執行升級。

### Automation output

`memoria setup --serve --json` emits JSON Lines, one row per step. A successful installed-mode run looks like:

```json
{"step":"preflight","ok":true,"ms":120,"mode":"installed"}
{"step":"init","ok":true,"ms":85}
{"step":"verify","ok":true,"ms":42}
{"step":"skill","ok":true,"ms":14,"path":"./memoria/.agents/skills/memoria"}
{"step":"serve","ok":true,"port":3917}
```

Confirm readiness with `curl -sf http://localhost:3917/v1/health`. Request examples and endpoint contracts are in the [API Reference](API.md) ([繁體中文](API.zh-TW.md)).

### Background service (macOS / Ubuntu)

Setup 完成後，可安裝個人層級的常駐服務，不需要 sudo：

```bash
memoria service install --memoria-home "$(pwd)/memoria"
memoria service status
```

支援的 lifecycle commands：

```bash
memoria service install [--port 3917] [--no-start]
memoria service start
memoria service stop
memoria service status [--json]
memoria service uninstall
```

- Ubuntu/Linux 使用 `~/.config/systemd/user/memoria.service` 與 `systemctl --user`；log 可用 `journalctl --user -u memoria.service` 查看。
- macOS 使用 `~/Library/LaunchAgents/io.github.raybird.memoria.plist`；stdout/stderr 位於 `~/Library/Logs/Memoria/`。
- installed runtime 會使用絕對 Node executable 與 bundled CLI 路徑，不依賴 launchd/systemd 的 shell `PATH`。
- `service uninstall` 只停止並移除 service definition，不刪除 `<memoria-home>` 的資料。
- Ubuntu 若需要登出後仍持續執行，可另外啟用 user lingering；一般桌面登入使用不需要。

## Method B: No-Clone Tarball Install

下載 release 中的 `install.sh` 後執行；installer 會依目前 Node runtime 自動選擇原生 artifact：

```bash
bash install.sh --version 1.35.0 --install-dir "$HOME/.local/share/memoria"
```

可先檢查將要下載的 URL，不會寫入任何檔案：

```bash
bash install.sh --version 1.35.0 --print-release-url
```

也可直接指定已下載的本地 artifact：

```bash
bash install.sh \
  --artifact ./memoria-linux-x64-v1.35.0.tar.gz \
  --install-dir "$HOME/.local/share/memoria"
```

可用 artifact 平台名稱：

| OS | Node architecture | Artifact platform |
|----|-------------------|-------------------|
| Ubuntu/Linux | x64 | `linux-x64` |
| Ubuntu/Linux | arm64 | `linux-arm64` |
| macOS Intel | x64 | `darwin-x64` |
| macOS Apple Silicon | arm64 | `darwin-arm64` |

Installer behavior:

- 只部署 release runtime，不建立 repo
- 依 `process.platform` + `process.arch` 選擇與 Node 相同架構的 native artifact；`--platform` 可供 URL 檢查與自動化明確指定
- 支援本地 tarball 路徑或 HTTPS URL
- **自動驗證 tarball SHA256**：release 同時發布 `.tar.gz.sha256`，installer 會下載/讀取並比對，不符即中止；找不到 checksum 檔時警告後繼續（`--version` 也會先驗證格式）
- 安裝後入口固定在 `<install-dir>/bin/memoria`
- 後續初始化交給 `memoria setup` / `memoria init`

建議安裝後立刻驗證：

```bash
$HOME/.local/share/memoria/bin/memoria preflight --json
$HOME/.local/share/memoria/bin/memoria setup --memoria-home "$(pwd)/memoria" --serve --json
$HOME/.local/share/memoria/bin/memoria setup --serve --json
```

`setup` 預設會把資料寫到執行當下工作目錄的 `./memoria`，而不是 runtime 安裝目錄。若要固定位置，請顯式傳入 `--memoria-home`。

安裝完成後，內建 skill 也會部署到 `<memoria-home>/.agents/skills/memoria/`（在 active_skills 中以 **memoria** 名稱出現），並提供 deploy 專用的 `SKILL.md` / `REFERENCE.md` 與本地 `bin/memoria` wrapper。

常見失敗排查：

- `artifact not found`: 檢查 `--artifact` 路徑或 URL 是否正確
- `curl is required`: 使用本地 tarball，或先安裝 `curl`
- `Node.js >= 18 is required`: 升級 Node.js 後重試
- `artifact missing required path`: 重新下載 tarball，確認不是 repo source archive

## Method C: Developer Setup From Repo

```bash
git clone https://github.com/raybird/Memoria Memoria
cd Memoria
pnpm install
# or: npm install

MEMORIA_HOME=$(pwd) ./cli init
MEMORIA_HOME=$(pwd) ./cli sync examples/session.sample.json
MEMORIA_HOME=$(pwd) ./cli verify
# optional: manual incremental tree index build
MEMORIA_HOME=$(pwd) ./cli index build
```

## Agent Hook Integration (post-install)

安裝後不需再寫程式，就能把 Memoria 接進支援 hook 的 agent CLI。三個整合都由 `memoria adapter <name>` 提供（讀 stdin JSON、回 stdout JSON），並且 fail-open——Memoria 沒開或故障都不會打斷 agent。

先確保 server 在跑（`memoria setup --serve` 或 `memoria serve`），再把對應 hook 貼進該 CLI 的設定：

| Host CLI | 接線位置 | 指令 |
|----------|----------|------|
| Claude Code | `~/.claude/settings.json` 的 `hooks` | `memoria adapter claude-code` |
| Codex CLI | `~/.codex/hooks.json`（或 `config.toml` 的 `[hooks]`） | `memoria adapter codex` |
| Antigravity CLI | 客製目錄的 `hooks.json`（或 `settings.json` 的 `hooks`） | `memoria adapter antigravity` |

可直接複製部署好的範本（`setup` 後位於 `<memoria-home>/.agents/skills/memoria/resources/hooks/`，repo 內為 `skills/memoria-memory-sync/resources/hooks/`）：

- `claude-code.hooks.json`
- `codex.hooks.json`
- `antigravity.hooks.json`

完整片段與各事件說明見 [SDK 與 Agent 整合](INTEGRATIONS.zh-TW.md)（[English](INTEGRATIONS.md)）。預設連 `localhost:3917`，可用 `--server` 或 `MEMORIA_SERVER_URL` 覆寫，`--project` 指定寫入的 project tag。

## Path Overrides

Priority:

1. Explicit env
2. `MEMORIA_HOME`
3. Internal fallback

Supported env vars:

- `MEMORIA_DB_PATH`
- `MEMORIA_SESSIONS_PATH`
- `MEMORIA_CONFIG_PATH`

Example:

```bash
export MEMORIA_HOME="/workspace/Memoria"
export MEMORIA_DB_PATH="/data/memoria/sessions.db"
export MEMORIA_SESSIONS_PATH="/data/memoria/sessions"
export MEMORIA_CONFIG_PATH="/etc/memoria"

./cli init
./cli doctor
./cli verify
```

## Dist Runtime Mode

Build once:

```bash
pnpm run build
```

Run without tsx/pnpm runtime dependency:

```bash
node dist/cli.mjs --help
node dist/cli.mjs init
```

`./cli` will prefer `dist/cli.mjs` when present.

Release artifact 與 repo dist mode 不同：

- repo dist mode: 仍在原始碼樹內執行 `node dist/cli.mjs`
- no-clone mode: 使用 release tarball 內的 `bin/memoria`

## Container

Memoria 附有基礎 `Dockerfile` 供快速容器使用。

```bash
docker build -t memoria:local .
docker run --rm memoria:local
```

預設容器指令執行 `./cli verify` 與 `node dist/cli.mjs --help`。

互動式用法：

```bash
docker run --rm -it -v "$(pwd)":/workspace -w /workspace memoria:local bash
./cli init
./cli verify
```

- Base image: `node:22-slim`
- `pnpm` 透過 `corepack` 啟用
- Build stage 產出 `dist/cli.mjs`

## UI delivery

`memoria serve --ui` uses assets embedded in `dist/cli.mjs`; npm and release tar installs require no separate frontend directory or dependencies. Rebuild after UI source changes. Use an initialized data root explicitly; the viewer installs no service or hook. See [CLI](CLI.md#local-memory-workspace).
