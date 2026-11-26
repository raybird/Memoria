#!/usr/bin/env bash
# issue-37 AC-2 baseline: remember output with semantic recall NOT enabled (no LIBSQL_URL).
# Usage: bash docs/issues/issue-37/evidence/baseline.sh <out-dir>
# Volatile fields (timestamp, latency_ms) are removed from the --json lines so runs compare byte for byte.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
OUT="$1"; mkdir -p "$OUT"
H="$(mktemp -d)"; trap 'rm -rf "$H"' EXIT
run() { env -u LIBSQL_URL -u MEMORIA_EMBED_PROVIDER -u MEMORIA_VECTOR_TIMEOUT_MS -u MEMORIA_VECTOR_RECALL_CMD MEMORIA_HOME="$H" "$ROOT/cli" "$@"; }
strip() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);const drop=x=>{if(x&&typeof x==="object"){delete x.timestamp;delete x.latency_ms;for(const v of Object.values(x))drop(v)}};drop(o);console.log(JSON.stringify(o))})'; }
run init >/dev/null
{
  run remember "switched to pnpm because the lockfile is authoritative" --project Demo
  run remember "switched to pnpm because the lockfile is authoritative" --project Demo
  run remember "release branch merged into main" --verify "git log main --oneline -1"
  run remember "use vitest for unit tests" --type skill --durable
} > "$OUT/human.txt"
{
  run remember "json note one" --project Demo --json | strip
  run remember "json note one" --project Demo --json | strip
} > "$OUT/json.txt"
