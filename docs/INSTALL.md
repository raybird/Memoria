# Install Guide

## Environment

- Node.js `>=18`（建議 20/22）
- `pnpm`（推薦）或 `npm`（fallback）

## Method A: Installer (Recommended)

```bash
git clone https://github.com/raybird/Memoria Memoria
cd Memoria
./install.sh
```

Minimal mode（容器/極簡系統）：

```bash
./install.sh --minimal
```

Installer behavior:

- 會先做 preflight（node/pnpm/npm/git/unzip/python3）
- `pnpm` 不存在時會 fallback `npm`
- `--no-git` 或無 git 時會跳過 git 初始化

## Method B: Manual Install

```bash
git clone https://github.com/raybird/Memoria Memoria
cd Memoria
pnpm install
# or: npm install

MEMORIA_HOME=$(pwd) ./cli init
MEMORIA_HOME=$(pwd) ./cli sync examples/session.sample.json
MEMORIA_HOME=$(pwd) ./cli verify
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
