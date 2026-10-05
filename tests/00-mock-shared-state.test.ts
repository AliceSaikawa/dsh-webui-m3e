import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext, type MockExtension } from '../web/src/dsh/mock/context.ts'
import { MOCK_IDS } from '../web/src/dsh/mock/fixtures.ts'

const sessionId = MOCK_IDS.sessions.readme
type Selection = { lastUsed: { provider: string; model: string } | null; next: { provider: string; model: string } | null }

test('settings readers expose the current owner value without storing a second copy', () => {
  let permission = { defaultPreset: 'workspace-write', options: ['workspace-write', 'full'] }
  const context = createMockContext()
  try {
    const kit = context.mock
    assert.equal(kit.getSettingsValue('permission'), undefined)
    kit.registerSettingsReader(namespace => namespace === 'permission' ? permission : undefined)
    assert.equal(kit.getSettingsValue('unknown'), undefined)
    const copy = kit.getSettingsValue<typeof permission>('permission')!
    copy.defaultPreset = 'changed'
    copy.options.push('changed')
    assert.deepEqual(permission, { defaultPreset: 'workspace-write', options: ['workspace-write', 'full'] })
    permission = { ...permission, defaultPreset: 'full' }
    assert.equal(kit.getSettingsValue<typeof permission>('permission')?.defaultPreset, 'full')
  } finally { context.dispose() }
  assert.equal(context.mock.getSettingsValue('permission'), undefined)
})

test('settings reader registration is isolated per context and first registration wins', (t) => {
  const warnings: unknown[][] = []
  t.mock.method(console, 'warn', (...values: unknown[]) => { warnings.push(values) })
  const first = createMockContext()
  const second = createMockContext()
  try {
    first.mock.registerSettingsReader(() => ({ defaultPreset: 'first' }))
    first.mock.registerSettingsReader(() => ({ defaultPreset: 'second' }))
    assert.equal(first.mock.getSettingsValue<{ defaultPreset: string }>('permission')?.defaultPreset, 'first')
    assert.equal(second.mock.getSettingsValue('permission'), undefined)
    assert.equal(warnings.length, 1)
  } finally { first.dispose(); second.dispose() }
})

test('separate feature extensions can initialize a new session from the latest settings', async () => {
  let defaultPreset = 'workspace-write'
  const composer: MockExtension = { extendMock(kit) {
    const add = kit.addSession.bind(kit)
    kit.addSession = (summary, records) => {
      add(summary, records)
      const settings = kit.getSettingsValue<{ defaultPreset: string }>('permission')
      kit.setProjection(summary.id, 'permissions', { currentValue: settings?.defaultPreset ?? 'workspace-write' })
    }
  } }
  const settings: MockExtension = { extendMock(kit) {
    kit.registerSettingsReader(namespace => namespace === 'permission' ? { defaultPreset } : undefined)
  } }
  const context = createMockContext({ extensions: [composer, settings] })
  try {
    defaultPreset = 'full'
    const created = await context.sessions.create({ workspaceId: MOCK_IDS.workspaces.m3e })
    assert.equal(context.mock.getProjection<{ currentValue: string }>(created, 'permissions')?.currentValue, 'full')
  } finally { context.dispose() }
})

test('projection updates share the latest value and preserve fields written by other features', () => {
  const context = createMockContext()
  try {
    const kit = context.mock
    const used = { provider: 'deepseek', model: 'previous' }
    const next = { provider: 'ollama', model: 'next' }
    const projection = context.sessions.retain(sessionId, { source: 'm3e.test' }).binding.session.projections.faceOf('modelSelection')
    let projectionChanges = 0
    let listChanges = 0
    const stopProjection = projection.subscribe(() => { projectionChanges++ })
    const stopList = context.sessions.list.subscribe(() => { listChanges++ })
    try {
      kit.setProjection(sessionId, 'modelSelection', { lastUsed: used, next: null })
      kit.updateProjection<Selection>(sessionId, 'modelSelection', current => ({ lastUsed: current?.lastUsed ?? null, next }))
      const expected = { lastUsed: used, next }
      assert.deepEqual(kit.getProjection(sessionId, 'modelSelection'), expected)
      assert.deepEqual(projection.getSnapshot(), expected)
      assert.deepEqual(context.sessions.list.getSnapshot().byId[sessionId]?.projectionValues?.modelSelection, expected)
      assert.equal(projectionChanges, 2)
      assert.equal(listChanges, 2)
    } finally { stopProjection(); stopList() }
  } finally { context.dispose() }
})

