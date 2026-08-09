// Direct assertions for the pure ranking/retention/calibration helpers (HANDOVER §5 工程債).
//
// These functions decide which memories rank, survive pruning, and how honest `confidence` looks —
// but until now they were only covered INDIRECTLY, through e2e flows that assert on end results. An
// e2e green tells you the pipeline works; it does not tell you the threshold is 2 rather than 3, or
// that an explicit signal fully overrides the reuse proxy instead of being averaged with it. Those
// are exactly the invariants the RFCs commit to, so they get asserted here at the source.
//
// Run via `pnpm exec tsx` from the repo root (same driver pattern as repo-git-exec-driver.mts).
// No test framework — this repo deliberately has none.

import {
    tokenCoverage,
    effectiveUtility,
    buildCalibration,
    REUSE_UTILITY_MIN_OBS,
    EXPLICIT_UTILITY_MIN_OBS
} from '../src/core/utils.js'
import { computeDecayFactor } from '../src/core/db/recall.js'

let failures = 0

function ok(label: string): void {
    console.log(`  ✓ ${label}`)
}

function fail(label: string, detail: string): void {
    console.error(`  ✗ ${label}: ${detail}`)
    failures += 1
}

function eq(label: string, actual: unknown, expected: unknown): void {
    if (Object.is(actual, expected)) ok(label)
    else fail(label, `expected ${String(expected)}, got ${String(actual)}`)
}

function near(label: string, actual: number, expected: number, tolerance = 1e-9): void {
    if (Math.abs(actual - expected) <= tolerance) ok(label)
    else fail(label, `expected ≈${expected}, got ${actual}`)
}

// ── effectiveUtility: the "never mix signal kinds" contract (RFC-utility-feedback §2.4) ──────────
console.log('[pure] effectiveUtility')

eq('no observations at all → null (caller leaves the memory untouched)',
    effectiveUtility({}), null)

eq(`reuse below the floor (${REUSE_UTILITY_MIN_OBS - 1} obs) → null`,
    effectiveUtility({ observations: REUSE_UTILITY_MIN_OBS - 1, utility_sum: 1 }), null)

near('reuse at the floor → mean of the reuse proxy',
    effectiveUtility({ observations: 2, utility_sum: 1 }) as number, 0.5)

near(`explicit needs only ${EXPLICIT_UTILITY_MIN_OBS} observation`,
    effectiveUtility({ explicit_observations: 1, explicit_sum: 0.9 }) as number, 0.9)

// The whole point of Phase 3(a): one explicit signal outranks any amount of reuse evidence, and the
// two accumulators are never averaged together.
near('explicit fully overrides reuse (not averaged)',
    effectiveUtility({ observations: 10, utility_sum: 0, explicit_observations: 1, explicit_sum: 1 }) as number, 1)
near('…and in the opposite direction too',
    effectiveUtility({ observations: 10, utility_sum: 10, explicit_observations: 1, explicit_sum: 0 }) as number, 0)

near('out-of-range sums are clamped to [0,1] (high)',
    effectiveUtility({ explicit_observations: 1, explicit_sum: 5 }) as number, 1)
near('out-of-range sums are clamped to [0,1] (low)',
    effectiveUtility({ observations: 2, utility_sum: -4 }) as number, 0)

// ── computeDecayFactor: ranking half-life (recall.ts) ────────────────────────────────────────────
console.log('[pure] computeDecayFactor')

near('a memory from the future does not decay', computeDecayFactor(new Date(Date.now() + 60_000).toISOString()), 1)

const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000).toISOString()
near('at one half-life the factor is 0.5', computeDecayFactor(ninetyDaysAgo), 0.5, 1e-4)

const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString()
near('at 365 days the factor matches 1/(1+age/90)', computeDecayFactor(yearAgo), 1 / (1 + 365 / 90), 1e-4)

const older = computeDecayFactor(new Date(Date.now() - 200 * 86_400_000).toISOString())
const newer = computeDecayFactor(new Date(Date.now() - 10 * 86_400_000).toISOString())
if (older < newer) ok('older memories decay strictly more than newer ones')
else fail('decay is monotonic in age', `older=${older} newer=${newer}`)

// A custom half-life is what issue-5's durable exemption divides back out.
near('a durable hit restores its decay-free score by dividing out the factor',
    (0.42 * computeDecayFactor(yearAgo)) / computeDecayFactor(yearAgo), 0.42, 1e-12)

// ── tokenCoverage: the lexical-reuse proxy behind UFL ────────────────────────────────────────────
console.log('[pure] tokenCoverage')

eq('empty query has no coverage', tokenCoverage('', 'anything'), 0)
near('every token present → 1', tokenCoverage('pnpm lockfile', 'we use pnpm because the lockfile wins'), 1)
near('half the tokens present → 0.5', tokenCoverage('pnpm yarn', 'we use pnpm'), 0.5)
near('matching ignores case', tokenCoverage('PNPM', 'we use pnpm'), 1)
near('CJK terms are tokenized, not dropped', tokenCoverage('套件管理器', '改用 pnpm 作為套件管理器'), 1)
near('a CJK term that is absent scores 0', tokenCoverage('資料庫', '改用 pnpm 作為套件管理器'), 0)

// ── buildCalibration: confidence×utility honesty check (UFL Phase 2) ─────────────────────────────
console.log('[pure] buildCalibration')

const empty = buildCalibration([])
eq('no scored points → scoredQueries 0', empty.scoredQueries, 0)
eq('no scored points → no buckets', empty.buckets.length, 0)
eq('monotonic is null (not false) when undecidable', empty.monotonic, null)

const partial = buildCalibration([
    { confidence: 0.9, utility: null },        // no outcome yet
    { confidence: null, utility: 0.5 },        // no confidence
    { confidence: 0.9, utility: 0.8 }          // the only usable point
])
eq('points missing either side are skipped', partial.scoredQueries, 1)
eq('a single bucket cannot establish monotonicity', partial.monotonic, null)

const rising = buildCalibration([
    { confidence: 0.1, utility: 0.1 },
    { confidence: 0.4, utility: 0.4 },
    { confidence: 0.9, utility: 0.9 }
])
eq('utility rising with confidence → monotonic true', rising.monotonic, true)
eq('only non-empty buckets are emitted', rising.buckets.length, 3)

// The failure this metric exists to surface: high confidence that does NOT pay off.
const inverted = buildCalibration([
    { confidence: 0.1, utility: 0.9 },
    { confidence: 0.9, utility: 0.1 }
])
eq('confidence that does not track usefulness → monotonic false', inverted.monotonic, false)

const clamped = buildCalibration([{ confidence: 5, utility: -3 }])
eq('out-of-range inputs are clamped into the top bucket', clamped.buckets[0].meanConfidence, 1)
eq('…and the clamped utility lands at 0', clamped.buckets[0].meanUtility, 0)

console.log(failures === 0 ? '[pure] ✓ all assertions passed' : `[pure] ✗ ${failures} assertion(s) failed`)
process.exit(failures === 0 ? 0 : 1)
