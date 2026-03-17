#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_MEMORIA_HOME="$(mktemp -d)"
trap 'rm -rf "$TMP_MEMORIA_HOME"' EXIT

SESSION_FILE="$ROOT_DIR/examples/session.sample.json"

if [ ! -f "$SESSION_FILE" ]; then
  echo "Missing sample session: $SESSION_FILE"
  exit 1
fi

echo "[smoke] init"
MEMORIA_HOME="$TMP_MEMORIA_HOME" "$ROOT_DIR/cli" init

echo "[smoke] sync"
MEMORIA_HOME="$TMP_MEMORIA_HOME" "$ROOT_DIR/cli" sync "$SESSION_FILE"

echo "[smoke] quality guardrails"
GUARDRAIL_FILE="$TMP_MEMORIA_HOME/guardrail-session.json"
cat > "$GUARDRAIL_FILE" <<'JSON'
{
  "id": "session_guardrail_001",
  "timestamp": "2026-03-16T10:00:00Z",
  "project": "Memoria",
  "summary": "hi",
  "events": [
    {
      "timestamp": "2026-03-16T10:00:01Z",
      "type": "UserMessage",
      "content": { "text": "Need to remember TS-first migration guardrails" },
      "metadata": { "channel": "cli" }
    },
    {
      "timestamp": "2026-03-16T10:00:01Z",
      "type": "UserMessage",
      "content": { "text": "Need to remember TS-first migration guardrails" },
      "metadata": { "channel": "cli" }
    }
  ]
}
JSON
MEMORIA_HOME="$TMP_MEMORIA_HOME" "$ROOT_DIR/cli" sync "$GUARDRAIL_FILE" >/dev/null
node - <<'NODE' "$TMP_MEMORIA_HOME/.memory/sessions.db"
const Database = require('better-sqlite3')
const db = new Database(process.argv[2], { readonly: true })
const session = db.prepare('SELECT event_count, summary FROM sessions WHERE id = ?').get('session_guardrail_001')
if (!session) throw new Error('guardrail session missing')
if (session.event_count !== 1) throw new Error(`expected duplicate suppression to keep 1 event, got ${session.event_count}`)
if (!String(session.summary).includes('TS-first migration guardrails')) {
  throw new Error(`expected derived summary from signal event, got: ${session.summary}`)
}
db.close()
NODE

echo "[smoke] scope isolation"
SCOPE_FILE="$TMP_MEMORIA_HOME/scope-session.json"
cat > "$SCOPE_FILE" <<'JSON'
{
  "id": "session_scope_001",
  "timestamp": "2026-03-16T11:00:00Z",
  "project": "Memoria",
  "scope": "agent:alpha",
  "summary": "Agent alpha remembers scope-filtered planning",
  "events": [
    {
      "timestamp": "2026-03-16T11:00:01Z",
      "type": "UserMessage",
      "content": { "text": "Agent alpha planning memory" },
      "metadata": { "channel": "cli" }
    }
  ]
}
JSON
MEMORIA_HOME="$TMP_MEMORIA_HOME" "$ROOT_DIR/cli" sync "$SCOPE_FILE" >/dev/null

echo "[smoke] governance review"
GOV1_FILE="$TMP_MEMORIA_HOME/governance-1.json"
GOV2_FILE="$TMP_MEMORIA_HOME/governance-2.json"
cat > "$GOV1_FILE" <<'JSON'
{
  "id": "session_govern_001",
  "timestamp": "2026-03-16T12:00:00Z",
  "project": "Memoria",
  "summary": "Governance candidate one",
  "events": [
    {
      "timestamp": "2026-03-16T12:00:05Z",
      "type": "DecisionMade",
      "content": {
        "decision": "Prefer deterministic governance review",
        "impact_level": "high"
      },
      "metadata": {}
    },
    {
      "timestamp": "2026-03-16T12:00:10Z",
      "type": "SkillLearned",
      "content": {
        "skill_name": "Governance Review",
        "category": "process"
      },
      "metadata": {}
    }
  ]
}
JSON
cat > "$GOV2_FILE" <<'JSON'
{
  "id": "session_govern_002",
  "timestamp": "2026-03-16T13:00:00Z",
  "project": "Memoria",
  "summary": "Governance candidate two",
  "events": [
    {
      "timestamp": "2026-03-16T13:00:05Z",
      "type": "DecisionMade",
      "content": {
        "decision": "Prefer deterministic governance review",
        "impact_level": "medium"
      },
      "metadata": {}
    },
    {
      "timestamp": "2026-03-16T13:00:10Z",
      "type": "SkillLearned",
      "content": {
        "skill_name": "Governance Review",
        "category": "process"
      },
      "metadata": {}
    }
  ]
}
JSON
MEMORIA_HOME="$TMP_MEMORIA_HOME" "$ROOT_DIR/cli" sync "$GOV1_FILE" >/dev/null
MEMORIA_HOME="$TMP_MEMORIA_HOME" "$ROOT_DIR/cli" sync "$GOV2_FILE" >/dev/null
GOVERN_JSON=$(MEMORIA_HOME="$TMP_MEMORIA_HOME" "$ROOT_DIR/cli" govern review --json)
node -e "const data=JSON.parse(process.argv[1]); const items=data?.data?.items ?? []; if(items.length < 2) throw new Error('expected governance candidates'); if(!items.some((x)=>x.kind==='decision' && x.normalized_title==='prefer_deterministic_governance_review')) throw new Error('missing decision candidate'); if(!items.some((x)=>x.kind==='skill' && x.normalized_title==='governance_review')) throw new Error('missing skill candidate');" "$GOVERN_JSON"

