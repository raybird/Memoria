# MCP / libSQL Integration

Memoria uses a dual-layer model:

- Memoria (SQLite + markdown) = source of truth
- `mcp-memory-libsql` = semantic enhancement layer

## What It Does

Hybrid flow (`run-sync-with-enhancement.sh`) performs:

1. `init/sync/stats`
2. Bridge payload generation (`.memory/exports/mcp-bridge/`)
3. MCP request bundle generation
4. Auto-ingest to `mcp-memory-libsql`

## Basic Usage

```bash
export LIBSQL_URL="file:/path/to/memory-tool.db"
bash skills/memoria-memory-sync/scripts/run-sync-with-enhancement.sh examples/session.sample.json
```

## MCP Templates

- Gemini CLI: `skills/memoria-memory-sync/resources/mcp/gemini-cli.mcp.json`
- OpenCode: `skills/memoria-memory-sync/resources/mcp/opencode.mcp.json`
- Playbook: `skills/memoria-memory-sync/resources/mcp/INGEST_PLAYBOOK.md`

## Failure Policy

Strict mode (default):

```bash
export MEMORIA_MCP_STRICT=1
```

Non-strict mode (log and continue):

```bash
export MEMORIA_MCP_STRICT=0
```

## End-to-End Check

```bash
bash scripts/test-mcp-e2e.sh
```
