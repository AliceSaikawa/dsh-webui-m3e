import assert from 'node:assert/strict'
import test from 'node:test'
import { RemoteCallError } from '../web/src/dsh/remote-result.ts'
import { bundleListOf, inventorySnapshotOf, pluginsApi, type BundleInfo, type PluginEntry, type PluginInventorySnapshot } from '../web/src/features/plugins/api.ts'
import { bundleErrorLabel, groupPlugins, localizedText, phaseLabel, pluginTitle } from '../web/src/features/plugins/model.ts'
import { pluginMessages, type PluginTexts } from '../web/src/features/plugins/messages.ts'

const text: PluginTexts = pluginMessages.ja
const active = (entryId: string, moduleName: string, title?: string, extra: Partial<PluginEntry> = {}): PluginEntry => ({
  entryId, moduleName, enabled: true, fiberPhase: 'active', ...(title === undefined ? {} : { meta: { title } }), ...extra,
})

// --- localizedText ---------------------------------------------------------

test('局所化された文言は、文字列ならそのまま、対象の言語・ja・en の順に選ぶ', () => {
  assert.equal(localizedText(undefined, 'ja'), undefined)
  assert.equal(localizedText('そのまま', 'ja'), 'そのまま')
  assert.deepEqual(localizedText({ en: 'Notes', ja: 'メモ' }, 'ja'), 'メモ')
  assert.equal(localizedText({ en: 'Notes', ja: 'メモ' }, 'en'), 'Notes')
  assert.equal(localizedText({ en: 'Notes', ja: 'メモ' }, 'zh'), 'メモ')
  assert.equal(localizedText({ en: 'Notes' }, 'ja'), 'Notes')
})

test('プラグインの題名は、局所化された題名がなければ moduleName の短い名前にする', () => {
  assert.equal(pluginTitle({ moduleName: '@scope/dsh-plugin-notes', meta: { title: { en: 'Notes', ja: 'メモ' } } }, 'ja'), 'メモ')
  assert.equal(pluginTitle({ moduleName: '@scope/dsh-plugin-notes' }, 'ja'), 'notes')
  assert.equal(pluginTitle({ moduleName: 'dsh-plugin-palette' }, 'ja'), 'palette')
  assert.equal(pluginTitle({ moduleName: 'dsh-inbox' }, 'ja'), 'inbox')
  assert.equal(pluginTitle({ moduleName: 'plain' }, 'ja'), 'plain')
  // An empty localized title falls back to the module name.
  assert.equal(pluginTitle({ moduleName: 'dsh-plugin-x', meta: { title: '' } }, 'ja'), 'x')
})

// --- phaseLabel ------------------------------------------------------------

test('プラグインの状態を辞書の文言にする', () => {
  assert.equal(phaseLabel('active', true, text), '稼働中')
  assert.equal(phaseLabel('loading', true, text), '読み込み中')
  assert.equal(phaseLabel('pending', true, text), '待機中')
  assert.equal(phaseLabel('unloading', true, text), '停止中')
  assert.equal(phaseLabel('failed', true, text), '読み込みに失敗')
  assert.equal(phaseLabel(null, true, text), '未起動')
  // A disabled plugin is 無効 whatever the fiber phase says.
  assert.equal(phaseLabel('active', false, text), '無効')
  assert.equal(phaseLabel('failed', false, text), '無効')
})

// --- bundleErrorLabel ------------------------------------------------------

test('バンドルのエラーコードはすべて日本語の説明を持つ', () => {
  assert.equal(bundleErrorLabel('incompatible-version', text), 'この DSH の版に対応していません')
  assert.equal(bundleErrorLabel('operation-error', text), '操作に失敗しました')
  assert.equal(bundleErrorLabel('not-bundle', text), 'バンドルではありません')
  assert.equal(bundleErrorLabel('unknown-plugin', text), '見つからないプラグインです')
  assert.equal(bundleErrorLabel('management-required', text), 'この Host では管理できません')
  assert.equal(bundleErrorLabel('unaddressable', text), 'この Host では管理できません')
  for (const code of ['invalid-spec', 'ambiguous-install', 'not-removable', 'stop-profile', 'bundle-in-use', 'stale-approval'] as const) {
    assert.equal(typeof bundleErrorLabel(code, text), 'string')
    assert.notEqual(bundleErrorLabel(code, text), '')
  }
})

// --- groupPlugins ----------------------------------------------------------

test('プラグインを状態ごとに分け、題名で並べる', () => {
  const snapshot: PluginInventorySnapshot = {
    entries: [
      active('e-bravo', 'dsh-bravo', 'Bravo'),
      active('e-charlie', 'dsh-charlie', 'Charlie', { fiberPhase: 'failed' }),
      active('e-alpha', 'dsh-alpha', 'Alpha', { enabled: false }),
      active('e-delta', 'dsh-delta', 'Delta', { fiberPhase: 'pending' }),
      // failed wins over disabled, so this stays in the failed group.
      active('e-echo', 'dsh-echo', 'Echo', { enabled: false, fiberPhase: 'failed' }),
      active('e-foxtrot', 'dsh-foxtrot', 'Foxtrot'),
    ],
  }
  const groups = groupPlugins(snapshot, undefined)
  assert.deepEqual(groups.failed.map(e => e.entryId), ['e-charlie', 'e-echo'])
  assert.deepEqual(groups.active.map(e => e.entryId), ['e-bravo', 'e-foxtrot'])
  assert.deepEqual(groups.disabled.map(e => e.entryId), ['e-alpha'])
  assert.deepEqual(groups.other.map(e => e.entryId), ['e-delta'])
  assert.deepEqual(groups.bundles, [])
})

