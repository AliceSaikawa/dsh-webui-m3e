import { test, expect, visit, button } from './helpers'
import type { Page } from '@playwright/test'

// Exercise the production sheet and InteractionStore with a controllable continued-question RPC.
async function setup(page: Page) {
  await page.route('**/src/dsh/interactions.ts*', async route => {
    const response = await route.fetch(), body = await response.text()
    const creation = /const store = new InteractionStore\(\);?/
    expect(body.match(new RegExp(creation.source, 'g'))).toHaveLength(1)
    await route.fulfill({ response, body: body.replace(creation, '$& globalThis.__cancelRaceStore = store;') })
  })
  await visit(page)
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves the browser module at this URL.
    const { presentInteraction } = await import('/m3e/src/features/interactions/InteractionSheet.tsx')
    const store = (window as any).__cancelRaceStore
    const replies: { resolve(value: boolean): void; reject(error: Error): void }[] = []
    let calls = 0
    const sync = (ids: string[]) => store.syncQuestions('race-fixture', {
      active: ids.map(callId => ({ callId, state: 'continued', questions: [{ id: 'answer', question: callId, options: [{ label: 'はい' }] }] })), settled: [],
    }, {}, () => { calls++; return new Promise<boolean>((resolve, reject) => replies.push({ resolve, reject })) })
    ;(window as any).__cancelRace = {
      sync,
      open(id: string) { presentInteraction(store.getSnapshot().find((q: any) => q.callId === id), { from: 'inbox' }) },
      finish(index: number, success: boolean) { if (success) replies[index].resolve(true); else replies[index].reject(new Error('injected RPC failure')) },
      calls: () => calls,
      count: () => store.getSnapshot().filter((q: any) => q.sessionId === 'race-fixture').length,
    }
    sync(['最初の質問'])
    ;(window as any).__cancelRace.open('最初の質問')
  })
  await expect(page.getByRole('heading', { name: '最初の質問', exact: true })).toBeVisible()
}
async function send(page: Page) {
  await page.getByText('はい', { exact: true }).click()
  await button(page, '回答する').click()
  await expect(page.locator('.interaction-sheet')).toHaveAttribute('aria-busy', 'true')
}
const sync = (page: Page, ids: string[]) => page.evaluate(ids => (window as any).__cancelRace.sync(ids), ids)
const finish = (page: Page, success = false, index = 0) => page.evaluate(({ success, index }) => (window as any).__cancelRace.finish(index, success), { success, index })

for (const success of [false, true]) test(`送信中の質問取消後にRPCが${success ? '成功' : '失敗'}してもシートを閉じる`, async ({ page }) => {
  await setup(page); await send(page)
  await sync(page, [])
  await expect.poll(() => page.evaluate(() => (window as any).__cancelRace.count())).toBe(0)
  await expect(button(page, '回答する')).toBeDisabled()
  await finish(page, success)
  await expect(page.locator('.interaction-sheet')).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
  if (!success) await expect(page.getByText('質問の要求は取り消されました', { exact: true })).toHaveCount(1)
})

test('送信前の取消でもシートを閉じ、RPCを呼ばない', async ({ page }) => {
  await setup(page); await sync(page, [])
  await expect(page.locator('.interaction-sheet')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__cancelRace.calls())).toBe(0)
})

test('有効な質問の失敗は回答を保持して再試行でき、多重送信しない', async ({ page }) => {
  await setup(page); await send(page)
  await button(page, '回答する').dispatchEvent('click')
  await button(page, '回答する').dispatchEvent('click')
  expect(await page.evaluate(() => (window as any).__cancelRace.calls())).toBe(1)
  await finish(page)
  await expect(page.getByRole('alert')).toHaveText('回答を送れませんでした。もう一度お試しください。')
  await expect(button(page, '回答する')).toBeEnabled()
  await button(page, '回答する').click()
  expect(await page.evaluate(() => (window as any).__cancelRace.calls())).toBe(2)
  await finish(page, true, 1)
  await expect(page.locator('.interaction-sheet')).toHaveCount(0)
})

test('古い質問の遅い失敗と重複取消は後続のシートを閉じない', async ({ page }) => {
  await setup(page); await send(page)
  await sync(page, ['次の質問'])
  await page.evaluate(() => (window as any).__cancelRace.open('次の質問'))
  await sync(page, ['次の質問'])
  await finish(page)
  await expect(page.getByRole('heading', { name: '次の質問', exact: true })).toBeVisible()
  await expect(page.locator('.interaction-sheet')).toHaveCount(1)
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByText('質問の要求は取り消されました', { exact: true })).toHaveCount(1)
  await send(page); await finish(page, true, 1)
  await expect(page.locator('.interaction-sheet')).toHaveCount(0)
})
