import { readFileSync } from 'node:fs'
import { evaluateE2eReport } from './ci-e2e-results.ts'

const [path, status] = process.argv.slice(2)
const runnerStatus = status !== undefined && /^(0|[1-9]\d{0,2})$/.test(status) ? Number(status) : NaN
let report = ''
try {
  if (!path) throw new Error('Missing Playwright report path')
  report = readFileSync(path, 'utf8')
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
}
const result = evaluateE2eReport(report, runnerStatus)
console.log(JSON.stringify({ runnerStatus, ...result }))
process.exitCode = result.exitCode
