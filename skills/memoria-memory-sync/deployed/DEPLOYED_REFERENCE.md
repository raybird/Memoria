# Memoria Deployed Skill Reference

This reference is for installed mode, after `memoria setup` has deployed the skill.

## Layout Contract

`memoria setup` always deploys to `<memoria-home>/.agents/skills/memoria/`, the one real copy. `--agent claude-code`, `--agent codex`, or `--agent both` also points `~/.claude/skills/memoria/` and/or `~/.codex/skills/memoria/` (`$CODEX_HOME/skills/memoria/` when `CODEX_HOME` is set), where those host agents discover skills, at it with a symlink (a junction on Windows). A `setup` without `--agent` therefore refreshes every linked host as well. For the same reason, an edit made through a host path lands in the data-root copy and the next `setup` overwrites it without a backup: these files belong to `setup`, so keep customizations in a separate skill directory.

```text
<skill-root>/
  SKILL.md
  REFERENCE.md
  DATA_ROOT            # the data root this copy was deployed for
  bin/memoria          # runtime wrapper
  scripts/run-sync.sh
  scripts/run-sync-with-enhancement.sh
  resources/mcp/INGEST_PLAYBOOK.md
```

`setup --agent <claude-code|codex|both>` replaces an existing host skill target only in these cases:

- **A Memoria link**: a symlink whose target path ends in `.agents/skills/memoria` and is either gone or a real directory whose `SKILL.md` frontmatter carries both `deployment_mode: installed` and `repository: Memoria`. It is relinked to this data root with no backup; the old target is not touched. Reruns and switching `--memoria-home` take this path.
- **An empty directory**: removed and linked, no backup.
- **A real directory with both marks** (a copy an older `setup` deployed): every deployed template carries the marks, so a copy made from one by hand and edited since carries them too. It is copied whole to `<memoria-home>/.agents/skill-backups/<agent>-<timestamp>/` first, `setup` prints that path, and then it is replaced by the link. This happens once, on the first upgrade.

Anything else — a hand-written skill, a file, a symlink to anywhere else (even a marked one), a symlinked ancestor, a data-root skill directory that is itself a symlink, or a host path that is the data-root skill directory or lies inside it, or contains it (e.g. `CODEX_HOME=<memoria-home>/.agents`; compared by device and inode, so a bind mount or a differently cased spelling counts too) — is left byte-for-byte untouched and `setup` exits non-zero naming the path before writing anything; move it aside first if you want the deployed one.

## Refresh after a runtime upgrade

A global npm upgrade replaces the runtime package. The data-root skill is a copy (host directories link to it), so refresh it by running `memoria setup` (interactive) or `memoria setup --scope global --agent both --vector --yes` (or `--memoria-home <existing-data-root>`) with the upgraded runtime. One call refreshes all selected host locations, updates the managed block (`<!-- memoria:managed:start -->` ... `<!-- memoria:managed:end -->`) in shared `AGENTS.md` / `CLAUDE.md` after backing up the file to `<memoria-home>/.agents/instruction-backups/`, and regenerates the brief. GitHub main changes become available through npm only after a release includes them.

## Summary payload (`repo summarize --submit`)

Validated with Zod:

```json
{
  "title": "<issue> <feature>: <one-line subject>",
  "summary": "Problem or goal, what was done, key design, how it was verified, current state",
  "key_changes": ["Concrete changes, naming files or modules"],
  "decisions": [{ "decision": "What was decided", "reason": "Why" }],
  "known_limitations": ["Known limitations"],
  "risks": ["Risks"],
  "affected_domains": ["Paths or modules"],
  "importance": 0.75,
  "confidence": 0.85,
  "generator_version": "<model id>",
  "prompt_version": "v1"
}
```

- `title` 1–200 characters, `summary` 1–4000; `importance` and `confidence` are 0–1.
- `importance`: major feature 0.8–0.9, solid fix 0.6–0.75, small change 0.4–0.5.
- `decisions` only takes decisions whose reason is written down in the issue or commit messages; otherwise `[]`. Each one becomes its own recall memory and appears among the brief's recent decisions.
- When the merged range carries commits of another issue, say so at the end of `summary` and leave that issue's decisions out.
- Keep tokens, keys, personal data and credentialed URLs out; name the env key instead.

## Command Mapping

```bash
MEMORIA_HOME="<memoria-home>" "$MEMORIA_BIN" doctor --json
MEMORIA_HOME="<memoria-home>" "$MEMORIA_BIN" recall "<query>" --mode vector --project <repo>
MEMORIA_HOME="<memoria-home>" "$MEMORIA_BIN" feedback <recall_id> --score <0..1> --used --hits <ids>
MEMORIA_HOME="<memoria-home>" "$MEMORIA_BIN" remember "<fact>" --project <repo> --rationale "<why>"
MEMORIA_HOME="<memoria-home>" "$MEMORIA_BIN" repo sync <repo>
MEMORIA_HOME="<memoria-home>" "$MEMORIA_BIN" repo summarize <repo> --merge <sha> --json
MEMORIA_HOME="<memoria-home>" "$MEMORIA_BIN" repo summarize <repo> --submit <summary id> --file <payload.json> --json
MEMORIA_HOME="<memoria-home>" "$MEMORIA_BIN" brief --global
MEMORIA_HOME="<memoria-home>" "$MEMORIA_BIN" sync /absolute/path/to/session.json
MEMORIA_HOME="<memoria-home>" "$MEMORIA_BIN" verify
```

## Helper Runners

Import a session JSON (base, then with MCP enhancement when `LIBSQL_URL` is set):

```bash
MEMORIA_BIN="$SKILL_ROOT/bin/memoria" bash "$SKILL_ROOT/scripts/run-sync.sh" /absolute/path/to/session.json "<memoria-home>"
MEMORIA_BIN="$SKILL_ROOT/bin/memoria" bash "$SKILL_ROOT/scripts/run-sync-with-enhancement.sh" /absolute/path/to/session.json "<memoria-home>"
```

See `resources/mcp/INGEST_PLAYBOOK.md` for environment and failure-policy details.

## Debugging Notes

- `doctor --json` shows the resolved paths and where `MEMORIA_HOME` came from (`homeSource`).
- `verify --json` checks the database and writeability.
- If the wrapper fails, check that `bin/memoria` is executable and points at a valid Memoria runtime.
