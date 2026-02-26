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
```

## Hybrid MCP Workflow

```bash
export LIBSQL_URL="file:/path/to/memory-tool.db"
bash skills/memoria-memory-sync/scripts/run-sync-with-enhancement.sh examples/session.sample.json
```

## Integration Strategy

- Tight coupling: run the hybrid script in your agent's after-response hook (near real-time).
- Async batch: run the same script on a scheduler for high-throughput environments.
- Prefer tight coupling first; switch to batch when latency isolation or scale requires it.

Optional e2e checks:

```bash
bash scripts/test-smoke.sh
bash scripts/test-mcp-e2e.sh
```
