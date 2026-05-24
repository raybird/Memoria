# Install Guide

## Environment

- Node.js `>=18`（建議 20/22）
- npm 安裝跨平台（Linux / macOS / Windows，`better-sqlite3` 自帶 prebuilt binaries）
- no-clone release artifact 目前只支援 Linux x64
- repo 開發模式需要 `pnpm`

## Method A: npm Install (Recommended)

```bash
# 一次性執行（無須全域安裝）
npx @raybird.chen/memoria setup --serve --json

# 或全域安裝
npm install -g @raybird.chen/memoria
memoria setup --serve --json
```

`setup` 預設會把資料寫到執行當下工作目錄的 `./memoria`。若要固定位置，請顯式傳入 `--memoria-home`。

## Method B: No-Clone Tarball Install

```bash
bash install.sh \
  --artifact ./memoria-linux-x64-v1.11.0.tar.gz \
  --install-dir "$HOME/.local/share/memoria"
```

也可省略 `--artifact`，直接用 `--version` 從 GitHub release 下載：

```bash
bash install.sh --version 1.11.0 --install-dir "$HOME/.local/share/memoria"
```

Installer behavior:

- 只部署 release runtime，不建立 repo
- 支援本地 tarball 路徑或 HTTPS URL
- 安裝後入口固定在 `<install-dir>/bin/memoria`
- 後續初始化交給 `memoria setup` / `memoria init`

建議安裝後立刻驗證：

```bash
$HOME/.local/share/memoria/bin/memoria preflight --json
$HOME/.local/share/memoria/bin/memoria setup --memoria-home "$(pwd)/memoria" --serve --json
$HOME/.local/share/memoria/bin/memoria setup --serve --json
```

`setup` 預設會把資料寫到執行當下工作目錄的 `./memoria`，而不是 runtime 安裝目錄。若要固定位置，請顯式傳入 `--memoria-home`。

安裝完成後，內建 skill 也會部署到 `<memoria-home>/.agents/memoria-memory-sync/`，並提供 deploy 專用的 `SKILL.md` / `REFERENCE.md` 與本地 `bin/memoria` wrapper。

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
