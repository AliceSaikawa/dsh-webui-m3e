import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { extendMock } from '../web/src/features/settings/mock.ts'
import { createProviderStore, type ProviderRemote, type ProviderStore } from '../web/src/features/settings/providers.ts'
import { describeKeyBatches } from '../web/src/features/settings/provider-key-info.ts'
import { keyReferenceConflict } from '../web/src/features/settings/provider-key-refs.ts'

const profile = { api: 'openai-completions', baseURL: 'http://localhost:4321', models: [{ id: 'one' }] }
async function put(remote: ProviderRemote, providers: Record<string, unknown>) {
  const answer = await remote.settings.describe(); assert.ok(answer.ok)
  const ns = answer.value.namespaces.find(row => row.ns === 'llm-pi-ai')!
  assert.ok((await remote.settings.update(ns.ns, { providers } as any, ns.revision)).ok)
}
const row = (keys: ProviderStore, id: string) => keys.getSnapshot().rows.find(item => item.id === id)!

test('I16 R3 main parity: 標準・明示・明示共有の行はキーなし追加の前後もmainと同じ', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    const remote = ctx.remote as unknown as ProviderRemote
    const directory = remote.llm.listConfigurableProviders
    remote.llm.listConfigurableProviders = async () => {
      const answer = await directory(); assert.ok(answer.ok)
      return { ok: true, value: [...answer.value.filter(item => item.provider !== 'openai'),
        { provider: 'openai', displayName: 'OpenAI', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'], declared: false }] }
    }
    await put(remote, {
      owner: { ...profile, apiKeyEnv: 'NEW_PROVIDER_API_KEY' },
      'share-one': { ...profile, apiKeyEnv: 'SHARED_API_KEY' },
      'share-two': { ...profile, apiKeyEnv: 'SHARED_API_KEY' },
    })
    const keys = createProviderStore(remote)
    // main providerRows/read/change: native has no ref and cannot be changed;
    // explicit refs remain writable, and two explicit owners see the same state.
    for (const withCustom of [false, true]) {
      if (withCustom) await put(remote, { 'new-provider': profile, 'shared': profile, 'DEEPSEEK': profile, 'OPENAI': profile })
      await keys.load()
      assert.deepEqual([row(keys, 'ollama').ref, row(keys, 'ollama').status, row(keys, 'ollama').writable], [undefined, 'unnecessary', false])
      assert.equal((await keys.save(row(keys, 'ollama'), 'fake-native')).ok, false)
      assert.equal((await keys.remove(row(keys, 'ollama'))).ok, false)
      for (const id of ['owner', 'share-one', 'share-two', 'deepseek', 'openai']) {
        assert.equal(row(keys, id).writable, true, id)
        assert.equal(row(keys, id).keyUnavailableReason, undefined, id)
        assert.equal((await keys.save(row(keys, id), 'fake-parity')).ok, true, id)
        assert.equal(row(keys, id).status, 'registered', id)
        if (id.startsWith('share')) assert.equal(row(keys, id === 'share-one' ? 'share-two' : 'share-one').status, 'registered')
        assert.equal((await keys.remove(row(keys, id))).ok, true, id)
        assert.equal(row(keys, id).status, 'missing', id)
        if (id.startsWith('share')) assert.equal(row(keys, id === 'share-one' ? 'share-two' : 'share-one').status, 'missing')
      }
    }
  } finally { ctx.dispose() }
})

test('I16 R3 post-reference race: 参照の応答待ちに他の所有者が増えたら登録しない', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    const remote = ctx.remote as unknown as ProviderRemote
    await put(remote, { 'race-ref': profile })
    const keys = createProviderStore(remote); await keys.load()
    let started!: () => void, release!: () => void
    const observed = new Promise<void>(resolve => { started = resolve })
    const held = new Promise<void>(resolve => { release = resolve })
    const update = remote.settings.update
    remote.settings.update = async (...args) => { const answer = await update(...args); started(); await held; return answer }
    const pending = keys.save(row(keys, 'race-ref'), 'fake-must-not-send')
    await observed
    remote.settings.update = update
    await put(remote, { owner: { ...profile, apiKeyEnv: 'RACE_REF_API_KEY' } })
    release()
    assert.equal((await pending).ok, false)
    await keys.load()
    assert.equal(row(keys, 'owner').status, 'missing')
    assert.equal(row(keys, 'race-ref').status, 'missing')
    assert.match(row(keys, 'race-ref').keyNotice!, /参照先だけ/)
  } finally { ctx.dispose() }
})

