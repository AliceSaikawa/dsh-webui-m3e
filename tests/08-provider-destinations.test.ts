import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { extendMock } from '../web/src/features/settings/mock.ts'
import { createProviderStore, type ProviderRemote } from '../web/src/features/settings/providers.ts'
import { createCustomProviderStore } from '../web/src/features/settings/custom-provider-store.ts'
import { modelDraft } from '../web/src/features/settings/custom-provider.ts'
import type { SettingObject } from '../web/src/features/settings/schema.ts'
import { keyReferenceConflict } from '../web/src/features/settings/provider-key-refs.ts'

const profile = { api: 'openai-completions', baseURL: 'http://localhost:4321', models: [{ id: 'one' }] }
async function put(remote: ProviderRemote, id: string, value: SettingObject) {
  const result = await remote.settings.describe()
  assert.ok(result.ok)
  const ns = result.value.namespaces.find(row => row.ns === 'llm-pi-ai')!
  assert.ok((await remote.settings.mutate(ns.ns, [{ op: 'set', path: ['providers', id], value }], ns.revision)).ok)
}

test('I16 destinations list: 参照先なしのカスタムは一覧で照会も登録削除もしない', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    const remote = ctx.remote as unknown as ProviderRemote
    await put(remote, 'cloud', { apiKeyEnv: 'LOCAL_API_API_KEY' })
    const keys = createProviderStore(remote)
    await keys.load()
    assert.ok((await keys.save(keys.getSnapshot().rows.find(row => row.id === 'cloud')!, 'fake-owner')).ok)
    await put(remote, 'local-api', profile)
    await keys.load()
    const target = keys.getSnapshot().rows.find(row => row.id === 'local-api')!
    assert.equal((await keys.save(target, 'fake-must-not-overwrite')).ok, false)
    assert.equal((await keys.remove(target)).ok, false)
    assert.equal(target.status, 'unset')
    assert.equal(target.ref, undefined)
    assert.equal(target.writable, false)
    const settings = await remote.settings.describe()
    assert.ok(settings.ok)
    assert.equal((settings.value.namespaces.find(row => row.ns === 'llm-pi-ai')!.value.providers as any)['local-api'].apiKeyEnv, undefined)
  } finally { ctx.dispose() }
})

test('I16 destinations reopen: 明示済みの共有は開き直してもmainと同じく操作できる', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    const remote = ctx.remote as unknown as ProviderRemote
    await put(remote, 'cloud', { apiKeyEnv: 'LOCAL_API_API_KEY' })
    await put(remote, 'local-api', { ...profile, apiKeyEnv: 'LOCAL_API_API_KEY' })
    for (let attempt = 0; attempt < 2; attempt++) {
      const keys = createProviderStore(remote)
      const editor = createCustomProviderStore(remote, keys, 'local-api')
      await editor.load(); editor.input.input('fake-reopened')
      assert.equal(await editor.submit(), true)
      assert.equal(editor.getSnapshot().errors.key, undefined)
      const target = keys.getSnapshot().rows.find(row => row.id === 'local-api')!
      assert.equal(target.status, 'registered')
      assert.equal((await keys.save(target, 'fake-list-retry')).ok, true)
      assert.equal(keys.getSnapshot().rows.find(row => row.id === 'cloud')!.status, 'registered')
      assert.equal((await keys.remove(target)).ok, true)
      assert.equal(keys.getSnapshot().rows.find(row => row.id === 'cloud')!.status, 'missing')
      editor.dispose()
    }
  } finally { ctx.dispose() }
})

test('I16 destinations native: 明示参照のない標準の保存先と別名も予約する', async () => {
  for (const [native, id] of [['openai', 'OPENAI'], ['google', 'GEMINI'], ['moonshotai', 'MOONSHOT']]) {
    const ctx = createMockContext({ extensions: [{ extendMock }] })
    try {
      const remote = ctx.remote as unknown as ProviderRemote
      const list = remote.llm.listProviders
      remote.llm.listProviders = async () => {
        const result = await list(); assert.ok(result.ok)
        return { ok: true, value: [...result.value, { id: native!, name: native! }] }
      }
      const keys = createProviderStore(remote)
      const editor = createCustomProviderStore(remote, keys)
      await editor.load()
      editor.change(draft => ({ ...draft, id: id!, baseURL: profile.baseURL, models: [modelDraft({ id: 'one' })] }))
      editor.input.input('fake-native-collision')
      assert.equal(await editor.submit(), false)
      assert.match(editor.getSnapshot().errors.key!, /予約されています.*my-/)
      editor.input.clear(); assert.equal(await editor.submit(), true)
      await keys.load()
      const target = keys.getSnapshot().rows.find(row => row.id === id)!
      assert.equal(target.writable, false)
      assert.equal(target.status, 'unset')
      assert.equal((await keys.save(target, 'fake-after-keyless')).ok, false)
      assert.equal(keys.getSnapshot().rows.find(row => row.id === native)!.ref, undefined)
      editor.dispose()
    } finally { ctx.dispose() }
  }
})

test('I16 destinations owners: 新規参照は明示名と標準名だけを予約しキーなしIDは予約しない', () => {
  assert.equal(keyReferenceConflict([], 'constructor', 'CONSTRUCTOR_API_KEY'), false)
  assert.equal(keyReferenceConflict([], 'google', 'GOOGLE_API_KEY'), true)
  assert.equal(keyReferenceConflict([], 'google', 'GOOGLE_CLOUD_PROJECT'), true)
  assert.equal(keyReferenceConflict([], 'GOOGLE', 'GOOGLE_API_KEY'), true)
  for (const [id, ref] of [['deepseek-official', 'DEEPSEEK_API_KEY'], ['google', 'GEMINI_API_KEY'], ['moonshotai-cn', 'MOONSHOT_API_KEY']]) {
    assert.equal(keyReferenceConflict([], id!, ref!), true)
    assert.equal(keyReferenceConflict([{ id: id === 'deepseek-official' ? 'deepseek' : id!, ref }], id!, ref!), true)
    assert.equal(keyReferenceConflict([], id!.toUpperCase(), ref!), true)
  }
  for (const ref of ['AWS_SESSION_TOKEN', 'GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'CLOUDFLARE_ACCOUNT_ID']) {
    assert.equal(keyReferenceConflict([], 'local-api', ref), true)
  }
  assert.equal(keyReferenceConflict([{ id: 'other', ref: 'LOCAL_API_API_KEY' }], 'local-api', 'LOCAL_API_API_KEY'), true)
  assert.equal(keyReferenceConflict([{ id: 'other', ref: 'DEEPSEEK_API_KEY' }], 'deepseek-official', 'DEEPSEEK_API_KEY'), true)
  assert.equal(keyReferenceConflict([{ id: 'other', ref: 'DIFFERENT_API_KEY' }], 'OTHER', 'OTHER_API_KEY'), false)
  assert.equal(keyReferenceConflict([{ id: 'other' }], 'OTHER', 'OTHER_API_KEY'), false)
  assert.equal(keyReferenceConflict([{ id: 'other', ref: 'local_api_api_key' }], 'local-api', 'LOCAL_API_API_KEY'), false)
})
