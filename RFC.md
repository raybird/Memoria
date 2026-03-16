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
- Adaptive retrieval gate: `planned`
- Lightweight multi-scope isolation: `planned`
- Memory-quality guardrails: `planned`
- Governance / skill-extraction layer: `idea`

## Design Inputs Worth Absorbing

Recent analysis of production memory plugins suggests these ideas fit Memoria's direction when kept lightweight:

- **Adaptive retrieval**: avoid recall for greetings, slash commands, and trivial confirmations.
- **Scope isolation**: extend beyond `project` when cross-agent or multi-user boundaries become necessary.
- **Quality gating**: suppress noisy / low-value writes before they pollute long-term memory.
- **Score hygiene**: keep ranking fair with recency/length/relevance balancing, without overbuilding a search stack.
- **Governance extraction**: promote repeated lessons into durable skills or operating rules as an optional layer.

These are roadmap candidates, not commitments.

When an RFC item is implemented, update `SPEC.md` and related user docs.
