# SDK and Agent Integrations

**English** ｜ [繁體中文](INTEGRATIONS.zh-TW.md) · [README](../README.md)

Last verified: 2026-10-23 against v1.31.1 source, CLI help and documentation checks.

Skill-based memory use needs no server; see the [Install Guide](INSTALL.md). The SDK examples below assume a repository checkout and source imports; the npm package exposes the CLI and has no SDK export. The SDK and hook adapters require the HTTP server.

## Shared project instructions and brief

Keep common rules in `AGENTS.md`. Use `CLAUDE.md` as Claude's entry point, importing them with `@AGENTS.md` on its own line. Put any Claude-specific additions below the import.

After generating a brief, add the read instruction printed by `memoria brief` to `AGENTS.md`, so an agent reads it when it is not already in context:

```markdown
Before starting work, read /absolute/path/to/knowledge/BRIEF.md if it is not already in context.
```

Claude's `CLAUDE.md` can import both the shared rules and the generated brief for expansion at launch:

```markdown
@AGENTS.md
@/absolute/path/to/knowledge/BRIEF.md
```

Replace the example with the path printed by `brief`; generate the file first, and escape spaces in `@` imports with backslashes. Other agents follow the read instruction in `AGENTS.md`; `@` expansion depends on the host. Regenerate the brief after memory updates. See the [official Claude import documentation](https://code.claude.com/docs/en/memory#import-additional-files).

## Node.js SDK

```typescript
import { MemoriaClient } from '../src/sdk.js'

const client = new MemoriaClient()         // defaults to http://localhost:3917
await client.waitUntilReady()              // poll /v1/health until ready

const r = await client.remember(sessionData)
const hits = await client.recall({ query: 'migration', top_k: 3, scope: 'project:Memoria' })
const telemetry = await client.recallTelemetry({ window: 'P7D', limit: 50 })
const summary = await client.summarizeSession('session_abc')

// Utility feedback (UFL): report how useful a recall actually was
const recallId = hits.meta.recall_id!
await client.recordRecallOutcome(recallId, { signal: 'reuse', utility_score: 0.8 })   // proxy signal
await client.markRecallUseful(recallId, true, hits.data!.map(h => h.id))              // explicit, high-fidelity
```

## Agent Adapter

```typescript
import { OpenCodeAdapter } from '../src/adapter/index.js'

const adapter = new OpenCodeAdapter({ client, project: 'my-project' })

// Before prompt: inject historical memory
const context = await adapter.beforePrompt({ userMessage, conversationId })

// After response: persist memory (auto throttle + dedupe + fail-open)
await adapter.afterResponse({ response, conversationId, userMessage })
```

Reference implementations: [src/adapter/antigravity-adapter.ts](../src/adapter/antigravity-adapter.ts), [src/adapter/codex-adapter.ts](../src/adapter/codex-adapter.ts), [src/adapter/opencode-adapter.ts](../src/adapter/opencode-adapter.ts), [src/adapter/claude-code-adapter.ts](../src/adapter/claude-code-adapter.ts).

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
