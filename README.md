# Memoria

**English** ｜ [繁體中文](README.zh-TW.md)

Cross-session, traceable, self-hostable persistent memory for AI agents.

## 30-second Tour

- **Problem**: LLM agents start from scratch every conversation — last session's decisions, pitfalls, and learned skills are all lost.
- **Solution**: Persist sessions into a local SQLite store; pull relevant fragments back through keyword / tree / hybrid recall. An optional markdown view (compiled wiki) keeps everything human-readable.
- **Shape**: Node.js CLI (`./cli`) + HTTP API (`:3917`) + Node SDK (`MemoriaClient`) sharing one core; agent adapters (Claude Code / Antigravity CLI / Codex CLI / OpenCode) included.
- **Footprint**: Three runtime npm deps (`better-sqlite3` / `commander` / `zod`); HTTP runs on `node:http`. Fully offline.
- **Extension**: An MCP/libSQL cross-node semantic graph is opt-in via the `LIBSQL_URL` env var.

## 🤖 AI Agent Quick Install

> **Agents — this section is all you need.** Use npm; everything else is below.

### Install from npm (Recommended)

```bash
# One-shot via npx (no install needed)
npx @raybird.chen/memoria setup --serve --json

# Or install globally
npm install -g @raybird.chen/memoria
memoria setup --serve --json
```

`setup` also deploys the built-in agent skill into `<memoria-home>/.agents/skills/memoria/` (discoverable as the **memoria** skill), including a runtime-safe `SKILL.md`, `REFERENCE.md`, helper scripts, and a local `bin/memoria` wrapper — so agents can discover and use it immediately after install. Each folder gets its own data root, so you can give a clean folder its own memory by running `setup` there.

To point agents at the deployed skill, use:

```text
<memoria-home>/.agents/skills/memoria/SKILL.md
<memoria-home>/.agents/skills/memoria/REFERENCE.md
```

Output is JSON Lines, one row per step:

```json
{"step":"preflight","ok":true,"ms":120,"mode":"installed"}
{"step":"init","ok":true,"ms":85}
{"step":"verify","ok":true,"ms":42}
{"step":"skill","ok":true,"ms":14,"path":"./memoria/.agents/skills/memoria"}
{"step":"serve","ok":true,"port":3917}
```

Check readiness:

```bash
curl -sf http://localhost:3917/v1/health
```

Once running, use the HTTP API:

```bash
curl -X POST http://localhost:3917/v1/remember \
  -H 'Content-Type: application/json' \
  -d @examples/session.sample.json

curl -X POST http://localhost:3917/v1/recall \
  -H 'Content-Type: application/json' \
  -d '{"query":"SQLite migration","top_k":5}'

curl http://localhost:3917/v1/stats
```

**Prerequisites**: Node.js ≥ 18. `better-sqlite3` ships prebuilt binaries for Linux / macOS / Windows.

**Other install paths**: no-clone tarball (`install.sh`) and repo-mode developer setup are documented in [docs/INSTALL.md](docs/INSTALL.md).

**Full agent integration guide**: [AGENTS.md](AGENTS.md) (covers Core Architecture / HTTP API / Bootstrap).

---

## Capability Map

| Area | Capabilities |
|------|--------------|
| **Entrypoints** | CLI (init/sync/stats/doctor/verify/index/source/wiki/govern/prune/export/serve/preflight/setup) ｜ HTTP API (12 endpoints @ port 3917) ｜ Node.js SDK (`MemoriaClient`) ｜ Agent adapters (Claude Code / Antigravity CLI / Codex CLI / OpenCode) ｜ Every command supports `--json` machine-readable output |
| **Storage** | SQLite + markdown dual persistence ｜ Time-decay scoring (90-day half-life) + consolidation + stale eviction ｜ Backward-compatible schema auto-upgrades |
| **Retrieval** | `keyword / tree / hybrid` recall ｜ Adaptive gate skips trivial queries ｜ Lightweight scope isolation (`global / project / agent / user`) ｜ Recall routing telemetry (`stats` + API) |
| **Wiki workflows** | Raw source import (markdown/text) ｜ Compiled wiki special pages (`index / log / overview`) ｜ Query file-back (`synthesis / comparison`) ｜ Wiki governance lint |
| **Governance** | Governance review (duplicate decisions/skills candidates) ｜ Import guardrails (low-value summary correction + duplicate event suppression) |
| **Bootstrap** | One-shot `./cli setup --serve --json` ｜ No-clone release-artifact install path ｜ Deployed skill auto-installed to `<memoria-home>/.agents/` |
| **Optional** | MCP/libSQL cross-system semantic graph (gated by `LIBSQL_URL`) |
| **Planned** | Policy engine (PII filtering / read-write policy / multi-tenant rules) |

