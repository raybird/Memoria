# Memoria Skill Reference

This reference supports `SKILL.md` for deeper implementation details.

## Repository Facts

- Runtime: TypeScript CLI (`src/cli.ts`)
- Package manager: `pnpm`
- DB: SQLite via `better-sqlite3`
- Validation: `zod`
- Canonical CI: `.github/workflows/ci.yml`

## Commands and Intent

- Install dependencies:
  - `pnpm install`
- Type check:
  - `pnpm run check`
- Initialize base folders + DB:
  - `MEMORIA_HOME=$(pwd) ./cli init`
- Import and sync one session:
  - `MEMORIA_HOME=$(pwd) ./cli sync <session.json>`
- Preview sync only:
  - `MEMORIA_HOME=$(pwd) ./cli sync --dry-run <session.json>`
- Show aggregate stats:
  - `MEMORIA_HOME=$(pwd) ./cli stats`
- Run environment health checks:
  - `MEMORIA_HOME=$(pwd) ./cli doctor`
- Run runtime/schema verification:
  - `MEMORIA_HOME=$(pwd) ./cli verify`
  - `MEMORIA_HOME=$(pwd) ./cli verify --json`
- Build incremental tree index:
  - `MEMORIA_HOME=$(pwd) ./cli index build`
- Query recall routing telemetry API:
  - `curl -sS "http://localhost:3917/v1/telemetry/recall?window=P7D&limit=50"`

Skill validation (if available):

- `skills-ref validate skills/memoria-memory-sync`

## CI Parity Checklist

Run in this order when making behavior changes:

1. `pnpm install`
2. `pnpm run check`
3. `pnpm run build`
4. `node dist/cli.mjs --help`
5. `bash -n install.sh`
6. `bash scripts/test-smoke.sh`
7. `bash scripts/test-mcp-e2e.sh`

## Single-Test Focus

This repository currently has two explicit test scripts:

- `bash scripts/test-smoke.sh`
- `bash scripts/test-mcp-e2e.sh`

No Jest/Vitest/Pytest suite is configured.

## Data Model Notes

Current database tables:

- `sessions`
- `events`
- `skills`
- `memory_nodes`
- `memory_node_sources`
- `memory_sync_state`
- `recall_telemetry`

Current write semantics use `INSERT OR REPLACE`. Preserve unless requested.

## Output Contracts

- Daily notes: `knowledge/Daily/YYYY-MM-DD.md`
- Decision docs: `knowledge/Decisions/*.md`
- Skill docs: `knowledge/Skills/*.md`

When modifying sync logic:

- Keep deterministic filenames and content sections
- Preserve UTF-8 text output
- Avoid breaking links between session/event metadata and markdown

## Error Handling Expectations

- Invalid JSON input should fail with clear user-facing error
- Schema validation should report actionable field-level issues
- DB lifecycle should always close connections (`try/finally`)
- CLI should terminate with non-zero exit on fatal failure

## Optional MCP/libSQL Integration Pattern

If user asks to evolve memory semantics with MCP/libSQL:

- Treat libSQL as optional enhancement path
- Keep existing local SQLite sync functional as default path
- Add integration behind explicit config and guardrails
- Document required env vars and network assumptions
- Do not silently change persistence backend

Recommended staged rollout:

1. Adapter boundary around persistence/search operations
2. Feature flag for libSQL mode
3. Optional semantic retrieval tools
4. Extra verification for backward compatibility

## Complementary Strategy (How both systems help each other)

Use this architecture when user wants memory to "evolve" without losing reliability:

- Memoria tracks canonical event history and markdown outputs
- MCP/libSQL provides semantic indexing and relationship traversal

Practical split of responsibility:

- Memoria answers: "What exactly happened?"
- MCP/libSQL answers: "What is similar or related?"

Golden rule:

- Persist first, enrich second

This avoids data loss risk while still enabling advanced retrieval.

Suggested runtime pattern:

1. `./cli sync <session.json>`
2. Build bridge payload: `node skills/memoria-memory-sync/scripts/build-mcp-bridge-payload.mjs --memoria-home <path>`
3. Optional enhancement command if `LIBSQL_URL` is set
4. Report enhancement status explicitly (ran/skipped/failed)

Helper wrapper in this skill:

- `scripts/run-sync-with-enhancement.sh`
- `scripts/build-mcp-tool-requests.mjs`
- `scripts/ingest-mcp-libsql.mjs`

Bridge payload contract:

- Output file is JSON with `entities` and `relations`
- Payload path is exposed as `MEMORIA_MCP_PAYLOAD`
- Default location: `.memory/exports/mcp-bridge/`

MCP request bundle contract:

- Output file includes `create_entities`, `create_relations`, and verify requests
- File path is exposed as `MEMORIA_MCP_REQUESTS`
- Designed to match `mcp-memory-libsql` tool names and argument shape
- Includes `_meta.sync` for incremental cursor/debug context

Example MCP server config:

```json
{
  "mcpServers": {
    "mcp-memory-libsql": {
      "command": "npx",
      "args": ["-y", "mcp-memory-libsql"],
      "env": {
        "LIBSQL_URL": "file:/path/to/your/database.db"
      }
    }
  }
}
```

Client templates in this skill:

- Gemini CLI: `resources/mcp/gemini-cli.mcp.json`
- OpenCode: `resources/mcp/opencode.mcp.json`

These are intentionally template-first (similar to `ts-cli-skill` resource pattern):

- keep reusable config skeletons in `resources/`
- keep runtime orchestration in `scripts/`
- keep reasoning and constraints in `SKILL.md` and `references/`

Example enhancement command:

```bash
export LIBSQL_URL="libsql://your-db.turso.io"
export LIBSQL_AUTH_TOKEN="your-token"
export MEMORIA_MCP_ENHANCE_CMD='cat "$MEMORIA_MCP_PAYLOAD" | your-ingest-command'
bash skills/memoria-memory-sync/scripts/run-sync-with-enhancement.sh examples/session.sample.json
```

Automatic mode (no custom command):

- If `LIBSQL_URL` is set and `MEMORIA_MCP_ENHANCE_CMD` is not set,
  `run-sync-with-enhancement.sh` auto-runs `scripts/ingest-mcp-libsql.mjs`.
- Default server launch is equivalent to:
  - command: `npx`
  - args: `-y mcp-memory-libsql`
- Override with:
  - `MEMORIA_MCP_SERVER_COMMAND`
  - `MEMORIA_MCP_SERVER_ARGS`
- Incremental sync controls:
  - `MEMORIA_MCP_SYNC_TARGET` (cursor namespace)
  - `MEMORIA_MCP_PAYLOAD_MODE` (`incremental` default, `full` optional)
- Failure policy:
  - `MEMORIA_MCP_STRICT=1` (default): fail fast on MCP ingest errors
  - `MEMORIA_MCP_STRICT=0`: continue after logging MCP ingest failure

If your agent can call MCP tools directly, use `MEMORIA_MCP_REQUESTS` as the argument source:

1. Read `create_entities` from the request bundle and call `create_entities`
2. Read `create_relations` and call `create_relations`
3. Optionally call `read_graph` or `search_nodes` for verification
