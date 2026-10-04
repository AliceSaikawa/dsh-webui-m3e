import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { unwrapRemoteResult } from '../web/src/dsh/remote-result.ts'
import type { RemoteResult } from '../web/src/dsh/services.ts'
import { extendMock } from '../web/src/features/settings/mock.ts'
import { createKeyDraft, createProviderStore, keyInfo, type KeyOutcome, type ProviderRemote, type ProviderStore } from '../web/src/features/settings/providers.ts'
import { schemaFields, valueAt } from '../web/src/features/settings/schema.ts'
import { mockPermissionCatalog } from '../web/src/features/composer/mock.ts'

function setup(scenario?: string) {
  const ctx = createMockContext({ extensions: [{ extendMock }], scenario })
  const source = ctx.remote as unknown as ProviderRemote
  const remote: ProviderRemote = { llm: { ...source.llm }, settings: { ...source.settings }, credentials: { ...source.credentials } }
  return { ctx, remote }
}
function row(store: ProviderStore, id = 'cloud') {
  const result = store.getSnapshot().rows.find(item => item.id === id)
  assert.ok(result)
  return result
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}
const success = <T>(value: T): RemoteResult<T> => ({ ok: true, value })
const failure = (message: string): RemoteResult<never> => ({ ok: false, error: { code: 'rejected', message, details: { message } } })

test('偽データは登録済み・未登録・不要を分け、登録と削除の後に状態を更新する', async () => {
  const { ctx, remote } = setup()
  try {
    const store = createProviderStore(remote)
    const snapshots: string[] = []
    const stop = store.subscribe(() => { snapshots.push(JSON.stringify(store.getSnapshot())) })
    assert.equal(await store.load(), true)
    assert.deepEqual(store.getSnapshot().rows.map(item => [item.id, item.status]), [
      ['deepseek-official', 'registered'], ['cloud', 'missing'], ['local', 'unnecessary'],
    ])
    assert.equal(row(store, 'local').writable, false)
    assert.deepEqual(await store.save(row(store), 'submitted-value-never-returned'), { ok: true })
    assert.equal(row(store).status, 'registered')
    const status = unwrapRemoteResult(await remote.credentials.describe(['PI_AI_API_KEY']))
    assert.deepEqual(status, { PI_AI_API_KEY: { configured: true, writable: true } })
    assert.deepEqual(await store.remove(row(store)), { ok: true })
    assert.equal(row(store).status, 'missing')
    assert.doesNotMatch(JSON.stringify(snapshots), /submitted-value-never-returned/)
    stop()
  } finally { ctx.dispose() }
})

test('保存と削除の再確認中に更新通知が重なっても操作を完了する', async () => {
  for (const operation of ['save', 'remove']) {
    for (const event of ['credentials/reference-updated', 'llm/adapters-updated', 'settings/document-updated']) {
      const { ctx, remote } = setup()
      try {
        const store = createProviderStore(remote)
        await store.load()
        const target = row(store, operation === 'save' ? 'cloud' : 'deepseek-official')
        const started = deferred<void>()
        const release = deferred<void>()
        const describe = remote.settings.describe
        let reads = 0
        remote.settings.describe = async () => {
          const answer = structuredClone(await describe())
          if (++reads === 1) { started.resolve(); await release.promise }
          return answer
        }
        const refreshes: Promise<boolean>[] = []
        const on = ctx.remote.$on as (name: string, handler: () => void) => () => void
        const off = on(event, () => { refreshes.push(store.load()) })
        const draft = createKeyDraft(value => store.save(target, value))
        draft.input('overlapping-event-input'); draft.toggle()
        const pending = operation === 'save' ? draft.submit() : store.remove(target).then(result => result.ok)
        await started.promise
        await ctx.mock.emit(event, target.ref)
        assert.equal(store.getSnapshot().busy, true)
        release.resolve()
        assert.equal(await pending, true)
        await Promise.all(refreshes)
        assert.equal(row(store, target.id).status, operation === 'save' ? 'registered' : 'missing')
        assert.equal(store.getSnapshot().error, null)
        assert.ok(reads >= 3, '通知が重なった検証用の取得をやり直し、操作後にも状態を取得する')
        if (operation === 'save') assert.deepEqual(draft.getSnapshot(), { draft: '', visible: false, busy: false, error: null })
        assert.doesNotMatch(JSON.stringify(store.getSnapshot()), /overlapping-event-input/)
        off(); draft.dispose()
      } finally { ctx.dispose() }
    }
  }
})

