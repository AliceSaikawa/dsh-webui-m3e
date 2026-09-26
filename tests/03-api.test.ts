import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { MOCK_IDS } from '../web/src/dsh/mock/fixtures.ts'
import { RemoteCallError } from '../web/src/dsh/remote-result.ts'
import { composerApi, permissionDefaultsOf, requireMatched } from '../web/src/features/composer/api.ts'
import { extendMock, mockModelCatalog, mockPermissions } from '../web/src/features/composer/mock.ts'

test('composer RPC は sessionId と中断信号を実物と同じ位置へ渡す', async () => {
  const calls: unknown[][] = []
  const signal = new AbortController().signal
  const selection = { provider: 'local', model: 'model-one', reasoningEffort: 'high' }
  let changed = () => {}
  let unsubscribed = false
  const api = composerApi({
    commands: { async list(...args: unknown[]) { calls.push(['commands', ...args]); return { ok: true, value: [] } } },
    fileReferences: { async list(...args: unknown[]) { calls.push(['files', ...args]); return { ok: true, value: [] } } },
    session: {
      async modelCatalog(...args: unknown[]) { calls.push(['catalog', ...args]); return { ok: true, value: mockModelCatalog } },
      async selectModel(...args: unknown[]) { calls.push(['model', ...args]); return { ok: true, value: { selected: selection } } },
    },
    $on(event: string, listener: () => void) { calls.push(['listen', event]); changed = listener; return () => { unsubscribed = true } },
  })
  assert.deepEqual(await api.listCommands('session-one'), [])
  assert.deepEqual(await api.listFiles('session-one', 'docs/', signal), [])
  assert.deepEqual(await api.modelCatalog(), mockModelCatalog)
  assert.deepEqual(await api.selectModel('session-one', selection), selection)
  let count = 0
  const stop = api.onCommandsChange(() => { count++ })
  changed()
  stop()
  assert.equal(count, 1)
  assert.equal(unsubscribed, true)
  assert.deepEqual(calls, [
    ['commands', 'session-one'], ['files', 'session-one', 'docs/', signal], ['catalog'],
    ['model', { sessionId: 'session-one', ...selection }], ['listen', 'commands/change'],
  ])
})

test('RPC の失敗と未対応コマンドを成功として扱わない', () => {
  const failed = { ok: false as const, error: { code: 'session/not-found', message: '会話が見つかりません。', details: {} } }
  assert.throws(() => requireMatched(failed), error => {
    assert.ok(error instanceof RemoteCallError)
    assert.match(error.message, /会話が見つかりません/)
    assert.equal(error.rpcError, failed.error)
    return true
  })
  assert.throws(() => requireMatched({ ok: true, value: { matched: false } }), /使えません/)
  assert.doesNotThrow(() => requireMatched({ ok: true, value: { matched: true } }))
})

test('解除関数のないイベント API でも、閉じた画面へ更新を渡さない', () => {
  let emit = () => {}
  let count = 0
  const stop = composerApi({ $on(_name: string, listener: () => void) { emit = listener } }).onCommandsChange(() => { count++ })
  emit()
  stop()
  emit()
  assert.equal(count, 1)
})

test('権限の既定値は serialized schema の公開候補から読み、全体設定へ書かない', async () => {
  let reads = 0
  const api = composerApi({ settings: {
    async describe() {
      reads++
      return { ok: true, value: { namespaces: [{ ns: 'permission', value: { defaultPreset: 'workspace-write' }, schema: { uid: 1, refs: {
        1: { type: 'object', dict: { defaultPreset: 2 } },
        2: { type: 'union', list: [3, 4] },
        3: { type: 'const', value: 'workspace-write', meta: { description: 'ワークスペース書込' } },
        4: { type: 'const', value: 'custom', meta: { description: 'カスタム' } },
      } } }] } }
    },
    mutate() { assert.fail('会話の権限は全体設定を書き換えません') },
  } })
  assert.deepEqual(await api.defaultPermissions(), { currentValue: 'workspace-write', options: [{ value: 'workspace-write', name: 'ワークスペース書込' }] })
  assert.equal(reads, 1)
  assert.equal(await composerApi({}).defaultPermissions(), undefined)
  assert.equal(permissionDefaultsOf(undefined), undefined)
  assert.throws(() => permissionDefaultsOf({ ns: 'permission', value: { defaultPreset: 'unknown' }, schema: { type: 'object', dict: { defaultPreset: { type: 'const', value: 'workspace-write' } } } }), /権限候補/)
})

