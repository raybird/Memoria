# Memoria

**English** ｜ [繁體中文](README.zh-TW.md)

Cross-session, traceable, self-hostable persistent memory for AI agents.

Memoria keeps decisions, pitfalls and learned skills in local SQLite, then recalls relevant memories when an agent needs them. Markdown notes and a compiled brief keep that memory readable and ready to load into the next session.

## What it does

| Capability | What you get |
| --- | --- |
| Persistent memory | Import sessions or save a single note with `remember`; retain provenance in SQLite and markdown |
| Recall | Keyword, tree and hybrid retrieval, plus optional semantic recall with local embeddings |
| Long-term context | Durable memories, explicit replacements and project-scoped briefs for `CLAUDE.md` imports |
| Git-aware memory | Observe repositories read-only, enrich change summaries and recall decisions with commit provenance |
| Feedback | Report useful recalls; observed utility informs ranking and retention |
| Wiki | Import markdown/text sources, compile wiki pages and file useful query results |
| Integrations | CLI, HTTP API, source-level Node.js SDK and agent adapters sharing one core |

The core runs locally with three runtime dependencies: `better-sqlite3`, `commander` and `zod`. MCP/libSQL is optional; SQLite remains the source of truth. See the [MCP/libSQL guide](docs/MCP_INTEGRATION.md) when you need semantic indexing or cross-system graph projection.

## Quick start

Requires **Node.js ≥ 18**. Install once and choose a stable data root:

```bash
npm install -g @raybird.chen/memoria
export MEMORIA_HOME="$HOME/.memoria"
memoria setup

memoria remember "Use pnpm" --project Memoria --rationale "The lockfile is authoritative"
memoria recall "why pnpm" --project Memoria --json
memoria brief --project Memoria
```

These commands use local storage directly. A server is optional. Keep `MEMORIA_HOME` set when returning to this store; without it or `--memoria-home`, setup uses `./memoria` in the current directory.

`brief` prints a path you can import from `CLAUDE.md`. Regenerate it after memory updates. See the [CLI Guide](docs/CLI.md) for project detection, durable markers and utility feedback.

## Use it with an agent

Setup deploys the **memoria** skill to:

```text
<memoria-home>/.agents/skills/memoria/SKILL.md
```

For Claude Code, also deploy into its skill directory:

```bash
memoria setup --agent claude-code
```

The skill guides recall before work and memory write-back after decisions or completed changes. Deployment paths, backups and standalone installation are covered in the [Install Guide](docs/INSTALL.md).

Optional next steps:

- **HTTP or hooks:** `memoria setup --serve --json`, then follow the [API Reference](docs/API.md) or [SDK and Agent Integrations](docs/INTEGRATIONS.md).
- **Semantic recall:** `memoria setup --vector` installs dependencies and warms the local model. Configure `LIBSQL_URL` and ingest your memories separately; follow [Semantic Recall Operations](docs/OPERATIONS.md#semantic-recall-operations-optional).
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

Last verified: 2026-10-23 against v1.31.1 source, CLI help and documentation checks.

## License

MIT
