# MCP / libSQL Integration

Memoria uses a dual-layer model:

- Memoria (SQLite + markdown) = source of truth
- `mcp-memory-libsql` = semantic enhancement layer

## Is MCP Required?

No. In v1.3.0, MCP/libSQL is still optional.

- Without MCP/libSQL: Memoria core features remain fully available (sync, index, recall, stats, telemetry).
- With MCP/libSQL: you gain external graph projection and cross-agent semantic enrichment.

Think of MCP/libSQL as an add-on index layer, not a replacement datastore.

## Decision Guide

Choose your deployment mode based on workload:

- Use **Memoria-only** when you need simple, local, auditable memory with minimal ops overhead.
- Enable **Memoria + MCP/libSQL** when you need cross-agent graph sharing, external semantic traversal, or multi-node memory projection.

Practical defaults:

- Start with Memoria-only in development and early production.
- Add MCP/libSQL when retrieval complexity or collaboration scope grows.
- Keep Memoria SQLite as source-of-truth in both modes.

## What It Does

Hybrid flow (`run-sync-with-enhancement.sh`) performs:

1. `init/sync/stats`
2. Bridge payload generation (`.memory/exports/mcp-bridge/`)
3. MCP request bundle generation
4. Auto-ingest to `mcp-memory-libsql`
5. Commit incremental sync cursor to Memoria SQLite

## Incremental Tree Sync

- Memoria tracks MCP sync cursor in `memory_sync_state` (target: `mcp-memory-libsql`).
- Bridge payload includes only tree nodes with `updated_at > cursor_updated_at`.
- After successful ingest, `update-mcp-sync-state.mjs` advances cursor and marks `memory_nodes.last_synced_at`.
- Default payload mode is `incremental` (tree delta + affected sessions only).

Disable/override target name:

```bash
export MEMORIA_MCP_SYNC_TARGET="mcp-memory-libsql"
```

Optional payload mode override:

```bash
# default
export MEMORIA_MCP_PAYLOAD_MODE="incremental"

# legacy full payload (session/events/skills + tree)
export MEMORIA_MCP_PAYLOAD_MODE="full"
```

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
