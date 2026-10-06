import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { extendMock } from '../web/src/features/settings/mock.ts'
import { createProviderStore, type ProviderRemote, type ProviderStore } from '../web/src/features/settings/providers.ts'
import { providerSummary } from '../web/src/features/settings/schema.ts'

const profile = { api: 'openai-completions', baseURL: 'http://localhost:4321', models: [{ id: 'one' }] }
async function setup(withCustom: boolean) {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  const remote = ctx.remote as unknown as ProviderRemote
  const description = await remote.settings.describe(); assert.ok(description.ok)
  const ns = description.value.namespaces.find(row => row.ns === 'llm-pi-ai')!
  const providers = {
    owner: { ...profile, apiKeyEnv: 'OWNER_API_KEY' },
    'share-one': { ...profile, apiKeyEnv: 'SHARED_API_KEY' }, 'share-two': { ...profile, apiKeyEnv: 'SHARED_API_KEY' },
    ...(withCustom ? Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`${i}-keyless`, profile])) : {}),
  }
  assert.ok((await remote.settings.update(ns.ns, { providers }, ns.revision)).ok)
  const directory = remote.llm.listConfigurableProviders
  remote.llm.listConfigurableProviders = async () => {
    const result = await directory(); assert.ok(result.ok)
    return { ok: true, value: [...result.value.filter(row => !['openai', 'native-pi'].includes(row.provider)),
      ...['openai', 'native-pi', 'inactive-other', 'deepseek-account'].map(provider => ({ provider, displayName: provider,
        settingsNs: provider === 'inactive-other' ? 'other' : 'llm-pi-ai', settingsPath: ['providers', provider], declared: false }))] }
  }
  const live = remote.llm.listProviders
  remote.llm.listProviders = async () => { const result = await live(); assert.ok(result.ok); return { ok: true, value: [...result.value, { id: 'native-pi', name: 'native-pi' }] } }
  remote.session = { modelCatalog: async () => ({ ok: true, value: { groups: [{ id: 'deepseek-account', models: [{ id: 'model' }] }] } as any }) }
  return { ctx, remote, keys: createProviderStore(remote) }
}
const row = (keys: ProviderStore, id: string) => keys.getSnapshot().rows.find(row => row.id === id)!

test('I16 R4 lookup failures: 拒否・不正応答・例外のphaseと戻り値と文言をmainに合わせる', async () => {
  for (const withCustom of [false, true]) for (const mode of ['rejected', 'malformed', 'thrown']) {
    const { ctx, remote, keys } = await setup(withCustom)
    try {
      remote.credentials.describe = async () => {
        if (mode === 'thrown') throw new Error('private-input-not-for-display')
        return mode === 'rejected' ? { ok: false, error: { code: 'unavailable', message: '', details: {} } }
          : { ok: true, value: { OWNER_API_KEY: { configured: 'false', writable: true } } }
      }
      let writes = 0
      remote.credentials.set = remote.credentials.unset = async () => { writes++; return { ok: true, value: {} } }
      assert.equal(await keys.load(), mode !== 'thrown')
      assert.equal(keys.getSnapshot().phase, mode === 'thrown' ? 'error' : 'ready')
      const message = mode === 'thrown' ? '提供元と API キーの登録状況を読み込めませんでした。もう一度お試しください。'
        : '一部の API キーの登録状況を確認できません。再読み込みしてください。'
      assert.equal(keys.getSnapshot().error, message)
      assert.equal(keys.getSnapshot().rows.some(row => row.writable || row.status === 'registered' || row.status === 'missing'), false)
      const target = row(keys, 'owner') ?? { id: 'owner' } as any
      assert.equal((await keys.save(target, 'fake-no-write')).ok, false)
      assert.equal((await keys.remove(target)).ok, false)
      assert.equal(writes, 0)
    } finally { ctx.dispose() }
  }
})

test('I16 R4 main parity: 全種類の既存行は70件の参照先なしカスタムの有無で変わらない', async () => {
  for (const withCustom of [false, true]) {
    const { ctx, remote, keys } = await setup(withCustom)
    try {
      assert.equal(await keys.load(), true); assert.equal(keys.getSnapshot().phase, 'ready'); assert.equal(keys.getSnapshot().error, null)
      for (const id of ['ollama', 'native-pi', 'deepseek-account', 'inactive-other']) {
        const target = row(keys, id)
        assert.deepEqual([target.ref, target.status, target.writable], id === 'inactive-other'
          ? ['INACTIVE_OTHER_API_KEY', 'missing', false] : [undefined, 'unnecessary', false])
        assert.deepEqual(await keys.save(target, 'fake-no-write'), { ok: false, message: '設定が変わったか、このキーは変更できません。入力画面を開き直してください。' })
        assert.equal((await keys.remove(target)).ok, false)
      }
      assert.equal(row(keys, 'openai').needsReference, true)
      for (const id of ['owner', 'share-one', 'share-two', 'deepseek', 'openai']) {
        assert.equal(row(keys, id).writable, true)
        assert.equal((await keys.save(row(keys, id), 'fake-parity')).ok, true)
        assert.equal(row(keys, id).status, 'registered')
        if (id.startsWith('share')) assert.equal(row(keys, id === 'share-one' ? 'share-two' : 'share-one').status, 'registered')
        assert.equal((await keys.remove(row(keys, id))).ok, true)
        assert.equal(row(keys, id).status, 'missing')
        if (id.startsWith('share')) assert.equal(row(keys, id === 'share-one' ? 'share-two' : 'share-one').status, 'missing')
      }
      if (withCustom) {
        assert.match(providerSummary(keys.getSnapshot()), /未設定 70/)
        for (let i = 0; i < 70; i++) assert.deepEqual([row(keys, `${i}-keyless`).ref, row(keys, `${i}-keyless`).status, row(keys, `${i}-keyless`).writable], [undefined, 'unset', false])
        assert.equal((await keys.save(row(keys, '69-keyless'), 'fake-blocked')).ok, false)
        assert.equal((await keys.remove(row(keys, '69-keyless'))).ok, false)
      }
      remote.session = { modelCatalog: async () => ({ ok: true, value: { groups: [] } as any }) }
      await keys.load(); assert.equal(row(keys, 'deepseek-account'), undefined)
    } finally { ctx.dispose() }
  }
})

test('I16 R4 native write: 標準の参照保存後に取得が失敗してもmainと同じくキーを送る', async () => {
  for (const withCustom of [false, true]) {
    const { ctx, remote, keys } = await setup(withCustom)
    try {
      await keys.load(); const target = row(keys, 'openai'); assert.equal(target.needsReference, true)
      const describe = remote.settings.describe, update = remote.settings.update
      remote.settings.update = async (...args) => {
        const result = await update(...args)
        remote.settings.describe = async () => ({ ok: false, error: { code: 'unavailable', message: '', details: {} } })
        return result
      }
      assert.deepEqual(await keys.save(target, 'fake-standard'), { ok: true })
      assert.equal(keys.getSnapshot().phase, 'error')
      assert.equal(keys.getSnapshot().error, '提供元と API キーの登録状況を読み込めませんでした。もう一度お試しください。')
      remote.settings.describe = describe
      await keys.load(); assert.equal(row(keys, 'openai').status, 'registered')
      assert.equal(row(keys, 'openai').needsReference, false)
    } finally { ctx.dispose() }
  }
})
