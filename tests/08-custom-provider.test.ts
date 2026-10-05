import { test } from 'node:test'
import assert from 'node:assert/strict'
import { customDraft, customOperations, customFieldWritable, modelDraft, validateCustom, protocolChoices } from '../web/src/features/settings/custom-provider.ts'
import { createCustomProviderStore } from '../web/src/features/settings/custom-provider-store.ts'
import { settingsFixtures } from '../web/src/features/settings/mock-fixtures.ts'
import { applyMockOperations } from '../web/src/features/settings/mock-mutations.ts'
import { validMockValue } from '../web/src/features/settings/mock-validation.ts'
import { createProviderStore, type ProviderRemote, type ProviderRow } from '../web/src/features/settings/providers.ts'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { extendMock } from '../web/src/features/settings/mock.ts'
import type { SettingsOperation } from '../web/src/features/settings/store.ts'
import type { SettingObject } from '../web/src/features/settings/schema.ts'

const ns = () => structuredClone(settingsFixtures().find(row => row.ns === 'llm-pi-ai')!)
const good = (namespace = ns()) => ({ ...customDraft(namespace), id: 'local-api', baseURL: 'http://localhost:4321/v1', models: [modelDraft({ id: 'local-model' })] })
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(fn => { resolve = fn }); return { promise, resolve } }

test('I16 ops: 新規と変更項目だけを送り未知のモデル情報を保持する', () => {
  const row = ns()
  assert.deepEqual(customOperations(row, customDraft(row), good(row), false), [{ op: 'set', path: ['providers', 'local-api'], value: { api: 'openai-completions', baseURL: 'http://localhost:4321/v1', models: [{ id: 'local-model' }] } }])
  row.value = { providers: { custom: { displayName: '名前', api: 'openai-responses', baseURL: 'https://localhost', headers: { keep: 'value' }, models: [{ id: 'one', extra: { keep: true }, maxTokens: 8192 }] }, other: { keep: 1 } } }
  const before = structuredClone(row.value)
  const initial = customDraft(row, 'custom')
  assert.deepEqual(customOperations(row, initial, { ...initial, displayName: '' }, true), [{ op: 'unset', path: ['providers', 'custom', 'displayName'] }])
  const draft = structuredClone(initial)
  draft.models[0]!.name = '変更後'
  draft.models.push(modelDraft({ id: 'two' }))
  assert.deepEqual(customOperations(row, initial, draft, true), [{ op: 'set', path: ['providers', 'custom', 'models'], value: [{ id: 'one', extra: { keep: true }, maxTokens: 8192, name: '変更後' }, { id: 'two' }] }])
  assert.deepEqual(row.value, before)
  assert.deepEqual(customOperations(row, initial, structuredClone(initial), true), [])
  assert.deepEqual(customOperations(row, initial, { ...initial, baseURL: '  http://localhost:4567/v1  ' }, true), [{ op: 'set', path: ['providers', 'custom', 'baseURL'], value: 'http://localhost:4567/v1' }])
  assert.equal((customOperations(row, customDraft(row), { ...good(row), baseURL: '  https://[::1]:1234/v1  ' }, false)[0] as { value: SettingObject }).value.baseURL, 'https://[::1]:1234/v1')
  row.schema = { uid: 0, refs: {
    0: { type: 'object', dict: { providers: 1 } }, 1: { type: 'dict', inner: 2 },
    2: { type: 'object', dict: { models: 3 } }, 3: { type: 'array', inner: 4 },
    4: { type: 'object', dict: { extra: 5 } }, 5: { type: 'string', meta: { role: 'password' } },
  } }
  assert.equal(customFieldWritable(row, 'custom', 'models'), false)
  assert.throws(() => customOperations(row, initial, draft, true), /変更できません/)
  assert.deepEqual(validateCustom({ ...initial, models: [] }, ['openai-responses'], [], true, row), {})
  assert.deepEqual(customOperations(row, initial, { ...initial, displayName: 'safe' }, true), [{ op: 'set', path: ['providers', 'custom', 'displayName'], value: 'safe' }])
})