## Memoria vs MCP/libSQL

`mcp-memory-libsql` is an **optional enhancement**, not a required dependency.

| Capability | Memoria standalone | Memoria + MCP/libSQL |
|------------|--------------------|------------------------|
| Local persistent memory (SQLite + markdown) | ✅ | ✅ |
| `recall` (keyword/tree/hybrid) | ✅ | ✅ |
| Recall telemetry (`stats` + API) | ✅ | ✅ |
| Cross-system graph projection / incremental sync | ➖ | ✅ |
| Multi-agent shared external semantic graph | ➖ | ✅ |

Bottom line:

- For a **fully functional setup**: Memoria alone is enough.
- For **cross-system / multi-node semantic enhancement**: add MCP/libSQL.

Quick decision (three lines):

- Start with Memoria-only (minimal ops cost, fully featured).
- Add MCP/libSQL when you need cross-agent / cross-node semantic graphs.
- Either way, Memoria's SQLite stays the source of truth.

## HTTP API

Launch: `./cli serve` (port 3917, override via `MEMORIA_PORT`).

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/v1/health` | Health check |
| `GET`  | `/v1/stats` | Statistics |
| `GET`  | `/v1/telemetry/recall` | Recall routing telemetry (query: `window`, `limit`) |
| `POST` | `/v1/remember` | Write memory (body: SessionData; optional `scope`) |
| `POST` | `/v1/recall` | Recall memories (body: `{query, top_k?, project?, scope?, mode?}`) |
| `POST` | `/v1/recall/:id/outcome` | Report recall utility (body: `{signal, utility_score?, used?}`; UFL write-back) |
| `POST` | `/v1/sources` | Import a markdown/text source |
| `GET`  | `/v1/sources` | List raw sources |
| `POST` | `/v1/wiki/build` | Rebuild compiled wiki special pages |
| `POST` | `/v1/wiki/file-query` | File a high-value query back into a wiki page |
| `POST` | `/v1/wiki/lint` | Run wiki governance lint |
| `GET`  | `/v1/sessions/:id/summary` | Session summary |

All responses use the `MemoriaResult<T>` envelope (`evidence[]`, `confidence`, `latency_ms`).

## Common CLI Commands

```bash
./cli init                           # Initialize DB + directories
./cli sync <session.json>            # Import a session
./cli sync --dry-run <session.json>  # Preview without writing
./cli stats [--json]                 # Statistics
./cli doctor [--json]                # Local health check
./cli verify [--json]                # Full verification
./cli index build [--json]           # Incremental tree-index rebuild
./cli index build --scope agent:main # Rebuild only the given scope
./cli source add notes/research.md   # Import a markdown/text source
./cli source list --json             # List raw sources
./cli wiki build --json              # Rebuild the compiled wiki
./cli wiki file-query --query "TS CLI migration" --title "TS CLI Migration Brief" --kind synthesis --scope project:Memoria
./cli wiki lint --json               # Produce durable wiki governance findings
./cli govern review --json           # Check for rule/skill promotion candidates
./cli prune --all --dry-run          # Cleanup preview (consolidate 90d + stale 180d)
./cli prune --consolidate-days 90    # Merge old session nodes under the same topic
./cli prune --stale-days 180         # Remove memory never hit by recall
./cli export --type all --format json # Export
./cli serve [--port 3917]            # HTTP API server
./cli preflight [--json]             # Prerequisite check
./cli setup [--serve] [--json]       # One-shot install
```

## Node.js SDK

```typescript
import { MemoriaClient } from './src/sdk.js'

const client = new MemoriaClient()         // defaults to http://localhost:3917
await client.waitUntilReady()              // poll /v1/health until ready

const r = await client.remember(sessionData)
const hits = await client.recall({ query: 'migration', top_k: 3, scope: 'project:Memoria' })
const telemetry = await client.recallTelemetry({ window: 'P7D', limit: 50 })
const summary = await client.summarizeSession('session_abc')
```

## Agent Adapter

```typescript
import { OpenCodeAdapter } from './src/adapter/index.js'

const adapter = new OpenCodeAdapter({ client, project: 'my-project' })

// Before prompt: inject historical memory
const context = await adapter.beforePrompt({ userMessage, conversationId })

