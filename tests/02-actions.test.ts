import assert from 'node:assert/strict'
import test from 'node:test'
import { createForkOperation, messageForkOperation } from '../web/src/features/chat/fork-operation.ts'
import { createChatSheetLifetime } from '../web/src/features/chat/sheet-lifetime.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

test('承認でシートが外れても分岐は1回だけ進み、再購読で結果と遷移を受け取る', async () => {
  const response = deferred<string>()
  let calls = 0
  const sessions = { fork: async () => { calls++; return response.promise } }
  const operation = messageForkOperation(sessions, 'source', 12)
  let before = 0
  const stop = operation.subscribe(() => before++)
  const first = operation.start()
  assert.equal(operation.getSnapshot().status, 'pending')
  stop() // The approval replaces the sheet and unmounts its subscriber.
  const remounted = messageForkOperation(sessions, 'source', 12)
  assert.equal(remounted, operation)
  assert.equal(remounted.start(), first)
  assert.equal(remounted.claimNavigation(), undefined)
  response.resolve('branched')
  await first
  assert.equal(calls, 1)
  assert.equal(before, 1)
  assert.deepEqual(remounted.getSnapshot(), { status: 'success', sessionId: 'branched' })
  assert.equal(remounted.claimNavigation(), 'branched')
  assert.equal(remounted.claimNavigation(), undefined)
  await remounted.start()
  assert.equal(calls, 1)
  // A fresh sheet sees the completed result instead of offering another fork.
  assert.equal(messageForkOperation(sessions, 'source', 12).getSnapshot().status, 'success')
})

test('割り込み中の分岐失敗を再作成したシートで読み、明示した再試行だけ実行する', async () => {
  const response = deferred<string>()
  let calls = 0
  const operation = createForkOperation(() => ++calls === 1 ? response.promise : Promise.resolve('retry-result'))
  const first = operation.start()
  response.reject(new Error('失敗'))
  await first
  const failure = operation.getSnapshot()
  assert.equal(failure.status, 'error')
  assert.ok(failure.status === 'error' && failure.message.includes('分岐'))
  assert.equal(operation.claimNavigation(), undefined)
  let notified = 0
  const stop = operation.subscribe(() => notified++)
  const retry = operation.start()
  assert.equal(operation.start(), retry)
  await retry
  stop()
  assert.equal(calls, 2)
  assert.equal(notified, 2)
  assert.deepEqual(operation.getSnapshot(), { status: 'success', sessionId: 'retry-result' })
})

test('分岐の状態は会話・seq・接続ごとに独立し、同期例外も失敗として保持する', async () => {
  const sessions = { fork: () => { throw new Error('失敗') } }
  const first = messageForkOperation(sessions, 'a', 1)
  assert.notEqual(first, messageForkOperation(sessions, 'a', 2))
  assert.notEqual(first, messageForkOperation(sessions, 'b', 1))
  assert.notEqual(first, messageForkOperation({ ...sessions }, 'a', 1))
  await first.start()
  assert.equal(first.getSnapshot().status, 'error')
  assert.equal(messageForkOperation(sessions, 'a', 2).getSnapshot().status, 'idle')
})

test('会話離脱で詳細・操作・画像シートをすべて閉じ、別会話のシートは残す', () => {
  const owner = createChatSheetLifetime()
  const other = createChatSheetLifetime()
  const closed: string[] = []
  owner.track(() => closed.push('詳細'))
  owner.track(() => closed.push('操作'))
  owner.track(() => closed.push('画像'))
  other.track(() => closed.push('別会話'))
  owner.dispose()
  assert.deepEqual(closed, ['詳細', '操作', '画像'])
  assert.equal(owner.isActive(), false)
  assert.equal(other.isActive(), true)
  owner.dispose()
  assert.equal(closed.length, 3)
  other.dispose()
  assert.equal(closed.at(-1), '別会話')
})

test('閉じた親シートと残る画像シート、離脱後の遅い登録を安全に片付ける', () => {
  const owner = createChatSheetLifetime()
  const closed: string[] = []
  const closeParent = owner.track(() => closed.push('親'))
  closeParent()
  closeParent()
  owner.track(() => closed.push('画像'))
  owner.dispose()
  const lateClose = owner.track(() => closed.push('遅い登録'))
  lateClose()
  assert.deepEqual(closed, ['親', '画像', '遅い登録'])
  // React may reinstall the owning effect. Old handles must remain harmless.
  owner.activate()
  owner.track(() => closed.push('新しいシート'))
  closeParent()
  assert.equal(closed.length, 3)
  owner.dispose()
  assert.equal(closed.at(-1), '新しいシート')
})

test('会話を離れても分岐自体は完了し、画面から独立した結果が失われない', async () => {
  const response = deferred<string>()
  const owner = createChatSheetLifetime()
  const operation = createForkOperation(() => response.promise)
  const pending = operation.start()
  owner.dispose()
  response.resolve('later')
  await pending
  assert.equal(owner.isActive(), false)
  assert.deepEqual(operation.getSnapshot(), { status: 'success', sessionId: 'later' })
})
