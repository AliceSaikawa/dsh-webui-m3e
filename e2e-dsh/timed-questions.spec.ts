import { expect, button, openM3e } from './fixtures.ts'
import { test, observe, ask, projection, toolResults } from './timed-questions-fixtures.ts'
import { textOf } from './fake-llm.ts'

test('timed: 表示中はHost期限を越えて保持し、回答をツール結果としてモデルへ返す', async ({ page, integration }, info) => {
  const { host, llm } = integration
  await observe(page)
  await openM3e(page, host)
  const before = llm.requests.length
  const id = await ask(page)
  await expect.poll(async () => (await projection(page, id))?.active[0]?.state).toBe('open')
  // Deliberately exceed the real Host's configured two-second deadline.
  await page.waitForTimeout(2500)
  expect(toolResults(llm, before)).toEqual([])
  expect((await projection(page, id)).active[0]?.state).toBe('open')
  await expect(page.getByText('統合試験の質問です。どちらを選びますか？')).toBeVisible()
  await page.getByText('赤', { exact: true }).click()
  await button(page, '回答する').click()
  await expect.poll(() => JSON.stringify(toolResults(llm, before))).toContain('赤')
  expect(toolResults(llm, before).some(block => textOf(block.content).includes('"pending":true'))).toBe(false)
  await expect.poll(async () => (await projection(page, id))?.settled[0]?.answers[0]?.selected).toEqual(['赤'])
  await info.attach('timed-answered-projection', { body: JSON.stringify(await projection(page, id)), contentType: 'application/json' })
})

test('timed: 画面を閉じたまま期限を過ぎ、再度開いて既存のカードから回答できる', async ({ page, integration }, info) => {
  const { host, llm } = integration
  await observe(page)
  await openM3e(page, host)
  const before = llm.requests.length
  const id = await ask(page)
  const url = page.url()
  await expect.poll(async () => (await projection(page, id))?.active[0]?.state).toBe('open')
  await page.goto('about:blank')
  await expect.poll(() => JSON.stringify(toolResults(llm, before))).toContain('pending')
  await page.goto(url)
  await expect(page.getByText('統合試験の質問です。どちらを選びますか？')).toBeVisible()
  expect((await projection(page, id)).active[0]?.state).toBe('continued')
  await page.getByText('青', { exact: true }).click()
  await button(page, '回答する').click()
  await expect.poll(() => llm.requests.slice(before).some(request => request.messages.some(message =>
    message.role === 'user' && message.content.some(block => block.type === 'text' && block.text?.includes('answer_to_pending_question') && block.text.includes('青'))))).toBe(true)
  await expect.poll(async () => (await projection(page, id))?.active).toEqual([])
  expect((await projection(page, id)).settled[0]?.answers[0]?.selected).toEqual(['青'])
  await info.attach('timed-continued-reply', { body: JSON.stringify(await projection(page, id)), contentType: 'application/json' })
})
