import { test, expect, visit, button, nav } from './helpers'
import type { UserQuestionProjection } from '../web/src/dsh/interactions-store.ts'
import type { DshContext, InboxState, SessionWireEvent } from '../web/src/dsh/services.ts'
import type { Page } from '@playwright/test'

declare global { interface Window {
  __m3eObserveQuestions?: (read: () => unknown) => void
  __m3eReadQuestions?: () => UserQuestionProjection
  __m3eObserveQuestionRecords?: (read: () => unknown) => void
  __m3eReadQuestionRecords?: () => SessionWireEvent[]
  __m3eObserveQuestionQueue?: (read: () => unknown) => void
  __m3eReadQuestionQueue?: () => InboxState
  __timedContext?: DshContext
  __finishTimedReply?: () => void
  __timedStore?: import('../web/src/dsh/interactions-store.ts').InteractionStore
} }

async function observe(page: Page) {
  await page.addInitScript(() => {
    window.__m3eObserveQuestions = read => { window.__m3eReadQuestions = read as () => UserQuestionProjection }
    window.__m3eObserveQuestionRecords = read => { window.__m3eReadQuestionRecords = read as () => SessionWireEvent[] }
    window.__m3eObserveQuestionQueue = read => { window.__m3eReadQuestionQueue = read as () => InboxState }
  })
}
async function answerAll(page: Page) {
  await expect(page.getByRole('heading', { name: 'どちらのデータベースにしますか', exact: true })).toBeVisible()
  await page.getByText('PostgreSQL', { exact: true }).click()
  await button(page, '次へ').click()
  await page.getByText('データの移行', { exact: true }).click()
  await button(page, '回答する').click()
}
const answers = [{ id: 'database', selected: ['PostgreSQL'] }, { id: 'migration-checks', selected: ['データの移行'] }]

test('timed mockは表示中に期限を過ぎても質問を保持し、回答をtool resultへ返す', async ({ page }) => {
  await page.clock.install(); await observe(page)
  await visit(page, '/s/05-db-choice', 'question-timed')
  await expect(page.getByRole('heading', { name: 'どちらのデータベースにしますか', exact: true })).toBeVisible()
  await page.clock.runFor(2_500)
  expect(await page.evaluate(() => window.__m3eReadQuestions!().active[0]?.state)).toBe('open')
  expect(await page.evaluate(() => window.__m3eReadQuestionRecords!().filter(row => row.type === 'tool/result'))).toHaveLength(0)
  await answerAll(page)
  await expect.poll(() => page.evaluate(() => {
    const row = window.__m3eReadQuestionRecords!().find(row => row.type === 'tool/result')
    return row ? JSON.parse((row.data as any).message.content[0].text) : null
  })).toEqual({ answers })
})

for (const departure of ['あとで', '別の会話'] as const) test(`timed mockは${departure}の後に期限で続行し、同じカードからRPCで回答できる`, async ({ page }) => {
  await page.clock.install(); await observe(page)
  await visit(page, '/s/05-db-choice', 'question-timed')
  await expect(page.getByRole('heading', { name: 'どちらのデータベースにしますか', exact: true })).toBeVisible()
  if (departure === 'あとで') await button(page, 'あとで').click()
  else await page.evaluate(() => { location.hash = '#/s/readme-review' })
  await page.clock.runFor(2_500)
  await expect.poll(() => page.evaluate(() => window.__m3eReadQuestions!().active[0]?.state)).toBe('continued')
  expect(await page.evaluate(() => {
    const row = window.__m3eReadQuestionRecords!().find(row => row.type === 'tool/result')!
    return JSON.parse((row.data as any).message.content[0].text)
  })).toEqual({ pending: true, callId: '05-timed-question' })
  await page.evaluate(() => { location.hash = '#/' })
  await nav(page, '対応待ち').click()
  await page.getByRole('list', { name: '返事が必要' }).getByText('DB の選び直し', { exact: true }).click()
  await answerAll(page)
  await expect.poll(() => page.evaluate(() => window.__m3eReadQuestions!().settled)).toEqual([{ callId: '05-timed-question', answers }])
  expect(await page.evaluate(() => {
    const row = window.__m3eReadQuestionRecords!().find(row => row.type === 'user/message' && (row.data as any).source.kind === 'user-question-reply')!
    return JSON.parse((row.data as any).content[0].text).answers
  })).toEqual(answers)
})