test('更新通知が重なった再確認は最新の参照先を取り直し古い参照への保存を止める', async () => {
  const { ctx, remote } = setup()
  try {
    const store = createProviderStore(remote)
    await store.load()
    const target = row(store)
    const started = deferred<void>()
    const release = deferred<void>()
    const describe = remote.settings.describe
    let reads = 0
    let writes = 0
    remote.settings.describe = async () => {
      const answer = structuredClone(await describe())
      if (++reads === 1) { started.resolve(); await release.promise }
      return answer
    }
    remote.credentials.set = async () => { writes++; return success({}) }
    const refreshes: Promise<boolean>[] = []
    const on = ctx.remote.$on as (name: string, handler: () => void) => () => void
    const off = on('settings/document-updated', () => { refreshes.push(store.load()) })
    const pending = store.save(target, 'must-not-use-outdated-reference')
    await started.promise
    const updated = await remote.settings.update(target.ns, { providers: { cloud: { apiKeyEnv: 'CHANGED_API_KEY' } } }, target.revision!)
    assert.equal(updated.ok, true)
    release.resolve()
    assert.equal((await pending).ok, false)
    await Promise.all(refreshes)
    assert.equal(writes, 0)
    assert.equal(row(store).ref, 'CHANGED_API_KEY')
    off()
  } finally { ctx.dispose() }
})

test('参照指定のない未稼働の非 pi-ai 提供元も導出参照で状態だけを照会する', async () => {
  for (const configured of [false, true]) {
    const { ctx, remote } = setup()
    try {
      const list = remote.llm.listProviders
      remote.llm.listProviders = async () => success(unwrapRemoteResult(await list()).filter(item => item.id !== 'deepseek-official'))
      const describe = remote.settings.describe
      remote.settings.describe = async () => {
        const description = structuredClone(unwrapRemoteResult(await describe()))
        description.namespaces.find(item => item.ns === 'llm-deepseek')!.value = {}
        return success(description)
      }
      const lookup = remote.credentials.describe
      const lookedUp: string[][] = []
      remote.credentials.describe = async refs => {
        lookedUp.push(refs)
        const result = unwrapRemoteResult(await lookup(refs))
        result.DEEPSEEK_OFFICIAL_API_KEY = { configured, writable: true }
        return success(result)
      }
      let writes = 0
      remote.settings.update = async () => { writes++; return failure('変更してはいけません') }
      remote.credentials.set = async () => { writes++; return failure('変更してはいけません') }
      remote.credentials.unset = async () => { writes++; return failure('変更してはいけません') }
      const store = createProviderStore(remote)
      assert.equal(await store.load(), true)
      const target = row(store, 'deepseek-official')
      assert.equal(target.ref, 'DEEPSEEK_OFFICIAL_API_KEY')
      assert.equal(target.status, configured ? 'registered' : 'missing')
      assert.equal(target.writable, false)
      assert.equal(store.getSnapshot().error, null)
      const requested = lookedUp[0]
      assert.ok(requested)
      assert.ok(requested.includes('DEEPSEEK_OFFICIAL_API_KEY'))
      assert.equal((await store.save(target, 'must-not-write-derived-only-reference')).ok, false)
      assert.equal((await store.remove(target)).ok, false)
      assert.equal(writes, 0)
    } finally { ctx.dispose() }
  }
})