test('projection writes and update callbacks cannot leak mutations into stored state', () => {
  const context = createMockContext()
  try {
    const kit = context.mock
    const input = { nested: { values: ['first'] } }
    kit.setProjection(sessionId, 'shared-test', input)
    input.nested.values.push('outside')
    const first = kit.getProjection<typeof input>(sessionId, 'shared-test')!
    first.nested.values.push('read-copy')
    assert.deepEqual(kit.getProjection(sessionId, 'shared-test'), { nested: { values: ['first'] } })
    let callbackCopy: typeof input | undefined
    kit.updateProjection<typeof input>(sessionId, 'shared-test', current => {
      callbackCopy = current!
      callbackCopy.nested.values.push('second')
      return callbackCopy
    })
    callbackCopy!.nested.values.push('after-return')
    assert.deepEqual(kit.getProjection(sessionId, 'shared-test'), { nested: { values: ['first', 'second'] } })
    const before = context.sessions.list.getSnapshot()
    assert.throws(() => kit.updateProjection<typeof input>(sessionId, 'shared-test', current => {
      current!.nested.values.push('failed')
      throw new Error('updater failed')
    }), /updater failed/)
    assert.equal(context.sessions.list.getSnapshot(), before)
    assert.deepEqual(kit.getProjection(sessionId, 'shared-test'), { nested: { values: ['first', 'second'] } })
  } finally { context.dispose() }
})

test('projection helpers distinguish absent keys and unknown sessions and remain isolated', () => {
  const first = createMockContext()
  const second = createMockContext()
  try {
    assert.equal(first.mock.getProjection(sessionId, 'new-key'), undefined)
    first.mock.updateProjection<{ count: number }>(sessionId, 'new-key', current => ({ count: (current?.count ?? 0) + 1 }))
    assert.deepEqual(first.mock.getProjection(sessionId, 'new-key'), { count: 1 })
    assert.equal(second.mock.getProjection(sessionId, 'new-key'), undefined)
    assert.throws(() => first.mock.getProjection('missing-session', 'new-key'), /偽のセッションが見つかりません/)
    let called = false
    assert.throws(() => first.mock.updateProjection('missing-session', 'new-key', () => { called = true; return {} }), /偽のセッションが見つかりません/)
    assert.equal(called, false)
  } finally { first.dispose(); second.dispose() }
})

test('scenario checks are available during feature registration and preserve scenario setup order', () => {
  const effects: string[] = []
  const options = { scenario: 'inbox-demo', extensions: [{ extendMock(kit) {
    if (kit.isScenario(undefined, 'home-demo')) effects.push('home-request')
    if (kit.isScenario('inbox-demo')) effects.push('inbox-request')
    kit.scenario('inbox-demo', () => { effects.push('inbox-setup') })
  } } as MockExtension] }
  const context = createMockContext(options)
  const defaultContext = createMockContext()
  try {
    assert.deepEqual(effects, ['inbox-request', 'inbox-setup'])
    assert.equal(context.mock.isScenario('inbox-demo'), true)
    assert.equal(context.mock.isScenario(undefined), false)
    assert.equal(defaultContext.mock.isScenario(undefined), true)
    assert.equal(defaultContext.mock.isScenario(), false)
    options.scenario = 'home-demo'
    assert.equal(context.mock.isScenario('inbox-demo'), true)
  } finally { context.dispose(); defaultContext.dispose() }
})
