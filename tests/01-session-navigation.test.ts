import assert from 'node:assert/strict'
import test, { afterEach } from 'node:test'
import { createMockContext, type MockContext } from '../web/src/dsh/mock/context.ts'
const contexts: MockContext[] = []
afterEach(() => { for (const ctx of contexts.splice(0)) ctx.dispose() })
import type { SessionListState, SessionSummary, SessionProjectionSnapshot } from '../web/src/dsh/services.ts'
import { RemoteCallError } from '../web/src/dsh/remote-result.ts'
import { canEditHomeSession, openHomeSession } from '../web/src/features/home/session-navigation.ts'

const child: SessionSummary = { retainedBy: {}, id: 'child/日本語', parentId: 'parent', origin: 'subagent', displayTitle: '子の会話', running: false, blank: false, updatedAt: 0 }
function catalog(mode: 'one-shot' | 'continuable'): SessionProjectionSnapshot {
  return { state: 'ready', error: null, values: { subagentCatalog: [{ id: child.id, mode, label: '子の会話', createdAt: 0 }] } }
}
function fixture(initial?: SessionProjectionSnapshot) {
  const ctx = createMockContext(); contexts.push(ctx)
  ctx.mock.addSession(child, [])
  ctx.mock.setProjection(child.id, 'subagent', { mode: initial?.values.subagentCatalog?.[0]?.mode ?? 'continuable', seq: 0 })
  let snapshot: SessionListState = {
    ids: [child.id], byId: { [child.id]: child }, phase: 'ready',
    projectionsBySession: initial ? { parent: initial } : {},
  }
  const calls: unknown[] = []
  return {
    calls,
    updateCatalog(value: SessionProjectionSnapshot) { snapshot = { ...snapshot, projectionsBySession: { parent: value } } },
    sessions: {
      ...ctx.sessions,
      list: { getSnapshot: () => snapshot, subscribe: () => () => {} },
      async refreshProjections(id: string) { calls.push(['refresh', id]) },
      retain(target: import('../web/src/dsh/services.ts').SessionTarget, options: import('../web/src/dsh/services.ts').SessionRetainOptions) { calls.push([options.source === 'm3e.navigation' ? 'prepare' : 'select', target]); return ctx.sessions.retain(target, options) },
    },
    navigate: (path: string) => { calls.push(['navigate', path]) },
  }
}

test('child selection includes its catalog mode and occurs before route navigation', async () => {
  for (const mode of ['one-shot', 'continuable'] as const) {
    const f = fixture(catalog(mode))
    await openHomeSession(f.sessions, child, f.navigate)
    assert.deepEqual(f.calls, [
      ['prepare', { parentSessionId: 'parent', childSessionId: child.id, mode }],
      ['select', { parentSessionId: 'parent', childSessionId: child.id, mode }],
      ['navigate', `/s/${encodeURIComponent(child.id)}`],
    ])
  }
})

test('an unloaded child catalog is refreshed and the new snapshot supplies the address', async () => {
  const f = fixture()
  f.sessions.refreshProjections = async id => { f.calls.push(['refresh', id]); f.updateCatalog(catalog('continuable')) }
  await openHomeSession(f.sessions, child, f.navigate)
  assert.deepEqual(f.calls, [
    ['refresh', 'parent'], ['prepare', { parentSessionId: 'parent', childSessionId: child.id, mode: 'continuable' }], ['select', { parentSessionId: 'parent', childSessionId: child.id, mode: 'continuable' }],
    ['navigate', `/s/${encodeURIComponent(child.id)}`],
  ])
})

test('catalog errors returned through state prevent selection and navigation', async () => {
  const f = fixture()
  const error = { code: 'gateway/internal', message: 'Internal failure', details: {} }
  f.sessions.refreshProjections = async () => { f.updateCatalog({ state: 'error', error, values: {} }) }
  await assert.rejects(openHomeSession(f.sessions, child, f.navigate), cause => cause instanceof RemoteCallError && cause.rpcError === error)
  assert.deepEqual(f.calls, [])
})

test('missing parents, invalid entries and failed selection never fall through to a normal session route', async () => {
  const f = fixture()
  await assert.rejects(openHomeSession(f.sessions, { ...child, parentId: undefined }, f.navigate))
  assert.deepEqual(f.calls, [])
  for (const entry of [{ id: 'different-child', mode: 'one-shot' as const, createdAt: 0 }, { id: child.id, mode: 'unknown' as const, createdAt: 0 }]) {
    const invalid = fixture({ state: 'ready', error: null, values: { subagentCatalog: [entry] } })
    await assert.rejects(openHomeSession(invalid.sessions, child, invalid.navigate))
    assert.deepEqual(invalid.calls, [['refresh', 'parent']])
  }
  const rejected = fixture(catalog('one-shot'))
  rejected.sessions.retain = () => { throw new Error('カタログが変わりました') }
  await assert.rejects(openHomeSession(rejected.sessions, child, rejected.navigate))
  assert.deepEqual(rejected.calls, [])
})

test('leaving the list while its child catalog loads cancels the pending navigation', async () => {
  const f = fixture()
  let active = true
  f.sessions.refreshProjections = async () => { f.updateCatalog(catalog('one-shot')); active = false }
  await openHomeSession(f.sessions, child, f.navigate, () => active)
  assert.deepEqual(f.calls, [])
})

test('normal sessions use URL selection while child and missing rows cannot be changed', async () => {
  const f = fixture()
  const normal = { ...child, origin: undefined, parentId: undefined }
  await openHomeSession(f.sessions, normal, f.navigate)
  assert.deepEqual(f.calls, [['navigate', `/s/${encodeURIComponent(child.id)}`]])
  assert.equal(canEditHomeSession(normal), true)
  assert.equal(canEditHomeSession(child), false)
  assert.equal(canEditHomeSession(undefined), false)
})
