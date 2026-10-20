import assert from 'node:assert/strict'
import test from 'node:test'
import { RemoteCallError } from '../web/src/dsh/remote-result.ts'
import { AGENT_PRESET_SETTINGS_NS, agentPresetsApi, documentOf, presetSettingsFacts, rosterOf } from '../web/src/features/agent-presets/api.ts'
import { canMakeDefault, hostNotice, isBuiltInPreset, presetDisplayText, presetSections, requiresCodingTools } from '../web/src/features/agent-presets/model.ts'
import { modeMessages, type ModeTexts } from '../web/src/features/agent-presets/messages.ts'
import type { AgentPresetRow } from '../web/src/features/agent-presets/api.ts'

const text: ModeTexts = modeMessages.ja
const row = (id: string, extra: Partial<AgentPresetRow> = {}): AgentPresetRow => ({ id, isDefault: false, ...extra })
const openGate = { writable: true, revision: 3, saving: false }

test('一覧の応答は壊れた行を落とし、空の名前は未発表として扱う', () => {
  const roster = rosterOf({
    presets: [
      { id: 'standard', isDefault: true },
      { id: 'review', isDefault: false, name: '見直し', description: '差分を読む' },
      { id: 'blank-name', isDefault: false, name: '', description: '' },
      { id: 'legacy', isDefault: false, name: '旧', broken: '読めません' },
      { id: 'no-flag', name: '欠ける' },
      { isDefault: true },
      'nope',
      null,
    ],
  })
  assert.deepEqual(roster.presets.map(item => item.id), ['standard', 'review', 'blank-name', 'legacy'])
  assert.equal(roster.presets[2]!.name, undefined)
  assert.equal(roster.presets[2]!.description, undefined)
  assert.equal(roster.presets[3]!.broken, '読めません')
  assert.deepEqual(rosterOf(null), { presets: [] })
  assert.deepEqual(rosterOf({ presets: 'nope' }), { presets: [] })
})

test('構成の YAML はそのまま残り、頼んだ id と違う文書は使わない', () => {
  const content = 'enabled: !!js true\n'
  const document = documentOf({ agentPreset: 'standard', content, name: '', description: 'ignored empty' })
  assert.equal(document?.content, content)
  assert.equal(document?.name, undefined)
  assert.equal(documentOf({ agentPreset: 'standard' }), undefined)
  assert.equal(documentOf({ content: 'x' }), undefined)
  assert.equal(documentOf('yaml'), undefined)
})

test('設定の説明から、書けるか、revision、コード作業の有無を読む', () => {
  assert.equal(presetSettingsFacts(null), undefined)
  assert.equal(presetSettingsFacts({ writable: true, namespaces: 'nope' }), undefined)
  const described = presetSettingsFacts({
    writable: true,
    namespaces: [
      { ns: AGENT_PRESET_SETTINGS_NS, revision: 4, value: {} },
      { ns: 'ui-settings', value: { enabled: false } },
      { ns: 'other' },
    ],
  })
  assert.deepEqual(described, { writable: true, revision: 4, codingToolsEnabled: false })
  const missingTools = presetSettingsFacts({ writable: false, namespaces: [{ ns: 'locale', revision: 1 }] })
  assert.deepEqual(missingTools, { writable: false, codingToolsEnabled: true })
})

test('組込みの表示は辞書、名前のある行は Host の文言のまま', () => {
  assert.equal(isBuiltInPreset({ id: 'standard' }), true)
  assert.equal(isBuiltInPreset({ id: 'standard', name: '自分の標準' }), false)
  assert.equal(isBuiltInPreset({ id: 'review' }), false)
  assert.equal(requiresCodingTools({ id: 'ptc' }), true)
  assert.equal(requiresCodingTools({ id: 'minimal' }), true)
  assert.equal(requiresCodingTools({ id: 'ptc', name: '名前付き' }), false)
  assert.equal(requiresCodingTools({ id: 'standard' }), false)
  assert.deepEqual(presetDisplayText({ id: 'cordis' }, text), {
    name: '作成モード',
    description: text.presetCordisDescription,
  })
  assert.deepEqual(presetDisplayText({ id: 'standard', description: 'Host の説明' }, text).description, text.presetStandardDescription)
  assert.deepEqual(presetDisplayText({ id: 'review', name: '見直し', description: '差分を読む' }, text), {
    name: '見直し',
    description: '差分を読む',
  })
  assert.equal(presetDisplayText({ id: 'bare' }, text).name, 'bare')
  assert.equal(presetDisplayText({ id: 'bare' }, text).description, undefined)
})