test('偽データは既存と最初の送信で作る新規セッションへ projection を公開する', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    assert.equal(ctx.remote.settings, undefined)
    ctx.mock.addRemote('settings', {
      async describe() {
        return { ok: true, value: { namespaces: [{ ns: 'permission', value: { defaultPreset: 'workspace-write' },
          schema: { type: 'object', dict: { defaultPreset: { type: 'const', value: 'workspace-write', meta: { description: 'ワークスペース書込' } } } },
        }] } }
      },
    })
    const api = composerApi(ctx.remote)
    assert.equal(ctx.sessions.list.getSnapshot().ids.length, 2)
    assert.deepEqual(await api.modelCatalog(), mockModelCatalog)
    assert.equal((await api.defaultPermissions())?.currentValue, 'workspace-write')
    for (const sessionId of Object.values(MOCK_IDS.sessions)) {
      const face = ctx.sessions.binding(sessionId)!.session
      assert.deepEqual(face.projections.faceOf('permissions').getSnapshot(), { currentValue: 'workspace-write', options: [{ value: 'workspace-write', name: 'ワークスペース書込' }] })
      assert.deepEqual(face.projections.faceOf('plan').getSnapshot(), { active: false, pending: false })
      assert.deepEqual(face.projections.faceOf('modelSelection').getSnapshot(), { lastUsed: null, next: null })
    }
    // Catalog reads never materialize an empty Session.
    assert.equal(ctx.sessions.list.getSnapshot().ids.length, 2)
    const created = await ctx.sessions.create({ workspaceId: MOCK_IDS.workspaces.m3e })
    const face = ctx.sessions.binding(created)!.session
    assert.deepEqual(face.projections.faceOf('permissions').getSnapshot(), mockPermissions)
    requireMatched(await face.command('/permission danger-full-access'))
    assert.equal((face.projections.faceOf('permissions').getSnapshot() as { currentValue: string }).currentValue, 'danger-full-access')
    requireMatched(await face.command('/plan'))
    assert.deepEqual(face.projections.faceOf('plan').getSnapshot(), { active: true, pending: false })
    requireMatched(await face.command('/plan off'))
    assert.deepEqual(face.projections.faceOf('plan').getSnapshot(), { active: false, pending: false })
    const efforts = (await api.modelCatalog()).groups.find(group => group.id === 'deepseek')!.models[0]!.reasoning!
    assert.deepEqual(efforts.efforts.map(effort => effort.id), ['off', 'low', 'high', 'max'])
    assert.equal(efforts.defaultEffort, 'high')
    for (const effort of efforts.efforts) {
      const value = { provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: effort.id }
      assert.deepEqual(await api.selectModel(created, value), value)
    }
    await assert.rejects(api.selectModel(created, { provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: 'medium' }), /モデルを選び直して/)
    const selection = { provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: 'high' }
    assert.deepEqual(await api.selectModel(created, selection), selection)
    assert.deepEqual(face.projections.faceOf('modelSelection').getSnapshot(), { lastUsed: null, next: selection })
    assert.equal((await api.listCommands(created)).some((command) => command.name === 'plan'), true)
    assert.deepEqual((await api.listFiles(created, 'docs/', new AbortController().signal)).map((file) => file.path), ['docs/handoff.md', 'docs/ui-spec.md'])
    await assert.rejects(api.selectModel(created, { provider: 'ollama', model: 'local', reasoningEffort: 'high' }), /モデルを選び直して/)
    await assert.rejects(api.selectModel('missing', selection), /会話が見つかりません/)
    const abort = new AbortController()
    abort.abort()
    await assert.rejects(api.listFiles(created, '', abort.signal), /取り消しました/)
    assert.equal((await api.defaultPermissions())?.currentValue, 'workspace-write')
  } finally { ctx.dispose() }
})

