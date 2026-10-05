import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { extendMock } from '../web/src/features/settings/mock.ts'
import { createProviderStore, type ProviderRemote, type ProviderStore } from '../web/src/features/settings/providers.ts'
import { createCustomProviderStore } from '../web/src/features/settings/custom-provider-store.ts'
import { modelDraft } from '../web/src/features/settings/custom-provider.ts'

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(fn => { resolve = fn }); return { promise, resolve } }
const row = (keys: ProviderStore, id: string) => keys.getSnapshot().rows.find(item => item.id === id)!
const raceMessage = '提供元の設定は保存しましたが、API キーを保存できませんでした。 設定を保存する間に、この参照名のキーが登録されました。上書きを避けるため、API キーを送信していません。この提供元は登録済みのキーを参照します。提供元の設定とキーを確認してください。'
function setup() {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  const remote = ctx.remote as unknown as ProviderRemote
  // Record destinations and the synthetic markers only; the mock keeps booleans.
  const sent: string[] = []
  const set = remote.credentials.set
  remote.credentials.set = async (ref, value) => { sent.push(`${ref}=${value}`); return set(ref, value) }
  const keys = createProviderStore(remote)
  const open = async (id: string, existing = false) => {
    const form = createCustomProviderStore(remote, keys, existing ? id : undefined)
    await form.load()
    if (!existing) form.change(draft => ({ ...draft, id, baseURL: 'http://localhost:4321/v1', models: [modelDraft({ id: 'one' })] }))
    return form
  }
  /** The other namespace's provider (llm-deepseek / deepseek) names the reference itself. */
  const nameForeign = async (ref: string) => {
    const description = await remote.settings.describe(); assert.ok(description.ok)
    const foreign = description.value.namespaces.find(item => item.ns === 'llm-deepseek')!
    assert.ok((await remote.settings.update(foreign.ns, { apiKeyEnv: ref }, foreign.revision)).ok)
  }
  const profile = async (id: string) => {
    const description = await remote.settings.describe(); assert.ok(description.ok)
    return (description.value.namespaces.find(item => item.ns === 'llm-pi-ai')!.value.providers as Record<string, any>)[id]
  }
  return { ctx, remote, keys, sent, open, nameForeign, profile }
}

test('I16 R5 late registration: 設定の保存中に別の名前空間で登録された名前へキーを送らない', async () => {
  const { ctx, remote, keys, sent, open, nameForeign, profile } = setup()
  try {
    const form = await open('local-api')
    const started = deferred(), held = deferred()
    const mutate = remote.settings.mutate
    remote.settings.mutate = async (...args) => {
      const answer = await mutate(...args)
      remote.settings.mutate = mutate; started.resolve(); await held.promise
      return answer
    }
    form.input.input('fake-form')
    const pending = form.submit()
    await started.promise
    // The destination was unregistered when the form checked it. Another
    // namespace is not covered by the llm-pi-ai revision.
    await nameForeign('LOCAL_API_API_KEY')
    assert.ok((await remote.credentials.set('LOCAL_API_API_KEY', 'fake-other-owner')).ok)
    held.resolve()
    assert.equal(await pending, false)
    assert.deepEqual(sent, ['LOCAL_API_API_KEY=fake-other-owner'])
    assert.equal(form.getSnapshot().phase, 'keyFailed')
    assert.equal(form.getSnapshot().message, raceMessage)
    assert.equal((await profile('local-api')).apiKeyEnv, 'LOCAL_API_API_KEY')
    assert.equal(row(keys, 'deepseek').status, 'registered')
    // The same form keeps the "reference assigned by this save" context.
    form.input.input('fake-form-retry')
    assert.equal(await form.submit(), false)
    assert.deepEqual(sent, ['LOCAL_API_API_KEY=fake-other-owner'])
    assert.equal(form.getSnapshot().message, raceMessage)
    assert.equal(form.input.getSnapshot().draft, '')
    // Reading the settings again inside the same sheet does not end it either.
    await form.load(); assert.equal(form.getSnapshot().editing, true)
    form.input.input('fake-form-reloaded')
    assert.equal(await form.submit(), false)
    assert.deepEqual(sent, ['LOCAL_API_API_KEY=fake-other-owner'])
    assert.equal(form.getSnapshot().message, raceMessage)
    form.dispose()
    // No option: registration from the list is the same as main and sends.
    await keys.load()
    assert.deepEqual(await keys.save(row(keys, 'local-api'), 'fake-list'), { ok: true })
    assert.deepEqual(sent, ['LOCAL_API_API_KEY=fake-other-owner', 'LOCAL_API_API_KEY=fake-list'])
    // Reopened: the reference is an explicit one read from the settings.
    const reopened = await open('local-api', true)
    reopened.input.input('fake-reopened')
    assert.equal(await reopened.submit(), true)
    assert.equal(sent.at(-1), 'LOCAL_API_API_KEY=fake-reopened')
    assert.equal(sent.length, 3)
    reopened.dispose()
  } finally { ctx.dispose() }
})

