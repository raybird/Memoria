---
name: memoria-memory-sync
description: Runtime-safe Memoria skill for installed agents. Use it to initialize memory, sync session JSON, inspect runtime health, build wiki outputs, and optionally run MCP enhancement flows without assuming a cloned repo.
license: MIT
compatibility: Designed for filesystem-based coding agents with bash access. Requires Node.js >=18.
version: "1.8.0"
deployment_mode: installed
repository: Memoria
---

# Memoria Memory Sync

Use this deployed skill when Memoria has already been installed and the agent needs a runtime-safe way to work with persistent memory from `<memoria-home>/.agents/memoria-memory-sync`.

## Activation Signals

- "sync memory", "import session json", or "persist this conversation"
- "init memoria", "set up memory folders", or "create sessions.db"
- "show memory stats", "doctor", "verify", or "wiki build"
- "run MCP enhancement" or "sync to libSQL"

## Installed Mode Quickstart

Assume:

- skill root: `<memoria-home>/.agents/memoria-memory-sync`
- local wrapper: `<skill-root>/bin/memoria`
- data root: `<memoria-home>`

Run the shortest safe flow like this:

```bash
SKILL_ROOT="<memoria-home>/.agents/memoria-memory-sync"
MEMORIA_BIN="$SKILL_ROOT/bin/memoria"
MEMORIA_HOME="<memoria-home>"

"$MEMORIA_BIN" init
"$MEMORIA_BIN" sync /absolute/path/to/session.json
"$MEMORIA_BIN" stats
```

## Path Rules

- Prefer `bin/memoria` from this deployed skill.
- You may override the binary with `MEMORIA_BIN` if another launcher is required.
- Use absolute session file paths when possible.
- Keep runtime install location and `MEMORIA_HOME` separate.
- Do not assume a cloned repo is available.

## Common Commands

```bash
MEMORIA_HOME="<memoria-home>" "$MEMORIA_BIN" doctor
MEMORIA_HOME="<memoria-home>" "$MEMORIA_BIN" verify
MEMORIA_HOME="<memoria-home>" "$MEMORIA_BIN" wiki build
MEMORIA_HOME="<memoria-home>" "$MEMORIA_BIN" wiki lint --json
MEMORIA_HOME="<memoria-home>" "$MEMORIA_BIN" source add /absolute/path/to/note.md
```

Helper runners shipped with this deployed skill:

```bash
MEMORIA_BIN="$SKILL_ROOT/bin/memoria" bash "$SKILL_ROOT/scripts/run-sync.sh" /absolute/path/to/session.json "<memoria-home>"
MEMORIA_BIN="$SKILL_ROOT/bin/memoria" bash "$SKILL_ROOT/scripts/run-sync-with-enhancement.sh" /absolute/path/to/session.json "<memoria-home>"
```

## Safe Operating Rules

- Prefer `MEMORIA_HOME="<memoria-home>"` explicitly in automation.
- Do not rewrite deployed skill files during normal memory operations.
- Keep Memoria SQLite as source of truth even when MCP enhancement is enabled.
- Use `verify` or `doctor` before assuming a path or database issue is inside the session payload.

## Troubleshooting

- If `bin/memoria` is missing, rerun `memoria setup` for the same `MEMORIA_HOME`.
- If sync fails, confirm the session JSON path exists and is readable.
- If MCP enhancement fails, retry the base sync first, then inspect `LIBSQL_URL`, `MEMORIA_MCP_SERVER_COMMAND`, and `MEMORIA_MCP_SERVER_ARGS`.
- If paths look wrong, run `doctor --json` with the same `MEMORIA_HOME` the automation will use.

## See Also

- `REFERENCE.md`
- `resources/mcp/INGEST_PLAYBOOK.md`
