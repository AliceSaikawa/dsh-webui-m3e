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
  assert.deepEqual(await probeDirectory({ directoryPicker: null }), { ready: true, canAdd: false })
  assert.deepEqual(await probeDirectory({ directoryPicker: createDirectoryMock({ unavailable: 'none' }) }), { ready: true, canAdd: false })
})

test('temporary and unknown RPC failures retain the add entry for retry', async () => {
  for (const code of ['directory-picker/unreadable', 'gateway/internal', 'gateway/bad-request', 'rpc/disconnected', 'future/error']) {
    const failure = { code, message: '読み取れません', details: {} }
    const result = { ok: false as const, error: failure }
    assert.deepEqual(await probeDirectory({ directoryPicker: { list: async () => result } }), { ready: true, canAdd: true }, code)
    assert.deepEqual(await probeDirectory({ directoryPicker: { list: async () => { throw new RemoteCallError(failure) } } }), { ready: true, canAdd: true }, code)
    assert.equal(isNativeUnavailable(result), false, code)
  }
})

test('ordinary errors and an unknown namespace shape do not imply missing or native support', async () => {
  assert.deepEqual(await probeDirectory({ directoryPicker: { list: async () => { throw new Error('接続失敗') } } }), { ready: true, canAdd: true })
  assert.deepEqual(await probeDirectory({ directoryPicker: {} }), { ready: true, canAdd: true })
  assert.equal(isNativeUnavailable(new Error('native')), false)
})

test('a successful retry restores the home path after a temporary failure', async () => {
  const mock = createDirectoryMock()
  let attempts = 0
  const remote = {
    directoryPicker: {
      async list(path: string | undefined, signal?: AbortSignal) {
        attempts++
        if (attempts === 1) return { ok: false as const, error: { code: 'gateway/internal', message: '一時的な失敗', details: {} } }
        return mock.list(path, signal)
      },
    },
  }
  assert.deepEqual(await probeDirectory(remote), { ready: true, canAdd: true })
  assert.deepEqual(await probeDirectory(remote), { ready: true, canAdd: true, homePath: '/mock' })
  assert.equal(attempts, 2)
})

test('an aborted RPC response does not hide the add entry', async () => {
  const controller = new AbortController()
  controller.abort()
  assert.deepEqual(await probeDirectory({ directoryPicker: createDirectoryMock() }, controller.signal), { ready: true, canAdd: true })
})

test('the probe forwards cancellation and retains the entry after an in-flight abort', async () => {
  const controller = new AbortController()
  let receivedSignal: AbortSignal | undefined
  const pending = probeDirectory({
    directoryPicker: {
      list(_path: string | undefined, signal?: AbortSignal) {
        receivedSignal = signal
        return new Promise((_, reject) => {
          signal?.addEventListener('abort', () => {
            const error = new Error('取り消しました')
            error.name = 'AbortError'
            reject(error)
          }, { once: true })
        })
      },
    },
  }, controller.signal)
  assert.equal(receivedSignal, controller.signal)
  controller.abort()
  assert.deepEqual(await pending, { ready: true, canAdd: true })
})
