# Memoria RFC / Roadmap Notes

This document tracks planned or exploratory capabilities that are not guaranteed to be implemented yet.

## Candidate Directions

1. Context condensation/checkpoint recovery orchestration in core CLI
2. Native semantic retrieval workflows (beyond MCP bridge)
3. Richer schema migration/versioning strategy
4. Client-specific MCP adapters for Gemini/OpenCode auto wiring
5. Additional observability and performance profiling commands
6. Adaptive retrieval gate to skip unnecessary memory lookups on greetings / control prompts
7. Lightweight multi-scope isolation beyond `project` (for example `agent`, `user`, `global`)
8. Memory-quality guardrails (noise filtering, low-value write suppression, score hygiene)
9. Optional governance layer for extracting durable skills / rules from repeated sessions

## Status Labels

- `idea`: concept only
- `planned`: accepted direction, not yet implemented
- `in-progress`: implementation ongoing
- `done`: shipped in code and reflected in `SPEC.md`

## Current Snapshot

- Context compression in core: `idea`
- Native semantic search in core: `idea`
- OpenCode plugin in-repo: `idea`
- Expanded verify checks and schema migration helpers: `planned`
- Adaptive retrieval gate: `done`
- Lightweight multi-scope isolation: `done`
- Memory-quality guardrails: `done`
- Governance / skill-extraction layer: `idea`

## Design Inputs Worth Absorbing

Recent analysis of production memory plugins suggests these ideas fit Memoria's direction when kept lightweight:

- **Adaptive retrieval**: avoid recall for greetings, slash commands, and trivial confirmations.
- **Scope isolation**: extend beyond `project` when cross-agent or multi-user boundaries become necessary.
- **Quality gating**: suppress noisy / low-value writes before they pollute long-term memory.
- **Score hygiene**: keep ranking fair with recency/length/relevance balancing, without overbuilding a search stack.
- **Governance extraction**: promote repeated lessons into durable skills or operating rules as an optional layer.

These are roadmap candidates, not commitments.

## Proposed Implementation Plan

### Phase A - Adaptive Retrieval Gate

Goal: skip obviously unnecessary recall calls while preserving explicit user memory intent.

- Add a lightweight query classifier before `MemoriaCore.recall()` result selection.
- First-pass rules should be deterministic only:
  - skip greetings / emoji-only / short confirmations
  - force recall on memory-intent phrases like `remember`, `previously`, `last time`
  - preserve explicit `mode=tree|hybrid|keyword` requests
- Return `meta.route_mode=skipped` (or similar) when recall is intentionally bypassed.
- Extend recall telemetry to track skipped queries separately.

Why first:

- Lowest implementation risk
- Immediate latency/cost reduction
- No schema break required

### Phase B - Lightweight Scope Isolation

Goal: extend memory boundaries without turning Memoria into a heavy multi-tenant policy engine.

- Keep `project` as the current compatibility field.
- Add optional scope dimensions in a minimal form, likely one normalized string field first:
  - `scope` values such as `global`, `project:<id>`, `agent:<id>`, `user:<id>`
- Apply scope filtering consistently in:
  - `importSession`
  - `recallKeyword`
  - `recallTree`
  - index build / prune / export
- Keep defaults simple:
  - if unset, derive `scope=project:<project>` when project exists
  - otherwise default to `global`

Why second:

- Enables cleaner cross-agent memory boundaries
- Builds on current `project` model rather than replacing it
- Still preserves Memoria's local-first shape

### Phase C - Memory-Quality Guardrails

Goal: reduce memory pollution before it enters the durable store.

- Add a pre-write screening layer in `remember()` / `importSession()`.
- Start with deterministic heuristics only:
  - reject empty / boilerplate / greeting-only summaries
  - suppress duplicate low-value event payloads
  - cap pathological long summaries unless explicitly preserved
- Record skip reasons in telemetry or structured logs for debugging.
- Keep the guardrail fail-open behind an opt-out env/config switch if needed.

Why third:

- Directly improves long-term recall quality
- Pairs well with adaptive retrieval
- Avoids introducing embeddings or external ranking services

### Phase D - Optional Governance Extraction

Goal: promote repeated lessons into durable operating rules or reusable skills.

- Keep out of the core recall path.
- Build as a secondary command / background workflow, not mandatory runtime logic.
- Candidate shape:
  - `memoria govern review`
  - `memoria govern extract-skill`
- Use existing sessions / decisions / skills as source material.

Why later:

- Higher product/design ambiguity
- Better as an optional layer after retrieval hygiene is solid

## Governance Extraction MVP

The smallest useful version should stay deterministic at selection time and optional at execution time.

### Proposed Commands

- `memoria govern review`
  - scans existing `DecisionMade` + `SkillLearned` material
  - groups repeated/high-signal items
  - outputs a ranked review queue without mutating stored memory
- `memoria govern extract-skill --id <item>`
  - promotes one reviewed governance candidate into a durable skill/rule artifact
  - writes markdown under a dedicated governed path (for example `knowledge/Governance/` or `knowledge/Skills/` with provenance)

### Candidate Selection Rules

First implementation should avoid LLM dependence and rely on simple heuristics:

- repeated normalized decision titles across sessions
- repeated normalized skill names across sessions
- high-impact decisions (`impact_level=high`) with multiple related sessions
- frequently recalled items as optional secondary signal later

### Minimal Data Model

Prefer no new table in the first iteration if possible.

- `govern review` can derive candidates directly from:
  - `events`
  - `sessions`
  - `skills`
- If persistence becomes useful, add a small optional table later:
  - `governance_candidates(id, kind, title, source_count, first_seen_at, last_seen_at, status)`

### Output Shape

Review output should include:

- candidate id
- kind (`decision` | `skill`)
- normalized title
- source session count
- latest session id
- rationale for surfacing (`repeated`, `high-impact`, `high-signal`)

### Non-Goals for Governance MVP

- no automatic rule injection into recall prompts
- no mandatory background worker
- no LLM extraction as a baseline requirement
- no replacement of current `DecisionMade` / `SkillLearned` flow

## Next Concrete Slice

Recommended next implementation step:

1. Add `memoria govern review --json`
2. Surface repeated decisions / skills with deterministic scoring
3. Defer `extract-skill` write path until review output stabilizes

This keeps the first governance release small, inspectable, and easy to test.

## Recommended Execution Order

1. Adaptive retrieval gate
2. Memory-quality guardrails
3. Lightweight scope isolation
4. Optional governance extraction

This order gives the fastest quality win while minimizing schema churn.

When an RFC item is implemented, update `SPEC.md` and related user docs.
