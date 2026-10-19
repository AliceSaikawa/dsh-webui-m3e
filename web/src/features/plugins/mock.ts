import type { MockKit } from '../../dsh/mock/kit.ts'
import type { RemoteResult } from '../../dsh/services.ts'
import type { BundleInfo, PluginEntry, PluginInventorySnapshot } from './api.ts'

/** Fake data for the read-only plugin list. Japanese fixture text is not translated. */

const success = <T>(value: T): RemoteResult<T> => ({ ok: true, value: structuredClone(value) })
const failure = (code: string, message: string): RemoteResult<never> => ({ ok: false, error: { code, message, details: {} } })

// A tiny 24x24 SVG, as a Host declares an icon.
const iconDataUrl = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCI+PHJlY3Qgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0IiBmaWxsPSIjNjc1MEE0Ii8+PC9zdmc+'

export const mockPluginEntries: readonly PluginEntry[] = [
  {
    entryId: 'entry-notes', moduleName: '@example/dsh-plugin-notes', enabled: true, fiberPhase: 'active',
    meta: {
      title: { en: 'Notes', ja: 'メモ' },
      description: { en: 'Adds a notes panel to the session view.', ja: '会話の画面にメモの欄を足します。' },
    },
  },
  { entryId: 'entry-palette', moduleName: 'dsh-plugin-palette', enabled: true, fiberPhase: 'active', meta: { title: 'パレット', icon: iconDataUrl } },
  { entryId: 'entry-workflow', moduleName: '@example/workflow', enabled: true, fiberPhase: 'active', meta: { title: 'ワークフロー' } },
  {
    entryId: 'entry-broken', moduleName: '@example/dsh-plugin-broken', enabled: true, fiberPhase: 'failed',
    meta: { title: { en: 'Broken plugin', ja: '壊れたプラグイン' } },
  },
  { entryId: 'entry-legacy', moduleName: 'dsh-plugin-legacy', enabled: false, fiberPhase: null, meta: { title: '旧プラグイン' } },
  { entryId: 'entry-slow', moduleName: 'dsh-plugin-slow', enabled: true, fiberPhase: 'pending', meta: { title: '起動待ち' } },
  {
    entryId: 'entry-diagnostic', moduleName: '@example/dsh-plugin-diagnostic', enabled: true, fiberPhase: 'active',
    meta: { title: '診断', error: 'meta.title is not a string' },
  },
]

export const mockBundles: readonly BundleInfo[] = [
  {
    name: 'demo-bundle', version: '1.2.3', enabled: true, installed: true, optional: false, removable: true,
    meta: { title: 'デモバンドル' },
    rows: [
      { rowId: 'row-notes', moduleName: '@example/dsh-plugin-notes', entryId: 'entry-notes' },
      { rowId: 'row-palette', moduleName: 'dsh-plugin-palette', entryId: 'entry-palette' },
    ],
    overrides: [],
  },
  {
    name: 'optional-tools', version: '0.4.0', enabled: false, installed: false, optional: true, removable: false,
    description: '使うときだけ有効にします。',
    rows: [{ rowId: 'row-workflow', moduleName: '@example/workflow', entryId: 'entry-workflow' }],
    overrides: [],
  },
  {
    name: 'legacy-bundle', version: '0.9.0', enabled: true, installed: true, optional: false, removable: false,
    error: {
      code: 'incompatible-version', diagnostic: 'peer range not satisfied',
      incompatible: [{ name: 'dsh-core', version: '0.2.0', runtimeVersion: '0.3.0', peers: { 'dsh-core': '^0.3.0' } }],
    },
    rows: [{ rowId: 'row-legacy', moduleName: 'dsh-plugin-legacy', entryId: 'entry-legacy' }],
    overrides: [],
  },
]

export function extendMock(kit: MockKit): void {
  let listFails = false
  let managementAvailable = true
  // A Host without these namespaces registers neither remote.
  if (!kit.isScenario('plugins-unavailable')) {
    kit.addRemote('pluginInventory', {
      async list(): Promise<RemoteResult<PluginInventorySnapshot>> {
        if (listFails) return failure('gateway/internal', 'プラグインの一覧を取得できませんでした。')
        return success<PluginInventorySnapshot>({ managementAvailable, entries: mockPluginEntries })
      },
    })
    kit.addRemote('pluginManager', {
      async listBundles(): Promise<RemoteResult<readonly BundleInfo[]>> {
        if (listFails) return failure('gateway/internal', 'バンドルの一覧を取得できませんでした。')
        return success<readonly BundleInfo[]>(mockBundles)
      },
    })
  }
  kit.scenario('plugins-error', () => { listFails = true })
  kit.scenario('plugins-unmanaged', () => { managementAvailable = false })
  kit.scenario('plugins-unavailable', () => {})
}
