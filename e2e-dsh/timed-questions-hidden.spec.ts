import { expect, button, openM3e } from './fixtures.ts'
import { test, observe, ask, projection, toolResults } from './timed-questions-fixtures.ts'
import { textOf } from './fake-llm.ts'

for (const departure of ['defer', 'conversation'] as const) test(`timed: ページを閉じず${departure === 'defer' ? '「あとで」' : '別の会話への切替'}の後で期限を迎え、保留から回答できる`, async ({ page, integration }) => {
  const { host, llm } = integration
  await observe(page)
  await openM3e(page, host)
  let otherId: string | undefined
  if (departure === 'conversation') {
    otherId = await ask(page)
    await page.getByText('赤', { exact: true }).click()
    await button(page, '回答する').click()
    await expect.poll(async () => (await projection(page, otherId!))?.settled[0]?.answers[0]?.selected).toEqual(['赤'])
    await button(page, '戻る').last().click()
  }
  const before = llm.requests.length
  const id = await ask(page)
  await expect.poll(async () => (await projection(page, id))?.active[0]?.state).toBe('open')
  if (departure === 'defer') await button(page, 'あとで').click()
  else {
    // The question sheet has no navigation action. Drive the existing SPA
    // router as a conversation selection would, without unloading its Client.
    await page.evaluate(sessionId => { location.hash = `/s/${encodeURIComponent(sessionId!)}` }, otherId)
    await expect(page.locator('.interaction-sheet')).toHaveCount(0)
  }
  await expect.poll(() => toolResults(llm, before).some(block => textOf(block.content).includes('"pending":true'))).toBe(true)
  if (departure === 'defer') await page.locator('.interaction-pending-chips m3e-assist-chip').click()
  else await page.evaluate(sessionId => { location.hash = `/s/${encodeURIComponent(sessionId)}` }, id)
  await expect(page.getByText('統合試験の質問です。どちらを選びますか？')).toBeVisible()
  expect((await projection(page, id)).active[0]?.state).toBe('continued')
  await page.getByText('青', { exact: true }).click()
  await button(page, '回答する').click()
  await expect.poll(async () => (await projection(page, id))?.settled[0]?.answers[0]?.selected).toEqual(['青'])
  await expect.poll(() => llm.requests.slice(before).some(request => request.messages.some(message =>
    message.role === 'user' && message.content.some(block => block.type === 'text' && block.text?.includes('answer_to_pending_question') && block.text.includes('青'))))).toBe(true)
})
