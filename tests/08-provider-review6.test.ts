import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { extendMock } from '../web/src/features/settings/mock.ts'
import { createProviderStore, type ProviderRemote, type ProviderStore } from '../web/src/features/settings/providers.ts'
import { createCustomProviderStore } from '../web/src/features/settings/custom-provider-store.ts'
import { modelDraft } from '../web/src/features/settings/custom-provider.ts'
import type { SettingsOperation } from '../web/src/features/settings/store.ts'

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(fn => { resolve = fn }); return { promise, resolve } }
const row = (keys: ProviderStore, id: string) => keys.getSnapshot().rows.find(item => item.id === id)!
const partial = '提供元の設定は保存しましたが、API キーを保存できませんでした。 設定を保存する間に、この参照名のキーが登録されました。上書きを避けるため、API キーを送信していません。'
const detached = `${partial} この保存で付けた参照名を、この提供元の設定から外しました。登録済みのキーは、この提供元には使われません。この提供元の API キーは未設定です。キーを使うには、ほかと重ならない ID で追加し直してください。`
const changed = `${partial} この保存で付けた参照名を外せませんでした。ほかの場所で設定が変わっています。この提供元が、登録済みの別のキーを参照したままの可能性があります。再読み込みして、一覧でこの提供元が「API キー：未設定」になっていなければ、DSH の標準の設定でこの提供元の参照名を外すか変えてください。`
const rejected = `${partial} 参照名を外す変更が拒否されました。この提供元は、登録済みの別のキーを参照しています。使う前に、DSH の標準の設定でこの提供元の参照名を外すか変えてください。`
const unknown = `${partial} 参照名を外せたか確認できません。この提供元が、登録済みの別のキーを参照したままの可能性があります。「保存結果を確認」で読み直して、一覧でこの提供元が「API キー：未設定」になっていなければ、DSH の標準の設定でこの提供元の参照名を外すか変えてください。`

function setup() {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  const remote = ctx.remote as unknown as ProviderRemote
  const sent: string[] = [], removed: string[] = [], writes: { ns: string; ops: SettingsOperation[]; revision: number }[] = []
  const set = remote.credentials.set, unset = remote.credentials.unset, mutate = remote.settings.mutate
  remote.credentials.set = async (ref, value) => { sent.push(`${ref}=${value}`); return set(ref, value) }
  remote.credentials.unset = async ref => { removed.push(ref); return unset(ref) }
  remote.settings.mutate = async (ns, ops, revision) => { writes.push({ ns, ops: structuredClone(ops), revision }); return mutate(ns, ops, revision) }
  const keys = createProviderStore(remote)
  const describe = async (ns: string) => {
    const description = await remote.settings.describe(); assert.ok(description.ok)
    return description.value.namespaces.find(item => item.ns === ns)!
  }
  const profile = async (id: string) => ((await describe('llm-pi-ai')).value.providers as Record<string, any>)[id]
  /** Hold this form's settings answer; meanwhile llm-deepseek names the reference and registers a key. */
  const race = (ref: string) => {
    const started = deferred(), held = deferred()
    const inner = remote.settings.mutate
    remote.settings.mutate = async (...args) => {
      const answer = await inner(...args)
      remote.settings.mutate = inner; started.resolve(); await held.promise
      return answer
    }
    return { started: started.promise, async register() {
      const foreign = await describe('llm-deepseek')
      assert.ok((await remote.settings.update(foreign.ns, { apiKeyEnv: ref }, foreign.revision)).ok)
      assert.ok((await set(ref, 'fake-other-owner')).ok)
      held.resolve()
    } }
  }
  const open = async (id: string) => {
    const form = createCustomProviderStore(remote, keys)
    await form.load()
    form.change(draft => ({ ...draft, id, baseURL: 'http://localhost:4321/v1', models: [modelDraft({ id: 'one' })] }))
    return form
  }
  return { ctx, remote, keys, sent, removed, writes, describe, profile, race, open }
}

