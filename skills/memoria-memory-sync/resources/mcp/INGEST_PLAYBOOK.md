# MCP Ingest Playbook

Use this after running:

```bash
LIBSQL_URL="file:/path/to/memory-tool.db" bash skills/memoria-memory-sync/scripts/run-sync-with-enhancement.sh examples/session.sample.json
```

By default, this command now performs automatic MCP ingestion using:

- `npx -y mcp-memory-libsql`

You only need manual tool calls if you want custom orchestration.

The script exports:

- `MEMORIA_MCP_REQUESTS`: tool-ready request bundle path
- `MEMORIA_MCP_PAYLOAD`: bridge payload path (contains incremental sync metadata)

## Tool Calls (mcp-memory-libsql)

1. Load `MEMORIA_MCP_REQUESTS` JSON.
2. Call tool `create_entities` with payload at `.create_entities`.
3. Call tool `create_relations` with payload at `.create_relations`.
4. Optional verification:
   - `read_graph` with `.verify.read_graph`
- `search_nodes` with `.verify.search_nodes`

## Automatic runner

Built-in runner:

```bash
node skills/memoria-memory-sync/scripts/ingest-mcp-libsql.mjs --requests "$MEMORIA_MCP_REQUESTS"
node skills/memoria-memory-sync/scripts/update-mcp-sync-state.mjs --payload "$MEMORIA_MCP_PAYLOAD"
```

`run-sync-with-enhancement.sh` executes both steps automatically on success.

Override MCP launch command if needed:

```bash
export MEMORIA_MCP_SERVER_COMMAND="npx"
export MEMORIA_MCP_SERVER_ARGS="-y mcp-memory-libsql"
```

Failure policy:

```bash
# default: enhancement fail -> non-zero exit
export MEMORIA_MCP_STRICT=1

# optional: enhancement fail -> warning and continue
export MEMORIA_MCP_STRICT=0
```

Payload mode:

```bash
# default: send tree delta + affected sessions only
export MEMORIA_MCP_PAYLOAD_MODE=incremental

# optional: send legacy full payload
export MEMORIA_MCP_PAYLOAD_MODE=full
```

## Notes

- Entity `name` values come from Memoria IDs and are treated as unique keys.
- Relations use `{ source, target, type }` mapped from Memoria graph edges.
- Keep Memoria SQLite as source-of-truth; libSQL graph is enrichment index.
- Incremental cursor lives in `memory_sync_state.cursor_updated_at`.
- Payload metadata includes `payload_mode` and `sync.affected_session_ids`.
