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
    tokenizeQuery,
    effectiveUtility,
    buildCalibration,
    buildRouteUtility,
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

// ── tokenizeQuery: CJK windowing (issue-15) ──────────────────────────────────────────────────────
//
// Chinese has no spaces, so TOKEN_SPLIT_PATTERN — which counts every CJK character as a token
// character — used to collapse a whole question into ONE token that had to appear verbatim. These
// assertions pin the window rule, because it is subtle enough to look like an accident: **n is the
// caller's minLength**, so the FTS path (which asks for 3, against a trigram index) gets 3-grams and
// the coverage/tree path (which asks for 2 and compares with `includes`) gets 2-grams. Handing the
// FTS path 2-grams instead would be worse than doing nothing — they fall below its own length
// filter, the MATCH string comes out empty, and recall drops to a verbatim LIKE.
console.log('[pure] tokenizeQuery (CJK)')

const eqList = (label: string, actual: string[], expected: string[]): void => {
    if (JSON.stringify(actual) === JSON.stringify(expected)) ok(label)
    else fail(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

eqList('a CJK run becomes overlapping n-grams sized by minLength (n=2)',
    tokenizeQuery('伺服器行程', 2), ['伺服', '服器', '器行', '行程'])
eqList('the same run at minLength 3 yields 3-grams, matching the trigram index',
    tokenizeQuery('伺服器行程', 3), ['伺服器', '服器行', '器行程'])
eqList('latin runs stay whole while CJK around them is windowed',
    tokenizeQuery('停掉 memoria 的伺服器', 3), ['memoria', '的伺服', '伺服器'])
eqList('a CJK run shorter than n is kept whole, then judged by the length filter',
    tokenizeQuery('停掉', 3), [])
eqList('latin-only queries are untouched by the windowing',
    tokenizeQuery('pnpm lockfile wins', 2), ['pnpm', 'lockfile', 'wins'])

// The user-visible consequence, taken from the real corpus this was measured on: the question and
// the memory share plenty of Chinese, but not as one contiguous string — so the whole query being a
// single token scored exactly 0 and the memory was never returned.
//
// Note what this case is NOT: a query whose Chinese simply does not appear in the memory (asking
// about 伺服器 when the memory says "server") still scores 0, correctly. That is vocabulary, not
// tokenization, and conflating the two is easy enough that the first draft of this very assertion
// did it.
if (tokenCoverage('版控文件可以寫真實名稱嗎', '隱私採兩層區隔：版控文件用代稱，本機記憶用真實名稱') > 0) {
    ok('a CJK paraphrase now scores above 0 instead of collapsing to a single token')
} else {
    fail('a CJK paraphrase now scores above 0', 'coverage was still 0')
}

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

// ── buildRouteUtility: semantic-vs-lexical uplift readout (RFC-semantic-recall §14) ─────────────
console.log('[pure] buildRouteUtility')

const noOutcomes = buildRouteUtility([
    { route: 'keyword', confidence: 0.8, utility: null },
    { route: 'vector', confidence: 0.7, utility: undefined }
])
eq('rows without an outcome are ignored', noOutcomes.scoredQueries, 0)
eq('no scored rows → no routes', noOutcomes.routes.length, 0)
eq('best is null when nothing is scored', noOutcomes.best, null)

const single = buildRouteUtility([
    { route: 'keyword', confidence: 0.5, utility: 0.6 },
    { route: 'keyword', confidence: 0.7, utility: 0.8 }
])
eq('one route → averaged', single.routes[0].meanUtility, 0.7)
// Declaring a winner with only one contestant would imply a comparison that never happened.
eq('a single route yields no best', single.best, null)
eq('…and no uplift', single.uplift, null)

const compared = buildRouteUtility([
    { route: 'keyword', confidence: 0.5, utility: 0.4 },
    { route: 'keyword', confidence: 0.5, utility: 0.6 },
    { route: 'vector', confidence: 0.6, utility: 0.9 },
    { route: 'vector', confidence: 0.6, utility: 0.7 }
])
eq('two scored routes → totals add up', compared.scoredQueries, 4)
eq('routes are sorted by mean utility, best first', compared.routes[0].route_mode, 'vector')
eq('best names the top route', compared.best, 'vector')
near('uplift is the gap to the runner-up', compared.uplift as number, 0.3, 1e-9)
eq('per-route counts are kept so "not enough data" stays visible', compared.routes[0].scoredQueries, 2)

const missingRoute = buildRouteUtility([{ route: null, confidence: 0.5, utility: 0.5 }])
eq('a missing route_mode is bucketed as unknown rather than dropped', missingRoute.routes[0].route_mode, 'unknown')

const clampedRoute = buildRouteUtility([{ route: 'keyword', confidence: 9, utility: 9 }])
eq('utility is clamped into [0,1]', clampedRoute.routes[0].meanUtility, 1)
eq('confidence is clamped too', clampedRoute.routes[0].meanConfidence, 1)

console.log(failures === 0 ? '[pure] ✓ all assertions passed' : `[pure] ✗ ${failures} assertion(s) failed`)
process.exit(failures === 0 ? 0 : 1)
