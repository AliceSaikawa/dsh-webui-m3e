import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { waitForDshUrl } from '../e2e-dsh/dsh-host.ts'

test('S6B Hostの起動タイムアウト・早期終了・spawn失敗は自分のprocessを解放する', { timeout: 1000 }, async () => {
  for (const failure of ['timeout', 'exit', 'error']) {
    const process = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() })
    let stopped = 0
    const waiting = waitForDshUrl(process as unknown as ChildProcess, async () => { stopped++ }, 20)
    const rejected = assert.rejects(waiting, failure === 'timeout' ? /did not print/ : failure === 'exit' ? /exited/ : /spawn failed/)
    if (failure === 'exit') process.emit('exit', 1)
    if (failure === 'error') process.emit('error', new Error('spawn failed'))
    await rejected
    assert.equal(stopped, 1, failure)
    assert.equal(process.listenerCount('exit') + process.listenerCount('error') + process.stdout.listenerCount('data') + process.stderr.listenerCount('data'), 0)
  }
})
