import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createSettingInput, type InputSaveResult } from '../web/src/features/settings/input.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve))

function harness<T>(initial: T) {
  const calls: { value: T; reset: boolean; response: ReturnType<typeof deferred<InputSaveResult<T>>> }[] = []
  let enabled = true
  const input = createSettingInput(initial, {
    canSave: () => enabled,
    save(value, reset) {
      const response = deferred<InputSaveResult<T>>()
      calls.push({ value, reset, response })
      return response.promise
    },
  })
  return { input, calls, disable() { enabled = false } }
}

test('保存中の入力と古い応答を分け、最新の文字列を続けて保存する', async () => {
  const h = harness('最初の値')
  h.input.change('ひとつ目')
  const saving = h.input.flush()
  assert.equal(h.input.getSnapshot().saving, true)
  h.input.change('ふたつ目')
  h.input.change('最後の値')
  // The store may publish the earlier response before resolving edit().
  h.input.receive('ひとつ目')
  assert.equal(h.input.getSnapshot().value, '最後の値')
  assert.equal(h.input.flush(), saving)
  assert.equal(h.calls.length, 1)
  h.calls[0]!.response.resolve({ ok: true, value: 'ひとつ目' })
  await tick()
  assert.equal(h.input.getSnapshot().value, '最後の値')
  assert.equal(h.input.getSnapshot().saved, false)
  assert.deepEqual(h.calls.map(call => call.value), ['ひとつ目', '最後の値'])
  h.calls[1]!.response.resolve({ ok: true, value: '最後の値' })
  await saving
  assert.deepEqual(h.input.getSnapshot(), { value: '最後の値', dirty: false, saving: false, saved: true })
  await h.input.flush()
  assert.equal(h.calls.length, 2)
})

test('数値を保存中に追加入力しても、古い正規化済みの応答で上書きしない', async () => {
  const h = harness('1')
  h.input.change('2.0')
  const saving = h.input.flush()
  h.input.change('23.5')
  h.calls[0]!.response.resolve({ ok: true, value: '2' })
  await tick()
  h.input.receive('2')
  assert.equal(h.input.getSnapshot().value, '23.5')
  assert.equal(h.calls[1]!.value, '23.5')
  h.calls[1]!.response.resolve({ ok: true, value: '23.5' })
  await saving
  assert.equal(h.input.getSnapshot().value, '23.5')
})

test('スイッチを保存中に元へ戻しても、戻した値を二度目に送る', async () => {
  const h = harness(false)
  h.input.change(true)
  const saving = h.input.flush()
  h.input.change(false)
  h.calls[0]!.response.resolve({ ok: true, value: true })
  await tick()
  assert.deepEqual(h.calls.map(call => call.value), [true, false])
  assert.equal(h.input.getSnapshot().value, false)
  h.calls[1]!.response.resolve({ ok: true, value: false })
  await saving
  assert.equal(h.input.getSnapshot().saved, true)
})

test('選択肢を保存中に変えても新しい選択を保ち、未編集の外部更新には追従する', async () => {
  const h = harness('a')
  h.input.change('b')
  const saving = h.input.flush()
  h.input.change('c')
  h.input.receive('b')
  assert.equal(h.input.getSnapshot().value, 'c')
  h.calls[0]!.response.resolve({ ok: true, value: 'b' })
  await tick()
  h.calls[1]!.response.resolve({ ok: true, value: 'c' })
  await saving
  h.input.receive('d')
  assert.equal(h.input.getSnapshot().value, 'd')
  assert.equal(h.input.getSnapshot().saved, false)
})

test('保存拒否は入力を保ち、自動で繰り返さず、明示した再試行で保存する', async () => {
  const h = harness('元の値')
  h.input.change('保存したい値')
  const first = h.input.flush()
  h.calls[0]!.response.resolve({ ok: false })
  await first
  assert.equal(h.calls.length, 1)
  assert.deepEqual(h.input.getSnapshot(), { value: '保存したい値', dirty: true, saving: false, saved: false })
  const retry = h.input.flush()
  h.calls[1]!.response.resolve({ ok: true, value: '保存したい値' })
  await retry
  assert.equal(h.input.getSnapshot().saved, true)
})

test('既定値に戻す応答も追加入力を消さず、その入力を続けて保存する', async () => {
  const h = harness('上書きの値')
  const saving = h.input.reset()
  assert.equal(h.calls[0]!.reset, true)
  h.input.change('新しい値')
  h.input.receive('既定値')
  h.calls[0]!.response.resolve({ ok: true, value: '既定値' })
  await tick()
  assert.equal(h.input.getSnapshot().value, '新しい値')
  assert.equal(h.calls[1]!.reset, false)
  assert.equal(h.calls[1]!.value, '新しい値')
  h.calls[1]!.response.resolve({ ok: true, value: '新しい値' })
  await saving
  assert.equal(h.input.getSnapshot().saved, true)
})

test('競合や再接続で保存の権限が変わった場合、古い画面の待機入力を送らない', async () => {
  const h = harness('元の値')
  h.input.change('最初の変更')
  const saving = h.input.flush()
  h.input.change('待機中の変更')
  h.disable()
  h.calls[0]!.response.resolve({ ok: false })
  await saving
  await h.input.flush()
  assert.equal(h.calls.length, 1)
  assert.equal(h.input.getSnapshot().saving, false)
})

test('画面を離れた後は待機中の入力を続けて送らない', async () => {
  const h = harness('元の値')
  h.input.change('最初の変更')
  const saving = h.input.flush()
  h.input.change('次の変更')
  h.input.setActive(false)
  h.calls[0]!.response.resolve({ ok: true, value: '最初の変更' })
  await saving
  assert.equal(h.calls.length, 1)
  assert.equal(h.input.getSnapshot().value, '次の変更')
})

test('通信例外を処理し、未保存の入力を保つ', async () => {
  const input = createSettingInput('元の値', {
    canSave: () => true,
    save: async () => { throw new Error('通信が切れました') },
  })
  input.change('次の値')
  await input.flush()
  assert.deepEqual(input.getSnapshot(), { value: '次の値', dirty: true, saving: false, saved: false })
})
