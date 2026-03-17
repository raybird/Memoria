# Skill Usage Guide

Primary skill path:

- `skills/memoria-memory-sync/SKILL.md`

Supporting docs:

- `skills/memoria-memory-sync/references/REFERENCE.md`
- `skills/memoria-memory-sync/resources/mcp/INGEST_PLAYBOOK.md`

## Validate Skill (Optional)

If you have `skills-ref` installed:

```bash
skills-ref validate skills/memoria-memory-sync
```

## Core Skill Workflow

```bash
pnpm install
MEMORIA_HOME=$(pwd) ./cli init
MEMORIA_HOME=$(pwd) ./cli sync examples/session.sample.json
MEMORIA_HOME=$(pwd) ./cli verify
MEMORIA_HOME=$(pwd) ./cli index build
MEMORIA_HOME=$(pwd) ./cli govern review --json
```

Session JSON can optionally include `scope` (for example `agent:main`, `user:alice`, `project:Memoria`).

## Hybrid MCP Workflow

```bash
export LIBSQL_URL="file:/path/to/memory-tool.db"
bash skills/memoria-memory-sync/scripts/run-sync-with-enhancement.sh examples/session.sample.json
```

## Integration Strategy

- Tight coupling: run the hybrid script in your agent's after-response hook (near real-time).
- Async batch: run the same script on a scheduler for high-throughput environments.
- Prefer tight coupling first; switch to batch when latency isolation or scale requires it.

## Runtime Notes

- Recall supports `mode=keyword|tree|hybrid`.
- Trivial recall queries may return `meta.route_mode=skipped` due to adaptive retrieval.
- Use `scope` on write/read when you need agent- or user-level isolation.
- Use `./cli govern review --json` to inspect repeated decisions/skills worth promoting.

Optional e2e checks:

```bash
bash scripts/test-smoke.sh
bash scripts/test-mcp-e2e.sh
```