test('設定全体とキー専用の読み取り専用状態はどちらも登録と削除を止める', async () => {
  for (const scenario of ['settings-readonly', 'settings-keys-readonly']) {
    const { ctx, remote } = setup(scenario)
    try {
      let writes = 0
      if (scenario === 'settings-readonly') {
        const describe = remote.credentials.describe
        remote.credentials.describe = async refs => success(Object.fromEntries(Object.entries(unwrapRemoteResult(await describe(refs)))
          .map(([ref, info]) => [ref, { ...keyInfo(info)!, writable: true }])))
      }
      const set = remote.credentials.set
      const unset = remote.credentials.unset
      remote.credentials.set = async (...args) => { writes++; return set(...args) }
      remote.credentials.unset = async (...args) => { writes++; return unset(...args) }
      const store = createProviderStore(remote)
      await store.load()
      assert.equal(row(store).writable, false)
      assert.equal(row(store, 'deepseek-official').writable, false)
      assert.equal((await store.save(row(store), 'must-not-be-written')).ok, false)
      assert.equal((await store.remove(row(store, 'deepseek-official'))).ok, false)
      assert.equal(writes, 0)
      assert.equal(row(store).status, 'missing')
      assert.equal(row(store, 'deepseek-official').status, 'registered')
      assert.equal(unwrapRemoteResult(await remote.settings.describe()).writable, scenario !== 'settings-readonly')
    } finally { ctx.dispose() }
  }
})

test('状態照会の拒否・不正応答・例外を未登録に置き換えず書き込みを止める', async () => {
  for (const mode of ['rejected', 'malformed', 'thrown']) {
    const { ctx, remote } = setup(mode === 'rejected' ? 'settings-keys-unavailable' : undefined)
    try {
      if (mode === 'malformed') remote.credentials.describe = async () => success({ PI_AI_API_KEY: { configured: 'false', writable: true } })
      if (mode === 'thrown') remote.credentials.describe = async () => { throw new Error('remote-key-do-not-display') }
      const store = createProviderStore(remote)
      const loaded = await store.load()
      const state = store.getSnapshot()
      assert.equal(loaded, mode !== 'thrown')
      assert.ok(state.error)
      assert.equal(state.rows.some(item => item.status === 'missing'), false)
      assert.equal(state.rows.some(item => item.writable), false)
      if (mode !== 'thrown') assert.equal(row(store).status, 'unknown')
      assert.doesNotMatch(JSON.stringify(state), /remote-key-do-not-display/)
    } finally { ctx.dispose() }
  }
})

test('登録状態の変換は二つの真偽値だけを残し余分な保存値を捨てる', () => {
  const raw = { configured: true, writable: false, value: 'stored-value-do-not-display', nested: { token: 'stored-value-do-not-display' } }
  assert.deepEqual(keyInfo(raw), { configured: true, writable: false })
  assert.doesNotMatch(JSON.stringify(keyInfo(raw)), /stored-value-do-not-display/)
  assert.equal(raw.value, 'stored-value-do-not-display')
  for (const value of [null, [], false, {}, { configured: true }, { configured: 'true', writable: true }, { configured: true, writable: 1 }]) {
    assert.equal(keyInfo(value), undefined)
  }
})

test('サーバーの拒否と例外に入力値が含まれても保存結果と入力シートへ出さない', async () => {
  for (const mode of ['rejected', 'thrown']) {
    const { ctx, remote } = setup()
    try {
      remote.credentials.set = async (_ref, value) => {
        if (mode === 'thrown') throw new Error(`送信した値: ${value}`)
        return failure(`送信した値: ${value}`)
      }
      const store = createProviderStore(remote)
      await store.load()
      const draft = createKeyDraft(value => store.save(row(store), value))
      const snapshots: string[] = []
      draft.input('do-not-echo-failed-value')
      draft.toggle()
      const stop = draft.subscribe(() => { snapshots.push(JSON.stringify(draft.getSnapshot())) })
      assert.equal(await draft.submit(), false)
      assert.deepEqual({ draft: draft.getSnapshot().draft, visible: draft.getSnapshot().visible, busy: draft.getSnapshot().busy }, { draft: '', visible: false, busy: false })
      assert.ok(draft.getSnapshot().error)
      assert.doesNotMatch(JSON.stringify([snapshots, store.getSnapshot()]), /do-not-echo-failed-value/)
      stop(); draft.dispose()
    } finally { ctx.dispose() }
  }
})

