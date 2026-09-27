import { createMockContext as createContext, type MockExtension, type MockOptions } from './context.ts'

export type { MockKit, MockContext, MockOptions, MockExtension } from './context.ts'
export { MOCK_IDS } from './fixtures.ts'

const extensions = import.meta.glob<MockExtension>('../../features/*/mock.ts', { eager: true })

/** Only imported from the DEV branch of main.tsx; feature fixtures auto-register. */
export function createMockContext(options: MockOptions = {}) {
  const scenario = options.scenario ?? new URLSearchParams(globalThis.location?.search ?? '').get('scenario') ?? undefined
  const ctx = createContext({ ...options, scenario, extensions: [...Object.keys(extensions).sort().map((key) => ({ ...extensions[key]!, source: key })), ...options.extensions ?? []] })
  // E2E sets this before loading the mock page; ordinary ?mock has no delay.
  const delay = (globalThis as typeof globalThis & { __m3eTestModelCatalogDelay?: number }).__m3eTestModelCatalogDelay
  if (typeof delay === 'number' && delay > 0 && delay <= 200) {
    const session = ctx.remote.session as { modelCatalog(): Promise<unknown> }
    const modelCatalog = session.modelCatalog.bind(session)
    ctx.mock.patch('remote.session.modelCatalog', async () => {
      await new Promise(resolve => setTimeout(resolve, delay))
      return modelCatalog()
    })
  }
  return ctx
}
