import assert from 'node:assert/strict'
import test from 'node:test'
import { promptOutcomeIsUnknown, UncertainPromptError } from '../web/src/features/composer/delivery-status.ts'
import { submitMessage } from '../web/src/features/composer/submission.ts'
import type { ISession } from '../web/src/dsh/services.ts'

test('the installed Gateway shared carrier/internal code cannot prove prompt rejection', () => {
  for (const code of ['gateway/internal', 'gateway/cancelled']) {
    const failure = { code, message: 'synthetic diagnostic', details: {} }
    for (const error of [failure, { rpcError: failure }, { ok: false, error: failure }]) assert.equal(promptOutcomeIsUnknown(error), true)
  }
  assert.equal(promptOutcomeIsUnknown(new Error('synthetic missing response')), true)
  for (const code of ['subagent/parent-unavailable', 'subagent/attachment-invalid', 'session/agent-busy', 'gateway/bad-request']) {
    assert.equal(promptOutcomeIsUnknown({ code, message: 'rejected', details: {} }), false)
  }
})

test('a lost prompt response retains its diagnostic cause and abandons the display echo without another call', async () => {
  const cause = new Error('synthetic response loss')
  let calls = 0
  let abandoned = 0
  const face = {
    beginSubmission: () => ({ requestId: 'echo-id', abandon: () => { abandoned++ } }),
    prompt: async () => { calls++; throw cause },
  } as unknown as ISession
  await assert.rejects(submitMessage(face, '同じ本文', [], 'queue', []), (error: unknown) => {
    assert.ok(error instanceof UncertainPromptError)
    assert.equal(error.cause, cause)
    assert.match(error.message, /重複/)
    return true
  })
  assert.equal(calls, 1)
  assert.equal(abandoned, 1)
})

test('pre-prompt guard, echo setup and known command errors are not uncertain admissions', async () => {
  const cause = new Error('synthetic preparation error')
  let calls = 0
  const face = {
    beginSubmission: () => { throw cause },
    command: async () => { throw cause },
    prompt: async () => { calls++; return { ok: true, value: { accepted: true } } },
  } as unknown as ISession
  for (const invoke of [
    () => submitMessage(face, '依頼', [], 'queue', [], { beforePrompt: () => { throw cause } }),
    () => submitMessage(face, '依頼', [], 'queue', []),
    () => submitMessage(face, '/plan', [], 'queue', [{ name: 'plan', description: '計画' }]),
  ]) await assert.rejects(invoke(), (error: unknown) => error === cause)
  assert.equal(calls, 0)
})
