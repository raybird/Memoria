# Operations Guide

## Runtime Health Commands

```bash
./cli stats
./cli doctor
./cli verify
./cli verify --json
./cli prune --all --dry-run
./cli export --type all --format json
```

## Test Commands

```bash
bash scripts/test-smoke.sh
bash scripts/test-mcp-e2e.sh
```

## CI Parity (Local)

```bash
pnpm install
pnpm run check
pnpm run build
node dist/cli.mjs --help
bash -n install.sh
bash scripts/test-smoke.sh
bash scripts/test-mcp-e2e.sh
```

## Backup

```bash
tar -czf ai-memory-backup-$(date +%Y%m%d).tar.gz "$MEMORIA_HOME"
```

## Security Basics

```bash
chmod 700 "$MEMORIA_HOME/.memory"
chmod 600 "$MEMORIA_HOME/.memory/sessions.db"
```
