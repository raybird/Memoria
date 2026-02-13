# AGENTS.md

Guidance for coding agents operating in this repository.

## Project Snapshot

- Stack: TypeScript CLI (Node.js).
- Package manager: `pnpm` (lockfile: `pnpm-lock.yaml`).
- Entry point: `cli` -> `src/cli.ts` via `tsx`.
- Core domains: session import, SQLite persistence, markdown sync.
- Main runtime dependency: `better-sqlite3`.
- Validation library: `zod`.

## Source of Truth for Commands

- `package.json` scripts
- `.github/workflows/ci.yml`
- `scripts/test-smoke.sh`

If local docs disagree with CI, follow CI.

## Environment Requirements

- Node.js `>=18` (CI runs Node 22).
- `pnpm` available on PATH.
- Optional but common: `MEMORIA_HOME` pointing at repo root.

## Setup Commands

- Install deps: `pnpm install`
- Run CLI in dev: `pnpm run memoria -- --help`
- Initialize memory dirs/db: `MEMORIA_HOME=$(pwd) ./cli init`

## Build, Lint, and Test Commands

There is no separate transpile build step and no dedicated ESLint/Prettier config.

- Type check (primary static check): `pnpm run check`
- Direct type check equivalent: `pnpm exec tsc --noEmit`
- Validate shell script syntax: `bash -n install.sh`
- Smoke/integration test: `bash scripts/test-smoke.sh`

## Single-Test Guidance (Important)

This repo currently has one explicit test script: `scripts/test-smoke.sh`.

- Run the single smoke test: `bash scripts/test-smoke.sh`
- There is no unit-test framework (no Jest/Vitest/Pytest config present).
- For focused verification, run one CLI flow manually:
  - `TMP=$(mktemp -d)`
  - `MEMORIA_HOME="$TMP" ./cli init`
  - `MEMORIA_HOME="$TMP" ./cli sync examples/session.sample.json`

## CI Parity Checklist

Before opening PRs, mirror CI locally in this order:

1. `pnpm install`
2. `pnpm run check`
3. `bash -n install.sh`
4. `bash scripts/test-smoke.sh`

## Repository Layout

- `src/cli.ts`: TypeScript CLI implementation.
- `cli`: executable shim (`pnpm tsx`).
- `scripts/test-smoke.sh`: smoke test.
- `skills/memoria-memory-sync/SKILL.md`: Agent Skill entrypoint.
- `skills/memoria-memory-sync/scripts/`: hybrid sync and MCP bridge scripts.
- `examples/session.sample.json`: sample input for sync flow.
- `.github/workflows/ci.yml`: canonical validation pipeline.

## Agent Skill and MCP Notes

- Primary skill path: `skills/memoria-memory-sync/SKILL.md`.
- Hybrid runner: `skills/memoria-memory-sync/scripts/run-sync-with-enhancement.sh`.
- MCP integration is optional and gated by `LIBSQL_URL`.
- Default MCP server launch for automation is `npx -y mcp-memory-libsql`.

## Code Style: General

- Keep changes minimal and targeted; avoid broad refactors.
- Prefer clarity over cleverness.
- Preserve existing architecture and command-line UX.
- Do not introduce new tooling unless explicitly requested.
- Avoid adding dependencies unless justified by clear need.

## Code Style: TypeScript

- TS config is strict (`"strict": true`); keep code type-safe.
- Prefer explicit narrow types for external/untrusted data.
- Use `unknown` at boundaries, then validate (current pattern: Zod).
- Keep helper functions small and single-purpose.
- Maintain existing function-oriented style (no unnecessary classes).
- Use async fs APIs from `node:fs/promises`.
- Use `path.join/resolve` for filesystem paths.

## Imports and Module Conventions

- Use ESM imports (project has `"type": "module"`).
- Keep import groups consistent with current file style:
  1. Node built-ins
  2. Third-party packages
  3. Local modules (if added)
- Keep side-effect imports explicit and rare.

## Naming Conventions

- Functions/variables: `camelCase`.
- Types/interfaces/type aliases: `PascalCase`.
- Constants: `UPPER_SNAKE_CASE` only for true constants; otherwise `camelCase`.
- Filenames: existing style is lowercase with separators as needed.
- IDs/slugs: sanitize before filesystem usage.

## Error Handling and Reliability

- Validate external input before use (JSON parse + schema parse).
- Throw informative `Error` messages for user-facing failures.
- Use `try/finally` for DB open/close lifecycle.
- Avoid swallowing errors silently; explicit fallbacks are acceptable.
- Keep CLI exit behavior consistent (`run().catch(...); process.exit(1)`).

## SQLite and Data Handling

- Keep schema changes backward-compatible unless requested.
- Prefer prepared statements for inserts/queries.
- Preserve current upsert semantics (`INSERT OR REPLACE`).
- Serialize structured fields with `JSON.stringify` before persistence.
- Be careful with timestamp parsing; use safe date fallback pattern.

## File and Markdown Output Rules

- Ensure directories exist before writing.
- Keep deterministic, sanitized filenames (`slugify`/sanitize pattern).
- Preserve markdown document section structure when extending templates.
- Use UTF-8 when writing text files.

## Shell Style in This Repo

- Shell scripts should use `set -euo pipefail` when practical.
- Quote variable expansions in shell paths.

## What Not to Change Implicitly

- Do not rename CLI commands (`init`, `sync`, `stats`, `doctor`) without request.
- Do not change persisted table names/columns without migration plan.
- Do not alter sample file formats unless all readers are updated.

## Agent Workflow Recommendations

- Read `package.json` and CI workflow before coding.
- Implement smallest viable change.
- Run relevant checks from the CI parity checklist.
- Update docs when command behavior or flags change.

## Cursor and Copilot Rules

- `.cursor/rules/`: not present at time of writing.
- `.cursorrules`: not present at time of writing.
- `.github/copilot-instructions.md`: not present at time of writing.
- If these files are later added, treat them as higher-priority agent rules.

## Definition of Done for Agent Changes

- Code compiles with `pnpm run check`.
- Smoke test passes (`bash scripts/test-smoke.sh`) for flow changes.
- Script syntax remains valid for touched shell files.
- Behavior and output remain consistent with existing CLI expectations.