test('I16 G1 standard notice: 前からある種類の行には参照先だけの案内を付けずmainの表示を保つ', async () => {
  const { ctx, remote, keys, profile } = setup()
  try {
    // An inactive standard pi-ai route without a profile (not declared, not live).
    const directory = remote.llm.listConfigurableProviders
    remote.llm.listConfigurableProviders = async () => {
      const result = await directory(); assert.ok(result.ok)
      return { ok: true, value: [...result.value.filter(item => item.provider !== 'openai'), { provider: 'openai', displayName: 'openai', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'openai'], declared: false }] }
    }
    await keys.load()
    // Explicit standard reference (llm-deepseek names DEEPSEEK_API_KEY) without a key.
    assert.ok((await keys.remove(row(keys, 'deepseek'))).ok)
    assert.deepEqual([row(keys, 'deepseek').status, row(keys, 'deepseek').keyNotice], ['missing', undefined])
    // An inactive standard pi-ai row whose reference was just written by main's flow.
    const set = remote.credentials.set
    remote.credentials.set = async () => ({ ok: false, error: { code: 'credential/rejected', message: '', details: {} } })
    assert.equal(row(keys, 'openai').needsReference, true)
    assert.equal((await keys.save(row(keys, 'openai'), 'fake-standard')).ok, false)
    remote.credentials.set = set
    await keys.load()
    assert.deepEqual([row(keys, 'openai').needsReference, row(keys, 'openai').status, row(keys, 'openai').keyNotice], [false, 'missing', undefined])
    // Two standard-kind rows naming the same reference explicitly.
    const ns = (await remote.settings.describe()); assert.ok(ns.ok)
    const pi = ns.value.namespaces.find(item => item.ns === 'llm-pi-ai')!
    assert.ok((await remote.settings.mutate(pi.ns, [{ op: 'set', path: ['providers', 'cloud', 'apiKeyEnv'], value: 'OPENAI_API_KEY' }], pi.revision)).ok)
    await keys.load()
    for (const id of ['cloud', 'openai']) assert.deepEqual([row(keys, id).status, row(keys, id).keyNotice], ['missing', undefined])
    // The custom row with a reference only still carries the notice.
    const draft = { api: 'openai-completions', baseURL: 'http://localhost:4321', models: [{ id: 'one' }], apiKeyEnv: 'NOTICE_ONLY_API_KEY' }
    const latest = await remote.settings.describe(); assert.ok(latest.ok)
    const target = latest.value.namespaces.find(item => item.ns === 'llm-pi-ai')!
    assert.ok((await remote.settings.mutate(target.ns, [{ op: 'set', path: ['providers', 'notice-only'], value: draft }], target.revision)).ok)
    await keys.load()
    assert.equal(row(keys, 'notice-only').custom, true)
    assert.match(row(keys, 'notice-only').keyNotice!, /キーの参照先だけが設定されています/)
    assert.equal((await profile('notice-only')).apiKeyEnv, 'NOTICE_ONLY_API_KEY')
  } finally { ctx.dispose() }
})

test('I16 G2 detach: 新しく付けた名前に別のキーが登録されたら、その名前を外して別のキーを参照させない', async () => {
  const { ctx, keys, sent, removed, writes, describe, profile, race, open } = setup()
  try {
    const form = await open('local-api')
    const step = race('LOCAL_API_API_KEY')
    form.input.input('fake-form')
    const pending = form.submit()
    await step.started; await step.register()
    assert.equal(await pending, false)
    assert.deepEqual(sent, [])
    assert.deepEqual(removed, [])
    assert.equal(form.getSnapshot().message, detached)
    assert.equal(form.getSnapshot().phase, 'saved')
    assert.equal((await profile('local-api')).apiKeyEnv, undefined)
    assert.equal((await profile('local-api')).baseURL, 'http://localhost:4321/v1')
    // Exactly one path operation, at the revision read just before it.
    const detach = writes.at(-1)!
    assert.deepEqual(detach.ops, [{ op: 'unset', path: ['providers', 'local-api', 'apiKeyEnv'] }])
    assert.equal(writes.length, 2)
    assert.equal(detach.revision, writes[0]!.revision + 1)
    // The other owner keeps its name and key.
    assert.equal((await describe('llm-deepseek')).value.apiKeyEnv, 'LOCAL_API_API_KEY')
    await keys.load()
    assert.equal(row(keys, 'deepseek').status, 'registered')
    assert.deepEqual([row(keys, 'local-api').status, row(keys, 'local-api').ref], ['unset', undefined])
    // Closed state: nothing more is sent from this form.
    form.input.input('fake-after-detach')
    assert.equal(await form.submit(), false)
    assert.deepEqual(sent, []); assert.equal(writes.length, 2)
    form.dispose()
    // Reopening and entering a key now stops at the collision before any write.
    const reopened = createCustomProviderStore(ctx.remote as unknown as ProviderRemote, keys, 'local-api')
    await reopened.load(); reopened.input.input('fake-reopened')
    assert.equal(await reopened.submit(), false)
    assert.match(reopened.getSnapshot().errors.key!, /参照名が重なります/)
    assert.deepEqual(sent, []); assert.equal(writes.length, 2)
    reopened.dispose()
  } finally { ctx.dispose() }
})

test('I16 G2 detach changed: 名前が自分の付けた値から変わっていたら外さず案内する', async () => {
  const { ctx, remote, keys, sent, writes, describe, profile, race, open } = setup()
  try {
    const form = await open('local-api')
    const step = race('LOCAL_API_API_KEY')
    // Another page renames this provider's reference after the key save refused.
    const save = keys.save
    keys.save = async (...args) => {
      const outcome = await save(...args)
      const pi = await describe('llm-pi-ai')
      assert.ok((await remote.settings.update(pi.ns, { providers: { 'local-api': { apiKeyEnv: 'RENAMED_API_KEY' } } }, pi.revision)).ok)
      return outcome
    }
    form.input.input('fake-form')
    const pending = form.submit()
    await step.started; await step.register()
    assert.equal(await pending, false)
    assert.equal(form.getSnapshot().message, changed)
    assert.equal(form.getSnapshot().phase, 'stale')
    assert.equal((await profile('local-api')).apiKeyEnv, 'RENAMED_API_KEY')
    assert.equal(writes.filter(write => write.ops.some(op => op.op === 'unset')).length, 0)
    assert.deepEqual(sent, [])
    form.dispose()
  } finally { ctx.dispose() }
})