test('I16 validation: UIの明示条件と実測したHostの条件を区別する', () => {
  const row = ns(), choices = protocolChoices(row)
  assert.deepEqual(choices, ['openai-completions', 'openai-responses', 'anthropic-messages'])
  const base = good(row)
  assert.deepEqual(validateCustom(base, choices, [], false), {})
  for (const id of ['', '__proto__', 'constructor', 'prototype']) assert.ok(validateCustom({ ...base, id }, choices, [], false).id)
  for (const id of ['1-api', 'UPPER', 'with_space', 'a--b', ' ', 'a/b']) assert.deepEqual(validateCustom({ ...base, id }, choices, [], false), {})
  assert.ok(validateCustom(base, choices, ['local-api'], false).id)
  assert.ok(validateCustom({ ...base, baseURL: '' }, choices, [], false).baseURL)
  for (const baseURL of ['not a url', 'ftp://localhost', ' ', 'http://', 'https://[bad]', 'http:localhost']) assert.ok(validateCustom({ ...base, baseURL }, choices, [], false).baseURL)
  for (const baseURL of ['http://localhost:1234', 'http://127.0.0.1:1234/v1', 'https://[::1]:1234', '  https://example.com/v1  ']) assert.deepEqual(validateCustom({ ...base, baseURL }, choices, [], false), {})
  assert.ok(validateCustom({ ...base, api: 'unknown' }, choices, [], false).api)
  for (const models of [[], [modelDraft({ id: '' })], [modelDraft({ id: 'x' }), modelDraft({ id: 'x' })], [{ ...base.models[0]!, maxTokens: '1.000000001' }], [{ ...base.models[0]!, contextWindow: '0' }]]) assert.ok(Object.keys(validateCustom({ ...base, models }, choices, [], false)).length)
  const value = (profile: SettingObject) => ({ providers: { 'test-custom': profile } })
  const profile = { api: 'openai-completions', baseURL: 'not a url', models: [{ id: ' ' }] }
  assert.equal(validMockValue(row, value(profile)), true)
  for (const patch of [{ models: [] }, { models: [{ id: 'x' }, { id: 'x' }] }, { models: [{ id: 'x', maxTokens: 1.000000001 }] }, { api: 'unknown' }]) assert.equal(validMockValue(row, value({ ...profile, ...patch })), false)
})

function harness() {
  const row = ns()
  row.value = { providers: {} }; row.base = { providers: {} }; row.user = {}
  const writes: { ops: SettingsOperation[]; revision: number }[] = []
  const keyWrites: string[] = []
  let rejected = false, throwWrite = false, lostResult = false, writable = true, missing = false, keyFails = false
  let gate: Promise<void> | undefined
  const remote: Pick<ProviderRemote, 'settings' | 'llm'> = {
    settings: {
      async describe() { return { ok: true, value: { writable, namespaces: missing ? [] : [structuredClone(row)] } } },
      async update() { throw new Error('専用フォームはupdateしない') },
      async mutate(_ns, ops, revision) {
        writes.push({ ops: structuredClone(ops), revision })
        if (gate) await gate
        if (rejected) return { ok: false, error: { code: 'settings/conflict', message: '', details: {} } }
        row.user = applyMockOperations(row, ops); row.value = structuredClone(row.user); row.revision++
        if (throwWrite) throw new Error('応答が失われた')
        if (lostResult) return { ok: false, error: { code: 'gateway/internal', message: '', details: {} } }
        return { ok: true, value: structuredClone(row) }
      },
    },
    llm: {
      async listProviders() { return { ok: true, value: [] } },
      async listConfigurableProviders() { return { ok: true, value: Object.keys(row.value.providers ?? {}).map(provider => ({ provider, displayName: provider, settingsNs: 'llm-pi-ai', settingsPath: ['providers', provider], declared: true })) } },
    },
  }
  const keys = {
    async load() { return true },
    getSnapshot() { return { phase: 'ready' as const, busy: false, error: null, rows: Object.keys(row.value.providers ?? {}).map(id => ({ id, name: id, ns: 'llm-pi-ai', path: ['providers', id], ref: 'LOCAL_API_API_KEY', needsReference: false, status: 'missing', writable: true } as ProviderRow)) } },
    async save(_row: ProviderRow, value: string) { keyWrites.push(value); return keyFails ? { ok: false as const, message: '拒否' } : { ok: true as const } },
  }
  const store = createCustomProviderStore(remote, keys)
  const load = async () => { await store.load(); store.change(() => good(row)) }
  return { store, load, row, writes, keyWrites, keys,
    controls: { conflict: () => { rejected = true }, lost: () => { throwWrite = true }, lostResult: () => { lostResult = true }, readonly: () => { writable = false }, missing: () => { missing = true }, keyFails: (next: boolean) => { keyFails = next }, gate: (next: Promise<void>) => { gate = next } } }
}

