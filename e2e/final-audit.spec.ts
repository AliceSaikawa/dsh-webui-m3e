import { test, expect, visit, button } from './helpers'
import type { Page } from '@playwright/test'

async function expose(page: Page) {
  await page.route('**/src/dsh/mock/context.ts*', async route => {
    const response = await route.fetch(), body = await response.text()
    expect(body.match(/\breturn ctx;?/g)).toHaveLength(1)
    await route.fulfill({ response, body: body.replace(/\breturn ctx;?/, `
      globalThis.__finalAudit = ctx;
      globalThis.__jobWatches = {};
      const originalList = ctx.remote.job.list.bind(ctx.remote.job);
      ctx.remote.job.list = (request, signal) => {
        const id = request.sessionId;
        globalThis.__jobWatches[id] = (globalThis.__jobWatches[id] ?? 0) + 1;
        const stream = originalList(request, signal);
        let disposed = false;
        const close = () => { if (disposed) return; disposed = true; globalThis.__jobWatches[id]--; stream.dispose(); };
        signal?.addEventListener('abort', close, { once: true });
        return { ...stream, dispose: close };
      };
      return ctx;`) })
  })
  await visit(page, '/s/approval-sheet')
  await expect(page.getByLabel('メッセージ入力欄')).toBeEnabled()
}

test('J3 ジョブ画面の反復開閉と会話切替で購読を解放し、閉じた一覧を更新しない', async ({ page }) => {
  await expose(page)
  await expect.poll(() => page.evaluate(() => (window as any).__jobWatches['approval-sheet'])).toBe(1)
  for (let cycle = 0; cycle < 3; cycle++) {
    await page.evaluate(() => { window.location.hash = '/s/approval-sheet/jobs' })
    await expect(page.getByRole('heading', { name: 'ジョブ', exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => (window as any).__jobWatches['approval-sheet'])).toBe(1)
    await page.evaluate(() => { window.location.hash = '/s/approval-sheet' })
    await expect(page.getByLabel('メッセージ入力欄')).toBeEnabled()
    // The conversation menu owns one legitimate watch; the closed jobs screen
    // must release its own watch instead of accumulating another one.
    await expect.poll(() => page.evaluate(() => (window as any).__jobWatches['approval-sheet'])).toBe(1)
    await page.evaluate(() => { window.location.hash = '/' })
    await expect.poll(() => page.evaluate(() => (window as any).__jobWatches['approval-sheet'])).toBe(0)
    await page.evaluate(() => (window as any).__finalAudit.mock.setJobs('approval-sheet', [{
      id: 'late', kind: 'bash', label: '閉じた会話の更新', status: 'running', startedAt: 1000, output: { total: 0, earliest: 0 },
    }]))
    await expect(page.getByText('閉じた会話の更新', { exact: true })).toHaveCount(0)
  }
  await page.evaluate(() => { window.location.hash = '/s/approval-sheet/jobs' })
  await expect(page.getByRole('heading', { name: 'ジョブ', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).__jobWatches['approval-sheet'])).toBe(1)
  await page.evaluate(() => { window.location.hash = '/s/readme-review/jobs' })
  await expect.poll(() => page.evaluate(() => (window as any).__jobWatches['approval-sheet'])).toBe(0)
  await expect.poll(() => page.evaluate(() => (window as any).__jobWatches['readme-review'])).toBe(1)
  await page.evaluate(() => { window.location.hash = '/' })
  await expect.poll(() => page.evaluate(() => (window as any).__jobWatches)).toEqual({ 'approval-sheet': 0, 'readme-review': 0 })
})

test('J4 ジョブの行は実行中を先に各群で新しい順に並び、状態更新でも並べ直す', async ({ page }) => {
  await expose(page)
  await page.evaluate(() => {
    const state = window as any
    state.__orderedJobs = [
      { id: 'complete', label: '完了した新しいジョブ', status: 'completed', startedAt: 4000, finishedAt: 5000 },
      { id: 'running-old', label: '実行中の古いジョブ', status: 'running', startedAt: 1000 },
      { id: 'failed', label: '失敗した古いジョブ', status: 'failed', startedAt: 500, finishedAt: 600 },
      { id: 'running-new', label: '実行中の新しいジョブ', status: 'running', startedAt: 2000 },
    ].map(job => ({ ...job, kind: 'bash', output: { total: 0, earliest: 0 } }))
    state.__finalAudit.mock.setJobs('approval-sheet', state.__orderedJobs)
    window.location.hash = '/s/approval-sheet/jobs'
  })
  const rows = page.getByRole('list', { name: 'ジョブの一覧' }).locator('.st-title')
  await expect(rows).toHaveText(['実行中の新しいジョブ', '実行中の古いジョブ', '完了した新しいジョブ', '失敗した古いジョブ'])
  await page.evaluate(() => {
    const state = window as any
    state.__finalAudit.mock.setJobs('approval-sheet', state.__orderedJobs.map((job: any) => job.id === 'running-new' ? { ...job, status: 'completed', finishedAt: 6000 } : job))
  })
  await expect(rows).toHaveText(['実行中の古いジョブ', '実行中の新しいジョブ', '完了した新しいジョブ', '失敗した古いジョブ'])
})

test('G4 ラウンド上限の一つ手前・ちょうど・一つ上で再開の表示とRPCを区別する', async ({ page }) => {
  await expose(page)
  for (const rounds of [7, 8, 9]) {
    await page.evaluate(async rounds => {
      const state = window as any, ctx = state.__finalAudit, id = 'approval-sheet'
      const api = ctx.remote.goals
      const current = await api.get(id)
      if (!current.ok || !current.value) throw new Error('ゴールの準備に失敗')
      if (current.value.phase === 'active') await api.pause(id, { id: current.value.id, revision: current.value.revision })
      const paused = await api.get(id)
      const goal = { ...paused.value, phase: 'paused', activation: 'disarmed', roundsStarted: rounds, maxGoalRounds: 8 }
      state.__goalResumeCalls = []
      api.get = async () => ({ ok: true, value: goal })
      api.resume = async (...args: any[]) => { state.__goalResumeCalls.push(args); return { ok: true, value: { ...goal, phase: 'active', activation: 'armed' } } }
      const { roundsStarted, activation, ...snapshot } = goal
      ctx.mock.setProjection(id, 'goal', { goal: snapshot, roundsStarted })
      window.location.hash = '/s/approval-sheet/goal'
    }, rounds)
    await expect(page.locator('.st-goal-status')).toContainText(`${rounds} / 8 ラウンド`)
    // Complete becomes enabled only after the activation read settles.
    await expect(button(page, '完了にする')).toBeEnabled()
    const reason = page.getByText('ラウンド数の上限に達したため、再開できません。', { exact: true })
    if (rounds < 8) {
      await expect(button(page, '再開')).toBeEnabled()
      await expect(reason).toHaveCount(0)
      await button(page, '再開').click()
      await expect.poll(() => page.evaluate(() => (window as any).__goalResumeCalls.length)).toBe(1)
      expect(await page.evaluate(() => (window as any).__goalResumeCalls[0][0])).toBe('approval-sheet')
    } else {
      await expect(button(page, '再開')).toBeDisabled()
      await expect(reason).toBeVisible()
      // A real pointer attempt on the disabled host must not reach the RPC.
      const bounds = await button(page, '再開').boundingBox()
      expect(bounds).not.toBeNull()
      await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2)
      expect(await page.evaluate(() => (window as any).__goalResumeCalls)).toEqual([])
    }
    await page.evaluate(() => { window.location.hash = '/s/approval-sheet' })
    await expect(page.getByLabel('メッセージ入力欄')).toBeEnabled()
  }
})

