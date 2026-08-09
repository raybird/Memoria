#!/usr/bin/env bash
# Direct coverage for the pure ranking/retention/calibration helpers (HANDOVER §5 工程債).
#
# effectiveUtility / computeDecayFactor / tokenCoverage / buildCalibration decide what ranks, what
# survives pruning, and how honest `confidence` looks — but every existing test reaches them only
# through an e2e flow. This runs the assertions against the functions themselves, so a changed
# threshold or a signal-mixing regression fails here instead of silently shifting rankings.
#
# Same driver pattern as scripts/test-repo-git-exec.sh: a tsx driver, no test framework.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "[pure] run assertions via tsx"
(cd "$ROOT_DIR" && pnpm exec tsx scripts/pure-fn-driver.mts)

echo "[pure] ok"
