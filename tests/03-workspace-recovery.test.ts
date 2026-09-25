import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentContext, ISessions } from '../web/src/dsh/services.ts'
import { clearDraft, readDraft, writeDraft } from '../web/src/features/composer/drafts.ts'
import { pendingWorkspaceAttachment, retryWorkspaceAttachment, workspaceAttachmentFrom } from '../web/src/features/composer/workspace-recovery.ts'

test('only the verified partial-create error with matching Workspace and a usable ID is recovered', () => {
  const details = { workspaceId: 'workspace-a', sessionId: 'session-a' }
  const failure = { code: 'session/workspace-attach-failed', details }
  assert.deepEqual(workspaceAttachmentFrom(failure, 'workspace-a'), details)
  assert.deepEqual(workspaceAttachmentFrom(Object.assign(new Error('wrapped'), { rpcError: failure }), 'workspace-a'), details)
  assert.equal(workspaceAttachmentFrom(failure, 'workspace-b'), undefined)
  assert.equal(workspaceAttachmentFrom({ code: 'unknown', details }, 'workspace-a'), undefined)
  assert.equal(workspaceAttachmentFrom({ rpcError: { code: failure.code } }, 'workspace-a'), undefined)
  for (const sessionId of [undefined, null, '', ' ', 'a\nb', 12, {}]) {
    assert.equal(workspaceAttachmentFrom({ ...failure, details: { ...details, sessionId } }, 'workspace-a'), undefined)
  }
  assert.equal(workspaceAttachmentFrom('session-a', 'workspace-a'), undefined)
})

function setup(label: string) {
  const attachment = { workspaceId: `recovery-${label}`, sessionId: `published-${label}` }
  const originKey = `new:${attachment.workspaceId}`
  const sessionKey = `session:${attachment.sessionId}`
  const calls: { workspaceId?: string; sessionId?: string }[] = []
  let fail = true
  let available = true
  let wait: Promise<void> | undefined
  const failure = new Error('attachment failed')
  const sessions: Pick<ISessions, 'create' | 'scope' | 'refresh'> = {
    async create(options) { calls.push(options ?? {}); if (wait) await wait; if (fail) throw failure; return attachment.sessionId },
    scope() { return available ? {} as AgentContext : undefined },
    async refresh() {},
  }
  const draft = { text: '保つ本文', images: [{ id: 'image-test' }], model: { provider: 'local', model: 'small' }, permission: 'limited', plan: true, workspaceAttachment: attachment }
  // Only identity is relevant here; encoding is covered by the image and delivery tests.
  writeDraft(originKey, draft as Parameters<typeof writeDraft>[1])
  writeDraft(sessionKey, draft as Parameters<typeof writeDraft>[1])
  return {
    attachment, originKey, sessionKey, calls, sessions, failure,
    succeed() { fail = false }, unavailable() { available = false }, waitFor(promise: Promise<void>) { wait = promise },
  }
}

test('repeated Workspace registration failures only adopt the same ID and preserve body, images and choices', async () => {
  const h = setup('retry')
  const before = readDraft(h.sessionKey)
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await retryWorkspaceAttachment({ draftKey: h.sessionKey, sessions: h.sessions })
    assert.equal(result.error, h.failure)
    assert.equal(result.sessionId, h.attachment.sessionId)
    assert.equal(result.sessionReady, true)
    assert.equal(readDraft(h.sessionKey), before)
  }
  assert.equal(h.calls.length, 2)
  assert.ok(h.calls.every(call => call.sessionId === h.attachment.sessionId && call.workspaceId === h.attachment.workspaceId))
  assert.equal(h.calls.filter(call => call.sessionId === undefined).length, 0)
  h.succeed()
  const result = await retryWorkspaceAttachment({ draftKey: h.sessionKey, sessions: h.sessions })
  assert.deepEqual(result, { sessionId: h.attachment.sessionId, sessionReady: true })
  const after = readDraft(h.sessionKey)
  assert.equal(after.workspaceAttachment, undefined)
  assert.equal(after.text, before.text)
  assert.deepEqual(after.images, before.images)
  assert.deepEqual(after.model, before.model)
  assert.equal(after.permission, before.permission)
  assert.equal(after.plan, before.plan)
  assert.deepEqual(readDraft(h.originKey), { text: '', images: [] })
})

test('new-screen recovery moves the latest edits to the existing draft, then removes the duplicate origin', async () => {
  const h = setup('new-edits')
  writeDraft(h.originKey, { ...readDraft(h.originKey), text: '登録を待つ間に編集した本文' })
  h.succeed()
  const result = await retryWorkspaceAttachment({ draftKey: h.originKey, sessions: h.sessions })
  assert.equal(result.sessionReady, true)
  assert.equal(readDraft(h.sessionKey).text, '登録を待つ間に編集した本文')
  assert.equal(readDraft(h.sessionKey).workspaceAttachment, undefined)
  assert.deepEqual(readDraft(h.originKey), { text: '', images: [] })
})

test('successful adoption without a visible scope preserves the original ID on the new screen', async () => {
  const h = setup('unavailable')
  h.unavailable()
  h.succeed()
  writeDraft(h.originKey, { ...readDraft(h.originKey), text: '一覧へ反映される前の最新本文' })
  const before = readDraft(h.originKey)
  const result = await retryWorkspaceAttachment({ draftKey: h.originKey, sessions: h.sessions })
  assert.equal(result.sessionId, h.attachment.sessionId)
  assert.equal(result.sessionReady, false)
  assert.ok(result.error)
  assert.equal(readDraft(h.originKey), before)
  assert.equal(readDraft(h.sessionKey).workspaceAttachment?.sessionId, h.attachment.sessionId)
  assert.equal(readDraft(h.sessionKey).text, '一覧へ反映される前の最新本文')
})

test('remounted recovery joins one Promise and the pending getter exposes it', async () => {
  const h = setup('pending')
  let finish!: () => void
  h.waitFor(new Promise<void>(resolve => { finish = resolve }))
  h.succeed()
  const first = retryWorkspaceAttachment({ draftKey: h.sessionKey, sessions: h.sessions })
  assert.equal(pendingWorkspaceAttachment(h.sessionKey), first)
  assert.equal(retryWorkspaceAttachment({ draftKey: h.sessionKey, sessions: h.sessions }), first)
  assert.equal(h.calls.length, 1)
  finish()
  await first
  assert.equal(pendingWorkspaceAttachment(h.sessionKey), undefined)
})

test('missing registration identity and preparing images never invoke create', async () => {
  const h = setup('guard')
  writeDraft(h.sessionKey, { ...readDraft(h.sessionKey), preparingImages: 1 })
  const before = readDraft(h.sessionKey)
  assert.ok((await retryWorkspaceAttachment({ draftKey: h.sessionKey, sessions: h.sessions })).error)
  assert.equal(readDraft(h.sessionKey), before)
  clearDraft(h.sessionKey)
  assert.ok((await retryWorkspaceAttachment({ draftKey: h.sessionKey, sessions: h.sessions })).error)
  assert.deepEqual(h.calls, [])
})