test('I16 partial: 設定成功後はキーだけ再試行し入力を消して二重送信を防ぐ', async () => {
  const h = harness(); await h.load(); h.controls.keyFails(true)
  h.store.input.input('fake-first'); h.store.input.toggle()
  const wait = deferred<void>(); h.controls.gate(wait.promise)
  const first = h.store.submit()
  assert.equal(h.store.input.getSnapshot().draft, '')
  assert.equal(h.store.input.getSnapshot().visible, false)
  assert.equal(await h.store.submit(), false)
  wait.resolve(); assert.equal(await first, false)
  assert.equal(h.store.getSnapshot().phase, 'keyFailed')
  assert.equal(h.writes.length, 1); assert.equal(h.keyWrites.length, 1)
  h.controls.keyFails(false); h.store.input.input('fake-second')
  assert.equal(await h.store.submit(), true)
  assert.equal(h.writes.length, 1); assert.deepEqual(h.keyWrites, ['fake-first', 'fake-second'])
  const shared = harness()
  shared.row.value = { providers: { 'LOCAL-API': {} } }; shared.row.user = structuredClone(shared.row.value)
  await shared.load(); shared.store.input.input('fake-collision')
  assert.equal(await shared.store.submit(), false)
  assert.ok(shared.store.getSnapshot().errors.key)
  assert.equal(shared.writes.length, 0)
  shared.store.input.clear(); assert.equal(await shared.store.submit(), true)
  await shared.store.load(); shared.store.input.input('fake-later-collision')
  assert.equal(await shared.store.submit(), false)
  assert.equal(shared.writes.length, 1); assert.equal(shared.keyWrites.length, 0)
})

test('I16 refusals: 競合とreadonlyと名前空間なしでは勝手に送信しない', async () => {
  const h = harness(); await h.load(); h.controls.conflict()
  assert.equal(await h.store.submit(), false)
  assert.equal(h.store.getSnapshot().phase, 'stale')
  assert.equal(await h.store.submit(), false); assert.equal(h.writes.length, 1)
  for (const mode of ['readonly', 'missing'] as const) {
    const blocked = harness(); blocked.controls[mode](); await blocked.load()
    assert.equal(await blocked.store.submit(), false); assert.equal(blocked.writes.length, 0)
  }
})

test('I16 close: 設定送信後に閉じると未送信キーと入力を破棄する', async () => {
  const h = harness(); await h.load()
  const wait = deferred<void>(); h.controls.gate(wait.promise)
  h.store.input.input('fake-discarded')
  const saving = h.store.submit()
  h.store.dispose(); wait.resolve()
  assert.equal(await saving, false)
  assert.equal(h.writes.length, 1); assert.equal(h.keyWrites.length, 0)
  assert.equal(h.store.input.getSnapshot().draft, '')
})

test('I16 unknown: 結果不明の追加を読み直して編集に切り替え自動再送しない', async () => {
  for (const mode of ['lost', 'lostResult'] as const) {
    const h = harness(); await h.load(); h.controls[mode]()
    assert.equal(await h.store.submit(), false)
    assert.equal(h.store.getSnapshot().phase, 'unknown')
    assert.equal(await h.store.submit(), false); assert.equal(h.writes.length, 1)
    await h.store.load()
    assert.equal(h.store.getSnapshot().editing, true)
    assert.equal(h.store.getSnapshot().draft!.id, 'local-api')
    assert.equal(h.writes.length, 1)
    h.store.input.input('fake-pending'); h.store.connectionChanged(false)
    assert.equal(h.store.input.getSnapshot().draft, '')
    assert.equal(await h.store.submit(), false)
  }
})

test('I16 explicit reference: 明示された保存先との共有を追加とあと付け登録で生まない', async () => {
  for (const ref of ['LOCAL_API_API_KEY', 'DIFFERENT_API_KEY']) {
    const h = harness()
    h.row.value = { providers: { 'old-provider': { apiKeyEnv: ref } } }; h.row.user = structuredClone(h.row.value)
    await h.load(); h.store.input.input('fake-collision')
    if (ref === 'DIFFERENT_API_KEY') {
      assert.equal(await h.store.submit(), true)
      assert.deepEqual(h.keyWrites, ['fake-collision'])
      continue
    }
    assert.equal(await h.store.submit(), false)
    assert.match(h.store.getSnapshot().errors.key!, /参照名が重なります/)
    assert.equal(h.writes.length, 0); assert.equal(h.keyWrites.length, 0)
    h.store.input.clear(); assert.equal(await h.store.submit(), true)
    await h.store.load(); h.store.input.input('fake-later')
    assert.equal(await h.store.submit(), false)
    assert.match(h.store.getSnapshot().errors.key!, /この画面ではキーを登録できません/)
    assert.equal(h.writes.length, 1); assert.equal(h.keyWrites.length, 0)
  }
})

