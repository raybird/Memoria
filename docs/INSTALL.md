# Install Guide

## Environment

- Node.js `>=18`（建議 20/22）
- no-clone release artifact 目前只支援 Linux x64
- repo 開發模式需要 `pnpm`

## Method A: No-Clone Install (Recommended)

```bash
bash install.sh \
  --artifact ./memoria-linux-x64-v1.6.0.tar.gz \
  --install-dir "$HOME/.local/share/memoria"
```

也可省略 `--artifact`，直接用 `--version` 從 GitHub release 下載：

```bash
bash install.sh --version 1.6.0 --install-dir "$HOME/.local/share/memoria"
```

Installer behavior:

- 只部署 release runtime，不建立 repo
- 支援本地 tarball 路徑或 HTTPS URL
- 安裝後入口固定在 `<install-dir>/bin/memoria`
- 後續初始化交給 `memoria setup` / `memoria init`

建議安裝後立刻驗證：

```bash
$HOME/.local/share/memoria/bin/memoria preflight --json
$HOME/.local/share/memoria/bin/memoria setup --serve --json
```

常見失敗排查：

- `artifact not found`: 檢查 `--artifact` 路徑或 URL 是否正確
- `curl is required`: 使用本地 tarball，或先安裝 `curl`
- `Node.js >= 18 is required`: 升級 Node.js 後重試
- `artifact missing required path`: 重新下載 tarball，確認不是 repo source archive

## Method B: Developer Setup From Repo

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