test('I16 R5 unknown result: 設定の応答を失っても付けようとした名前の登録済みキーを上書きしない', async () => {
  for (const registeredElsewhere of [true, false]) {
    const { ctx, remote, sent, open, nameForeign, profile } = setup()
    try {
      const form = await open('local-api')
      const mutate = remote.settings.mutate
      remote.settings.mutate = async (...args) => { await mutate(...args); remote.settings.mutate = mutate; throw new Error('応答を受け取れませんでした。') }
      form.input.input('fake-lost')
      assert.equal(await form.submit(), false)
      assert.equal(form.getSnapshot().phase, 'unknown')
      assert.equal((await profile('local-api')).apiKeyEnv, 'LOCAL_API_API_KEY')
      assert.deepEqual(sent, [])
      if (registeredElsewhere) {
        await nameForeign('LOCAL_API_API_KEY')
        assert.ok((await remote.credentials.set('LOCAL_API_API_KEY', 'fake-other-owner')).ok)
      }
      await form.load(); assert.equal(form.getSnapshot().editing, true)
      form.input.input('fake-after-check')
      assert.equal(await form.submit(), !registeredElsewhere)
      assert.deepEqual(sent, [registeredElsewhere ? 'LOCAL_API_API_KEY=fake-other-owner' : 'LOCAL_API_API_KEY=fake-after-check'])
      if (registeredElsewhere) assert.equal(form.getSnapshot().message, raceMessage)
      form.dispose()
    } finally { ctx.dispose() }
  }
})

test('I16 R5 retry: 未登録のままなら新しい参照名へ同じフォームの再試行で登録できる', async () => {
  const { ctx, remote, keys, sent, open, profile } = setup()
  try {
    const form = await open('local-api')
    const set = remote.credentials.set
    remote.credentials.set = async () => { remote.credentials.set = set; return { ok: false, error: { code: 'credential/rejected', message: '', details: {} } } }
    form.input.input('fake-rejected')
    assert.equal(await form.submit(), false)
    assert.equal(form.getSnapshot().phase, 'keyFailed')
    assert.equal(form.getSnapshot().message, '提供元の設定は保存しましたが、API キーを保存できませんでした。 API キーの変更が拒否されました。登録状況を確認してください。')
    assert.equal((await profile('local-api')).apiKeyEnv, 'LOCAL_API_API_KEY')
    assert.equal(row(keys, 'local-api').status, 'missing')
    form.input.input('fake-retry')
    assert.equal(await form.submit(), true)
    assert.deepEqual(sent, ['LOCAL_API_API_KEY=fake-retry'])
    assert.equal(row(keys, 'local-api').status, 'registered')
    form.dispose()
  } finally { ctx.dispose() }
})
