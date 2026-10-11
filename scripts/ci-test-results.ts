/** Fail closed on missing, malformed or incomplete Node test summaries. */
export const countFields = ['tests', 'passed', 'failed', 'cancelled', 'skipped', 'todo', 'suites', 'topLevel'] as const
export type Counts = Record<typeof countFields[number], number>

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function evaluateTestReport(report: string, runnerStatus: number): {
  exitCode: number
  counts?: Counts
  error?: string
} {
  if (!Number.isInteger(runnerStatus) || runnerStatus < 0 || runnerStatus > 255) {
    return { exitCode: 1, error: 'Invalid or missing test runner exit status' }
  }
  let counts: Counts | undefined
  try {
    const summary: unknown = JSON.parse(report)
    if (!record(summary) || !record(summary.counts)) throw new Error('Missing Node test counts')
    const values = summary.counts
    for (const field of countFields) {
      if (!Number.isSafeInteger(values[field]) || (values[field] as number) < 0) {
        throw new Error(`Invalid test count: ${field}`)
      }
    }
    counts = Object.fromEntries(countFields.map(field => [field, values[field]])) as Counts
    if (typeof summary.success !== 'boolean' || typeof summary.duration_ms !== 'number'
      || !Number.isFinite(summary.duration_ms) || summary.duration_ms < 0 || summary.file !== undefined) {
      throw new Error('Malformed or non-cumulative Node test summary')
    }
    if (counts.tests === 0 || counts.topLevel === 0 || counts.topLevel > counts.tests + counts.suites) {
      throw new Error('Empty or inconsistent Node test totals')
    }
    if (counts.skipped !== 0) throw new Error(`Skipped tests are forbidden: ${counts.skipped}`)
    if (counts.failed !== 0 || counts.cancelled !== 0 || counts.todo !== 0 || !summary.success) {
      throw new Error('Tests failed, were cancelled, marked TODO or did not finish successfully')
    }
    if (counts.passed !== counts.tests) throw new Error('Passed count does not match total test count')
    if (runnerStatus !== 0) throw new Error(`Test runner exited with status ${runnerStatus}`)
    return { exitCode: 0, counts }
  } catch (error) {
    // A valid original failure status always wins, even if the report is broken.
    return { exitCode: runnerStatus || 1, ...(counts ? { counts } : {}),
      error: error instanceof Error ? error.message : String(error) }
  }
}