test('I16 numeric ID: キーなしで作成しても既存の登録状況と登録削除を壊さない', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    const remote = ctx.remote as unknown as ProviderRemote
    const keys = createProviderStore(remote)
    const store = createCustomProviderStore(remote, keys)
    await store.load(); store.change(() => ({ ...good(), id: '1-api' }))
    store.input.input('fake-invalid-reference')
    assert.equal(await store.submit(), false)
    assert.match(store.getSnapshot().errors.key!, /参照名が DSH の形式に合わない/)
    const absent = await remote.settings.describe()
    assert.equal(absent.ok && Object.hasOwn(absent.value.namespaces.find(row => row.ns === 'llm-pi-ai')!.value.providers as object, '1-api'), false)
    store.input.clear(); assert.equal(await store.submit(), true)
    const current = () => keys.getSnapshot().rows
    assert.equal(current().find(row => row.id === '1-api')!.writable, false)
    assert.match(current().find(row => row.id === '1-api')!.keyUnavailableReason!, /参照名/)
    assert.equal(current().find(row => row.id === 'deepseek')!.status, 'registered')
    assert.equal(current().find(row => row.id === 'cloud')!.status, 'missing')
    assert.equal(keys.getSnapshot().error, null)
    assert.equal((await keys.save(current().find(row => row.id === 'cloud')!, 'fake-existing')).ok, true)
    assert.equal(current().find(row => row.id === 'cloud')!.status, 'registered')
    assert.equal((await keys.remove(current().find(row => row.id === 'cloud')!)).ok, true)
    assert.equal(current().find(row => row.id === 'cloud')!.status, 'missing')
    store.dispose()
  } finally { ctx.dispose() }
})

test('I16 key recheck close: キー保存内部の再照会後も閉じたシートから送信しない', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    const remote = ctx.remote as unknown as ProviderRemote
    const keys = createProviderStore(remote)
    const store = createCustomProviderStore(remote, keys)
    await store.load(); store.change(() => good())
    const started = deferred<void>(), release = deferred<void>()
    const describe = remote.settings.describe
    const save = keys.save
    let insideSave = false, writes = 0
    keys.save = async (...args) => { insideSave = true; return save(...args) }
    remote.settings.describe = async () => {
      const answer = await describe()
      if (insideSave) { started.resolve(); await release.promise }
      return answer
    }
    const send = remote.credentials.set
    remote.credentials.set = async (...args) => { writes++; return send(...args) }
    store.input.input('fake-close-during-recheck')
    const pending = store.submit()
    await started.promise
    assert.equal(store.getSnapshot().phase, 'savingKey')
    assert.equal(writes, 0)
    store.dispose(); release.resolve()
    assert.equal(await pending, false)
    assert.equal(writes, 0)
    assert.equal(store.input.getSnapshot().draft, '')
    await keys.load()
    assert.equal(keys.getSnapshot().rows.find(row => row.id === 'local-api')!.status, 'missing')
    // No sheet lifetime is supplied by the existing direct registration path.
    assert.equal((await keys.save(keys.getSnapshot().rows.find(row => row.id === 'local-api')!, 'fake-direct')).ok, true)
    assert.equal(writes, 1)
  } finally { ctx.dispose() }
})

test('I16 reference recheck: 保存の再照会で新たな参照先の共有を検出する', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    const remote = ctx.remote as unknown as ProviderRemote
    const keys = createProviderStore(remote)
    const store = createCustomProviderStore(remote, keys)
    await store.load(); store.change(() => good())
    const save = keys.save
    keys.save = async (...args) => {
      const description = await remote.settings.describe()
      assert.equal(description.ok, true)
      if (!description.ok) throw new Error('取得できません')
      const row = description.value.namespaces.find(row => row.ns === 'llm-pi-ai')!
      assert.equal((await remote.settings.mutate(row.ns, [{ op: 'set', path: ['providers', 'cloud', 'apiKeyEnv'], value: 'LOCAL_API_API_KEY' }], row.revision)).ok, true)
      return save(...args)
    }
    store.input.input('fake-must-not-share')
    assert.equal(await store.submit(), false)
    assert.equal(store.getSnapshot().phase, 'keyFailed')
    assert.equal(keys.getSnapshot().rows.find(row => row.id === 'cloud')!.status, 'missing')
    assert.equal(keys.getSnapshot().rows.find(row => row.id === 'local-api')!.status, 'missing')
    store.dispose()
  } finally { ctx.dispose() }
})
