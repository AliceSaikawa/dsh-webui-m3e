import assert from 'node:assert/strict'
import test from 'node:test'
import type { ISessions } from '../web/src/dsh/services.ts'
import { clearDraft, readDraft, writeDraft } from '../web/src/features/composer/drafts.ts'
import { pendingWorkspaceAttachment, retryWorkspaceAttachment, workspaceAttachmentFrom } from '../web/src/features/composer/workspace-recovery.ts'
import { deliverDraft } from '../web/src/features/composer/delivery.ts'

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
  const sessions: Pick<ISessions, 'create' | 'list' | 'refresh'> = {
    async create(options) { calls.push(options ?? {}); if (wait) await wait; if (fail) throw failure; return attachment.sessionId },
    list: { subscribe: () => () => {}, getSnapshot: () => ({ phase: 'ready', ids: available ? [attachment.sessionId] : [], byId: available ? { [attachment.sessionId]: { id: attachment.sessionId, retainedBy: {}, displayTitle: attachment.sessionId, running: false, blank: true, updatedAt: 0 } } : {}, projectionsBySession: {} }) },
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

test('successful adoption without a visible catalog row preserves the original ID on the new screen', async () => {
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

// Issue #79: a retry started on the new screen must be visible from the created conversation's composer,
// and its handoff must never overwrite input written there after the retry began.
function held(h: ReturnType<typeof setup>) {
  let finish!: () => void
  h.waitFor(new Promise<void>(resolve => { finish = resolve }))
  return () => finish()
}

test('a retry started on the new screen is shared with the created conversation, and the reverse', async () => {
  const h = setup('shared')
  const release = held(h)
  h.succeed()
  const first = retryWorkspaceAttachment({ draftKey: h.originKey, sessions: h.sessions })
  assert.equal(pendingWorkspaceAttachment(h.sessionKey), first)
  assert.equal(retryWorkspaceAttachment({ draftKey: h.sessionKey, sessions: h.sessions }), first)
  release()
  await first
  assert.equal(pendingWorkspaceAttachment(h.originKey), undefined)
  assert.equal(pendingWorkspaceAttachment(h.sessionKey), undefined)
  assert.equal(h.calls.length, 1)

  const r = setup('shared-reverse')
  const releaseReverse = held(r)
  const reverse = retryWorkspaceAttachment({ draftKey: r.sessionKey, sessions: r.sessions })
  assert.equal(pendingWorkspaceAttachment(r.originKey), reverse)
  assert.equal(retryWorkspaceAttachment({ draftKey: r.originKey, sessions: r.sessions }), reverse)
  releaseReverse()
  await reverse
  assert.equal(pendingWorkspaceAttachment(r.originKey), undefined)
  assert.equal(r.calls.length, 1)
})

for (const outcome of ['success', 'not-ready', 'failure'] as const) {
  test(`${outcome}: input written in the created conversation during the retry is never overwritten`, async () => {
    const h = setup(`edited-${outcome}`)
    const release = held(h)
    if (outcome !== 'failure') h.succeed()
    if (outcome === 'not-ready') h.unavailable()
    const recovery = retryWorkspaceAttachment({ draftKey: h.originKey, sessions: h.sessions })
    // Not through the disabled composer: any later write (images, another path) counts as newer input.
    writeDraft(h.sessionKey, { ...readDraft(h.sessionKey), text: '移動先で書いた新しい本文' })
    release()
    const result = await recovery
    const destination = readDraft(h.sessionKey)
    assert.equal(destination.text, '移動先で書いた新しい本文')
    assert.deepEqual(destination.images, [{ id: 'image-test' }])
    if (outcome === 'success') {
      assert.deepEqual(result, { sessionId: h.attachment.sessionId, sessionReady: true })
      assert.equal(destination.workspaceAttachment, undefined)
      // The origin only held the input the destination already had when the retry began.
      assert.deepEqual(readDraft(h.originKey), { text: '', images: [] })
    } else if (outcome === 'not-ready') {
      assert.equal(result.sessionReady, false)
      assert.deepEqual(destination.workspaceAttachment, h.attachment)
      assert.equal(readDraft(h.originKey).text, '保つ本文')
      assert.deepEqual(readDraft(h.originKey).workspaceAttachment, h.attachment)
    } else {
      assert.equal(result.error, h.failure)
      assert.deepEqual(destination.workspaceAttachment, h.attachment)
      assert.deepEqual(readDraft(h.originKey), { text: '', images: [] })
    }
  })
}

test('a distinct origin input is kept as an ordinary draft when the destination was edited meanwhile', async () => {
  const h = setup('both-edited')
  writeDraft(h.originKey, { ...readDraft(h.originKey), text: '新規画面で直した本文' })
  const release = held(h)
  h.succeed()
  const recovery = retryWorkspaceAttachment({ draftKey: h.originKey, sessions: h.sessions })
  writeDraft(h.sessionKey, { ...readDraft(h.sessionKey), text: '会話画面で書いた本文' })
  release()
  assert.equal((await recovery).sessionReady, true)
  assert.equal(readDraft(h.sessionKey).text, '会話画面で書いた本文')
  assert.equal(readDraft(h.sessionKey).workspaceAttachment, undefined)
  const origin = readDraft(h.originKey)
  assert.equal(origin.text, '新規画面で直した本文')
  assert.equal(origin.workspaceAttachment, undefined)
})

test('sending from either screen is refused while the shared retry is pending', async () => {
  const h = setup('send-blocked')
  const release = held(h)
  h.succeed()
  const recovery = retryWorkspaceAttachment({ draftKey: h.originKey, sessions: h.sessions })
  const sessions = h.sessions as Parameters<typeof deliverDraft>[0]['sessions']
  const api = {} as Parameters<typeof deliverDraft>[0]['api']
  for (const [draftKey, target] of [[h.sessionKey, { kind: 'session', sessionId: h.attachment.sessionId }], [h.originKey, { kind: 'new', workspaceId: h.attachment.workspaceId }]] as const) {
    const before = readDraft(draftKey)
    const sent = await deliverDraft({ target, draftKey, sessions, api, mode: 'queue' })
    assert.match(String((sent.error as Error | undefined)?.message), /ワークスペースへの登録/)
    assert.equal(readDraft(draftKey), before)
  }
  assert.equal(h.calls.length, 1)
  release()
  await recovery
  assert.equal(readDraft(h.sessionKey).text, '保つ本文')
})