test('設定の偽データの持ち主が先に登録しても、03 は読取と保存を妨げない', async () => {
  let saves = 0
  const settings = {
    async describe() {
      return { ok: true, value: { namespaces: [{ ns: 'permission', value: { defaultPreset: 'workspace-write' },
        schema: { type: 'object', dict: { defaultPreset: { type: 'const', value: 'workspace-write', meta: { description: 'ワークスペース書込' } } } },
      }] } }
    },
    async mutate() { saves++; return { ok: true, value: {} } },
  }
  const ctx = createMockContext({ extensions: [{ extendMock(kit) { kit.addRemote('settings', settings) } }, { extendMock }] })
  try {
    assert.equal(ctx.remote.settings, settings)
    assert.equal((await composerApi(ctx.remote).defaultPermissions())?.currentValue, 'workspace-write')
    await settings.mutate()
    assert.equal(saves, 1)
  } finally { ctx.dispose() }
})

test('偽の commands/change の購読を解除でき、別機能の projection を維持する', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    let changed = 0
    const stop = composerApi(ctx.remote).onCommandsChange(() => { changed++ })
    await ctx.mock.emit('commands/change', undefined)
    stop()
    await ctx.mock.emit('commands/change', undefined)
    assert.equal(changed, 1)
    ctx.mock.addSession({ id: 'extra-fixture', displayTitle: '追加の会話', running: false, blank: false, updatedAt: 0, projectionValues: { plan: { active: true, pending: true } } }, [])
    assert.deepEqual(ctx.sessions.binding('extra-fixture')!.session.projections.faceOf('plan').getSnapshot(), { active: true, pending: true })
    ctx.mock.removeSession('extra-fixture')
    await assert.rejects(composerApi(ctx.remote).selectModel('extra-fixture', mockModelCatalog.default), /会話が見つかりません/)
  } finally { ctx.dispose() }
})

test('先行拡張の会話にも補助機能を提供し、明示された projection は保持する', async () => {
  const permissions = { currentValue: 'fixture-preset', options: [{ value: 'fixture-preset', name: '先行拡張の権限' }] }
  const plan = { active: true, pending: true }
  const modelSelection = { lastUsed: mockModelCatalog.default, next: { provider: 'ollama', model: 'local' } }
  const ctx = createMockContext({ extensions: [
    { extendMock(kit) {
      kit.addSession({ id: 'earlier-empty', displayTitle: '先に追加した会話', running: false, blank: false, updatedAt: 0 }, [])
      kit.addSession({ id: 'earlier-projected', displayTitle: '設定済みの会話', running: false, blank: false, updatedAt: 0,
        projectionValues: { permissions, plan, modelSelection, fixtureOnly: { value: 1 } },
      }, [])
      kit.setProjection(MOCK_IDS.sessions.readme, 'permissions', permissions)
    } },
    { extendMock },
  ] })
  try {
    const api = composerApi(ctx.remote)
    const empty = ctx.sessions.binding('earlier-empty')!.session
    assert.deepEqual(empty.projections.faceOf('permissions').getSnapshot(), mockPermissions)
    assert.deepEqual(empty.projections.faceOf('plan').getSnapshot(), { active: false, pending: false })
    assert.deepEqual(empty.projections.faceOf('modelSelection').getSnapshot(), { lastUsed: null, next: null })
    const projected = ctx.sessions.binding('earlier-projected')!.session
    assert.deepEqual(projected.projections.faceOf('permissions').getSnapshot(), permissions)
    assert.deepEqual(projected.projections.faceOf('plan').getSnapshot(), plan)
    assert.deepEqual(projected.projections.faceOf('modelSelection').getSnapshot(), modelSelection)
    assert.deepEqual(projected.projections.faceOf('fixtureOnly').getSnapshot(), { value: 1 })
    assert.deepEqual(ctx.sessions.binding(MOCK_IDS.sessions.readme)!.session.projections.faceOf('permissions').getSnapshot(), permissions)
    assert.deepEqual(ctx.sessions.list.getSnapshot().byId['earlier-empty']?.projectionValues?.permissions, mockPermissions)
    for (const sessionId of ['earlier-empty', 'earlier-projected']) {
      assert.equal((await api.listCommands(sessionId)).some(command => command.name === 'plan'), true)
      assert.deepEqual((await api.listFiles(sessionId, 'docs/', new AbortController().signal)).map(file => file.path), ['docs/handoff.md', 'docs/ui-spec.md'])
      assert.deepEqual(await api.selectModel(sessionId, mockModelCatalog.default), mockModelCatalog.default)
    }
    assert.deepEqual(projected.projections.faceOf('modelSelection').getSnapshot(), { lastUsed: modelSelection.lastUsed, next: mockModelCatalog.default })
  } finally { ctx.dispose() }
})

