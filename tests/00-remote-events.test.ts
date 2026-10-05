import assert from 'node:assert/strict'
import test from 'node:test'
import { onRemoteEvent } from '../web/src/dsh/remote-events.ts'
import { subagentCatalogAddress } from '../web/src/dsh/session-navigation.ts'
import type { DshRemote, SessionListState, SubagentCatalogEntry } from '../web/src/dsh/services.ts'
import { missingContractMembers } from '../web/src/dsh/contract.ts'
import { createMockContext } from '../web/src/dsh/mock/context.ts'

test('onRemoteEvent keeps the remote as this and forwards the payload', () => {
  const calls: unknown[] = []
  let disposed = 0
  const remote: DshRemote = {
    $on(this: unknown, event: string, listener: (...args: unknown[]) => void) {
      calls.push(this === remote, event)
      listener('agent-default-model', 3)
      return () => { disposed++ }
    },
  }
  const received: unknown[] = []
  const off = onRemoteEvent(remote, 'settings/document-updated', (ns, revision) => received.push(ns, revision))
  assert.deepEqual(calls, [true, 'settings/document-updated'])
  assert.deepEqual(received, ['agent-default-model', 3])
  off()
  off()
  assert.equal(disposed, 1)
})

test('onRemoteEvent tolerates a Host without $on or without a disposer', () => {
  assert.doesNotThrow(() => onRemoteEvent({}, 'commands/change', () => {})())
  assert.doesNotThrow(() => onRemoteEvent({ $on: () => undefined }, 'commands/change', () => {})())
})

function listWith(entries: unknown[], state: 'ready' | 'loading' = 'ready'): SessionListState {
  return {
    ids: [], byId: {}, phase: 'ready',
    projectionsBySession: { parent: { state, error: null, values: { subagentCatalog: entries as SubagentCatalogEntry[] } } },
  }
}

test('subagentCatalogAddress reads only ready catalog rows for a child with a known mode', () => {
  assert.deepEqual(subagentCatalogAddress(listWith([{ id: 'child', mode: 'continuable' }]), 'parent', 'child'),
    { parentSessionId: 'parent', childSessionId: 'child', mode: 'continuable' })
  assert.equal(subagentCatalogAddress(listWith([{ id: 'child', mode: 'continuable' }], 'loading'), 'parent', 'child'), undefined)
  assert.equal(subagentCatalogAddress(listWith([{ id: 'child', mode: 'unknown' }]), 'parent', 'child'), undefined)
  assert.equal(subagentCatalogAddress(listWith([{ id: 'child', mode: 'forever' }]), 'parent', 'child'), undefined)
  assert.equal(subagentCatalogAddress(listWith([{ id: 'other', mode: 'one-shot' }]), 'parent', 'child'), undefined)
  assert.equal(subagentCatalogAddress(listWith([]), 'missing-parent', 'child'), undefined)
})

test('the mock context offers every controller member the boot contract requires', () => {
  assert.deepEqual(missingContractMembers(createMockContext()), [])
})

test('missingContractMembers names removed methods and non-observable lists', () => {
  const ctx = createMockContext() as unknown as Record<string, Record<string, unknown>>
  const sessions = { ...ctx.sessions, retain: undefined, list: {} }
  assert.deepEqual(missingContractMembers({ ...ctx, sessions }), ['sessions.list', 'sessions.retain'])
  assert.deepEqual(missingContractMembers({}), ['connection', 'sessions', 'workspaces', 'jobs', 'remote'])
})
