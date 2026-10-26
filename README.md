# Memoria

**English** ｜ [繁體中文](README.zh-TW.md)

Cross-session, traceable, self-hostable persistent memory for AI agents.

Memoria keeps decisions, pitfalls and learned skills in local SQLite, then recalls relevant memories when an agent needs them. Markdown notes and a compiled brief keep that memory readable and ready to load into the next session.

## What it does

| Capability | What you get |
| --- | --- |
| Persistent memory | Import sessions or save a single note with `remember`; retain provenance in SQLite and markdown |
| Recall | Keyword, tree and hybrid retrieval, plus optional semantic recall with local embeddings |
| Long-term context | Durable memories, explicit replacements and project-scoped briefs read through shared `AGENTS.md` instructions |
| Git-aware memory | Observe repositories read-only, enrich change summaries and recall decisions with commit provenance |
| Feedback | Report useful recalls; observed utility informs ranking and retention |
| Wiki | Import markdown/text sources, compile wiki pages and file useful query results |
| Memory workspace | Browse, search and read full memories, reasons and sources in a local, read-only UI |
| Integrations | CLI, HTTP API, source-level Node.js SDK and agent adapters sharing one core |

The core runs locally with three runtime dependencies: `better-sqlite3`, `commander` and `zod`. MCP/libSQL is optional; SQLite remains the source of truth. See the [MCP/libSQL guide](docs/MCP_INTEGRATION.md) when you need semantic indexing or cross-system graph projection.

## Quick start

Requires **Node.js ≥ 18**. Install once and run the guided setup (or pass explicit flags):

```bash
npm install -g @raybird.chen/memoria
memoria setup
# Non-interactive one-shot (global memory + Claude Code & Codex skills + local semantic recall):
# memoria setup --scope global --agent both --vector --yes

memoria remember "Use pnpm" --project Memoria --rationale "The lockfile is authoritative"
memoria recall "why pnpm" --project Memoria --mode vector --json
memoria brief --project Memoria
```

These commands use local storage directly; a server is optional. Global setup saves your default data root (`~/.memoria`) and vector settings to the user config (`install.json`), so new terminals find the same memory store without manually exporting `MEMORIA_HOME` or `LIBSQL_URL`. Project-scoped setup (`--scope project`) keeps `./memoria` in the current project, and an explicit `MEMORIA_HOME` or `--memoria-home` always wins.

`setup` can also generate the initial brief and wire a managed block (`<!-- memoria:managed:start -->` ... `<!-- memoria:managed:end -->`) into shared `AGENTS.md` and `CLAUDE.md` while backing up existing files. Regenerate the brief with `memoria brief` after memory updates. See the [CLI Guide](docs/CLI.md) for project detection, durable markers and utility feedback.

## Browse memory visually

Requires v1.33.0 or later. From a source checkout, run `pnpm run build` and `node dist/cli.mjs serve --ui`.

After setup, run:

```bash
memoria serve --ui
```

Open the printed `http://127.0.0.1:3917/ui/` address. The workspace includes decision, skill and session lists, project filters, full reasons and provenance, search, briefs, light/dark themes and keyboard navigation. It uses the same initialized data root as the CLI; you can select one explicitly with `MEMORIA_HOME=/path/to/data-root memoria serve --ui`.

The viewer runs in the foreground and closes with Ctrl+C. Assets are bundled for offline browsing; explicit searches keep local recall telemetry. See the [local workspace guide](docs/CLI.md#local-memory-workspace) for scope, semantic search and access boundaries.

## Use it with an agent

Setup deploys the **memoria** skill to `<memoria-home>/.agents/skills/memoria/SKILL.md`, and when selected, into host discovery directories (`~/.claude/skills/memoria` for Claude Code, `~/.codex/skills/memoria` or `$CODEX_HOME/skills/memoria` for Codex):

```bash
memoria setup --scope global --agent both --yes
```

The skill guides recall before work and memory write-back after decisions or completed changes. Deployment paths, backups and standalone installation are covered in the [Install Guide](docs/INSTALL.md).

Optional next steps:

- **HTTP or hooks:** `memoria setup --serve --json`, then follow the [API Reference](docs/API.md) or [SDK and Agent Integrations](docs/INTEGRATIONS.md).
- **Semantic recall:** choosing `--vector` during `memoria setup` installs dependencies, warms the local model, builds the tree index, ingests your corpus into `<memoria-home>/.memory/vectors.db`, and verifies vector readiness. For advanced diagnostics and recovery, see [Semantic Recall Operations](docs/OPERATIONS.md#semantic-recall-operations-optional).
- **Repository memory:** start with `memoria repo add /path/to/project`; see [Git-Aware Memory Operations](docs/OPERATIONS.md#git-aware-memory-operations).

## Documentation

| Guide | Contents |
| --- | --- |
| [Install](docs/INSTALL.md) | npm, standalone artifacts, data paths, deployed skills and background services |
| [CLI](docs/CLI.md) · [繁中](docs/CLI.zh-TW.md) | Commands, memory markers, brief generation and scope |
| [HTTP API](docs/API.md) · [繁中](docs/API.zh-TW.md) | Endpoints, request examples and response semantics |
| [SDK and Agent Integrations](docs/INTEGRATIONS.md) · [繁中](docs/INTEGRATIONS.zh-TW.md) | Source-level SDK usage and hook configurations |
| [Operations](docs/OPERATIONS.md) | Indexing, vector recovery, pruning, backups and governance |
| [MCP/libSQL](docs/MCP_INTEGRATION.md) | Optional graph projection and incremental sync |
| [AGENTS.md](AGENTS.md) · [CLAUDE.md](CLAUDE.md) | Architecture, development commands and agent conventions |
| [Specification](SPEC.md) · [Roadmap](RFC.md) | Implemented behavior and future directions |
| [Releases](CHANGELOG.md) · [Release SOP](RELEASE.md) | Version history and maintainer workflow |

Last verified: 2026-10-26 against the issue-30 implementation, CLI help and documentation checks. The workspace requires v1.33.0 or later.

## License

MIT
