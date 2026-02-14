# Memoria Specification (Implemented)

This document is the source of truth for what Memoria currently implements.

## Implemented Scope

- TypeScript CLI commands:
  - `init`
  - `sync` (`--dry-run`)
  - `stats`
  - `doctor`
  - `verify` (`--json`)
  - `prune`
  - `export`
- SQLite persistence (`sessions`, `events`, `skills`)
- Markdown sync outputs:
  - `knowledge/Daily/`
  - `knowledge/Decisions/`
  - `knowledge/Skills/`
- Path overrides via environment variables:
  - `MEMORIA_DB_PATH`
  - `MEMORIA_SESSIONS_PATH`
  - `MEMORIA_CONFIG_PATH`
- Deterministic fallback IDs for idempotent re-sync behavior
- Optional MCP/libSQL enhancement flow:
  - bridge payload generation
  - request bundle generation
  - auto-ingest with strict/non-strict mode

## Validation Commands

```bash
pnpm run check
pnpm run build
node dist/cli.mjs --help
bash scripts/test-smoke.sh
bash scripts/test-mcp-e2e.sh
```

## Out of Scope (Current)

- Built-in context condensation engine
- Built-in semantic/vector retrieval engine inside Memoria core
- First-party OpenCode plugin implementation

Those items are tracked in planning docs (`RFC.md`, legacy spec notes).