test('I16 R3 many references: 65件以上の照会でも既存のキーを登録削除できる', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    const remote = ctx.remote as unknown as ProviderRemote
    await put(remote, Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`many-${i}`, profile])))
    const keys = createProviderStore(remote); await keys.load()
    assert.equal(row(keys, 'deepseek').status, 'registered')
    assert.equal(row(keys, 'many-69').status, 'missing')
    assert.equal(keys.getSnapshot().error, null)
    for (const id of ['cloud', 'many-69']) {
      assert.equal((await keys.save(row(keys, id), 'fake-many')).ok, true)
      assert.equal(row(keys, id).status, 'registered')
      assert.equal((await keys.remove(row(keys, id))).ok, true)
      assert.equal(row(keys, id).status, 'missing')
    }
  } finally { ctx.dispose() }
})

test('I16 R3 batches: 64件に分け失敗した回だけを不明にする', async () => {
  for (const mode of ['reject', 'throw']) {
    const refs = Array.from({ length: 130 }, (_, i) => `REF_${i}`)
    const calls: string[][] = []
    const answer = await describeKeyBatches(refs, async batch => {
      calls.push(batch)
      assert.ok(batch.length <= 64)
      if (batch.includes('REF_64')) {
        if (mode === 'throw') throw new Error('offline')
        return { ok: false, error: { code: 'unavailable', message: '', details: {} } }
      }
      return { ok: true, value: Object.fromEntries(batch.map(ref => [ref, { configured: true, writable: true }])) }
    })
    assert.deepEqual(calls.map(batch => batch.length), [64, 64, 2])
    assert.deepEqual(calls.flat(), refs)
    assert.equal(Object.keys(answer).length, 66)
    assert.deepEqual(answer.REF_0, { configured: true, writable: true })
    assert.equal(answer.REF_64, undefined)
    assert.deepEqual(answer.REF_129, { configured: true, writable: true })
  }
})

test('I16 R3 case N09: 大小文字だけ違う参照は独立して登録削除できる', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    const remote = ctx.remote as unknown as ProviderRemote
    await put(remote, { lower: { ...profile, apiKeyEnv: 'case_only_api_key' }, 'case-only': profile })
    const keys = createProviderStore(remote); await keys.load()
    assert.equal(keyReferenceConflict(keys.getSnapshot().rows, 'case-only', 'CASE_ONLY_API_KEY'), false)
    assert.equal((await keys.save(row(keys, 'lower'), 'fake-lower')).ok, true)
    assert.equal(row(keys, 'case-only').status, 'missing')
    assert.equal((await keys.save(row(keys, 'case-only'), 'fake-upper')).ok, true)
    assert.equal(row(keys, 'case-only').needsReference, false)
    assert.equal(row(keys, 'lower').status, 'registered')
    assert.equal((await keys.remove(row(keys, 'lower'))).ok, true)
    assert.equal(row(keys, 'lower').status, 'missing')
    assert.equal(row(keys, 'case-only').status, 'registered')
    assert.equal((await keys.save(row(keys, 'lower'), 'fake-lower-again')).ok, true)
    assert.equal((await keys.remove(row(keys, 'case-only'))).ok, true)
    assert.equal(row(keys, 'lower').status, 'registered')
    assert.equal(row(keys, 'case-only').status, 'missing')
  } finally { ctx.dispose() }
})
