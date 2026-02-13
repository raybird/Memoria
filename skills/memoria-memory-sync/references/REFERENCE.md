# Memoria Skill Reference

This reference supports `SKILL.md` for deeper implementation details.

## Repository Facts

- Runtime: TypeScript CLI (`src/cli.ts`)
- Package manager: `pnpm`
- DB: SQLite via `better-sqlite3`
- Validation: `zod`
- Canonical CI: `.github/workflows/ci.yml`

## Commands and Intent

- Install dependencies:
  - `pnpm install`
- Type check:
  - `pnpm run check`
- Initialize base folders + DB:
  - `MEMORIA_HOME=$(pwd) ./cli init`
- Import and sync one session:
  - `MEMORIA_HOME=$(pwd) ./cli sync <session.json>`
- Preview sync only:
  - `MEMORIA_HOME=$(pwd) ./cli sync --dry-run <session.json>`
- Show aggregate stats:
  - `MEMORIA_HOME=$(pwd) ./cli stats`
- Run environment health checks:
  - `MEMORIA_HOME=$(pwd) ./cli doctor`

## CI Parity Checklist

Run in this order when making behavior changes:

1. `pnpm install`
2. `pnpm run check`
3. `bash -n install.sh`
4. `bash scripts/test-smoke.sh`

## Single-Test Focus

This repository currently has one explicit test script:

- `bash scripts/test-smoke.sh`

No Jest/Vitest/Pytest suite is configured.

## Data Model Notes

Current database tables:

- `sessions`
- `events`
- `skills`

Current write semantics use `INSERT OR REPLACE`. Preserve unless requested.

## Output Contracts

- Daily notes: `knowledge/Daily/YYYY-MM-DD.md`
- Decision docs: `knowledge/Decisions/*.md`
- Skill docs: `knowledge/Skills/*.md`

When modifying sync logic:

- Keep deterministic filenames and content sections
- Preserve UTF-8 text output
- Avoid breaking links between session/event metadata and markdown

## Error Handling Expectations

- Invalid JSON input should fail with clear user-facing error
- Schema validation should report actionable field-level issues
- DB lifecycle should always close connections (`try/finally`)
- CLI should terminate with non-zero exit on fatal failure

## Optional MCP/libSQL Integration Pattern

If user asks to evolve memory semantics with MCP/libSQL:

- Treat libSQL as optional enhancement path
- Keep existing local SQLite sync functional as default path
- Add integration behind explicit config and guardrails
- Document required env vars and network assumptions
- Do not silently change persistence backend

Recommended staged rollout:

1. Adapter boundary around persistence/search operations
2. Feature flag for libSQL mode
3. Optional semantic retrieval tools
4. Extra verification for backward compatibility

## Complementary Strategy (How both systems help each other)

Use this architecture when user wants memory to "evolve" without losing reliability:

- Memoria tracks canonical event history and markdown outputs
- MCP/libSQL provides semantic indexing and relationship traversal

Practical split of responsibility:

- Memoria answers: "What exactly happened?"
- MCP/libSQL answers: "What is similar or related?"

Golden rule:

- Persist first, enrich second

This avoids data loss risk while still enabling advanced retrieval.

Suggested runtime pattern:

1. `./cli sync <session.json>`
2. Optional enhancement command if `LIBSQL_URL` is set
3. Report enhancement status explicitly (ran/skipped/failed)

Helper wrapper in this skill:

- `scripts/run-sync-with-enhancement.sh`
