import assert from 'node:assert/strict'
import test from 'node:test'
import type { ISessions } from '../web/src/dsh/services.ts'
import { clearDraft, readDraft, writeDraft, type Draft, type WorkspaceAttachment, type WorkspaceAttachmentBaseline } from '../web/src/features/composer/drafts.ts'
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
  const images = [{ id: 'image-test' }] as unknown as Draft['images']
  const model = { provider: 'local', model: 'small' } as Draft['model']
  const baseline: WorkspaceAttachmentBaseline = { text: '保つ本文', input: { images, model, permission: 'limited', plan: true } }
  const attachment: WorkspaceAttachment = { workspaceId: `recovery-${label}`, sessionId: `published-${label}`, baseline }
  const originKey = `new:${attachment.workspaceId}`
  const sessionKey = `session:${attachment.sessionId}`
  const calls: { workspaceId?: string; sessionId?: string }[] = []
  let fail = true
  let available = true
  let wait: Promise<void> | undefined
  // DSH 0.2.1 reuses a named Session only while it is an unarchived blank member
  // of the requested Workspace and otherwise reports another identity.
  let minted: string | undefined
  const failure = new Error('attachment failed')
  const published = () => minted ?? attachment.sessionId
  const sessions: Pick<ISessions, 'create' | 'list' | 'refresh'> = {
    async create(options) {
      calls.push(options ?? {})
      if (wait) await wait
      if (fail) throw minted === undefined ? failure : Object.assign(new Error('attachment failed'), { rpcError: { code: 'session/workspace-attach-failed', message: 'attachment failed', details: { workspaceId: attachment.workspaceId, sessionId: minted } } })
      return published()
    },
    list: { subscribe: () => () => {}, getSnapshot: () => { const id = published(); return { phase: 'ready', ids: available ? [id] : [], byId: available ? { [id]: { id, retainedBy: {}, displayTitle: id, running: false, blank: true, updatedAt: 0 } } : {}, projectionsBySession: {} } } },
    async refresh() {},
  }
  const draft: Draft = { text: '保つ本文', images, model, permission: 'limited', plan: true, workspaceAttachment: attachment }
  // Only identity is relevant here; encoding is covered by the image and delivery tests.
  writeDraft(originKey, draft)
  writeDraft(sessionKey, draft)
  return {
    attachment, originKey, sessionKey, calls, sessions, failure,
    succeed() { fail = false }, unavailable() { available = false }, waitFor(promise: Promise<void>) { wait = promise },
    hostMints(id: string) { minted = id },
  }
}