echo "[smoke] verify"
MEMORIA_HOME="$TMP_MEMORIA_HOME" "$ROOT_DIR/cli" verify

echo "[smoke] export"
MEMORIA_HOME="$TMP_MEMORIA_HOME" "$ROOT_DIR/cli" export --type all --format json --out "$TMP_MEMORIA_HOME/.memory/exports"

echo "[smoke] prune(dry-run)"
MEMORIA_HOME="$TMP_MEMORIA_HOME" "$ROOT_DIR/cli" prune --all --dry-run

echo "[smoke] stats(json)"
STATS_JSON=$(MEMORIA_HOME="$TMP_MEMORIA_HOME" "$ROOT_DIR/cli" stats --json)
node -e "const data=JSON.parse(process.argv[1]); if(!data?.data?.recallRouting){ throw new Error('missing recallRouting in stats') }" "$STATS_JSON"

echo "[smoke] adaptive recall skip"
MEMORIA_HOME="$TMP_MEMORIA_HOME" "$ROOT_DIR/cli" serve --port 3941 --json >/tmp/memoria-smoke-serve.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true; rm -rf "$TMP_MEMORIA_HOME"' EXIT
sleep 1
SKIP_JSON=$(curl -sf -X POST http://localhost:3941/v1/recall -H 'Content-Type: application/json' -d '{"query":"hi"}')
node -e "const data=JSON.parse(process.argv[1]); if(data?.meta?.route_mode!=='skipped'){ throw new Error('expected skipped route_mode') }" "$SKIP_JSON"
SCOPE_JSON=$(curl -sf -X POST http://localhost:3941/v1/recall -H 'Content-Type: application/json' -d '{"query":"planning","scope":"agent:alpha","mode":"keyword"}')
node -e "const data=JSON.parse(process.argv[1]); if(!Array.isArray(data?.data) || data.data.length<1){ throw new Error('expected scoped recall hits') }" "$SCOPE_JSON"
WRONG_SCOPE_JSON=$(curl -sf -X POST http://localhost:3941/v1/recall -H 'Content-Type: application/json' -d '{"query":"planning","scope":"agent:beta","mode":"keyword"}')
node -e "const data=JSON.parse(process.argv[1]); if(!Array.isArray(data?.data) || data.data.length!==0){ throw new Error('expected empty recall hits for wrong scope') }" "$WRONG_SCOPE_JSON"
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true
trap 'rm -rf "$TMP_MEMORIA_HOME"' EXIT

if [ ! -f "$TMP_MEMORIA_HOME/.memory/sessions.db" ]; then
  echo "sessions.db was not created"
  exit 1
fi

DAILY_COUNT=$(ls "$TMP_MEMORIA_HOME/knowledge/Daily"/*.md 2>/dev/null | wc -l | tr -d ' ')
DECISION_COUNT=$(ls "$TMP_MEMORIA_HOME/knowledge/Decisions"/*.md 2>/dev/null | wc -l | tr -d ' ')
SKILL_COUNT=$(ls "$TMP_MEMORIA_HOME/knowledge/Skills"/*.md 2>/dev/null | wc -l | tr -d ' ')

if [ "$DAILY_COUNT" -lt 1 ] || [ "$DECISION_COUNT" -lt 1 ] || [ "$SKILL_COUNT" -lt 1 ]; then
  echo "Expected synced markdown outputs were not created"
  echo "Daily: $DAILY_COUNT Decisions: $DECISION_COUNT Skills: $SKILL_COUNT"
  exit 1
fi

echo "[smoke] ok"
