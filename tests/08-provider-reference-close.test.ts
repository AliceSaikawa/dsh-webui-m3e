import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { extendMock } from '../web/src/features/settings/mock.ts'
import { createProviderStore, type ProviderRemote } from '../web/src/features/settings/providers.ts'

test('I16 reference write close M47: 標準の参照書込み中もcanSendで中止して再開できる', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    const remote = ctx.remote as unknown as ProviderRemote
    const description = await remote.settings.describe(); assert.ok(description.ok)
    const ns = description.value.namespaces.find(row => row.ns === 'llm-pi-ai')!
    assert.ok((await remote.settings.mutate(ns.ns, [{ op: 'set', path: ['providers', 'close-ref'], value: {
      api: 'openai-completions', baseURL: 'http://localhost', models: [{ id: 'one' }],
    } }], ns.revision)).ok)
    const directory = remote.llm.listConfigurableProviders, live = remote.llm.listProviders
    remote.llm.listConfigurableProviders = async () => { const result = await directory(); assert.ok(result.ok); return { ok: true, value: result.value.map(row => row.provider === 'close-ref' ? { ...row, declared: false } : row) } }
    remote.llm.listProviders = async () => { const result = await live(); assert.ok(result.ok); return { ok: true, value: result.value.filter(row => row.id !== 'close-ref') } }
    const keys = createProviderStore(remote); await keys.load()
    const target = keys.getSnapshot().rows.find(row => row.id === 'close-ref')!
    assert.equal(target.needsReference, true)
    let active = true, writes = 0, started!: () => void, release!: () => void
    const observed = new Promise<void>(resolve => { started = resolve })
    const held = new Promise<void>(resolve => { release = resolve })
    const update = remote.settings.update
    remote.settings.update = async (...args) => {
      const answer = await update(...args); started(); await held; return answer
    }
    const send = remote.credentials.set
    remote.credentials.set = async (...args) => { writes++; return send(...args) }
    const pending = keys.save(target, 'fake-close-ref', { canSend: () => active })
    await observed
    assert.equal(writes, 0)
    active = false; release()
    assert.equal((await pending).ok, false)
    assert.equal(writes, 0)
    const reopened = createProviderStore(remote); await reopened.load()
    const row = reopened.getSnapshot().rows.find(row => row.id === 'close-ref')!
    assert.equal(row.needsReference, false)
    assert.equal(row.status, 'missing')
    assert.match(row.keyNotice!, /キーの参照先だけが設定されています/)
    assert.equal(row.writable, true)
    assert.equal((await reopened.save(row, 'fake-reference-retry')).ok, true)
    assert.equal(writes, 1)
    assert.equal(reopened.getSnapshot().rows.find(row => row.id === 'close-ref')!.status, 'registered')
  } finally { ctx.dispose() }
})
