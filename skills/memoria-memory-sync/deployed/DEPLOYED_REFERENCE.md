# Memoria Deployed Skill Reference

This reference is for installed mode after `memoria setup` has deployed the skill into `<memoria-home>/.agents/memoria-memory-sync`.

## Runtime Assumptions

- `MEMORIA_HOME` is the data root.
- The deployed skill lives at `<memoria-home>/.agents/memoria-memory-sync`.
- The preferred runtime entrypoint is `<skill-root>/bin/memoria`.
- The deployed scripts are expected to run without a cloned repo.

## Layout Contract

Expected deployed layout:

```text
<memoria-home>/.agents/memoria-memory-sync/
  SKILL.md
  REFERENCE.md
  bin/memoria
  scripts/run-sync.sh
  scripts/run-sync-with-enhancement.sh
  resources/mcp/INGEST_PLAYBOOK.md
```

## Command Mapping

Use the local wrapper for all core operations:

```bash
MEMORIA_HOME="<memoria-home>" "$MEMORIA_BIN" init
MEMORIA_HOME="<memoria-home>" "$MEMORIA_BIN" sync /absolute/path/to/session.json
MEMORIA_HOME="<memoria-home>" "$MEMORIA_BIN" stats
MEMORIA_HOME="<memoria-home>" "$MEMORIA_BIN" doctor
MEMORIA_HOME="<memoria-home>" "$MEMORIA_BIN" verify
MEMORIA_HOME="<memoria-home>" "$MEMORIA_BIN" index build
MEMORIA_HOME="<memoria-home>" "$MEMORIA_BIN" wiki build
MEMORIA_HOME="<memoria-home>" "$MEMORIA_BIN" wiki lint --json
```

## Helper Runners

- Base workflow:

```bash
MEMORIA_BIN="$SKILL_ROOT/bin/memoria" bash "$SKILL_ROOT/scripts/run-sync.sh" /absolute/path/to/session.json "<memoria-home>"
```

- MCP-enhanced workflow:

```bash
MEMORIA_BIN="$SKILL_ROOT/bin/memoria" bash "$SKILL_ROOT/scripts/run-sync-with-enhancement.sh" /absolute/path/to/session.json "<memoria-home>"
```

## MCP Notes

- `LIBSQL_URL` enables enhancement mode.
- The helper runner will perform normal Memoria sync first, then MCP ingestion.
- Use `resources/mcp/INGEST_PLAYBOOK.md` for environment and failure-policy details.

## Debugging Notes

- Use `doctor --json` to confirm resolved paths.
- Use `verify --json` to confirm database and writeability checks.
- If wrapper execution fails, verify `bin/memoria` is executable and points at a valid Memoria runtime.
