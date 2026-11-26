# CLI Guide

**English** ｜ [繁體中文](CLI.zh-TW.md) · [README](../README.md)

Last verified: 2026-11-26 against the issue-39 source (`feedback --used`), the issue-38 source (unscanned count scope and unscanned tags), CLI help and documentation checks.

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
memoria remember "release branch merged into main" --verify "git log main --oneline -1"  # State memory: recall/brief show the as-of date and the command; Memoria never runs it
memoria recall "..." --include-superseded          # Include replaced versions
memoria export --redact                  # Code-name known entities in private memories
memoria stats [--json]                 # Statistics
memoria stats --zero-utility [--window P30D] [--limit 20] [--json]  # Recalls reported useless or with no hits
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
# Writing back a merge or release summary also dismisses the commit-range skeletons inside it; the result reports dismissed_covered
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

With semantic recall enabled, `remember` checks the vector index after the write. It never writes vectors itself, so a new note stays invisible to `--mode vector` until the index is filled. When the index is short, the output adds `- vector coverage: 缺 <n> 筆，語意召回查不到它們；…`, with the same count as the `vector coverage` line of `doctor`, and `--json` adds `data.vector_missing`. Fill it with the fix `doctor` prints, now or at wrap-up. Nothing is added when semantic recall is off, when coverage cannot be measured (a remote libSQL, an overridden helper), when nothing is missing, or when the index cannot be read; the write and the exit code are unaffected either way.

A memory written with `--verify` is a state memory, a snapshot that can go stale. recall prints `⟳ 截至 <date>；據以行動前先跑：<command>` under the hit, and `--json` and `/v1/recall` carry it as `verify`. The brief adds `截至 <date>；據以行動前先跑 <command>` under the entry in every block that lists it, and one fixed note after the totals line saying the command is never run by Memoria and should be run only if it is a read-only check. The command is shown whole and never executed; the agent reading it decides whether to run it. The as-of date is the memory's UTC date. `--verify` must be a single non-empty line without control characters (tab is allowed; Unicode line separators are refused) and cannot be combined with `--durable`, either at write time or later through `mark` (split the lasting constraint and the snapshot into two notes).

recall's listing says why it found little. Under the count line, `- 語意查詢有執行，沒有命中；列出的是字面查詢的結果` means `--mode vector` did run and the semantic index contributed no memory (read this line or `vector_hits`, not `route_mode`, whose label is decided before superseded memories are dropped), and `- 這個 project 沒有任何記憶：<name>；已登記的名稱見 \`memoria repo list\`` means the `--project` value names no memory at all, so the empty result is not "nothing relevant". A hit whose relevance is below 0.3 shares only a token or two with the query and is marked `[0.250 弱命中]`. It is still returned. A hit found only by the semantic index prints `n/a` and is never marked: it has no lexical score to show, which is not a low score. `--json` carries the first two as `meta.vector_hits` and `meta.project_known`.

`recall --json` prints the `MemoriaResult` envelope `{ok, data, meta}`. `data` is the array of hits; each has `id` (what `feedback --hits` takes), `session_id`, `type`, `project`, `timestamp`, `snippet` and `score`, which orders the hits and is not a 0–1 match quality. `relevance` (0–1 lexical match) is on every hit except one the semantic index alone found; other fields such as `source` and `verify` appear when they apply. `meta` carries `recall_id`, `route_mode`, `confidence` and `confidence_basis`; `confidence` is `null` with basis `unavailable` when the top hit came from the semantic index alone. The human listing prints the `recall_id` on its last line.

`feedback` records `--score` on the recall, and `--hits` decides which memories accrue that utility; without `--hits` no memory's utility changes, which is how to report a recall run only as a test. `--used` is accepted for compatibility and has no effect on what is written.

Inside a registered repository, `brief` detects the project and writes `knowledge/BRIEF-<project>.md`; an explicit `--project` still writes `BRIEF.md`, and `--global` selects all projects. The body shows the generation time on the scope line, because hosts that `@`-import the brief drop the header comment. Durable memories appear in a pinned block outside the `--days` and `--top-k` limits; superseded memories are excluded. Recent decisions share their `--top-k` slots across projects, most recently active first. Memories whose project is not a registered repository accompany each project's brief. Follow the output to add read instructions to `AGENTS.md`; Claude's `CLAUDE.md` imports `@AGENTS.md` and the brief path. Regenerate the brief after memory updates. See [Operations](OPERATIONS.md#context-injection-via-briefmd).

The Repository block says when a repository needs `repo sync`. `未掃描 commit: N` counts commits past the last sync on the registered default branch and on tags, so work on a branch that is not merged yet does not count; without a registered default branch, or when there is no local branch by that name, it counts every branch as `repo sync` does. `未掃描 tag: <names>` names tags no sync has seen, newest first by tag date (a lightweight tag uses its commit's date), up to three plus `等 N 個` for the total. `--json` carries them as `repositories[].unscanned_commits` and `unscanned_tags`. `repo sync` itself still scans every branch. When the registered default branch is not where work is merged, re-register it with `memoria repo add <path> --default-branch <branch>`; `repo list` shows the current one.

## Local memory workspace

After initializing the intended data root, run:

```bash
MEMORIA_HOME=/path/to/data-root memoria serve --ui --port 3917
```

Open the printed `http://127.0.0.1:3917/ui/` address. UI mode binds only to IPv4 loopback and accepts the exact printed Host and same-origin requests. Use `127.0.0.1`, not a hostname alias. Plain `memoria serve` retains its existing API behavior.

The workspace provides decision, skill-event and session lists, exact project or environment filters, durable and superseded markers, full content and provenance, explicit keyword/semantic search, and the existing brief. The default decision list does not also show a note's wrapper session. Pinned lists are browsed separately; search in the library covers all memory types within the selected scope. Project briefs retain the established inclusion of environment memories.

The interface is read-only. UI mode rejects business writes and arbitrary file reads; explicit searches retain Memoria's local recall telemetry. It installs no service or hook and sends no UI analytics. It uses embedded local assets without CDN fonts or scripts. Memory content renders as text, including Markdown and HTML source. A missing data root is an error; UI mode never initializes or migrates it. Run `doctor` and, when needed, `init` explicitly against the intended root.

Choose light/dark/system appearance locally. URLs preserve scope, list type, page, search text and selected memory; browser history can therefore contain your search text and memory identifiers. Do not share these URLs as public links. Keyboard `/` focuses library search; narrow screens open a reading view with a return action. Semantic degradation is named; no ranking score is presented as a probability.

Use Tab to move between controls, Enter to open a focused memory and Escape to return to the list with its focus restored. `--json` prints the startup port and UI URL for automation. If the port is occupied, stop the existing process or select another `--port`; the viewer does not silently choose a different data root or port.
