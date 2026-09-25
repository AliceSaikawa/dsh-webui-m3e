import type { MockKit } from '../../dsh/mock/kit.ts'
import { traceExampleRecords, traceExampleSession, traceExampleWorkspace } from './trace-fixtures.ts'

/** Keep the trace demonstration separate from the shared chat fixtures. */
export function extendMock(kit: MockKit): void {
  kit.addWorkspace(traceExampleWorkspace)
  kit.addSession(traceExampleSession, traceExampleRecords)
}
