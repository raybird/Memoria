# CLI Guide

**English** ｜ [繁體中文](CLI.zh-TW.md) · [README](../README.md)

Last verified: 2026-10-23 against v1.31.1 source, CLI help and documentation checks.

These examples use the npm-installed `memoria` command. From a repository checkout, use `./cli` instead. Run `memoria <command> --help` for all flags. Square brackets denote optional arguments; replace values inside `<…>`.

## Common commands

```bash
memoria init                           # Initialize DB + directories
memoria sync <session.json>            # Import a session
memoria sync --dry-run <session.json>  # Preview without writing
memoria recall "why pnpm" [--json]     # Search memory (--project/--scope/--top-k/--time-window/--mode)
memoria remember "switched to pnpm" --project Memoria --rationale "lockfile is authoritative"
memoria remember "..." --type skill --category cli   # Write a SkillLearned note instead
memoria feedback <recall_id> --score 0.9 --hits <id,id>  # UFL utility write-back
memoria brief [--project X] [--days 30]  # Compile a markdown brief for shared AGENTS.md read instructions
memoria remember "..." --durable         # Evergreen fact: no time-decay, survives stale pruning
memoria mark <ref_id> --durable         # Pin an existing memory, including a git-promoted decision
memoria brief --global                 # Write one all-projects knowledge/BRIEF.md
memoria remember "..." --supersedes <ref_id>       # Old memory drops out of recall (data kept)
memoria remember "..." --sensitivity private       # Mark for export --redact
memoria recall "..." --include-superseded          # Include replaced versions
memoria export --redact                  # Code-name known entities in private memories
memoria stats [--json]                 # Statistics
memoria doctor [--json]                # Local health check
memoria verify [--json]                # Full verification
memoria index build [--json]           # Incremental tree-index rebuild
memoria index build --scope agent:main # Rebuild only the given scope
memoria source add notes/research.md   # Import a markdown/text source
memoria source list --json             # List raw sources
memoria repo add /path/to/project      # Observe a git repo (read-only)
memoria repo sync project              # Incremental scan → events → summaries → promotion
memoria repo summarize project --pending --json  # Summary requests for agent enrichment
memoria repo summarize project --dismiss-pending --type merge,release  # Skip teammates' skeletons without promoting them
memoria wiki build --json              # Rebuild the compiled wiki
memoria wiki file-query --query "TS CLI migration" --title "TS CLI Migration Brief" --kind synthesis --scope project:Memoria
memoria wiki lint --json               # Produce durable wiki governance findings
memoria govern review --json           # Check for rule/skill promotion candidates
memoria prune --all --dry-run          # Cleanup preview (consolidate 90d + stale 180d + git-observations 90d)
memoria prune --consolidate-days 90    # Merge old session nodes under the same topic
memoria prune --stale-days 180         # Remove memory never hit by recall
memoria export --type all --format json # Export
memoria serve [--port 3917]            # HTTP API server
memoria preflight [--json]             # Prerequisite check
memoria setup                          # Interactive guided setup (scope, agent skills, vector, brief/instructions)
memoria setup --scope global --agent both --vector --yes  # Non-interactive full setup
memoria setup [--serve] [--json]       # Automation one-shot install
```

`remember`, `recall`, `mark`, `feedback` and `brief` work directly against local storage, so a skill-based setup needs no server. When several repositories share a store, pass `--project` to recall to keep results scoped.

Inside a registered repository, `brief` detects the project and writes `knowledge/BRIEF-<project>.md`; an explicit `--project` still writes `BRIEF.md`, and `--global` selects all projects. Durable memories appear in a pinned block outside the `--days` and `--top-k` limits; superseded memories are excluded. Memories whose project is not a registered repository accompany each project's brief. Follow the output to add read instructions to `AGENTS.md`; Claude's `CLAUDE.md` imports `@AGENTS.md` and the brief path. Regenerate the brief after memory updates. See [Operations](OPERATIONS.md#context-injection-via-briefmd).
