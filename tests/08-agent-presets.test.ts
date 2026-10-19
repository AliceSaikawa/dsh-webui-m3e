import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { RemoteCallError, unwrapRemoteResult } from '../web/src/dsh/remote-result.ts'
import { extendMock, type SettingsMockRemote } from '../web/src/features/settings/mock.ts'
import {
  AGENT_PRESET_NS, agentPresetsApi, documentOf, groupPresets, isBuiltInPreset, presetDisplayText, rosterOf,
  type PresetCopy,
} from '../web/src/features/settings/agent-presets.ts'

const copy: PresetCopy = {
  standardName: '標準', standardDescription: '標準の説明',
  ptcName: 'PTC', ptcDescription: 'PTC の説明',
  minimalName: '最小', minimalDescription: '最小の説明',
  cordisName: 'Creator', cordisDescription: 'Creator の説明',
}

test('モード一覧は不正な行と重複を捨て、欠けた項目を安全に扱う', () => {
  const rows = rosterOf({ presets: [
    { id: 'standard', isDefault: true },
    { id: 'standard', isDefault: false },
    { id: '', isDefault: true },
    { id: 'custom', isDefault: 'yes', name: '独自', description: '説明', broken: '読めない' },
    { id: 42, isDefault: true },
    null,
  ] })
  assert.deepEqual(rows, [
    { id: 'standard', isDefault: true },
    { id: 'custom', isDefault: false, name: '独自', description: '説明', broken: '読めない' },
  ])
  assert.deepEqual(rosterOf({}), [])
  assert.deepEqual(rosterOf(null), [])
  assert.deepEqual(documentOf({ agentPreset: 'standard', content: 'a\nb', name: '名前' }, 'standard'),
    { id: 'standard', content: 'a\nb', name: '名前' })
  assert.equal(documentOf({ agentPreset: 'standard' }, 'standard'), undefined)
})

test('組み込みは名前のない既知の ID だけとし、表示文と 2 つのまとまりを作る', () => {
  assert.equal(isBuiltInPreset({ id: 'standard' }), true)
  assert.equal(isBuiltInPreset({ id: 'standard', name: '独自' }), false)
  assert.equal(isBuiltInPreset({ id: 'custom' }), false)
  assert.deepEqual(presetDisplayText({ id: 'ptc', isDefault: false }, copy), { name: 'PTC', description: 'PTC の説明' })
  assert.deepEqual(presetDisplayText({ id: 'custom', isDefault: false, name: '独自', description: '説明' }, copy),
    { name: '独自', description: '説明' })
  assert.deepEqual(presetDisplayText({ id: 'custom', isDefault: false }, copy), { name: 'custom' })
  const groups = groupPresets([
    { id: 'standard', isDefault: true },
    { id: 'custom', isDefault: false, name: '独自' },
    { id: 'minimal', isDefault: false },
  ])
  assert.deepEqual(groups.builtIn.map(row => row.id), ['standard', 'minimal'])
  assert.deepEqual(groups.custom.map(row => row.id), ['custom'])
})

test('偽データの一覧は設定の既定を読み、保存した既定と設定の内容を返す', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    const api = agentPresetsApi(ctx.remote)
    assert.equal(api.available, true)
    const initial = await api.list()
    assert.equal(initial?.find(row => row.isDefault)?.id, 'standard')
    assert.deepEqual(initial?.map(row => row.id), ['standard', 'ptc', 'minimal', 'cordis', 'broken-team', 'no-description', 'review'])
    const settings = ctx.remote.settings as SettingsMockRemote
    const registry = unwrapRemoteResult(await settings.describe()).namespaces.find(row => row.ns === AGENT_PRESET_NS)!
    unwrapRemoteResult(await settings.update(AGENT_PRESET_NS, { selectedDefault: 'review' }, registry.revision))
    const rows = await api.list()
    assert.equal(rows?.find(row => row.isDefault)?.id, 'review')
    assert.match(rows?.find(row => row.id === 'broken-team')?.broken ?? '', /team-tools .*Cannot find module .*team-tools\.js/)
    assert.match(rows?.find(row => row.id === 'broken-team')?.broken ?? '', /\npersona /)
    const document = await api.read('review')
    assert.match(document.content, /^- id: persona\n  name: '@deepseek-ai\/dsh-persona'/)
    assert.equal(document.name, 'レビュー用')
    const brokenDocument = await api.read('broken-team')
    assert.match(brokenDocument.content, /- id: team-tools\n  name: '\.\/plugins\/team-tools\.js'/)
    const current = unwrapRemoteResult(await settings.describe()).namespaces.find(row => row.ns === AGENT_PRESET_NS)!
    unwrapRemoteResult(await settings.update(AGENT_PRESET_NS, { selectedDefault: '' }, current.revision))
    assert.equal((await api.list())?.some(row => row.isDefault), false)
  } finally { ctx.dispose() }
})

test('名前空間のない Host は利用不可、取得失敗は理由を返し、知らないモードは not-found になる', async () => {
  const unavailable = createMockContext({ extensions: [{ extendMock }], scenario: 'agent-presets-unavailable' })
  try {
    const api = agentPresetsApi(unavailable.remote)
    assert.equal(api.available, false)
    assert.equal(await api.list(), undefined)
  } finally { unavailable.dispose() }
  const failed = createMockContext({ extensions: [{ extendMock }], scenario: 'agent-presets-error' })
  try {
    const api = agentPresetsApi(failed.remote)
    await assert.rejects(api.list(), error => error instanceof RemoteCallError && error.rpcError.code === 'gateway/internal')
    await assert.rejects(api.read('missing'), error => error instanceof RemoteCallError && error.rpcError.code === 'agent-preset/not-found')
  } finally { failed.dispose() }
})
