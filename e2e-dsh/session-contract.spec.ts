import type { Page } from '@playwright/test'
import type { ISessions, SessionBinding } from '../web/src/dsh/services.ts'
import { test, expect, button, openM3e } from './fixtures.ts'

type Probe = {
  sessions?: ISessions
  sent?: SessionBinding
  releases: { id: string; source: string; count: number }[]
  holdPrompt: boolean
  promptStarted: boolean
  finishPrompt?: () => void
}
declare global { interface Window { __sessionReview: Probe } }

/** Observe the real controller at plugin registration; all methods still call DSH.
 * No installed DSH or application file is modified by this instrumentation.
 */
async function instrument(page: Page) {
  await page.addInitScript(() => {
    const probe: Probe = { releases: [], holdPrompt: false, promptStarted: false }
    window.__sessionReview = probe
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
              const sessions = ctx.sessions
              probe.sessions = sessions
              const retain = sessions.retain.bind(sessions)
              sessions.retain = (target, options) => {
                const reference = retain(target, options)
                if (options.source === 'm3e.delivery') {
                  probe.sent = reference.binding
                  if (probe.holdPrompt) {
                    const session = reference.binding.session
                    const prompt = session.prompt.bind(session)
                    session.prompt = async (...args) => {
                      const result = await prompt(...args)
                      probe.promptStarted = true
                      await new Promise<void>(resolve => { probe.finishPrompt = resolve })
                      return result
                    }
                  }
                }
                const release = reference.release.bind(reference)
                reference.release = () => {
                  release()
                  probe.releases.push({ id: reference.sessionId, source: options.source, count: sessions.retainInfo(reference.sessionId).getSnapshot().referenceCount })
                }
                return reference
              }
              return result
            } }
          } })
        }
        Object.defineProperty(value, 'load', {
          configurable: true,
          get: () => observe,
          set: (next: Loader['load']) => { load = next.bind(value) },
        })
      },
    })
  })
}
async function setup(page: Page, host: Parameters<typeof openM3e>[1]) {
  await instrument(page)
  await openM3e(page, host)
  if (await page.getByRole('heading', { name: 'ワークスペースがありません' }).isVisible()) {
    await button(page, 'ワークスペースを追加').click()
    await button(page, 'ここを追加').click()
  }
  await expect(button(page, '新しいセッション')).toBeEnabled()
}
async function sendNew(page: Page, text: string) {
  await button(page, '新しいセッション').click()
  await page.getByLabel('メッセージ入力欄').fill(text)
  await button(page, '送信').click()
}

test('R1 実DSHで初回送信から表示へ同じSession世代を引き継ぐ', async ({ page, integration }) => {
  await setup(page, integration.host)
  await sendNew(page, '参照の引き継ぎを確認')
  await expect(page).toHaveURL(/#\/s\/[^/]+$/)
  await expect(page.getByText('こんにちは。偽のモデルです。')).toBeVisible()
  const result = await page.evaluate(() => {
    const { sessions, sent, releases } = window.__sessionReview
    return { same: sessions!.binding(sent!.sessionId) === sent,
      releases: releases.filter(row => row.id === sent!.sessionId && row.source === 'm3e.delivery'),
      count: sessions!.retainInfo(sent!.sessionId).getSnapshot().retainedBy['m3e.mainView'] }
  })
  expect(result.same).toBe(true)
  expect(result.count).toBe(1)
  expect(result.releases).toHaveLength(1)
  expect(result.releases[0]!.count).toBeGreaterThan(0)
})

test('R1 実DSHの初回送信待ちで離脱すると引き継がず解放する', async ({ page, integration }) => {
  await setup(page, integration.host)
  await page.evaluate(() => { window.__sessionReview.holdPrompt = true })
  await sendNew(page, '離脱した送信')
  await expect.poll(() => page.evaluate(() => window.__sessionReview.promptStarted)).toBe(true)
  await page.evaluate(() => { window.location.hash = '#/' })
  await expect(button(page, '新しいセッション')).toBeVisible()
  await page.evaluate(() => window.__sessionReview.finishPrompt!())
  await expect.poll(() => page.evaluate(() => {
    const { sessions, sent } = window.__sessionReview
    return sessions!.retainInfo(sent!.sessionId).getSnapshot().referenceCount
  })).toBe(0)
  await expect(page).toHaveURL(/#\/$/)
})

test('R5 実DSHでpagehide・pageshow後に現在の会話を再取得して送信できる', async ({ page, integration }) => {
  test.info().annotations.push({ type: 'lifecycle-events', description: 'BFCache実機ではなくChromiumのpagehide/pageshowイベントによる確認' })
  await setup(page, integration.host)
  await sendNew(page, 'ページ復帰前')
  await expect(page).toHaveURL(/#\/s\/[^/]+$/)
  await expect(page.getByText('こんにちは。偽のモデルです。')).toBeVisible()
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })))
  expect(await page.evaluate(() => {
    const { sessions, sent } = window.__sessionReview
    return sessions!.retainInfo(sent!.sessionId).getSnapshot().referenceCount
  })).toBe(0)
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })))
  await expect(page.getByText('ページ復帰前', { exact: true })).toBeVisible()
  await expect(page.getByLabel('メッセージ入力欄')).toBeEnabled()
  await page.getByLabel('メッセージ入力欄').fill('ページ復帰後')
  await button(page, '送信').click()
  await expect(page.locator('.chat-bubble').filter({ hasText: /^ページ復帰後$/ })).toBeVisible()
  await expect(page.getByLabel('メッセージ入力欄')).toHaveValue('')
  await expect(button(page, '実行を停止')).toHaveCount(0)
})