test('バンドルは行の entryId で一覧の項目と結び付ける', () => {
  const snapshot: PluginInventorySnapshot = { entries: [active('e-notes', 'dsh-notes', 'Notes'), active('e-palette', 'dsh-palette', 'Palette')] }
  const bundles: readonly BundleInfo[] = [
    { name: 'demo', installed: true, enabled: true, optional: false, removable: true, overrides: [], rows: [
      { rowId: 'r1', moduleName: 'dsh-notes', entryId: 'e-notes' },
      { rowId: 'r2', moduleName: 'dsh-missing', entryId: 'e-missing' },
      { rowId: 'r3', moduleName: 'dsh-palette', entryId: 'e-palette' },
    ] },
    { name: 'empty', installed: false, enabled: false, optional: true, removable: false, overrides: [], rows: [{ rowId: 'r4', moduleName: 'dsh-plain' }] },
  ]
  const groups = groupPlugins(snapshot, bundles)
  assert.deepEqual(groups.bundles.map(group => group.bundle.name), ['demo', 'empty'])
  assert.deepEqual(groups.bundles[0]!.entries.map(e => e.entryId), ['e-notes', 'e-palette'])
  assert.deepEqual(groups.bundles[1]!.entries, [])
})

test('一覧が無くても、バンドルだけを渡して空のグループを返す', () => {
  const groups = groupPlugins(undefined, undefined)
  assert.deepEqual([groups.failed, groups.active, groups.disabled, groups.other, groups.bundles], [[], [], [], [], []])
})

// --- api defensive parsing -------------------------------------------------

test('一覧の応答は壊れた項目を落とし、正しい項目だけを残す', () => {
  const value = {
    managementAvailable: true,
    entries: [
      { entryId: 'ok', moduleName: 'dsh-ok', enabled: true, fiberPhase: 'active', meta: { title: { en: 'OK', ja: 'OK' }, icon: 'data:image/png;base64,AAAA' } },
      { entryId: 'no-module', enabled: true, fiberPhase: 'active' },
      { entryId: 'no-enabled', moduleName: 'dsh-x', fiberPhase: 'active' },
      { entryId: 'bad-phase', moduleName: 'dsh-y', enabled: true, fiberPhase: 'elsewhere' },
      'not an object',
      null,
    ],
  }
  const snapshot = inventorySnapshotOf(value)
  assert.equal(snapshot.managementAvailable, true)
  assert.deepEqual(snapshot.entries.map(entry => entry.entryId), ['ok', 'bad-phase'])
  assert.equal(snapshot.entries[1]!.fiberPhase, null)
  assert.equal(snapshot.entries[0]!.meta?.icon, 'data:image/png;base64,AAAA')
})

test('バンドルの応答は壊れた項目・不明なエラーコードを落とす', () => {
  const value = [
    { name: 'good', version: '1.0.0', enabled: true, installed: true, optional: false, removable: true, rows: [
      { rowId: 'r1', moduleName: 'dsh-a', entryId: 'e1' },
      { rowId: 'bad' },
      'nope',
    ], overrides: ['x', 3] },
    { version: '1.0.0', enabled: true, installed: true },
    { name: 'bad-error', enabled: true, installed: true, error: { code: 'made-up' } },
    'not an object',
  ]
  const bundles = bundleListOf(value)
  assert.deepEqual(bundles.map(bundle => bundle.name), ['good', 'bad-error'])
  assert.deepEqual(bundles[0]!.rows.map(row => row.rowId), ['r1'])
  assert.deepEqual(bundles[0]!.overrides, ['x'])
  assert.equal(bundles[1]!.error, undefined)
})

test('名前空間がない Host は undefined を返し、失敗は例外にする', async () => {
  assert.equal(await pluginsApi({}).inventory(), undefined)
  assert.equal(await pluginsApi({}).bundles(), undefined)
  assert.equal(await pluginsApi({ pluginInventory: {} }).inventory(), undefined)
  const failure = { ok: false as const, error: { code: 'gateway/internal', message: '取得できません。', details: {} } }
  const api = pluginsApi({ pluginInventory: { list: async () => failure }, pluginManager: { listBundles: async () => failure } })
  await assert.rejects(api.inventory(), error => {
    assert.ok(error instanceof RemoteCallError)
    return true
  })
  await assert.rejects(api.bundles(), error => {
    assert.ok(error instanceof RemoteCallError)
    return true
  })
})
