# Operations Guide

## Runtime Health Commands

```bash
./cli stats
./cli doctor
./cli verify
./cli verify --json
./cli index build
./cli index build --project my-project --dry-run
./cli prune --all --dry-run
./cli export --type all --format json
```

## Tree Index Notes

- Memoria now auto-builds a lightweight tree index after each successful `sync`.
- Disable auto-build by setting `MEMORIA_INDEX_AUTOBUILD=0`.
- Manual incremental rebuild remains available via `./cli index build`.

## Recall Quality Checks

Start server and inspect tree/hybrid routing metadata:

```bash
./cli serve --port 3917

curl -sS -X POST http://localhost:3917/v1/recall \
  -H 'Content-Type: application/json' \
  -d '{"query":"StreamVue pricing","mode":"tree"}'

curl -sS -X POST http://localhost:3917/v1/recall \
  -H 'Content-Type: application/json' \
  -d '{"query":"StreamVue pricing","mode":"hybrid"}'
```

Look at `meta.route_mode`, `meta.fallback_used`, and `meta.reasoning_path`.

You can also inspect aggregated telemetry in stats:

```bash
./cli stats
./cli stats --json
```

Check `recallRouting` for 7-day route counts, fallback rate, and latency percentiles.

For raw recall telemetry rows (HTTP):

```bash
curl -sS "http://localhost:3917/v1/telemetry/recall?window=P7D&limit=50"
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