for (const [id, code, message] of [
  ['E3', 'session/writer-held', 'この会話はほかの処理が操作中です。処理が終わってから、もう一度お試しください。'],
  ['E4', 'session/attachment-invalid', '添付ファイルを送れません。内容やサイズを確認してください。'],
] as const) test(`${id} ${code} の送信拒否で理由と次の操作を案内し本文と画像を保つ`, async ({ page }) => {
  await expose(page)
  await page.evaluate(code => {
    const ctx = (window as any).__finalAudit
    ctx.mock.setSessionState('approval-sheet', { running: false })
    ctx.sessions.binding('approval-sheet').session.prompt = async () => {
      throw Object.assign(new Error('injected controller failure'), { rpcError: { code, message: 'English diagnostic', details: {} } })
    }
  }, code)
  await page.getByLabel('メッセージ入力欄').fill('失敗しても保持する本文')
  await page.locator('input[type="file"]').setInputFiles({ name: '保持する画像.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=', 'base64') })
  await expect(page.locator('.composer-images img')).toHaveCount(1)
  await button(page, '送信').click()
  await expect(page.locator('.composer-error[role="alert"] p')).toHaveText(message)
  await expect(page.getByLabel('メッセージ入力欄')).toHaveValue('失敗しても保持する本文')
  await expect(page.locator('.composer-images img')).toHaveAttribute('alt', '保持する画像.png')
  await expect(button(page, 'もう一度送る')).toBeEnabled()
})
