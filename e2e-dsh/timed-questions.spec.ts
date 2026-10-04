import type { Page } from '@playwright/test'
import type { ISessions } from '../web/src/dsh/services.ts'
import type { UserQuestionProjection } from '../web/src/dsh/interactions-store.ts'
import { test as base, expect, button, openM3e } from './fixtures.ts'
import { startDsh } from './dsh-host.ts'
import { startFakeLlm, MARK, textOf, type FakeLlm } from './fake-llm.ts'

const test = base.extend({ integration: [async ({}, use) => {
  const llm = await startFakeLlm()
  const host = await startDsh(llm.url, { timedQuestionSeconds: 2 })
  try { await use({ host, llm }) } finally { await host.stop(); await llm.close() }
}, { scope: 'worker', timeout: 600_000 }] })

declare global { interface Window { __timedSessions?: ISessions } }

async function observe(page: Page) {
  await page.addInitScript(() => {
    type Plugin = { id: string; factory: (require: unknown) => { apply?: (ctx: { sessions: ISessions }) => unknown } }
    type Loader = { load(plugin: Plugin): unknown }
    let facade: Loader
    Object.defineProperty(window, '__ModuleLoader__', {
      configurable: true, get: () => facade,
      set(value: Loader) {
        facade = value
        let load = value.load.bind(value)
        const observed = (plugin: Plugin) => plugin.id !== '@deepseek-ai/dsh-api-session-controller' ? load(plugin)
          : load({ ...plugin, factory(require) {
            const exported = plugin.factory(require)
            const apply = exported.apply!
            return { ...exported, apply(ctx: { sessions: ISessions }) {
              const result = apply(ctx)
              window.__timedSessions = ctx.sessions
              return result
            } }
          } })
        Object.defineProperty(value, 'load', { configurable: true, get: () => observed, set: next => { load = next.bind(value) } })
      },
    })
  })
}

async function ask(page: Page) {
  if (await page.getByRole('heading', { name: 'ワークスペースがありません' }).isVisible()) {
    await button(page, 'ワークスペースを追加').click()
    await button(page, 'ここを追加').click()
  }
  await button(page, '新しいセッション').click()
  await page.getByLabel('メッセージ入力欄').fill(`${MARK.question} 期限つきの質問を確認`)
  await button(page, '送信').click()
  await expect(page).toHaveURL(/#\/s\/[^/]+$/)
  await expect(page.getByText('統合試験の質問です。どちらを選びますか？')).toBeVisible()
  return decodeURIComponent(new URL(page.url()).hash.replace(/^#\/s\//, ''))
}

const projection = (page: Page, id: string) => page.evaluate(sessionId =>
  window.__timedSessions!.binding(sessionId)!.session.projections.faceOf('userQuestions').getSnapshot() as UserQuestionProjection, id)
const toolResults = (llm: FakeLlm, since: number) => llm.requests.slice(since).flatMap(request => request.messages)
  .flatMap(message => message.content).filter(block => block.type === 'tool_result' && block.tool_use_id === 'call-question')

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
