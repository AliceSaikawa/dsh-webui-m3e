import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { composerApi } from '../web/src/features/composer/api.ts'
import { extendMock, mockPermissionCatalog } from '../web/src/features/composer/mock.ts'
import { installPermissionCatalogMock } from '../web/src/features/composer/mock-permission-catalog.ts'
import { onRemoteEvent } from '../web/src/dsh/remote-events.ts'

test('M6 selectModelは省略された推論の強さを補完して返却とprojectionを揃える', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    const selected = await composerApi(ctx.remote).selectModel('approval-sheet', { provider: 'deepseek', model: 'deepseek-v4' })
    assert.deepEqual(selected, { provider: 'deepseek', model: 'deepseek-v4', reasoningEffort: 'high' })
    assert.equal(ctx.mock.getProjection<any>('approval-sheet', 'modelSelection').next.reasoningEffort, 'high')
  } finally { ctx.dispose() }
})

test('M7 カタログは設定を再読し未知の既定値を拒否、自動候補の増減時だけ通知する', async () => {
  let defaultPreset = 'workspace-write'
  let control!: ReturnType<typeof installPermissionCatalogMock>
  const ctx = createMockContext({ extensions: [{ extendMock(kit) {
    kit.registerSettingsReader(() => ({ defaultPreset }))
    control = installPermissionCatalogMock(kit, mockPermissionCatalog)
  } }] })
  try {
    const api = composerApi(ctx.remote)
    let notifications = 0
    const off = onRemoteEvent(ctx.remote, 'permission-presets/catalog-changed', () => { notifications++ })
    defaultPreset = 'danger-full-access'
    assert.equal((await api.permissionCatalog()).defaultPreset, defaultPreset)
    defaultPreset = 'unknown-preset'
    await assert.rejects(api.permissionCatalog())
    defaultPreset = 'workspace-write'
    await control.setAuto(true)
    assert.equal((await api.permissionCatalog()).options.at(-1)?.value, 'auto')
    assert.equal((await api.permissionCatalog()).defaultOptions.some(row => row.value === 'auto'), false)
    await control.setAuto(true)
    assert.equal(notifications, 1)
    await control.setAuto(false)
    assert.equal((await api.permissionCatalog()).options.some(row => row.value === 'auto'), false)
    assert.equal(notifications, 2)
    off()
  } finally { ctx.dispose() }
})
