/**
 * Fail closed on missing, malformed or incomplete Playwright JSON reports.
 * Playwright exits 0 when tests are skipped (test.skip, test.fixme), so the
 * zero-skip rule of the unit tests is enforced here from the report.
 */
export const e2eCountFields = ['tests', 'expected', 'unexpected', 'flaky', 'skipped'] as const
export type E2eCounts = Record<typeof e2eCountFields[number], number>

const outcomes = ['expected', 'unexpected', 'flaky', 'skipped'] as const

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Every test entry in the report, from nested suites and their specs. */
function collectTests(suites: unknown, found: unknown[] = []): unknown[] {
  if (!Array.isArray(suites)) throw new Error('Missing Playwright suites')
  for (const suite of suites) {
    if (!record(suite)) throw new Error('Malformed Playwright suite')
    for (const spec of (suite.specs ?? []) as unknown[]) {
      if (!record(spec) || !Array.isArray(spec.tests)) throw new Error('Malformed Playwright spec')
      found.push(...spec.tests)
    }
    if (suite.suites !== undefined) collectTests(suite.suites, found)
  }
  return found
}

export function evaluateE2eReport(report: string, runnerStatus: number): {
  exitCode: number
  counts?: E2eCounts
  error?: string
} {
  if (!Number.isInteger(runnerStatus) || runnerStatus < 0 || runnerStatus > 255) {
    return { exitCode: 1, error: 'Invalid or missing Playwright exit status' }
  }
  let counts: E2eCounts | undefined
  try {
    const parsed: unknown = JSON.parse(report)
    if (!record(parsed) || !record(parsed.stats)) throw new Error('Missing Playwright stats')
    const stats = parsed.stats
    for (const field of outcomes) {
      if (!Number.isSafeInteger(stats[field]) || (stats[field] as number) < 0) throw new Error(`Invalid browser test count: ${field}`)
    }
    // The stats must agree with the tests actually listed in the report.
    const listed = Object.fromEntries(outcomes.map(outcome => [outcome, 0])) as Record<typeof outcomes[number], number>
    const tests = collectTests(parsed.suites)
    for (const test of tests) {
      const status = record(test) ? test.status : undefined
      if (!outcomes.includes(status as typeof outcomes[number])) throw new Error(`Unknown browser test outcome: ${String(status)}`)
      listed[status as typeof outcomes[number]]++
    }
    counts = { tests: tests.length, ...Object.fromEntries(outcomes.map(field => [field, stats[field]])) } as E2eCounts
    if (outcomes.some(field => listed[field] !== counts![field])) throw new Error('Browser test stats do not match the listed tests')
    if (!Array.isArray(parsed.errors)) throw new Error('Missing Playwright errors')
    if (parsed.errors.length !== 0) throw new Error(`Playwright reported ${parsed.errors.length} error(s) outside tests`)
    if (counts.tests === 0 || counts.expected === 0) throw new Error('No browser tests ran')
    if (counts.skipped !== 0) throw new Error(`Skipped browser tests are forbidden: ${counts.skipped}`)
    if (counts.unexpected !== 0 || counts.flaky !== 0) throw new Error('Browser tests failed or were flaky')
    if (runnerStatus !== 0) throw new Error(`Playwright exited with status ${runnerStatus}`)
    return { exitCode: 0, counts }
  } catch (error) {
    // A valid original failure status always wins, even if the report is broken.
    return { exitCode: runnerStatus || 1, ...(counts ? { counts } : {}),
      error: error instanceof Error ? error.message : String(error) }
  }
}
