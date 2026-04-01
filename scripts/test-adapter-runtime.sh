#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "[adapter-runtime] construct BaseAdapter with URL string under native ESM"
pnpm exec tsc \
  --outDir "$TMP_DIR" \
  --module NodeNext \
  --moduleResolution NodeNext \
  --target ES2022 \
  --esModuleInterop \
  --skipLibCheck \
  src/adapter/adapter.ts src/sdk.ts src/core/types.ts

node --input-type=module <<EOF
import { pathToFileURL } from 'node:url'

const moduleUrl = pathToFileURL('${TMP_DIR}/adapter/adapter.js').href
const { BaseAdapter } = await import(moduleUrl)

class TestAdapter extends BaseAdapter {}

new TestAdapter({ client: 'http://localhost:3917' })
EOF

echo "[adapter-runtime] ok"
