import { createMockContext as createContext, type MockExtension, type MockOptions } from './context.ts'

export type { MockKit, MockContext, MockOptions, MockExtension } from './context.ts'
export { MOCK_IDS } from './fixtures.ts'

const extensions = import.meta.glob<MockExtension>('../../features/*/mock.ts', { eager: true })

/** Only imported from the DEV branch of main.tsx; feature fixtures auto-register. */
export function createMockContext(options: MockOptions = {}) {
  const scenario = options.scenario ?? new URLSearchParams(globalThis.location?.search ?? '').get('scenario') ?? undefined
  const ctx = createContext({ ...options, scenario, extensions: [...Object.keys(extensions).sort().map((key) => ({ ...extensions[key]!, source: key })), ...options.extensions ?? []] })
  // E2E can hold the response until its loading assertions finish. A fixed
  // delay may expire during navigation, before the sheet is even opened.
  // Ordinary ?mock has neither a gate nor a delay; this module is DEV-only.
  const testWindow = globalThis as typeof globalThis & {
    __m3eTestModelCatalogDelay?: number
    __m3eTestModelCatalogGate?: Promise<void>
    __m3eTestChildRequestIdMismatch?: boolean
    __m3eTestChildPromptGate?: Promise<void>
    __m3eTestChildPromptCalls?: number
    __m3eTestChildLoseResponseOnce?: boolean
    __m3eTestSelectModelGate?: Promise<void>
    __m3eTestSelectModelSessionId?: string
  }
  const delay = testWindow.__m3eTestModelCatalogDelay
  if (testWindow.__m3eTestSelectModelGate) {
    const remote = ctx.remote.session as { selectModel(input: { sessionId: string }): Promise<unknown> }
    const selectModel = remote.selectModel.bind(remote)
    ctx.mock.patch('remote.session.selectModel', async (input: { sessionId: string }) => {
      testWindow.__m3eTestSelectModelSessionId = input.sessionId
      await testWindow.__m3eTestSelectModelGate
      return selectModel(input)
    })
  }
  const gate = testWindow.__m3eTestModelCatalogGate
  if (gate || (typeof delay === 'number' && delay > 0 && delay <= 200)) {
    const session = ctx.remote.session as { modelCatalog(): Promise<unknown> }
    const modelCatalog = session.modelCatalog.bind(session)
    ctx.mock.patch('remote.session.modelCatalog', async () => {
      if (gate) await gate
      else await new Promise(resolve => setTimeout(resolve, delay))
      return modelCatalog()
    })
  }
  // Child wire identities are part of the normal controller contract. These
  // flags only gate delivery / lose a response for fault-injection tests.
  if (testWindow.__m3eTestChildRequestIdMismatch || testWindow.__m3eTestChildPromptGate || testWindow.__m3eTestChildLoseResponseOnce) {
    const sessionOf = ctx.sessions.sessionOf.bind(ctx.sessions)
    const wrapped = new WeakSet<object>()
    ctx.mock.patch('sessions.sessionOf', (scope: Parameters<typeof sessionOf>[0]) => {
      const face = sessionOf(scope)
      if (face && !wrapped.has(face) && face.getSnapshot().subagent?.address?.mode === 'continuable') {
        wrapped.add(face)
        const prompt = face.prompt.bind(face)
        face.prompt = async (content, mode, signal, requestId) => {
          testWindow.__m3eTestChildPromptCalls = (testWindow.__m3eTestChildPromptCalls ?? 0) + 1
          if (testWindow.__m3eTestChildPromptGate) await testWindow.__m3eTestChildPromptGate
          const result = await prompt(content, mode, signal, requestId)
          if (result.ok && testWindow.__m3eTestChildLoseResponseOnce) {
            testWindow.__m3eTestChildLoseResponseOnce = false
            return { ok: false, error: { code: 'gateway/internal', message: 'synthetic carrier lost the accepted response', details: {} } }
          }
          return result
        }
      }
      return face
    })
  }
  return ctx
}
