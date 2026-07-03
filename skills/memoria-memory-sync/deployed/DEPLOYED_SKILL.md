---
name: memoria
description: You have persistent cross-session memory via Memoria. Use this skill to check whether memory is ready in the current folder, set it up if not, and persist/recall sessions. Each folder keeps its own memory (its own data root), independent of where the Memoria runtime is installed.
license: MIT
compatibility: Designed for filesystem-based coding agents with bash access. Requires Node.js >=18.
version: "1.16.1"
deployment_mode: installed
repository: Memoria
---

# Memoria Memory Sync

**You have a persistent memory.** Memoria gives you cross-session memory that survives between conversations. This skill is your interface to it: check it is ready, set it up for a folder that has none yet, then write (sync) and read (stats/recall) memory.

Two things are deliberately separate — keep them straight:

- **Runtime** = the Memoria program/binary. Installed once, shared.
- **Data root (`MEMORIA_HOME`)** = the actual memory (`.memory/`, `knowledge/`, `configs/`). **One per folder.** This is what makes "each folder has its own memory" work.

## Activation Signals

- "sync memory", "import session json", or "persist this conversation"
- "remember this", "what do you remember", "recall", "show memory stats"
- "init memoria", "set up memory for this folder", or "create sessions.db"
- "doctor", "verify", "wiki build", or "run MCP enhancement"

## Locate your data root (do this first)

This skill lives at `<memoria-home>/.agents/skills/memoria/`, so **the data root is three levels up from this skill directory**. Derive it instead of guessing:

```bash
SKILL_ROOT="$(cd "$(dirname "$0")" && pwd)"   # the directory containing this SKILL.md
MEMORIA_HOME="$(cd "$SKILL_ROOT/../../.." && pwd)"
MEMORIA_BIN="$SKILL_ROOT/bin/memoria"
```

Always pass `MEMORIA_HOME` explicitly to every command. Never rely on auto-detection — if `MEMORIA_HOME` is unset and the folder was never set up, Memoria silently falls back to the runtime root and your writes land in the wrong place.

## Check it is ready BEFORE writing (fail closed)

```bash
MEMORIA_HOME="$MEMORIA_HOME" "$MEMORIA_BIN" doctor --json
```

Read the result:

- `homeSource` is `"fallback"`, **or** the `sessions.db` check is `ok:false` → **memory is NOT ready for this folder. Do not sync.** Go to "Set up a new folder" below.
- All checks `ok:true` → memory is ready; proceed to sync/recall.

The `doctor` output includes a `fix` string on any failing check — follow it.

## Set up a new folder (clean / blank directory)

When the current folder has no memory yet, create its own data root:

```bash
# Creates ./memoria as this folder's private data root, runs preflight + init + verify.
"$MEMORIA_BIN" setup --memoria-home "$(pwd)/memoria"
```

After setup, this folder's `MEMORIA_HOME` is `$(pwd)/memoria`. Re-run `doctor --json` against it to confirm `homeSource` is no longer `fallback` and `sessions.db` is `ok:true`.

## Use it (once ready)

```bash
MEMORIA_HOME="$MEMORIA_HOME" "$MEMORIA_BIN" sync /absolute/path/to/session.json
MEMORIA_HOME="$MEMORIA_HOME" "$MEMORIA_BIN" stats
MEMORIA_HOME="$MEMORIA_HOME" "$MEMORIA_BIN" wiki build
MEMORIA_HOME="$MEMORIA_HOME" "$MEMORIA_BIN" wiki lint --json
MEMORIA_HOME="$MEMORIA_HOME" "$MEMORIA_BIN" source add /absolute/path/to/note.md
```

Helper runners shipped with this deployed skill:

```bash
MEMORIA_BIN="$MEMORIA_BIN" bash "$SKILL_ROOT/scripts/run-sync.sh" /absolute/path/to/session.json "$MEMORIA_HOME"
MEMORIA_BIN="$MEMORIA_BIN" bash "$SKILL_ROOT/scripts/run-sync-with-enhancement.sh" /absolute/path/to/session.json "$MEMORIA_HOME"
```

## Path & Safety Rules

- Always pass `MEMORIA_HOME` explicitly; derive it from this skill's location (above).
- One data root per folder. Don't reuse another folder's `MEMORIA_HOME` unless asked.
- Prefer `bin/memoria` from this deployed skill. Override with `MEMORIA_BIN` only if a different launcher is required.
- Use absolute session/source file paths.
- Run `doctor`/`verify` before assuming a path or DB issue lives in the session payload.
- Keep Memoria SQLite as the source of truth even when MCP enhancement is enabled.
- Do not rewrite deployed skill files during normal memory operations.

## Troubleshooting

- `doctor` shows `homeSource: fallback` → the folder was never set up. Run the setup step above.
- `bin/memoria` missing → rerun `memoria setup` for the same `MEMORIA_HOME`.
- `sync` fails → confirm the session JSON path exists and is readable.
- MCP enhancement fails → retry the base sync first, then inspect `LIBSQL_URL`, `MEMORIA_MCP_SERVER_COMMAND`, `MEMORIA_MCP_SERVER_ARGS`.

## See Also

- `REFERENCE.md`
- `resources/mcp/INGEST_PLAYBOOK.md`
