import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { extendMock } from '../web/src/features/settings/mock.ts'
import { createProviderStore, type ProviderRemote, type ProviderStore } from '../web/src/features/settings/providers.ts'
import { createCustomProviderStore } from '../web/src/features/settings/custom-provider-store.ts'
import { customDraft, customOperations, modelDraft, validateCustom } from '../web/src/features/settings/custom-provider.ts'
import { settingsFixtures } from '../web/src/features/settings/mock-fixtures.ts'

// Tests added for mutations that survived the 6th-review audit (see 08-settings.md).
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(fn => { resolve = fn }); return { promise, resolve } }
const row = (keys: ProviderStore, id: string) => keys.getSnapshot().rows.find(item => item.id === id)!
function setup() {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  const remote = ctx.remote as unknown as ProviderRemote
  const keys = createProviderStore(remote)
  const writes: unknown[][] = []
  const mutate = remote.settings.mutate
  remote.settings.mutate = async (...args) => { writes.push(structuredClone(args)); return mutate(...args) }
  const describe = async (ns: string) => {
    const description = await remote.settings.describe(); assert.ok(description.ok)
    return description.value.namespaces.find(item => item.ns === ns)!
  }
  const open = async (id: string) => {
    const form = createCustomProviderStore(remote, keys)
    await form.load()
    form.change(draft => ({ ...draft, id, baseURL: 'http://localhost:4321/v1', models: [modelDraft({ id: 'one' })] }))
    return form
  }
  return { ctx, remote, keys, writes, describe, open }
}

test('I16 A6 detach revision F16: 外す書き込みは直前に読んだ版を使い、ほかの提供元の変更と競合させない', async () => {
  const { ctx, remote, keys, describe, open } = setup()
  try {
    const form = await open('local-api')
    const started = deferred(), held = deferred()
    const inner = remote.settings.mutate
    remote.settings.mutate = async (...args) => { const answer = await inner(...args); remote.settings.mutate = inner; started.resolve(); await held.promise; return answer }
    const save = keys.save
    keys.save = async (...args) => {
      const outcome = await save(...args)
      // Another page edits a different llm-pi-ai provider before the detach.
      const pi = await describe('llm-pi-ai')
      assert.ok((await remote.settings.update(pi.ns, { providers: { cloud: { displayName: '別ページの変更' } } }, pi.revision)).ok)
      return outcome
    }
    form.input.input('fake-form')
    const pending = form.submit()
    await started.promise
    const foreign = await describe('llm-deepseek')
    assert.ok((await remote.settings.update(foreign.ns, { apiKeyEnv: 'LOCAL_API_API_KEY' }, foreign.revision)).ok)
    assert.ok((await remote.credentials.set('LOCAL_API_API_KEY', 'fake-other-owner')).ok)
    held.resolve()
    assert.equal(await pending, false)
    assert.equal(form.getSnapshot().phase, 'saved')
    const providers = (await describe('llm-pi-ai')).value.providers as Record<string, any>
    assert.equal(providers['local-api'].apiKeyEnv, undefined)
    assert.equal(providers.cloud.displayName, '別ページの変更')
    form.dispose()
  } finally { ctx.dispose() }
})

test('I16 A6 reload clears key S07: シートの中で読み直すと入力中のキーを消す', async () => {
  const { ctx, open } = setup()
  try {
    const form = await open('local-api')
    form.input.input('fake-typed'); form.input.toggle()
    assert.equal(form.input.getSnapshot().draft, 'fake-typed')
    await form.load()
    assert.deepEqual([form.input.getSnapshot().draft, form.input.getSnapshot().visible], ['', false])
    form.dispose()
  } finally { ctx.dispose() }
})

test('I16 A6 change during save S15: 保存中に届いた外部変更は、拒否のあとで再読み込みを促す', async () => {
  const { ctx, remote, open, writes } = setup()
  try {
    const form = await open('local-api')
    remote.settings.mutate = async () => {
      form.updated('llm-pi-ai', 999)
      return { ok: false, error: { code: 'settings/rejected', message: '', details: {} } }
    }
    assert.equal(await form.submit(), false)
    assert.equal(form.getSnapshot().phase, 'stale')
    assert.equal(form.getSnapshot().message, 'ほかの場所で設定が変わりました。再読み込みして、変更内容を確認してください。')
    assert.equal(writes.length, 0)
    form.dispose()
  } finally { ctx.dispose() }
})

