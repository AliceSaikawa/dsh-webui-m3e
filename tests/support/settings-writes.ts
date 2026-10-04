import type { SettingsApi, SettingsOperation } from '../../web/src/features/settings/store.ts'
import type { SettingWriteCase } from './settings-write-cases.ts'

export const expectedWrites = (cases: SettingWriteCase[]) => cases.map(({ id, ok }) => ({ id, ok, ...ok ? {} : { code: 'settings/rejected' } }))

/** Exercise the RPC and restore every accepted write before the next input. */
export async function runSettingWrites(api: SettingsApi, cases: SettingWriteCase[]) {
  const row = async (ns: string) => {
    const response = await api.describe()
    if (!response.ok) throw new Error(response.error.message)
    const result = response.value.namespaces.find(row => row.ns === ns)
    if (!result) throw new Error(`Missing settings: ${ns}`)
    return result
  }
  const outcomes: { id: string; ok: boolean; code?: string }[] = []
  for (const item of cases) {
    const before = await row(item.ns)
    const result = await api.update(item.ns, structuredClone(item.patch), before.revision)
    outcomes.push({ id: item.id, ok: result.ok, ...result.ok ? {} : { code: result.error.code } })
    if (result.ok) {
      const current = await row(item.ns)
      const ops: SettingsOperation[] = Object.keys(item.patch).map(key => before.user && Object.hasOwn(before.user, key)
        ? { op: 'set', path: [key], value: before.user[key]! }
        : { op: 'unset', path: [key] })
      const restored = await api.mutate(item.ns, ops, current.revision)
      if (!restored.ok) throw new Error(`${item.id} restore: ${restored.error.message}`)
    }
  }
  return outcomes
}
