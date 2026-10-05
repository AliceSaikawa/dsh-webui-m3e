import type { Page } from '@playwright/test'
import type { ISessions } from '../web/src/dsh/services.ts'
import type { UserQuestionProjection } from '../web/src/dsh/interactions-store.ts'
import { test as base, expect, button, openM3e } from './fixtures.ts'
import { startDsh, type DshHost } from './dsh-host.ts'
import { startFakeLlm, MARK, textOf, type FakeLlm } from './fake-llm.ts'

export const test = base.extend({ integration: [async ({}, use) => {
  const llm = await startFakeLlm()
  let host: DshHost | undefined
  try {
    host = await startDsh(llm.url, { timedQuestionSeconds: 2 })
    await use({ host, llm })
  } finally { try { await host?.stop() } finally { await llm.close() } }
}, { scope: 'worker', timeout: 600_000 }] })

declare global { interface Window { __timedSessions?: ISessions } }

export async function observe(page: Page) {
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

export async function ask(page: Page) {
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

export const projection = (page: Page, id: string) => page.evaluate(sessionId =>
  window.__timedSessions!.binding(sessionId)!.session.projections.faceOf('userQuestions').getSnapshot() as UserQuestionProjection, id)
export const toolResults = (llm: FakeLlm, since: number) => llm.requests.slice(since).flatMap(request => request.messages)
  .flatMap(message => message.content).filter(block => block.type === 'tool_result' && block.tool_use_id === 'call-question')
