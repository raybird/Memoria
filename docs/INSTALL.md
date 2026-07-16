# Install Guide

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

Agent automation 可使用 JSON Lines step log，並選擇直接啟動 server：

```bash
memoria setup --serve --json
```

一次性試用可使用 `npx @raybird.chen/memoria setup --json`；正式長期使用仍建議安裝套件。packed npm artifact 與 deployed skill wrapper 會在 Ubuntu、macOS CI 實際安裝及執行。

`setup` 預設會把資料寫到執行當下工作目錄的 `./memoria`。若要固定位置，請顯式傳入 `--memoria-home`。

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
bash install.sh --version 1.20.0 --install-dir "$HOME/.local/share/memoria"
```

可先檢查將要下載的 URL，不會寫入任何檔案：

```bash
bash install.sh --version 1.20.0 --print-release-url
```

也可直接指定已下載的本地 artifact：

```bash
bash install.sh \
  --artifact ./memoria-linux-x64-v1.20.0.tar.gz \
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

完整片段與各事件說明見 [README](../README.md#agent-adapter)。預設連 `localhost:3917`，可用 `--server` 或 `MEMORIA_SERVER_URL` 覆寫，`--project` 指定寫入的 project tag。

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
