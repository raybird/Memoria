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
```

## Single-Test Guidance

The repo has one explicit test script:

```bash
bash scripts/test-smoke.sh
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

Use helper script for this pattern:

```bash
bash skills/memoria-memory-sync/scripts/run-sync-with-enhancement.sh examples/session.sample.json
```

Expected behavior:

- If MCP env/command is configured: run enhancement after base sync
- If not configured: base sync still succeeds and enhancement is skipped

## References

- Detailed operational guidance: `references/REFERENCE.md`
- Helper command wrapper: `scripts/run-sync.sh`
- Hybrid wrapper (base + optional MCP): `scripts/run-sync-with-enhancement.sh`
- Session JSON starter template: `assets/session.template.json`