test('コード作業がオフのとき、組込みの PTC と最小を隠し、既定とカスタムは残す', () => {
  const rows = [
    row('standard', { isDefault: false }),
    row('ptc'),
    row('minimal', { isDefault: true }),
    row('cordis'),
    row('ptc', { name: '名前付き PTC' }),
    row('review', { name: '見直し' }),
  ]
  const hidden = presetSections(rows, false)
  assert.deepEqual(hidden.map(section => section.kind), ['built-in', 'custom'])
  assert.deepEqual(hidden[0]!.rows.map(item => item.id), ['standard', 'minimal', 'cordis'])
  assert.deepEqual(hidden[1]!.rows.map(item => item.name), ['名前付き PTC', '見直し'])
  const shown = presetSections(rows, true)
  assert.deepEqual(shown[0]!.rows.map(item => item.id), ['standard', 'ptc', 'minimal', 'cordis'])
  assert.deepEqual(presetSections([], true), [])
  assert.deepEqual(presetSections([row('review', { name: '見直し' })], true).map(section => section.kind), ['custom'])
})

test('壊れている行と、今の既定と、書けない Host は既定にできない', () => {
  assert.equal(canMakeDefault(row('review'), openGate), true)
  assert.equal(canMakeDefault(row('review', { isDefault: true }), openGate), false)
  assert.equal(canMakeDefault(row('legacy', { broken: '読めません' }), openGate), false)
  assert.equal(canMakeDefault(row('review'), { writable: false, revision: 3, saving: false }), false)
  assert.equal(canMakeDefault(row('review'), { writable: true, revision: undefined, saving: false }), false)
  assert.equal(canMakeDefault(row('review'), { ...openGate, saving: true }), false)
})

test('人向けの日本語の拒否理由だけを出し、英数字の理由は固定文にする', () => {
  assert.equal(hostNotice('この値は管理者の設定によって許可されていません。', '失敗'), 'この値は管理者の設定によって許可されていません。')
  assert.equal(hostNotice('path /tmp/secret', '失敗'), '失敗')
  assert.equal(hostNotice('not allowed', '失敗'), '失敗')
  assert.equal(hostNotice(undefined, '失敗'), '失敗')
})

test('名前空間がない Host は一覧を返さず、既定の保存は settings.update に届く', async () => {
  assert.equal(await agentPresetsApi({}).list(), undefined)
  assert.equal(await agentPresetsApi({}).describeSettings(), undefined)
  const failure = { ok: false as const, error: { code: 'gateway/internal', message: '取得できません。', details: {} } }
  await assert.rejects(agentPresetsApi({ agentPresets: { list: async () => failure, read: async () => failure } }).list(), error => error instanceof RemoteCallError)
  let saved: { ns: string; id: string; revision: number } | undefined
  const api = agentPresetsApi({
    agentPresets: {
      async list() { return { ok: true as const, value: { presets: [{ id: 'standard', isDefault: true }, { id: 'nope', isDefault: 'yes' }] } } },
      async read(id: string) {
        return { ok: true as const, value: { agentPreset: id === 'mismatch' ? 'other' : id, content: 'enabled: !!js true' } }
      },
    },
    settings: {
      async describe() {
        return { ok: true as const, value: { writable: true, namespaces: [{ ns: AGENT_PRESET_SETTINGS_NS, revision: 8 }] } }
      },
      async update(ns: string, patch: { selectedDefault: string }, revision: number) {
        saved = { ns, id: patch.selectedDefault, revision }
        return { ok: true as const, value: {} }
      },
    },
  })
  assert.deepEqual((await api.list())?.presets.map(item => item.id), ['standard'])
  assert.equal((await api.read('standard')).content.includes('!!js'), true)
  await assert.rejects(api.read('mismatch'), /unusable/)
  const facts = await api.describeSettings()
  assert.equal(facts?.revision, 8)
  assert.equal(facts?.codingToolsEnabled, true)
  await api.setDefault('review', facts!.revision!)
  assert.deepEqual(saved, { ns: AGENT_PRESET_SETTINGS_NS, id: 'review', revision: 8 })
})