test('入力シートは送信開始時に入力と表示状態を消し成功・失敗・破棄の後も戻さない', async () => {
  for (const result of ['success', 'rejected', 'thrown']) {
    const pending = deferred<KeyOutcome>()
    let calls = 0
    const draft = createKeyDraft(async value => { calls++; assert.equal(value, 'entered-key'); return pending.promise })
    draft.input(' entered-key '); draft.toggle()
    assert.equal(draft.getSnapshot().visible, true)
    const submission = draft.submit()
    assert.deepEqual(draft.getSnapshot(), { draft: '', visible: false, busy: true, error: null })
    draft.input('busy-input'); draft.toggle()
    assert.equal(draft.getSnapshot().draft, '')
    assert.equal(draft.getSnapshot().visible, false)
    assert.equal(await draft.submit(), false)
    if (result === 'thrown') pending.reject(new Error('entered-key'))
    else pending.resolve(result === 'success' ? { ok: true } : { ok: false, message: '保存できませんでした。' })
    assert.equal(await submission, result === 'success')
    assert.equal(calls, 1)
    assert.equal(draft.getSnapshot().draft, '')
    assert.equal(draft.getSnapshot().visible, false)
    assert.equal(draft.getSnapshot().busy, false)
    assert.equal(Boolean(draft.getSnapshot().error), result !== 'success')
    assert.doesNotMatch(JSON.stringify(draft.getSnapshot()), /entered-key/)
    draft.input('discarded-input'); draft.toggle(); draft.dispose(); draft.activate()
    assert.deepEqual(draft.getSnapshot(), { draft: '', visible: false, busy: false, error: null })
    draft.dispose()
  }
})

test('破棄した入力シートの遅い応答は開き直した入力シートを更新しない', async () => {
  const pending = deferred<KeyOutcome>()
  const draft = createKeyDraft(() => pending.promise)
  draft.input('old-input')
  const submission = draft.submit()
  draft.dispose(); draft.activate(); draft.input('new-input'); draft.toggle()
  const reopened = structuredClone(draft.getSnapshot())
  pending.resolve({ ok: false, message: '古い保存に失敗しました。' })
  assert.equal(await submission, false)
  assert.deepEqual(draft.getSnapshot(), reopened)
  draft.dispose()
})

test('未稼働の提供元は導出した参照先を設定に保存してからキーを登録する', async () => {
  const { ctx, remote } = setup()
  try {
    const list = remote.llm.listProviders
    remote.llm.listProviders = async () => success(unwrapRemoteResult(await list()).filter(item => item.id !== 'cloud'))
    const describe = remote.settings.describe
    const update = remote.settings.update
    const set = remote.credentials.set
    let named = false
    const writes: unknown[] = []
    remote.settings.describe = async () => {
      const description = unwrapRemoteResult(await describe())
      if (!named) description.namespaces.find(item => item.ns === 'llm-pi-ai')!.value.providers = { cloud: {} }
      return success(description)
    }
    remote.settings.update = async (ns, patch, revision) => {
      writes.push(['settings', ns, patch, revision])
      const result = await update(ns, patch, revision)
      if (result.ok) named = true
      return result
    }
    remote.credentials.set = async (ref, value) => { writes.push(['key', ref]); return set(ref, value) }
    const store = createProviderStore(remote)
    await store.load()
    const target = row(store)
    assert.equal(target.ref, 'CLOUD_API_KEY')
    assert.equal(target.needsReference, true)
    assert.equal(target.status, 'missing')
    assert.deepEqual(await store.save(target, 'key-for-inactive-provider'), { ok: true })
    assert.deepEqual(writes, [
      ['settings', 'llm-pi-ai', { providers: { cloud: { apiKeyEnv: 'CLOUD_API_KEY' } } }, target.revision],
      ['key', 'CLOUD_API_KEY'],
    ])
    assert.equal(row(store).status, 'registered')
    assert.equal(row(store).needsReference, false)
  } finally { ctx.dispose() }
})

