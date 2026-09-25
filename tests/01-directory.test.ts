import { test } from 'node:test'
import assert from 'node:assert/strict'
import { probeDirectory, isNativeUnavailable } from '../web/src/features/home/directory.ts'
import { createDirectoryMock } from '../web/src/features/home/directory-mock.ts'
import { RemoteCallError } from '../web/src/dsh/remote-result.ts'

test('browse uses the public list RPC without a capability RPC', async () => {
  const remote = { directoryPicker: createDirectoryMock() }
  assert.deepEqual(await probeDirectory(remote), { ready: true, canAdd: true, homePath: '/mock' })
})

test('native-only hosts retain the entry to explain why adding is unavailable', async () => {
  const remote = { directoryPicker: createDirectoryMock({ unavailable: 'native' }) }
  assert.deepEqual(await probeDirectory(remote), { ready: true, canAdd: true })
  const result = await remote.directoryPicker.list()
  assert.equal(isNativeUnavailable(result), true)
  if (!result.ok) assert.equal(isNativeUnavailable(new RemoteCallError(result.error)), true)
})

test('missing and disabled directory RPCs hide the add entry', async () => {
  assert.deepEqual(await probeDirectory({}), { ready: true, canAdd: false })
  assert.deepEqual(await probeDirectory({ directoryPicker: createDirectoryMock({ unavailable: 'none' }) }), { ready: true, canAdd: false })
})

test('unreadable home allows retry but a transport failure does not imply native capability', async () => {
  const failure = { code: 'directory-picker/unreadable', message: '読み取れません', details: {} }
  assert.deepEqual(await probeDirectory({ directoryPicker: { list: async () => ({ ok: false, error: failure }) } }), { ready: true, canAdd: true })
  assert.deepEqual(await probeDirectory({ directoryPicker: { list: async () => { throw new Error('接続失敗') } } }), { ready: true, canAdd: false })
  assert.equal(isNativeUnavailable(new Error('native')), false)
})

test('the probe passes cancellation to the RPC', async () => {
  const controller = new AbortController()
  controller.abort()
  assert.deepEqual(await probeDirectory({ directoryPicker: createDirectoryMock() }, controller.signal), { ready: true, canAdd: false })
})
