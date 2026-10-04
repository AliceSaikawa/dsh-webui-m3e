import { conversationSelection } from '../web/src/dsh/conversation-selection.ts'
import { queueFromInbox } from '../web/src/dsh/inbox.ts'
import type { InboxState } from '../web/src/dsh/services.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockContext } from '../web/src/dsh/mock/context.ts'
import { extendMock as composerMock } from '../web/src/features/composer/mock.ts'
import { extendMock as toolsMock, SESSION_TOOLS_MOCK_IDS } from '../web/src/features/session-tools/mock.ts'
import { deliverDraft, type DeliveryOptions } from '../web/src/features/composer/delivery.ts'
import { clearDraft, readDraft, writeDraft } from '../web/src/features/composer/drafts.ts'

test('switching from a child during preparation keeps each conversation draft and prompt on its own target', async () => {
  const ctx = createMockContext({ extensions: [{ extendMock: composerMock }, { extendMock: toolsMock }] })
  const child = SESSION_TOOLS_MOCK_IDS.children.review
  const parent = SESSION_TOOLS_MOCK_IDS.parent
  let release!: () => void
  let started!: () => void
  const gate = new Promise<void>(done => { release = done })
  const entered = new Promise<void>(done => { started = done })
  const api: DeliveryOptions['api'] = {
    async selectModel(_id, model) { started(); await gate; return model },
    async listCommands() { return [] },
  }
  const send = (sessionId: string) => deliverDraft({ target: { kind: 'session', sessionId }, draftKey: `session:${sessionId}`, sessions: ctx.sessions, api, mode: 'queue' })
  try {
    await conversationSelection(ctx.sessions).select({ parentSessionId: parent, childSessionId: child, mode: 'continuable' })
    writeDraft(`session:${child}`, { text: '子だけに送る追加依頼', images: [], model: { provider: 'local', model: 'small' } })
    const waiting = send(child)
    await entered
    await conversationSelection(ctx.sessions).select(parent)
    writeDraft(`session:${parent}`, { text: '親だけに送る別の依頼', images: [] })
    assert.deepEqual(await send(parent), {})
    assert.equal(readDraft(`session:${child}`).text, '子だけに送る追加依頼')
    release()
    assert.deepEqual(await waiting, {})
    const childFace = ctx.sessions.retain(child, { source: 'm3e.test' }).binding.session
    const parentFace = ctx.sessions.retain(parent, { source: 'm3e.test' }).binding.session
    assert.ok(childFace && parentFace)
    assert.deepEqual(queueFromInbox(childFace.projections.faceOf('inbox').getSnapshot() as InboxState | undefined).map(item => item.text), ['子だけに送る追加依頼'])
    assert.deepEqual(queueFromInbox(parentFace.projections.faceOf('inbox').getSnapshot() as InboxState | undefined).map(item => item.text), ['親だけに送る別の依頼'])
    assert.equal(conversationSelection(ctx.sessions).state.getSnapshot().sessionId, parent)
    assert.equal(readDraft(`session:${child}`).text, '')
    assert.equal(readDraft(`session:${parent}`).text, '')
  } finally {
    release()
    ctx.dispose()
    clearDraft(`session:${child}`)
    clearDraft(`session:${parent}`)
  }
})