test('I16 G2 detach conflict: 外す書き込みが競合したら自動で再送せず、読み直したあとの再試行で外す', async () => {
  const { ctx, remote, sent, writes, profile, race, open } = setup()
  try {
    const form = await open('local-api')
    const mutate = remote.settings.mutate
    let conflicts = 1
    remote.settings.mutate = async (ns, ops, revision) => {
      if (ops.some(op => op.op === 'unset') && conflicts-- > 0) { writes.push({ ns, ops, revision }); return { ok: false, error: { code: 'settings/conflict', message: '', details: {} } } }
      return mutate(ns, ops, revision)
    }
    const step = race('LOCAL_API_API_KEY')
    form.input.input('fake-form')
    const pending = form.submit()
    await step.started; await step.register()
    assert.equal(await pending, false)
    assert.equal(form.getSnapshot().message, changed)
    assert.equal(form.getSnapshot().phase, 'stale')
    assert.equal((await profile('local-api')).apiKeyEnv, 'LOCAL_API_API_KEY')
    assert.equal(writes.filter(write => write.ops.some(op => op.op === 'unset')).length, 1)
    assert.deepEqual(sent, [])
    // Re-read in the same sheet, then retry: still refuses the key and detaches.
    await form.load(); assert.equal(form.getSnapshot().phase, 'editing')
    form.input.input('fake-retry')
    assert.equal(await form.submit(), false)
    assert.equal(form.getSnapshot().message, detached)
    assert.equal((await profile('local-api')).apiKeyEnv, undefined)
    assert.equal(writes.filter(write => write.ops.some(op => op.op === 'unset')).length, 2)
    assert.deepEqual(sent, [])
    form.dispose()
  } finally { ctx.dispose() }
})

test('I16 G2 detach failures: 拒否と結果不明でも名前を残したことを案内しキーを送らない', async () => {
  for (const mode of ['rejected', 'thrown', 'unreadable'] as const) {
    const { ctx, remote, keys, sent, profile, race, open } = setup()
    try {
      const form = await open('local-api')
      const mutate = remote.settings.mutate, read = remote.settings.describe
      remote.settings.mutate = async (ns, ops, revision) => {
        if (!ops.some(op => op.op === 'unset')) return mutate(ns, ops, revision)
        if (mode === 'thrown') throw new Error('応答を受け取れませんでした。')
        return { ok: false, error: { code: 'settings/rejected', message: '', details: {} } }
      }
      const step = race('LOCAL_API_API_KEY')
      // The read just before the detach fails; the key check itself read fine.
      const save = keys.save
      keys.save = async (...args) => {
        const outcome = await save(...args)
        if (mode === 'unreadable') remote.settings.describe = async () => ({ ok: false, error: { code: 'unavailable', message: '', details: {} } })
        return outcome
      }
      form.input.input('fake-form')
      const pending = form.submit()
      await step.started; await step.register()
      assert.equal(await pending, false)
      assert.equal(form.getSnapshot().message, mode === 'rejected' ? rejected : unknown)
      assert.equal(form.getSnapshot().phase, mode === 'rejected' ? 'keyFailed' : 'unknown')
      remote.settings.describe = read
      assert.equal((await profile('local-api')).apiKeyEnv, 'LOCAL_API_API_KEY')
      assert.deepEqual(sent, [])
      form.dispose()
    } finally { ctx.dispose() }
  }
})

test('I16 G3 list destination: 一覧が導出名を使う標準の行と重なる名前を新しく付けない', async () => {
  for (const [standard, id] of [['openai-codex', 'OpenAI-Codex'], ['azure-openai-responses', 'azure.openai.responses']] as const) {
    const { ctx, remote, keys, sent, writes, open } = setup()
    try {
      const directory = remote.llm.listConfigurableProviders
      remote.llm.listConfigurableProviders = async () => {
        const result = await directory(); assert.ok(result.ok)
        return { ok: true, value: [...result.value, { provider: standard, displayName: standard, settingsNs: 'llm-pi-ai', settingsPath: ['providers', standard], declared: false }] }
      }
      await keys.load()
      const ref = row(keys, standard).ref!
      assert.equal(row(keys, standard).needsReference, true)
      const form = await open(id)
      form.input.input('fake-collision')
      assert.equal(await form.submit(), false)
      assert.match(form.getSnapshot().errors.key!, new RegExp(`参照名「${ref}」：別の提供元とキーの参照名が重なります。`))
      assert.deepEqual(sent, []); assert.equal(writes.length, 0)
      // Keyless creation stays possible, and the standard row is as on main.
      form.input.clear(); assert.equal(await form.submit(), true)
      await keys.load()
      assert.deepEqual([row(keys, standard).ref, row(keys, standard).status, row(keys, standard).writable], [ref, 'missing', true])
      form.dispose()
    } finally { ctx.dispose() }
  }
})
