import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertPluginsActive } from '../web/src/dsh/boot.ts'
import { classifyBootFailure } from '../src/shared/dsh-compat.ts'

test('active plugins pass without consulting stale import failures', async () => {
  await assertPluginsActive({ importError() { assert.fail('active imports must not be checked') } }, [
    { options: { name: 'connection' }, fiber: { state: 2, async await() { assert.fail('already active') } } },
  ])
})

test('a download failure swallowed by loader.await is still a transient boot failure', async () => {
  const error = new Error('client-modules: bundle script plugins/??connection/client.js&rev=1 failed to load')
  await assert.rejects(assertPluginsActive({ importError: () => error }, [{ options: { name: 'connection' } }]), failure => {
    assert.equal(failure, error)
    assert.equal(classifyBootFailure(error.message), 'unknown')
    return true
  })
})

test('factory contract failures retain the compatibility diagnosis', async () => {
  const error = new Error('client-modules: no registered factory for connection')
  await assert.rejects(assertPluginsActive({ importError: () => error }, [{ options: { name: 'connection' } }]), failure => {
    assert.equal(failure, error)
    assert.equal(classifyBootFailure(error.message), 'incompatible')
    return true
  })
})

test('failed plugin fibers expose their runtime cause instead of a version error', async () => {
  const error = new Error('Failed to fetch')
  await assert.rejects(assertPluginsActive({ importError: () => undefined }, [
    { options: { name: 'connection' }, fiber: { state: 4, async await() { throw error } } },
  ]), failure => failure === error && classifyBootFailure(error.message) === 'unknown')
})

test('mixed shape and transport failures are not diagnosed as a version mismatch', async () => {
  const errors = [new Error('client-modules: no registered factory for a'), new Error('Failed to fetch')]
  await assert.rejects(assertPluginsActive({ importError: id => errors[Number(id)] }, [
    { options: { name: '0' } }, { options: { name: '1' } },
  ]), failure => failure === errors[1])
})

test('inactive entries without a recorded cause still fail the activation contract', async () => {
  await assert.rejects(assertPluginsActive({ importError: () => undefined }, [
    { options: { name: 'connection' } },
    { options: { name: 'gateway' }, fiber: { state: 0, async await() {} } },
  ]), failure => {
    assert.ok(failure instanceof Error)
    assert.equal(failure.message, 'webui-m3e: plugins did not activate: connection, gateway')
    assert.equal(classifyBootFailure(failure.message), 'incompatible')
    return true
  })
})
