import type { MockKit } from '../../dsh/mock/kit.ts'
import type { PermissionCatalog } from './api.ts'

export function installPermissionCatalogMock(kit: MockKit, initial: PermissionCatalog) {
  let auto = false
  kit.addRemote('permissionPresets', {
    async catalog() {
      const settings = kit.getSettingsValue<{ defaultPreset?: string }>('permission')
      const defaultPreset = settings?.defaultPreset ?? initial.defaultPreset
      if (!initial.defaultOptions.some(option => option.value === defaultPreset)) return {
        ok: false as const, error: { code: 'gateway/internal', message: '既定の権限が見つかりません。', details: {} },
      }
      return { ok: true as const, value: structuredClone({ ...initial, defaultPreset,
        options: [...initial.options, ...auto ? [{ value: 'auto', name: '自動', description: '操作ごとに権限を確認します。' }] : []],
      }) }
    },
  })
  return {
    async setAuto(available: boolean) {
      if (auto === available) return
      auto = available
      await kit.emit('permission-presets/catalog-changed')
    },
  }
}