test('設定の参照先が外部で変わったら古い入力シートの保存を止める', async () => {
  const { ctx, remote } = setup()
  try {
    let writes = 0
    const set = remote.credentials.set
    remote.credentials.set = async (...args) => { writes++; return set(...args) }
    const store = createProviderStore(remote)
    await store.load()
    const stale = row(store)
    const settings = unwrapRemoteResult(await remote.settings.describe())
    const ns = settings.namespaces.find(item => item.ns === stale.ns)!
    assert.equal((await remote.settings.update(ns.ns, { providers: { cloud: { apiKeyEnv: 'EXTERNAL_API_KEY' } } }, ns.revision)).ok, true)
    const outcome = await store.save(stale, 'must-not-use-old-reference')
    assert.equal(outcome.ok, false)
    assert.equal(writes, 0)
    assert.equal(row(store).ref, 'EXTERNAL_API_KEY')
    assert.equal(row(store).status, 'missing')
  } finally { ctx.dispose() }
})

test('切断前に始まった照会・保存前再確認・保存の応答は切断後の状態を巻き戻さない', async () => {
  for (const operation of ['load', 'validation', 'save']) {
    const { ctx, remote } = setup()
    try {
      const store = createProviderStore(remote)
      await store.load()
      const started = deferred<void>()
      const pending = deferred<RemoteResult<Record<string, unknown>>>()
      if (operation !== 'save') remote.credentials.describe = async () => { started.resolve(); return pending.promise }
      else remote.credentials.set = async () => { started.resolve(); return pending.promise }
      const request = operation === 'load' ? store.load() : store.save(row(store), 'old-connection-input')
      await started.promise
      store.connectionChanged(false)
      const disconnected = structuredClone(store.getSnapshot())
      assert.deepEqual(disconnected.rows, [])
      assert.equal(disconnected.busy, false)
      pending.resolve(success({ PI_AI_API_KEY: { configured: true, writable: true } }))
      const result = await request
      assert.equal(typeof result === 'boolean' ? result : result.ok, false)
      assert.deepEqual(store.getSnapshot(), disconnected)
    } finally { ctx.dispose() }
  }
})

test('保存後の遅い再取得と待機した通知は再接続後の操作を妨げない', async () => {
  const { ctx, remote } = setup()
  try {
    const store = createProviderStore(remote)
    await store.load()
    const oldRefreshStarted = deferred<void>()
    const oldRefreshRelease = deferred<void>()
    const describe = remote.settings.describe
    let reads = 0
    remote.settings.describe = async () => {
      const answer = structuredClone(await describe())
      if (++reads === 2) { oldRefreshStarted.resolve(); await oldRefreshRelease.promise }
      return answer
    }
    const oldSave = store.save(row(store), 'input-from-old-connection')
    await oldRefreshStarted.promise
    const oldEvent = store.load()
    store.connectionChanged(false)
    store.connectionChanged(true)
    assert.equal(await store.load(), true)
    assert.equal(row(store).status, 'registered')
    const newWriteStarted = deferred<void>()
    const newWriteRelease = deferred<void>()
    const unset = remote.credentials.unset
    remote.credentials.unset = async ref => {
      newWriteStarted.resolve(); await newWriteRelease.promise
      return unset(ref)
    }
    const newSave = store.remove(row(store))
    await newWriteStarted.promise
    const current = structuredClone(store.getSnapshot())
    assert.equal(current.busy, true)
    oldRefreshRelease.resolve()
    assert.equal((await oldSave).ok, false)
    assert.equal(await oldEvent, false)
    assert.deepEqual(store.getSnapshot(), current)
    newWriteRelease.resolve()
    assert.equal((await newSave).ok, true)
    assert.equal(row(store).status, 'missing')
    assert.equal(store.getSnapshot().busy, false)
  } finally { ctx.dispose() }
})

test('権限の偽データは03の既定値とプリセット候補に一致する', async () => {
  const { ctx, remote } = setup()
  try {
    const settings = unwrapRemoteResult(await remote.settings.describe())
    const permission = settings.namespaces.find(item => item.ns === 'permission')!
    assert.equal(valueAt(permission.value, ['defaultPreset']), undefined)
    const field = schemaFields(permission, mockPermissionCatalog).find(item => item.path[0] === 'defaultPreset')!
    assert.equal(field.kind, 'select')
    assert.deepEqual(field.options, [
      { value: 'workspace-write', label: 'ワークスペース書込' },
      { value: 'danger-full-access', label: 'フル アクセス' },
    ])
  } finally { ctx.dispose() }
})
