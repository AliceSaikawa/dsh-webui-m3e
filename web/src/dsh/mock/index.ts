import { createMockContext as createContext, type MockExtension, type MockOptions } from './context.ts'

export type { MockKit, MockContext, MockOptions, MockExtension } from './context.ts'
export { MOCK_IDS } from './fixtures.ts'

const extensions = import.meta.glob<MockExtension>('../../features/*/mock.ts', { eager: true })

/** Only imported from the DEV branch of main.tsx; feature fixtures auto-register. */
export function createMockContext(options: MockOptions = {}) {
  const scenario = options.scenario ?? new URLSearchParams(globalThis.location?.search ?? '').get('scenario') ?? undefined
  return createContext({ ...options, scenario, extensions: [...Object.keys(extensions).sort().map((key) => extensions[key]!), ...options.extensions ?? []] })
}