test('先行・後続の会話の削除を反映し、同じ ID の再追加に古いモデルを残さない', async () => {
  const ctx = createMockContext({ extensions: [
    { extendMock(kit) {
      kit.addSession({ id: 'earlier-removed', displayTitle: '削除する会話', running: false, blank: false, updatedAt: 0,
        projectionValues: { modelSelection: { lastUsed: mockModelCatalog.default, next: null } },
      }, [])
    } },
    { extendMock },
  ] })
  try {
    const api = composerApi(ctx.remote)
    ctx.mock.addSession({ id: 'later-removed', displayTitle: '後で追加した会話', running: false, blank: false, updatedAt: 0 }, [])
    for (const sessionId of ['earlier-removed', 'later-removed']) {
      assert.deepEqual(await api.selectModel(sessionId, mockModelCatalog.default), mockModelCatalog.default)
      ctx.mock.removeSession(sessionId)
      await assert.rejects(api.listCommands(sessionId), /会話が見つかりません/)
      await assert.rejects(api.listFiles(sessionId, '', new AbortController().signal), /会話が見つかりません/)
      await assert.rejects(api.selectModel(sessionId, mockModelCatalog.default), /会話が見つかりません/)
      ctx.mock.addSession({ id: sessionId, displayTitle: '追加し直した会話', running: false, blank: false, updatedAt: 0 }, [])
      const selection = { provider: 'ollama', model: 'local' }
      assert.deepEqual(await api.selectModel(sessionId, selection), selection)
      assert.deepEqual(ctx.sessions.binding(sessionId)!.session.projections.faceOf('modelSelection').getSnapshot(), { lastUsed: null, next: selection })
    }
  } finally { ctx.dispose() }
})

test('モデル変更は他機能が後から更新した共有 projection の使用済みモデルを保持する', async () => {
  const used = { provider: 'ollama', model: 'local' }
  const ctx = createMockContext({ extensions: [
    { extendMock },
    { extendMock(kit) { kit.setProjection(MOCK_IDS.sessions.readme, 'modelSelection', { lastUsed: used, next: used }) } },
  ] })
  try {
    const sessionId = MOCK_IDS.sessions.readme
    const api = composerApi(ctx.remote)
    const projection = ctx.sessions.binding(sessionId)!.session.projections.faceOf('modelSelection')
    const selection = { provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: 'low' }
    await api.selectModel(sessionId, selection)
    assert.deepEqual(projection.getSnapshot(), { lastUsed: used, next: selection })

    // Another feature or a completed turn can replace the shared projection again.
    ctx.mock.setProjection(sessionId, 'modelSelection', { lastUsed: selection, next: selection })
    await api.selectModel(sessionId, used)
    assert.deepEqual(projection.getSnapshot(), { lastUsed: selection, next: used })
    assert.deepEqual(ctx.sessions.list.getSnapshot().byId[sessionId]?.projectionValues?.modelSelection, { lastUsed: selection, next: used })

    ctx.mock.setProjection(sessionId, 'modelSelection', { lastUsed: null, next: null })
    await api.selectModel(sessionId, selection)
    assert.deepEqual(projection.getSnapshot(), { lastUsed: null, next: selection })
  } finally { ctx.dispose() }
})
