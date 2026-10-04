import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import * as composer from '../web/src/features/composer/mock.ts'
import * as sessionTools from '../web/src/features/session-tools/mock.ts'
import { composerApi, type ModelSelectionProjection } from '../web/src/features/composer/api.ts'
import type { GoalsRemote } from '../web/src/features/session-tools/operations.ts'
import type { RemoteResult } from '../web/src/dsh/services.ts'
import { createDirectoryMock } from '../web/src/features/home/directory-mock.ts'
import { excerptOf } from '../web/src/features/search/mock.ts'
import { onRemoteEvent } from '../web/src/dsh/remote-events.ts'

test('S6B モデルの既定effortを正規化し、保存後のcatalogと要求開始後のlastUsedを更新する', async () => {
  const ctx = createMockContext({ extensions: [composer] })
  try {
    const api = composerApi(ctx.remote)
    const selected = await api.selectModel('readme-review', { provider: 'deepseek', model: 'deepseek-v4' })
    assert.deepEqual(selected, { provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: 'high' })
    assert.deepEqual(ctx.mock.getProjection('readme-review', 'modelSelection'), { lastUsed: null, next: selected })
    assert.deepEqual((await api.modelCatalog()).default, selected)
    await ctx.mock.streamAssistant('readme-review', '確認', { chunkMs: 0 })
    assert.deepEqual(ctx.mock.getProjection<ModelSelectionProjection>('readme-review', 'modelSelection'), { lastUsed: selected, next: selected })
    const local = await api.selectModel('readme-review', { provider: 'ollama', model: 'local' })
    assert.deepEqual(local, { provider: 'ollama', model: 'local' })
    assert.deepEqual(ctx.mock.getProjection('readme-review', 'modelSelection'), { lastUsed: selected, next: local })
    assert.deepEqual((await api.modelCatalog()).default, local)
  } finally { ctx.dispose() }
})

test('S6B コマンド候補の順序と添付属性、任意signal、不正なRPCのdetailsを実物に合わせる', async () => {
  const ctx = createMockContext({ extensions: [composer] })
  try {
    const api = composerApi(ctx.remote)
    const commands = await api.listCommands('readme-review')
    assert.deepEqual(commands.map(row => row.name), ['model', 'permission', 'plan'])
    assert.equal(commands[2]?.input?.attachments, true)
    const files = ctx.remote.fileReferences as { list(id: string, query: string, signal?: AbortSignal): Promise<RemoteResult<unknown>> }
    assert.deepEqual(await files.list('readme-review', 'README'), { ok: true, value: [{ path: 'README.md', kind: 'file' }] })
    assert.deepEqual(await files.list('missing', ''), { ok: false, error: { code: 'session/not-found', message: '会話が見つかりません。', details: { sessionId: 'missing' } } })
    const remote = ctx.remote.session as { selectModel(input: object): Promise<RemoteResult<unknown>> }
    const result = await remote.selectModel({ sessionId: 'readme-review', provider: 'unknown', model: 'missing' })
    assert.equal(result.ok, false)
    if (!result.ok) assert.deepEqual(result.error, { code: 'session/model-unavailable', message: 'このモデルや考える深さは選べません。', details: { provider: 'unknown', model: 'missing' } })
  } finally { ctx.dispose() }
})

test('S6B ゴールはactivationの変化だけを通知し、revisionとclearは投影で伝える', async () => {
  const ctx = createMockContext({ extensions: [sessionTools] })
  const events: unknown[] = []
  const stop = onRemoteEvent(ctx.remote, 'goal/activation-changed', event => events.push(event))
  try {
    // Initial fixture publication may be waiting for its first listener.
    await Promise.resolve(); events.length = 0
    const remote = ctx.remote.goals as GoalsRemote
    const initial = await remote.get('approval-sheet')
    assert.ok(initial.ok && initial.value)
    const paused = await remote.pause('approval-sheet', initial.value)
    assert.ok(paused.ok)
    assert.equal(events.length, 1)
    const completed = await remote.complete('approval-sheet', paused.value)
    assert.ok(completed.ok)
    assert.equal(events.length, 1, 'disarmed to disarmed has no notification')
    assert.equal((ctx.mock.getProjection('approval-sheet', 'goal') as { goal: { phase: string } }).goal.phase, 'complete')
    await remote.clear('approval-sheet', completed.value)
    assert.equal(events.length, 1, 'clearing a disarmed goal has no notification')
    assert.equal(ctx.mock.getProjection('approval-sheet', 'goal'), null)
  } finally { stop(); ctx.dispose() }
})

test('S6B hidden階層のパンくずは常にfalseで、検索snippetは240 Unicode文字まで', async () => {
  const result = await createDirectoryMock().list('/mock/.cache')
  assert.ok(result.ok)
  assert.deepEqual(result.value.crumbs.map(row => row.hidden), [false, false, false])
  const query = '😀'.repeat(250)
  const snippet = excerptOf(`前${query}後`, query)!
  assert.equal(Array.from(snippet).length, 240)
  assert.equal(snippet, `前${'😀'.repeat(239)}`)
})
