import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { extendMock } from '../web/src/features/settings/mock.ts'
import { createProviderStore, type ProviderRemote } from '../web/src/features/settings/providers.ts'
import { inspectCustomKey } from '../web/src/features/settings/custom-provider-key.ts'
import { createCustomProviderStore } from '../web/src/features/settings/custom-provider-store.ts'
import { modelDraft } from '../web/src/features/settings/custom-provider.ts'

test('I16 destination RPC: 既存キーと未登録を実際の照会で区別する', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    const remote = ctx.remote as unknown as ProviderRemote, keys = createProviderStore(remote)
    await keys.load()
    const existing = keys.getSnapshot().rows.find(row => row.id === 'deepseek')!
    assert.deepEqual(await inspectCustomKey(remote, existing.ref!), { configured: true, writable: true })
    assert.deepEqual(await inspectCustomKey(remote, 'UNUSED_CUSTOM_API_KEY'), { configured: false, writable: true })
  } finally { ctx.dispose() }
})

test('I16 orphan destination: 設定から外された登録済みキーにも新しい参照を付けない', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    const remote = ctx.remote as unknown as ProviderRemote, keys = createProviderStore(remote)
    await keys.load()
    assert.ok((await keys.save(keys.getSnapshot().rows.find(row => row.id === 'cloud')!, 'fake-retained')).ok)
    const desc = await remote.settings.describe(); assert.ok(desc.ok)
    const ns = desc.value.namespaces.find(row => row.ns === 'llm-pi-ai')!
    assert.ok((await remote.settings.mutate(ns.ns, [{ op: 'set', path: ['providers', 'cloud', 'apiKeyEnv'], value: 'OTHER_CLOUD_API_KEY' }], ns.revision)).ok)
    const before = await remote.settings.describe()
    const form = createCustomProviderStore(remote, keys); await form.load()
    form.change(draft => ({ ...draft, id: 'pi-ai', baseURL: 'http://localhost', models: [modelDraft({ id: 'one' })] }))
    form.input.input('fake-must-not-overwrite')
    assert.equal(await form.submit(), false)
    assert.match(form.getSnapshot().errors.key!, /PI_AI_API_KEY.*すでに登録されています.*my-pi-ai/)
    assert.deepEqual(await remote.settings.describe(), before)
    assert.deepEqual(await inspectCustomKey(remote, 'PI_AI_API_KEY'), { configured: true, writable: true })
    form.dispose()
  } finally { ctx.dispose() }
})
