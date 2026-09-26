import assert from 'node:assert/strict'
import test from 'node:test'
import { composerApi } from '../web/src/features/composer/api.ts'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { extendMock, type SettingsMockRemote } from '../web/src/features/settings/mock.ts'
import { createSettingsStore } from '../web/src/features/settings/store.ts'

test('03の公開APIから08の現在の既定権限を読み、保存と復帰のあとも最新値を取得できる', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock }] })
  try {
    const consumer = composerApi(ctx.remote)
    const before = await consumer.defaultPermissions()
    assert.deepEqual(before, {
      currentValue: 'workspace-write',
      options: [
        { value: 'workspace-write', name: 'ワークスペース書込' },
        { value: 'danger-full-access', name: 'フル アクセス' },
      ],
    })
    const store = createSettingsStore(ctx.remote.settings as SettingsMockRemote)
    await store.reload()
    assert.equal(await store.edit('permission', ['defaultPreset'], 'danger-full-access'), true)
    assert.equal((await consumer.defaultPermissions())?.currentValue, 'danger-full-access')
    assert.equal(before.currentValue, 'workspace-write', '古い取得結果はコピーのため、作成時には再取得が必要')
    assert.equal(await store.edit('permission', ['defaultPreset']), true)
    assert.deepEqual(await consumer.defaultPermissions(), before)
  } finally { ctx.dispose() }
})
