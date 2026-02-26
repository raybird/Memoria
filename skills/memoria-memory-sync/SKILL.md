---
name: memoria-memory-sync
description: Initialize, sync, and inspect Memoria persistent memory data from exported AI session JSON files. Use when the user wants cross-session memory persistence, markdown knowledge outputs, memory health checks, or optional MCP/libSQL memory evolution.
license: MIT
compatibility: Designed for filesystem-based coding agents with bash access. Requires Node.js >=18 and pnpm.
metadata:
  owner: raybird
  version: "1.0"
  repository: Memoria
---

# Memoria Memory Sync

Use this skill when the task is about importing AI session exports into Memoria, generating durable notes, checking memory health, or extending memory behavior with optional MCP/libSQL workflows.

## Activation Signals

Activate this skill when user intent includes any of:

- "sync memory", "import session json", or "persist this conversation"
- "init memoria", "create sessions.db", or "set up memory folders"
- "show memory stats", "doctor", or runtime health checks
- "I want AI memory to evolve" with semantic/vector capability (optional MCP mode)

## Core Outcomes

This skill should deliver these outcomes:

1. Session data imported into `.memory/sessions.db`
2. Knowledge markdown generated in `knowledge/Daily`, `knowledge/Decisions`, and `knowledge/Skills`
3. Health and consistency checks completed (`stats`, `doctor`, smoke test when needed)

## Standard Workflow

1. Install deps if needed:

```bash
pnpm install
```

2. Initialize Memoria directories and database:

```bash
MEMORIA_HOME=$(pwd) ./cli init
```

3. Sync a session export:

```bash
MEMORIA_HOME=$(pwd) ./cli sync examples/session.sample.json
```

4. Inspect memory state:

```bash
MEMORIA_HOME=$(pwd) ./cli stats
MEMORIA_HOME=$(pwd) ./cli doctor
MEMORIA_HOME=$(pwd) ./cli verify
MEMORIA_HOME=$(pwd) ./cli index build
```

Optional skill validation (if `skills-ref` is installed):

```bash
skills-ref validate skills/memoria-memory-sync
```

## Single-Test Guidance

The repo has two explicit test scripts:

```bash
bash scripts/test-smoke.sh
bash scripts/test-mcp-e2e.sh
```

For focused manual verification:

```bash
TMP=$(mktemp -d)
MEMORIA_HOME="$TMP" ./cli init
MEMORIA_HOME="$TMP" ./cli sync examples/session.sample.json
```

## Safe Operating Rules

- Preserve existing CLI command names: `init`, `sync`, `stats`, `doctor`
- Keep current DB table names and columns unless user asks for migrations
- Validate external JSON input before persistence
- Use deterministic, sanitized filenames for markdown output
- Keep changes minimal; avoid introducing new dependencies by default

## Complementary Hybrid Mode (Recommended)

Yes: Memoria and MCP/libSQL can be designed to reinforce each other.

Use this dual-layer model:

- Layer 1 (Memoria): deterministic local truth for sessions/events/markdown artifacts
- Layer 2 (MCP/libSQL): semantic retrieval, graph relations, and vector-style memory evolution

Operating order:

1. Run normal Memoria sync first (durability-first)
2. Run optional MCP enhancement second (semantic enrichment)
3. Keep local outputs as source of truth for audit/debug
4. Treat MCP as additive index, not replacement storage

Environment gates:

- `LIBSQL_URL`
- `LIBSQL_AUTH_TOKEN` (for remote libSQL)
- Optional orchestration command: `MEMORIA_MCP_ENHANCE_CMD`
- Generated payload env: `MEMORIA_MCP_PAYLOAD`
- Generated request env: `MEMORIA_MCP_REQUESTS`
- Optional MCP server override: `MEMORIA_MCP_SERVER_COMMAND`, `MEMORIA_MCP_SERVER_ARGS`
- MCP failure policy: `MEMORIA_MCP_STRICT` (`1` fail-fast, `0` continue)
- Incremental MCP cursor target: `MEMORIA_MCP_SYNC_TARGET`
- MCP payload mode: `MEMORIA_MCP_PAYLOAD_MODE` (`incremental` default, `full` optional)

Use helper script for this pattern:

```bash
bash skills/memoria-memory-sync/scripts/run-sync-with-enhancement.sh examples/session.sample.json
```

Example MCP server config (from `mcp-memory-libsql` style):

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

Template files (ts-cli-skill style resources):

- `resources/mcp/gemini-cli.mcp.json`
- `resources/mcp/opencode.mcp.json`
- `resources/mcp/INGEST_PLAYBOOK.md`

Expected behavior:

- If `LIBSQL_URL` is set: bridge payload is generated from Memoria DB (incremental by default)
- Tool-ready request bundle is generated as `MEMORIA_MCP_REQUESTS`
- If `MEMORIA_MCP_ENHANCE_CMD` is set: run that command
- If command is not set: auto-run built-in ingest script against `mcp-memory-libsql`
- On successful ingest: sync cursor is committed to `memory_sync_state`
- If MCP env is missing: base sync still succeeds and enhancement is skipped

Failure semantics:

- Base sync completes before enhancement starts.
- In strict mode (`MEMORIA_MCP_STRICT=1`), enhancement failure returns non-zero exit.
- In non-strict mode (`MEMORIA_MCP_STRICT=0`), enhancement failure is logged and workflow continues.

## References

- Detailed operational guidance: `references/REFERENCE.md`
- Helper command wrapper: `scripts/run-sync.sh`
- Hybrid wrapper (base + optional MCP): `scripts/run-sync-with-enhancement.sh`
- Bridge payload builder: `scripts/build-mcp-bridge-payload.mjs`
- MCP tool request builder: `scripts/build-mcp-tool-requests.mjs`
- MCP auto-ingest runner: `scripts/ingest-mcp-libsql.mjs`
- MCP config templates: `resources/mcp/*.json`
- Ingest guide template: `resources/mcp/INGEST_PLAYBOOK.md`
- Session JSON starter template: `assets/session.template.json`
