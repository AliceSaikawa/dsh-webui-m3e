import type { Page } from '@playwright/test'
import type { ISessions, SessionWireEvent } from '../web/src/dsh/services.ts'
import { test, expect, button, openM3e } from './fixtures.ts'
import { MARK } from './fake-llm.ts'

declare global { interface Window { __recordsV4Sessions?: ISessions } }

/** Observe the real controller's wire journal without changing its behavior. */
async function observeRecords(page: Page) {
  await page.addInitScript(() => {
    type Plugin = { id: string; factory: (require: unknown) => { apply?: (ctx: { sessions: ISessions }) => unknown } }
    type Loader = { load(plugin: Plugin): unknown }
    let facade: Loader
    Object.defineProperty(window, '__ModuleLoader__', {
      configurable: true,
      get: () => facade,
      set(value: Loader) {
        facade = value
        let load = value.load.bind(value)
        const observe = (plugin: Plugin) => {
          if (plugin.id !== '@deepseek-ai/dsh-api-session-controller') return load(plugin)
          return load({ ...plugin, factory(require) {
            const exported = plugin.factory(require)
            const apply = exported.apply!
            return { ...exported, apply(ctx: { sessions: ISessions }) {
              const result = apply(ctx)
              window.__recordsV4Sessions = ctx.sessions
              return result
            } }
          } })
        }
        Object.defineProperty(value, 'load', {
          configurable: true, get: () => observe,
          set: (next: Loader['load']) => { load = next.bind(value) },
        })
      },
    })
  })
}

async function recordsOf(page: Page, sessionId: string): Promise<SessionWireEvent[]> {
  return page.evaluate(id => window.__recordsV4Sessions!.binding(id)!.eventSource.getSnapshot().entries
    .flatMap(entry => entry.type === 'event' ? [entry.event] : []), sessionId)
}

for (const scenario of [
  { name: '承認', mark: MARK.approval, tool: 'bash', callId: 'call-approval', output: 'm3e-approval-ok' },
  { name: '質問', mark: MARK.question, tool: 'ask_user_question', callId: 'call-question', output: '赤' },
]) {
  test(`V4 ${scenario.name}の実記録でツール結果と自分の発言を区別する`, async ({ page, integration }, info) => {
    await observeRecords(page)
    await openM3e(page, integration.host)
    if (await page.getByRole('heading', { name: 'ワークスペースがありません' }).isVisible()) {
      await button(page, 'ワークスペースを追加').click()
      await button(page, 'ここを追加').click()
    }
    const input = `${scenario.mark} V4 ${scenario.name}の記録を確認`
    await button(page, '新しいセッション').click()
    await page.getByLabel('メッセージ入力欄').fill(input)
    await button(page, '送信').click()
    await expect(page).toHaveURL(/#\/s\/[^/]+$/)
    const sessionId = decodeURIComponent(new URL(page.url()).hash.replace(/^#\/s\//, ''))
    if (scenario.mark === MARK.approval) {
      await expect(page.getByText('bash を実行しようとしています')).toBeVisible()
      await button(page, '許可（1 回）').click()
    } else {
      await expect(page.getByText('統合試験の質問です。どちらを選びますか？')).toBeVisible()
      await page.getByText('赤', { exact: true }).click()
      await button(page, '回答する').click()
    }
    await expect(page.getByText('ツールの結果を受け取りました。')).toBeVisible()
    await expect(button(page, '実行を停止')).toHaveCount(0)

    const ownMessages = page.getByRole('article', { name: '自分のメッセージ', exact: true })
    await expect(ownMessages).toHaveCount(1)
    await expect(ownMessages).toHaveText(input)
    await expect(page.locator('.chat-context').first()).toBeVisible()

    await expect.poll(async () => (await recordsOf(page, sessionId)).some(event => event.type === 'session/title-llm-request')).toBe(true)
    const records = await recordsOf(page, sessionId)
    const result = records.find(event => event.type === 'tool/result')!
    expect(result).toBeDefined()
    expect(result.surfaceOp).toBe('append')
    expect(result.data).toMatchObject({ message: {
      id: expect.any(String), role: 'tool', toolCallId: scenario.callId,
      source: { kind: 'tool', callId: scenario.callId }, content: expect.any(Array),
    } })
    const users = records.filter(event => event.type === 'user/message')
    const human = users.filter(event => (event.data as { source: { kind: string } }).source.kind === 'user')
    const contexts = users.filter(event => (event.data as { source: { kind: string } }).source.kind !== 'user')
    expect(human).toHaveLength(1)
    expect(contexts.length).toBeGreaterThan(0)
    expect(records.find(event => event.type === 'session/title-llm-request')!.data).toMatchObject({
      messages: [{ role: 'user', source: { kind: 'dsh-session-title-llm' }, content: expect.any(Array) }],
    })
    await info.attach('records-v4', { body: JSON.stringify(records.filter(event =>
      ['user/message', 'tool/call', 'tool/result', 'developer/message', 'session/title-llm-request', 'session/title'].includes(event.type)), null, 2), contentType: 'application/json' })

    await page.getByRole('tab', { name: 'トレース', exact: true }).click()
    const tool = page.locator('[data-trace-row]').filter({ hasText: `ツール：${scenario.tool}` })
    await expect(tool).toHaveCount(1)
    await expect(tool).not.toContainText('実行中')
    await tool.click()
    await expect(page.locator('.trace-record')).toContainText(scenario.output)
    await expect(page.locator('.trace-record')).not.toContainText('本文は記録されていません。')
  })
}
