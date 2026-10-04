import { expect, button, openM3e } from './fixtures.ts'
import { test, observe, ask, projection, toolResults } from './timed-questions-fixtures.ts'
import { textOf } from './fake-llm.ts'
import type { InboxState } from '../web/src/dsh/services.ts'

test('timed: 別Clientの返信取消で復帰したカードを古い回答応答が消さず、答え直しがモデルへ届く', async ({ page, integration, browserErrors, pageErrors }, info) => {
  const { host, llm } = integration
  const other = await page.context().newPage()
  other.on('pageerror', error => pageErrors.push(error.message))
  other.on('console', message => { if (message.type() === 'error') browserErrors.push(message.text()) })
  const marker = '取消競合のためモデルの次のステップを保留'
  const held = llm.holdTurn(marker)
  let releaseResponse!: () => void
  const responseGate = new Promise<void>(resolve => { releaseResponse = resolve })
  const requests: unknown[] = []
  let hostResponse: unknown
  let delivered = false
  const endpoint = `${host.origin}/api/userQuestions/answer`
  try {
    await observe(page); await observe(other)
    await openM3e(page, host)
    const before = llm.requests.length
    const id = await ask(page)
    await button(page, 'あとで').click()
    await expect.poll(() => toolResults(llm, before).some(block => textOf(block.content).includes('"pending":true'))).toBe(true)
    await expect.poll(async () => (await projection(page, id))?.active[0]?.state).toBe('continued')
    await expect(button(page, '実行を停止')).toHaveCount(0)

    // A held model call gives the real Agent a deterministic next-step boundary.
    // Neither answer may be admitted until releaseStep below.
    await page.getByLabel('メッセージ入力欄').fill(marker)
    await button(page, '送信').click()
    await expect.poll(() => held.first).toBeDefined()
    await openM3e(other, host, `/s/${encodeURIComponent(id)}`)
    const queued = () => other.evaluate(sessionId => {
      const inbox = window.__timedSessions!.binding(sessionId)!.session.projections.faceOf('inbox').getSnapshot() as InboxState
      return inbox['next-step'].filter(row => row.source.kind === 'user-question-reply')
    }, id)
    const callId = (await projection(other, id)).active[0]!.callId
    expect(callId).toBe('call-question')

    // Observe the real HTTP result, then hold only its delivery to this Client.
    // The Host, gateway, queue and projection streams are left untouched.
    await page.route(endpoint, async route => {
      requests.push(route.request().postDataJSON())
      if (requests.length !== 1) { await route.continue(); return }
      const response = await route.fetch({ timeout: 10_000 })
      hostResponse = await response.json()
      await responseGate
      await route.fulfill({ response })
      delivered = true
    })
    await page.evaluate(() => { location.hash = '#/inbox' })
    const row = page.locator('m3e-list-action.inbox-row').filter({ hasText: '統合試験の質問です。どちらを選びますか？' })
    await expect(row).toBeVisible()
    await row.click()
    await page.getByText('赤', { exact: true }).click()
    await button(page, '回答する').click()
    await expect.poll(() => hostResponse).toMatchObject({ type: 'server-response', result: { ok: true, value: true } })
    expect(delivered).toBe(false)
    await expect.poll(queued).toHaveLength(1)
    const first = (await queued())[0]!
    expect(first.source).toMatchObject({ kind: 'user-question-reply', callId })
    expect(JSON.parse(textOf(first.content)).answers).toEqual([{ id: 'color', selected: ['赤'] }])
    await expect(row).toHaveCount(0)
    expect((await projection(other, id)).active[0]?.state).toBe('continued')

    // This is a second browser page's real SessionFace -> session/updateQueue RPC.
    // The existing UI does not offer removal of user-question-reply queue items.
    const removed = await other.evaluate(async ({ id, itemId }) =>
      window.__timedSessions!.binding(id)!.session.updateQueue(itemId, { kind: 'remove' }), { id, itemId: first.id })
    expect(removed.ok).toBe(true)
    await expect.poll(queued).toEqual([])
    await expect(row).toHaveCount(1)
    const restoredRow = await row.elementHandle()
    expect(restoredRow).not.toBeNull()
    expect((await projection(other, id)).active[0]).toMatchObject({ callId, state: 'continued' })
    expect(delivered).toBe(false)
    expect(held.continuation).toBeUndefined()

    releaseResponse()
    await expect.poll(() => delivered).toBe(true)
    // Closing the busy sheet proves its original answer() continuation ran.
    // Do not navigate/reopen the Session: that could recreate a wrongly erased card.
    await expect(page.locator('.interaction-sheet')).toHaveCount(0)
    expect(await restoredRow!.evaluate(node => node.isConnected), '古いRPC完了後も復帰した対応待ちの行が残る').toBe(true)
    await expect(row).toBeVisible()
    await row.click()
    await page.getByText('青', { exact: true }).click()
    await button(page, '回答する').click()
    await expect.poll(queued).toHaveLength(1)
    const second = (await queued())[0]!
    expect(second.id).not.toBe(first.id)
    expect(second.source).toMatchObject({ kind: 'user-question-reply', callId })
    expect(JSON.parse(textOf(second.content)).answers).toEqual([{ id: 'color', selected: ['青'] }])
    expect(requests).toHaveLength(2)
    expect((await projection(other, id)).settled).toEqual([])
    expect(held.continuation).toBeUndefined()
    held.releaseStep()
    await expect.poll(() => held.continuation).toBeDefined()
    const replies = held.continuation!.messages.filter(message => message.role === 'user')
      .flatMap(message => message.content).filter(block => block.type === 'text' && block.text?.includes('answer_to_pending_question'))
      .map(block => JSON.parse(block.text!))
    expect(replies).toHaveLength(1)
    expect(replies[0]).toMatchObject({ callId, answers: [{ id: 'color', selected: ['青'] }] })
    await expect.poll(async () => (await projection(other, id)).settled).toEqual([{ callId, answers: [{ id: 'color', selected: ['青'] }] }])
    await expect.poll(queued).toEqual([])
    held.releaseTurn()
    await expect.poll(() => held.completed).toBe(true)
    await info.attach('real-question-reply-race', { body: JSON.stringify({ requests, hostResponse, canceled: first, admitted: second, modelReplies: replies }), contentType: 'application/json' })
  } finally {
    releaseResponse(); held.releaseStep(); held.releaseTurn()
    await page.unrouteAll({ behavior: 'wait' })
    await other.close()
  }
})