test('repeated Workspace registration failures of a reusable conversation keep naming the same ID and preserve body, images and choices', async () => {
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

// Issue #128: DSH 0.2.1 reuses a named Session only while it is an unarchived
// blank member of the requested Workspace (dsh-api-session-controller/lib/index.js:769,
// lib/types/agent.js:483). The conversation whose attach failed is not a member,
// so the Host mints another identity, and the retry must follow the one it reports.
test('a non-reusable recorded conversation is superseded by the minted ID the Host registers', async () => {
  const h = setup('minted')
  h.hostMints('minted-registered')
  h.succeed()
  const result = await retryWorkspaceAttachment({ draftKey: h.originKey, sessions: h.sessions })
  assert.deepEqual(result, { sessionId: 'minted-registered', sessionReady: true })
  assert.deepEqual(h.calls, [{ workspaceId: h.attachment.workspaceId, sessionId: h.attachment.sessionId }])
  const adopted = readDraft('session:minted-registered')
  assert.equal(adopted.text, '保つ本文')
  assert.deepEqual(adopted.images, [{ id: 'image-test' }])
  assert.deepEqual(adopted.model, { provider: 'local', model: 'small' })
  assert.equal(adopted.permission, 'limited')
  assert.equal(adopted.plan, true)
  assert.equal(adopted.workspaceAttachment, undefined)
  // The new screen handed its duplicate over, and the recorded conversation held
  // only this recovery, so its retry state is gone instead of pointing at an id
  // the Host can no longer register.
  assert.deepEqual(readDraft(h.originKey), { text: '', images: [] })
  assert.deepEqual(readDraft(h.sessionKey), { text: '', images: [] })
  assert.equal(pendingWorkspaceAttachment(h.sessionKey), undefined)
})

test('a repeated attach failure adopts the newest reported identity instead of the recorded one', async () => {
  const h = setup('minted-failure')
  h.hostMints('minted-again')
  const result = await retryWorkspaceAttachment({ draftKey: h.originKey, sessions: h.sessions })
  assert.equal(result.sessionId, 'minted-again')
  assert.equal(result.sessionReady, true)
  assert.ok(result.error)
  const adopted = readDraft('session:minted-again')
  assert.deepEqual(adopted.workspaceAttachment, { workspaceId: h.attachment.workspaceId, sessionId: 'minted-again',
    baseline: { text: '保つ本文', input: { images: [{ id: 'image-test' }], model: { provider: 'local', model: 'small' }, permission: 'limited', plan: true } } })
  assert.equal(adopted.text, '保つ本文')
  assert.deepEqual(readDraft(h.sessionKey), { text: '', images: [] })
  // The next retry names the newest identity instead of repeating the recorded
  // one that the Host replaced.
  await retryWorkspaceAttachment({ draftKey: 'session:minted-again', sessions: h.sessions })
  assert.deepEqual(h.calls.at(-1), { workspaceId: h.attachment.workspaceId, sessionId: 'minted-again' })
})

// Issue #125: a fresh identity has no earlier input of its own, so the state
// written for it must still record the input, or the next retry compares only bodies.
test('a failed attach of a minted identity records the input for the next retry', async () => {
  const h = setup('minted-input')
  h.hostMints('minted-input-new')
  const result = await retryWorkspaceAttachment({ draftKey: h.originKey, sessions: h.sessions })
  assert.equal(result.sessionId, 'minted-input-new')
  assert.ok(result.error)
  assert.deepEqual(readDraft('session:minted-input-new').workspaceAttachment, {
    workspaceId: h.attachment.workspaceId,
    sessionId: 'minted-input-new',
    baseline: { text: '保つ本文', input: { images: [{ id: 'image-test' }], model: { provider: 'local', model: 'small' }, permission: 'limited', plan: true } },
  })
})

test('a divergent body on the recorded conversation stays as an ordinary draft after being superseded', async () => {
  const h = setup('minted-divergent')
  h.hostMints('minted-kept')
  h.succeed()
  writeDraft(h.sessionKey, { ...readDraft(h.sessionKey), text: '記録側だけの別本文' })
  const result = await retryWorkspaceAttachment({ draftKey: h.originKey, sessions: h.sessions })
  assert.deepEqual(result, { sessionId: 'minted-kept', sessionReady: true })
  assert.equal(readDraft('session:minted-kept').text, '保つ本文')
  const recorded = readDraft(h.sessionKey)
  assert.equal(recorded.text, '記録側だけの別本文')
  assert.deepEqual(recorded.images, [{ id: 'image-test' }])
  assert.equal(recorded.workspaceAttachment, undefined)
})

test('a minted ID that is not yet listed keeps the retry on the screen the user started from', async () => {
  for (const outcome of ['success', 'failure'] as const) {
    const h = setup(`minted-unlisted-${outcome}`)
    h.hostMints('minted-unlisted')
    h.unavailable()
    if (outcome === 'success') h.succeed()
    const result = await retryWorkspaceAttachment({ draftKey: h.sessionKey, sessions: h.sessions })
    assert.equal(result.sessionId, 'minted-unlisted')
    assert.equal(result.sessionReady, false)
    assert.ok(result.error)
    // Navigation cannot happen before the list shows the identity, so the screen
    // the user is on keeps its retry naming the newest identity.
    const current = readDraft(h.sessionKey)
    assert.equal(current.text, '保つ本文')
    assert.deepEqual(current.workspaceAttachment, { workspaceId: h.attachment.workspaceId, sessionId: 'minted-unlisted',
      baseline: { text: '保つ本文', input: { images: [{ id: 'image-test' }], model: { provider: 'local', model: 'small' }, permission: 'limited', plan: true } } })
    // The new screen's duplicate held the same body, so it is not left behind.
    assert.deepEqual(readDraft(h.originKey), { text: '', images: [] })
    // The next retry names the newest identity, not the superseded recorded one.
    await retryWorkspaceAttachment({ draftKey: h.sessionKey, sessions: h.sessions })
    assert.deepEqual(h.calls.at(-1), { workspaceId: h.attachment.workspaceId, sessionId: 'minted-unlisted' })
  }
})

test('a retry from the recorded conversation follows a minted ID and leaves the body only there', async () => {
  const h = setup('minted-from-conversation')
  h.hostMints('minted-from-conversation')
  h.succeed()
  const result = await retryWorkspaceAttachment({ draftKey: h.sessionKey, sessions: h.sessions })
  assert.deepEqual(result, { sessionId: 'minted-from-conversation', sessionReady: true })
  const adopted = readDraft('session:minted-from-conversation')
  assert.equal(adopted.text, '保つ本文')
  assert.equal(adopted.workspaceAttachment, undefined)
  // Neither the recorded conversation nor the new screen keeps the body or a recovery.
  assert.deepEqual(readDraft(h.sessionKey), { text: '', images: [] })
  assert.deepEqual(readDraft(h.originKey), { text: '', images: [] })
})

// Issue #125: the recorded failure-time input decides which screen holds the
// newer body. A conversation still holding it receives the new screen's body;
// a conversation the user edited keeps its own.
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
  assert.equal(readDraft(h.sessionKey).text, '保つ本文')
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

// Issue #125, case 1: the conversation still holds the failure-time body, so the
// new screen's later edit is the newer one and moves over.
for (const outcome of ['success', 'failure'] as const) {
  test(`${outcome}: a new-screen edit made before the retry replaces the failure-time conversation body`, async () => {
    const h = setup(`failure-body-${outcome}`)
    if (outcome === 'success') h.succeed()
    writeDraft(h.originKey, { ...readDraft(h.originKey), text: '新規画面で先に直した本文' })
    const result = await retryWorkspaceAttachment({ draftKey: h.originKey, sessions: h.sessions })
    if (outcome === 'success') {
      assert.deepEqual(result, { sessionId: h.attachment.sessionId, sessionReady: true })
      assert.equal(readDraft(h.sessionKey).text, '新規画面で先に直した本文')
      assert.equal(readDraft(h.sessionKey).workspaceAttachment, undefined)
      assert.deepEqual(readDraft(h.originKey), { text: '', images: [] })
    } else {
      assert.equal(result.error, h.failure)
      const destination = readDraft(h.sessionKey)
      assert.equal(destination.text, '保つ本文')
      assert.deepEqual(destination.workspaceAttachment, h.attachment)
      const origin = readDraft(h.originKey)
      assert.equal(origin.text, '新規画面で先に直した本文')
      assert.deepEqual(origin.workspaceAttachment, h.attachment)
    }
  })
}

// Issue #125, case 2: the conversation holds an edit made after the failure, so
// it is kept; the new screen still copies the failure body and drops it.
for (const outcome of ['success', 'failure'] as const) {
  test(`${outcome}: a conversation edited before the retry keeps its input and drops the unchanged new-screen copy`, async () => {
    const h = setup(`conversation-edited-${outcome}`)
    if (outcome === 'success') h.succeed()
    writeDraft(h.sessionKey, { ...readDraft(h.sessionKey), text: '会話側で先に書いた新しい本文' })
    const result = await retryWorkspaceAttachment({ draftKey: h.originKey, sessions: h.sessions })
    const destination = readDraft(h.sessionKey)
    assert.equal(destination.text, '会話側で先に書いた新しい本文')
    assert.deepEqual(destination.images, [{ id: 'image-test' }])
    assert.deepEqual(destination.model, { provider: 'local', model: 'small' })
    assert.deepEqual(readDraft(h.originKey), { text: '', images: [] })
    if (outcome === 'success') {
      assert.deepEqual(result, { sessionId: h.attachment.sessionId, sessionReady: true })
      assert.equal(destination.workspaceAttachment, undefined)
    } else {
      assert.equal(result.error, h.failure)
      assert.deepEqual(destination.workspaceAttachment, h.attachment)
    }
  })
}

// Issue #125, case 3: both screens hold distinct edits, so both are kept.
for (const outcome of ['success', 'failure'] as const) {
  test(`${outcome}: drafts edited separately on both screens before the retry are both kept`, async () => {
    const h = setup(`both-edited-${outcome}`)
    if (outcome === 'success') h.succeed()
    writeDraft(h.originKey, { ...readDraft(h.originKey), text: '新規画面で先に直した本文' })
    writeDraft(h.sessionKey, { ...readDraft(h.sessionKey), text: '会話画面で先に直した本文' })
    const result = await retryWorkspaceAttachment({ draftKey: h.originKey, sessions: h.sessions })
    const destination = readDraft(h.sessionKey)
    assert.equal(destination.text, '会話画面で先に直した本文')
    const origin = readDraft(h.originKey)
    assert.equal(origin.text, '新規画面で先に直した本文')
    if (outcome === 'success') {
      assert.deepEqual(result, { sessionId: h.attachment.sessionId, sessionReady: true })
      assert.equal(destination.workspaceAttachment, undefined)
      assert.equal(origin.workspaceAttachment, undefined)
    } else {
      assert.equal(result.error, h.failure)
      assert.deepEqual(destination.workspaceAttachment, h.attachment)
      assert.deepEqual(origin.workspaceAttachment, h.attachment)
    }
  })
}

// A reload restores the body and the saved identity, but `readDraft` returns no
// images or choices and the saved baseline keeps only the body.
function afterReload(h: ReturnType<typeof setup>): WorkspaceAttachment {
  const attachment: WorkspaceAttachment = { workspaceId: h.attachment.workspaceId, sessionId: h.attachment.sessionId, baseline: { text: '保つ本文' } }
  writeDraft(h.originKey, { text: '保つ本文', images: [], workspaceAttachment: attachment })
  writeDraft(h.sessionKey, { text: '保つ本文', images: [], workspaceAttachment: attachment })
  return attachment
}

// Issue #125: with no saved input, the baseline stands for the empty input a
// reload restores, so input added afterwards is not mistaken for the failure state.
test('after a reload, an image added to the conversation survives while the new screen holds the edit', async () => {
  const h = setup('reload-conversation-image')
  afterReload(h)
  const added = { id: 'conversation-added-image' } as unknown as Draft['images'][number]
  writeDraft(h.sessionKey, { ...readDraft(h.sessionKey), images: [added] })
  writeDraft(h.originKey, { ...readDraft(h.originKey), text: '新規画面で直した本文' })
  h.succeed()
  const result = await retryWorkspaceAttachment({ draftKey: h.originKey, sessions: h.sessions })
  assert.deepEqual(result, { sessionId: h.attachment.sessionId, sessionReady: true })
  assert.deepEqual(readDraft(h.sessionKey), { text: '保つ本文', images: [added] })
  assert.deepEqual(readDraft(h.originKey), { text: '新規画面で直した本文', images: [] })
})

test('after a reload, an image added on the new screen survives while the conversation holds the edit', async () => {
  const h = setup('reload-origin-image')
  afterReload(h)
  const added = { id: 'new-screen-added-image' } as unknown as Draft['images'][number]
  writeDraft(h.originKey, { ...readDraft(h.originKey), images: [added] })
  writeDraft(h.sessionKey, { ...readDraft(h.sessionKey), text: '会話側で直した本文' })
  h.succeed()
  const result = await retryWorkspaceAttachment({ draftKey: h.originKey, sessions: h.sessions })
  assert.deepEqual(result, { sessionId: h.attachment.sessionId, sessionReady: true })
  assert.deepEqual(readDraft(h.sessionKey), { text: '会話側で直した本文', images: [] })
  assert.deepEqual(readDraft(h.originKey), { text: '保つ本文', images: [added] })
})

test('a retry that finds the same body on both screens removes the new-screen duplicate', async () => {
  const h = setup('same-body')
  h.succeed()
  const result = await retryWorkspaceAttachment({ draftKey: h.originKey, sessions: h.sessions })
  assert.deepEqual(result, { sessionId: h.attachment.sessionId, sessionReady: true })
  const destination = readDraft(h.sessionKey)
  assert.equal(destination.text, '保つ本文')
  assert.equal(destination.workspaceAttachment, undefined)
  assert.deepEqual(readDraft(h.originKey), { text: '', images: [] })
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
