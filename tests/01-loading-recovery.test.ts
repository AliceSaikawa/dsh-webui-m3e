import assert from 'node:assert/strict'
import test from 'node:test'
import { scheduleLoadingRecovery } from '../web/src/features/home/loading-recovery.ts'

test('normal loading completes without suggesting recovery', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const changes: boolean[] = []
  const stop = scheduleLoadingRecovery(true, value => changes.push(value))
  t.mock.timers.tick(500)
  stop?.()
  scheduleLoadingRecovery(false, value => changes.push(value))
  t.mock.timers.tick(60_000)
  assert.deepEqual(changes, [false, false])
})

test('recovery appears only after eight seconds and resets when loading completes', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const changes: boolean[] = []
  const stop = scheduleLoadingRecovery(true, value => changes.push(value))
  t.mock.timers.tick(7_999)
  assert.deepEqual(changes, [false])
  t.mock.timers.tick(1)
  assert.deepEqual(changes, [false, true])
  stop?.()
  scheduleLoadingRecovery(false, value => changes.push(value))
  assert.deepEqual(changes, [false, true, false])
})

test('a new loading period waits a full eight seconds and unmount cancels its timer', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const changes: boolean[] = []
  const update = (value: boolean) => changes.push(value)
  const stopFirst = scheduleLoadingRecovery(true, update)
  t.mock.timers.tick(7_000)
  stopFirst?.()
  scheduleLoadingRecovery(false, update)
  const stopNext = scheduleLoadingRecovery(true, update)
  t.mock.timers.tick(7_999)
  assert.deepEqual(changes, [false, false, false])
  stopNext?.()
  t.mock.timers.tick(60_000)
  assert.deepEqual(changes, [false, false, false])
})
