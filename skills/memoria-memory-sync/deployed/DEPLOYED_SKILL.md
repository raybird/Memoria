---
name: memoria
description: Use before starting work on an issue or feature, after making a decision with a reason or hitting a pitfall, after a merge to the main branch or a release, and when asked how or why something was decided before — reads and writes Memoria cross-session memory (recall, feedback, remember, repo sync and merge-summary write-back), and sets up memory for a folder that has none yet.
license: MIT
compatibility: Designed for filesystem-based coding agents with bash access. Requires Node.js >=18.
version: "1.33.0"
deployment_mode: installed
repository: Memoria
---

# Memoria Memory

**You have a persistent memory.** Memoria keeps decisions, pitfalls and merge history across conversations. Two things stay separate:

- **Runtime** = the Memoria program, reached through `bin/memoria` next to this file.
- **Data root (`MEMORIA_HOME`)** = the memory itself (`.memory/`, `knowledge/`, `configs/`).

## Locate your data root (do this first)

```bash
SKILL_ROOT="<the directory containing this SKILL.md>"
MEMORIA_HOME="${MEMORIA_HOME:-$(cat "$SKILL_ROOT/DATA_ROOT")}"
MEMORIA_BIN="$SKILL_ROOT/bin/memoria"
```

An exported `MEMORIA_HOME` wins: that is a shared home the user chose on purpose. Otherwise `DATA_ROOT` holds the data root `memoria setup` deployed this copy for. Pass `MEMORIA_HOME` explicitly on every command below — without it Memoria falls back to the saved global setting or the runtime root and your writes can land in the wrong place. When semantic recall was enabled for that data root during `memoria setup`, `MEMORIA_BIN` automatically attaches its local vector store (`file:<MEMORIA_HOME>/.memory/vectors.db`).

`<repo>` below is always a name from `"$MEMORIA_BIN" repo list`. A `--project` that names no registered repository files the memory as environment-wide, and it then appears in every project's brief.

## Check it is ready before writing (fail closed)

```bash
MEMORIA_HOME="$MEMORIA_HOME" "$MEMORIA_BIN" doctor --json
```

- `homeSource` is `"fallback"`, or the `sessions.db` check is `ok:false` → this data root has no memory yet. Go to "Set up a folder" and write nothing until it passes.
- Every check `ok:true` → ready. A failing check carries a `fix` string; follow it.

## When to use it

### Before starting an issue or feature — recall

```bash
MEMORIA_HOME="$MEMORIA_HOME" "$MEMORIA_BIN" recall "<issue id or topic>" --mode vector --project <repo>
```

`--mode vector` fuses semantic and lexical hits; the default keyword mode misses anything phrased differently. Without a vector index it falls back to lexical on its own (`route_mode: vector_unavailable`). Keep the `recall_id` from the output for feedback.

Done when: the relevant decisions and pitfalls among the hits are reflected in your plan or answer. No hits also counts.

### After using (or ruling out) recall results — feedback

```bash
MEMORIA_HOME="$MEMORIA_HOME" "$MEMORIA_BIN" feedback <recall_id> --score <0..1> --used --hits <comma-separated hit ids>
```

If nothing helped, report `--score 0` without `--used`. This is the only utility signal Memoria gets; ranking adapts to it.

Done when: every `recall_id` from this session has been reported once.

### After a decision with a reason, or a pitfall — remember

```bash
MEMORIA_HOME="$MEMORIA_HOME" "$MEMORIA_BIN" remember "<one-sentence fact>" --project <repo> --rationale "<why>"
```

Worth remembering is what the code and git history cannot tell: the reason behind a trade-off, a pitfall found by checking, a premise that turned out wrong.

- `--durable` for a constraint that must not fade; it is pinned in the brief.
- `--supersedes <old id>` corrects an older memory (the id comes from a recall hit); the old one leaves recall and the brief.

Done when: the text makes sense on its own outside this conversation and includes the why.

### After a merge to the main branch or a release — repo sync and the merge summary

1. `MEMORIA_HOME="$MEMORIA_HOME" "$MEMORIA_BIN" repo sync <repo>` (register a new repository first with `repo add <path>`).
2. `MEMORIA_HOME="$MEMORIA_HOME" "$MEMORIA_BIN" repo summarize <repo> --merge <merge sha> --json` returns the summary sync created for that merge (`data.summaries[0].id`). Status already `enriched` means someone wrote it; you are done.
3. Write the payload described in `REFERENCE.md` from the work you just did, then:
   ```bash
   MEMORIA_HOME="$MEMORIA_HOME" "$MEMORIA_BIN" repo summarize <repo> --submit <summary id> --file <payload.json> --json
   ```

Sync also creates pending skeletons for other people's merges and releases. Write back only your own; after that, `repo summarize <repo> --dismiss-pending --type merge,release` clears the rest from the brief's pending count without putting them into recall.

Done when: the `--json` submit result shows `status: enriched` and `promoted: true`.

### Wrap-up — once per session that ran remember or repo sync

1. `MEMORIA_HOME="$MEMORIA_HOME" "$MEMORIA_BIN" doctor` — when `vector coverage` shows `missing` above 0, run the fix it prints. The tree index updates itself; the vector index does not, and a memory missing from it is invisible to semantic recall without any error.
2. Regenerate the brief your agent instructions load: `brief --global` for one global `BRIEF.md`, or `brief` inside a registered repository for its `BRIEF-<repo>.md`.

3. For a new integration, follow the output: shared read instructions go in the project's `AGENTS.md`; Claude's `CLAUDE.md` imports `@AGENTS.md` and the generated brief. Keep the shared read instruction even when your host does not expand `@` imports.

Done when: `vector coverage` shows `missing=0` (or vector recall is disabled), the brief's first line carries a timestamp from just now, and the consuming project's instructions point to that brief.

## Set up a folder

When the current folder has no memory yet, give it its own data root:

```bash
"$MEMORIA_BIN" setup --memoria-home "$(pwd)/memoria"
```

Then re-run `doctor --json` against it: `homeSource` is no longer `fallback` and `sessions.db` is `ok:true`. `memoria setup --agent both` (or `--agent claude-code` / `--agent codex`) additionally installs this skill into `~/.claude/skills/memoria` and `~/.codex/skills/memoria` (or `$CODEX_HOME/skills/memoria`), bound to that data root; an existing deployed copy is backed up under `<data root>/.agents/skill-backups/` first.

## Path & Safety Rules

- Use absolute paths for session, source and payload files.
- Keep Memoria SQLite as the source of truth even when MCP enhancement is enabled.
- Leave the deployed skill files as they are during normal memory operations; `memoria setup` rewrites them.

## Troubleshooting

- `doctor` shows `homeSource: fallback` → the data root was never set up; run the setup step.
- `bin/memoria` missing → rerun `memoria setup` for the same data root.
- `recall --mode vector` reports `vector_timeout` → usually a cold start; the next call is warm.

## See Also

- `REFERENCE.md` — summary payload format, command map, deployed layout
- `resources/mcp/INGEST_PLAYBOOK.md`