// After response: persist memory (auto throttle + dedupe + fail-open)
await adapter.afterResponse({ response, conversationId, userMessage })
```

Reference implementations: `src/adapter/antigravity-adapter.ts`, `src/adapter/codex-adapter.ts`, `src/adapter/opencode-adapter.ts`, `src/adapter/claude-code-adapter.ts`.

Claude Code, Codex CLI, and Antigravity CLI all ship **zero-code hook integrations** — one CLI command wires both recall injection and turn write-back. All three fail-open so a Memoria outage never blocks the agent, and all require `memoria serve` running on `localhost:3917` (override with `--server` or `MEMORIA_SERVER_URL`).

### Claude Code (zero-code integration via hooks)

Wire Memoria into Claude Code via its hook system — no SDK needed, just the CLI:

```jsonc
// ~/.claude/settings.json (or .claude/settings.json per project)
{
  "hooks": {
    "UserPromptSubmit": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "memoria adapter claude-code" }] }
    ],
    "Stop": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "memoria adapter claude-code" }] }
    ]
  }
}
```

`UserPromptSubmit` injects relevant past memory as `additionalContext`; `Stop` writes the just-completed turn back to Memoria. Both fail-open so a Memoria outage never blocks your Claude Code session. Requires `memoria serve` running on `localhost:3917` (override with `--server` or `MEMORIA_SERVER_URL`).

### Codex CLI (zero-code integration via hooks)

Codex CLI's hook system mirrors Claude Code's (JSON on stdin, JSON on stdout). Wire it into a `hooks.json` next to your Codex config, or an inline `[hooks]` table in `~/.codex/config.toml`:

```jsonc
// ~/.codex/hooks.json
{
  "hooks": {
    "UserPromptSubmit": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "memoria adapter codex" }] }
    ],
    "Stop": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "memoria adapter codex" }] }
    ]
  }
}
```

`UserPromptSubmit` injects recalled memory as `additionalContext` (added as extra developer context); `Stop` persists the turn from the payload's `last_assistant_message`.

### Antigravity CLI (zero-code integration via hooks)

Antigravity CLI (`agy`) exposes agent lifecycle hooks (JSON on stdin/stdout). Register the handler in your `hooks.json` under the customization directory:

```jsonc
// .agents/hooks/hooks.json (or settings.json "hooks")
{
  "memoria": {
    "PreInvocation": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "memoria adapter antigravity", "timeout": 30 }] }
    ],
    "Stop": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "memoria adapter antigravity", "timeout": 30 }] }
    ]
  }
}
```

`PreInvocation` recalls memory and injects it before the model runs, emitted as **flat** top-level `additionalContext` (the Antigravity output schema rejects a nested `hookSpecificOutput` wrapper); `Stop` persists the completed turn. Antigravity delivers the conversation via `transcript_path` rather than payload fields, so the adapter reads the transcript (like Claude Code). The transcript line format is assumed to match Claude Code's JSONL — set `MEMORIA_ADAPTER_DEBUG=<file>` to capture a real payload from your `agy` build and confirm it.

## Project Layout

```text
src/
  cli.ts        # Commander registration shell (~50 lines)
  cli/          # Per-command modules + shared helpers (shared.ts / runtime.ts / preflight.ts / commands/)
  server.ts     # HTTP API server (node:http, zero extra deps)
  sdk.ts        # MemoriaClient SDK
  core/         # All business logic (types / paths / utils / db/ / memoria / source-import / wiki-*)
  core/db/      # SQLite ops by domain (schema / session / source / wiki / lint / sync / telemetry / verify / prune-export / recall / mappers)
  adapter/      # BaseAdapter + Claude Code / Antigravity CLI / Codex CLI / OpenCode adapters
scripts/        # End-to-end bash tests (test-*.sh) + release packaging
skills/         # memoria-memory-sync agent skill
examples/       # session.sample.json
```

Full directory and file-level responsibilities live in [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md).

## Documentation Map

| Document | Audience | Purpose |
|----------|----------|---------|
| [AGENTS.md](AGENTS.md) | AI agents | Architecture, API, Bootstrap, dev conventions |
| [RELEASE.md](RELEASE.md) | Maintainers | Patch/minor/major release SOP and validation |
| [SPEC.md](SPEC.md) | Developers | Shipped feature specs |
| [RFC.md](RFC.md) | Developers | Roadmap and future direction |
| [docs/](docs/) | Operators | Install, containers, MCP integration, and more |

## License

MIT