test('I16 A6 double submit S10/S11: キーなしの保存を重ねて押しても書き込みは 1 回', async () => {
  const { ctx, remote, open, writes } = setup()
  try {
    const form = await open('local-api')
    const gate = deferred()
    const inner = remote.settings.mutate
    remote.settings.mutate = async (...args) => { await gate.promise; return inner(...args) }
    const first = form.submit(), second = form.submit()
    gate.resolve()
    assert.deepEqual(await Promise.all([first, second]), [true, false])
    assert.equal(writes.length, 1)
    form.dispose()
  } finally { ctx.dispose() }
})

test('I16 A6 declared elsewhere P02: llm-pi-ai 以外の宣言はカスタムとして扱わずmainと同じ行にする', async () => {
  const { ctx, remote, keys } = setup()
  try {
    const directory = remote.llm.listConfigurableProviders
    remote.llm.listConfigurableProviders = async () => {
      const result = await directory(); assert.ok(result.ok)
      return { ok: true, value: [...result.value, { provider: 'other-declared', displayName: 'other-declared', settingsNs: 'other', settingsPath: ['providers', 'other-declared'], declared: true }] }
    }
    await keys.load()
    const target = row(keys, 'other-declared')
    assert.deepEqual([target.custom, target.ref, target.status, target.needsReference], [false, 'OTHER_DECLARED_API_KEY', 'missing', true])
  } finally { ctx.dispose() }
})

test('I16 A6 change while editing S16: 編集中にほかで設定が変わったら入力中のキーを消して再読み込みを促す', async () => {
  const { ctx, open } = setup()
  try {
    const form = await open('local-api')
    const revision = form.getSnapshot().namespace!.revision
    form.input.input('fake-typed')
    form.updated('llm-pi-ai', revision)
    assert.deepEqual([form.getSnapshot().phase, form.input.getSnapshot().draft], ['editing', 'fake-typed'])
    form.updated('llm-deepseek', revision + 1)
    assert.deepEqual([form.getSnapshot().phase, form.input.getSnapshot().draft], ['editing', 'fake-typed'])
    form.updated('llm-pi-ai', revision + 1)
    assert.equal(form.getSnapshot().phase, 'stale')
    assert.equal(form.getSnapshot().message, 'ほかの場所で設定が変わりました。再読み込みして、変更内容を確認してください。')
    assert.equal(form.input.getSnapshot().draft, '')
    form.dispose()
  } finally { ctx.dispose() }
})

test('I16 A6 edit key reference O06: 名前の無いカスタムを編集してキーを入れたら、その提供元に名前だけを付ける', () => {
  const row = structuredClone(settingsFixtures().find(item => item.ns === 'llm-pi-ai')!)
  row.value = { providers: { custom: { api: 'openai-completions', baseURL: 'http://localhost:4321/v1', models: [{ id: 'one' }] } } }
  const initial = customDraft(row, 'custom')
  assert.deepEqual(customOperations(row, initial, structuredClone(initial), true, true), [{ op: 'set', path: ['providers', 'custom', 'apiKeyEnv'], value: 'CUSTOM_API_KEY' }])
  assert.deepEqual(customOperations(row, initial, structuredClone(initial), true, false), [])
  ;(row.value.providers as any).custom.apiKeyEnv = 'SHARED_KEY'
  assert.deepEqual(customOperations(row, customDraft(row, 'custom'), customDraft(row, 'custom'), true, true), [])
})

test('I16 A6 models required O15: モデルが 0 件なら欄エラーで止める', () => {
  const row = structuredClone(settingsFixtures().find(item => item.ns === 'llm-pi-ai')!)
  const draft = { ...customDraft(row), id: 'local-api', baseURL: 'http://localhost:4321/v1', models: [] }
  assert.equal(validateCustom(draft, ['openai-completions'], [], false, row).models, 'モデルを 1 件以上追加してください。')
  assert.equal(validateCustom({ ...draft, models: [modelDraft({ id: 'one' })] }, ['openai-completions'], [], false, row).models, undefined)
})
