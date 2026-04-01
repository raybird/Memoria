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
./cli prune --consolidate-days 90 --dry-run
./cli prune --stale-days 180 --dry-run
./cli export --type all --format json
```

## Memory Quality & Pruning

Memoria applies time-decay scoring to recall results: newer memories rank higher when token relevance is equal. The decay follows `1 / (1 + ageDays / 90)` — a 90-day-old memory scores at 50% of an equivalent new one, but never reaches zero.

Prune strategies for long-running instances:

```bash
# Consolidate: merge old session nodes under same topic (keeps newest, removes rest)
./cli prune --consolidate-days 90 --dry-run

# Stale: remove memory_nodes never recalled and orphan sessions older than N days
./cli prune --stale-days 180 --dry-run

# All-in-one: exports 30d + checkpoints 30d + dedupe + consolidate 90d + stale 180d
./cli prune --all --dry-run
```

Note: `--consolidate-days` only removes `memory_nodes` (level=2) — original `sessions` and `events` rows are preserved for audit trail and keyword recall. `--stale-days` removes both stale nodes and orphan sessions.

## Tree Index Notes

- Memoria now auto-builds a lightweight tree index after each successful `sync`.
- Disable auto-build by setting `MEMORIA_INDEX_AUTOBUILD=0`.
- Manual incremental rebuild remains available via `./cli index build`.

## Import Guardrails

- Memoria suppresses exact duplicate events within the same imported session.
- If a session summary is trivial (for example greetings or very short acknowledgements), Memoria derives a better summary from the first higher-signal event when possible.

## Scope Filtering

- You can attach `scope` to imported session JSON (for example `agent:main`, `user:alice`, `project:Memoria`, `global`).
- If omitted, Memoria defaults to `project:<project>` when `project` exists, otherwise `global`.
- Use `scope` in recall requests to isolate memory reads.

## Governance Review

- Use `./cli govern review --json` to inspect repeated decisions and skills worth promoting into durable rules/skills.
- Current governance review is deterministic and read-only; it does not mutate memory state.

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

- `route_mode=skipped` means adaptive retrieval intentionally bypassed memory lookup for a trivial query.

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
bash scripts/test-bootstrap.sh
bash scripts/test-adapter-runtime.sh
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
bash scripts/test-bootstrap.sh
bash scripts/test-adapter-runtime.sh
bash scripts/test-mcp-e2e.sh
```

## Release SOP

Patch release flow lives in `RELEASE.md`.

Use it when docs, verification steps, runtime packaging, or release metadata change.

## Backup

```bash
tar -czf ai-memory-backup-$(date +%Y%m%d).tar.gz "$MEMORIA_HOME"
```

## Security Basics

```bash
chmod 700 "$MEMORIA_HOME/.memory"
chmod 600 "$MEMORIA_HOME/.memory/sessions.db"
```