test('timed mockの回答待機列を取り消すと同じ質問が復帰して答え直せる', async ({ page }) => {
  await page.route('**/src/dsh/interactions.ts*', async route => {
    const response = await route.fetch(), body = await response.text()
    const creation = /const store = new InteractionStore\(\);?/
    expect(body.match(new RegExp(creation.source, 'g'))).toHaveLength(1)
    await route.fulfill({ response, body: body.replace(creation, '$& globalThis.__timedStore = store;') })
  })
  await page.route('**/src/dsh/mock/context.ts*', async route => {
    const response = await route.fetch(), body = await response.text()
    expect(body.match(/\breturn ctx;?/g)).toHaveLength(1)
    await route.fulfill({ response, body: body.replace(/\breturn ctx;?/, 'globalThis.__timedContext = ctx; return ctx;') })
  })
  await page.clock.install(); await observe(page)
  await visit(page, '/s/05-db-choice', 'question-timed-queue')
  await expect(page.getByRole('heading', { name: 'どちらのデータベースにしますか', exact: true })).toBeVisible()
  await button(page, 'あとで').click(); await page.clock.runFor(2_500)
  await expect.poll(() => page.evaluate(() => window.__m3eReadQuestions!().active[0]?.state)).toBe('continued')
  await page.evaluate(() => { location.hash = '#/' }); await nav(page, '対応待ち').click()
  await page.evaluate(() => {
    const remote = window.__timedContext!.remote.userQuestions as import('../web/src/dsh/mock/questions.ts').MockUserQuestionsRemote
    const answer = remote.answer.bind(remote)
    remote.answer = async (...args) => {
      remote.answer = answer
      const result = await answer(...args)
      await new Promise<void>(resolve => { window.__finishTimedReply = resolve })
      return result
    }
  })
  await page.getByText('DB の選び直し', { exact: true }).click(); await answerAll(page)
  await page.evaluate(() => { location.hash = '#/s/05-db-choice' })
  await expect.poll(() => page.evaluate(() => window.__m3eReadQuestionQueue!()['next-step'].length)).toBe(1)
  // The existing UI lists human next-step messages only (dsh/inbox.ts).
  // Simulate a second Client cancelling this producer's reply via the same
  // controller API, without adding a new button or changing the UI selector.
  await page.evaluate(async () => {
    const ctx = window.__timedContext!
    const reference = ctx.sessions.retain('05-db-choice', { source: 'test.other-client' })
    try {
      const binding = await reference.ready
      const reply = window.__m3eReadQuestionQueue!()['next-step'][0]!
      const result = await binding.session.updateQueue(reply.id, { kind: 'remove' })
      if (!result.ok) throw new Error(result.error.message)
    } finally { reference.release() }
  })
  await expect.poll(() => page.evaluate(() => window.__m3eReadQuestionQueue!()['next-step'].length)).toBe(0)
  expect(await page.evaluate(async () => {
    const restored = window.__timedStore!.getSnapshot().find(row => row.sessionId === '05-db-choice')
    if (!restored) return false
    window.__finishTimedReply!()
    await new Promise(resolve => setTimeout(resolve, 0))
    return window.__timedStore!.getSnapshot().includes(restored)
  })).toBe(true)
  await page.evaluate(() => { location.hash = '#/' }); await nav(page, '対応待ち').click()
  await page.getByRole('list', { name: '返事が必要' }).getByText('DB の選び直し', { exact: true }).click()
  await answerAll(page)
  await expect.poll(() => page.evaluate(() => window.__m3eReadQuestionQueue!()['next-step'].length)).toBe(1)
  expect(await page.evaluate(() => window.__m3eReadQuestions!())).toMatchObject({ active: [{ callId: '05-timed-question', state: 'continued' }], settled: [] })
  expect(await page.evaluate(() => window.__m3eReadQuestionRecords!().filter(row => row.type === 'user/message' && (row.data as any).source.kind === 'user-question-reply'))).toHaveLength(0)
})

test('期限後の質問を既存の対応待ちの行で開き、全問に回答する', async ({ page }) => {
  await page.addInitScript(() => { window.__m3eObserveQuestions = read => { window.__m3eReadQuestions = read as () => UserQuestionProjection } })
  await visit(page, '/s/05-db-choice', 'question-continued')
  await expect(page.getByRole('heading', { name: 'どちらのデータベースにしますか', exact: true })).toBeVisible()
  await button(page, 'あとで').click()
  await button(page, '戻る').last().click()
  await nav(page, '対応待ち').click()
  await page.getByText('DB の選び直し', { exact: true }).click()
  await expect(page.getByRole('heading', { name: 'どちらのデータベースにしますか', exact: true })).toBeVisible()
  await page.getByText('PostgreSQL', { exact: true }).click()
  await button(page, '次へ').click()
  await page.getByText('データの移行', { exact: true }).click()
  await button(page, '回答する').click()
  await expect.poll(() => page.evaluate(() => window.__m3eReadQuestions!())).toEqual({ active: [], settled: [{
    callId: '05-timed-question', answers: [
      { id: 'database', selected: ['PostgreSQL'] }, { id: 'migration-checks', selected: ['データの移行'] },
    ],
  }] })
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByText('DB の選び直し', { exact: true })).toHaveCount(0)
})
