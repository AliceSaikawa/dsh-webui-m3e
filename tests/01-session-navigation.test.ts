import assert from 'node:assert/strict'
import test from 'node:test'
import type { SessionListState, SessionSummary, SubagentCatalogSnapshot } from '../web/src/dsh/services.ts'
import { RemoteCallError } from '../web/src/dsh/remote-result.ts'
import { canEditHomeSession, openHomeSession } from '../web/src/features/home/session-navigation.ts'

const child: SessionSummary = { id: 'child/日本語', parentId: 'parent', origin: 'subagent', displayTitle: '子の会話', running: false, blank: false, updatedAt: 0 }
function catalog(mode: 'one-shot' | 'continuable'): SubagentCatalogSnapshot {
  return { state: 'ready', error: null, entries: [{ kind: 'child', id: child.id, mode, activity: 'inactive', label: '子の会話', hasChildren: false }] }
}
function fixture(initial?: SubagentCatalogSnapshot) {
  let snapshot: SessionListState = {
    ids: [child.id], byId: { [child.id]: child }, phase: 'ready', current: undefined, currentAddress: undefined,
    jobsBySession: {}, subagentsByParent: initial ? { parent: initial } : {},
  }
  const calls: unknown[] = []
  return {
    calls,
    updateCatalog(value: SubagentCatalogSnapshot) { snapshot = { ...snapshot, subagentsByParent: { parent: value } } },
    sessions: {
      list: { getSnapshot: () => snapshot, subscribe: () => () => {} },
      async refreshSubagents(id: string) { calls.push(['refresh', id]) },
      openSubagent(address: unknown) { calls.push(['select', address]) },
    },
    navigate: (path: string) => { calls.push(['navigate', path]) },
  }
}

test('child selection includes its catalog mode and occurs before route navigation', async () => {
  for (const mode of ['one-shot', 'continuable'] as const) {
    const f = fixture(catalog(mode))
    await openHomeSession(f.sessions, child, f.navigate)
    assert.deepEqual(f.calls, [
      ['select', { parentSessionId: 'parent', childSessionId: child.id, mode }],
      ['navigate', `/s/${encodeURIComponent(child.id)}`],
    ])
  }
})

test('an unloaded child catalog is refreshed and the new snapshot supplies the address', async () => {
  const f = fixture()
  f.sessions.refreshSubagents = async id => { f.calls.push(['refresh', id]); f.updateCatalog(catalog('continuable')) }
  await openHomeSession(f.sessions, child, f.navigate)
  assert.deepEqual(f.calls, [
    ['refresh', 'parent'], ['select', { parentSessionId: 'parent', childSessionId: child.id, mode: 'continuable' }],
    ['navigate', `/s/${encodeURIComponent(child.id)}`],
  ])
})

test('catalog errors returned through state prevent selection and navigation', async () => {
  const f = fixture()
  const error = { code: 'gateway/internal', message: 'Internal failure', details: {} }
  f.sessions.refreshSubagents = async () => { f.updateCatalog({ state: 'error', error }) }
  await assert.rejects(openHomeSession(f.sessions, child, f.navigate), cause => cause instanceof RemoteCallError && cause.rpcError === error)
  assert.deepEqual(f.calls, [])
})

test('missing parents, invalid entries and failed selection never fall through to a normal session route', async () => {
  const f = fixture()
  await assert.rejects(openHomeSession(f.sessions, { ...child, parentId: undefined }, f.navigate))
  assert.deepEqual(f.calls, [])
  for (const entry of [{ kind: 'child', id: child.id }, { kind: 'diagnostic', id: child.id, mode: 'one-shot' }]) {
    const invalid = fixture({ state: 'ready', error: null, entries: [entry] })
    await assert.rejects(openHomeSession(invalid.sessions, child, invalid.navigate))
    assert.deepEqual(invalid.calls, [['refresh', 'parent']])
  }
  const rejected = fixture(catalog('one-shot'))
  rejected.sessions.openSubagent = () => { throw new Error('カタログが変わりました') }
  await assert.rejects(openHomeSession(rejected.sessions, child, rejected.navigate))
  assert.deepEqual(rejected.calls, [])
})

test('leaving the list while its child catalog loads cancels the pending navigation', async () => {
  const f = fixture()
  let active = true
  f.sessions.refreshSubagents = async () => { f.updateCatalog(catalog('one-shot')); active = false }
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
