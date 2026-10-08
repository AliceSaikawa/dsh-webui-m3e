import { test, expect, visit } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.route('**/src/dsh/mock/context.ts*', async route => {
    const response = await route.fetch(), body = await response.text()
    expect(body.match(/\breturn ctx;?/g)).toHaveLength(1)
    await route.fulfill({ response, body: body.replace(/\breturn ctx;?/, 'globalThis.__routeUnread = { ctx, owner: conversationSelection(ctx.sessions), status: completionStatus(ctx) }; return ctx;') })
  })
})

test('#43 開けなかった完了未読の会話は一覧に戻っても未読のまま', async ({ page }) => {
  await visit(page)
  await page.evaluate(async () => {
    const probe = (window as any).__routeUnread
    await probe.ctx.mock.streamAssistant('readme-review', '未読の返答', { chunkMs: 0 })
    probe.ctx.mock.setSessionState('readme-review', { openState: 'error', openError: { code: 'test/open', message: '試験用の失敗', details: {} } })
    const original = console.error.bind(console)
    console.error = (...args) => {
      if (args[0] === '会話を選択できませんでした: readme-review' && args[1]?.rpcError?.code === 'test/open') return
      original(...args)
    }
    window.location.hash = '/s/readme-review'
  })
  await expect(page.getByRole('button', { name: 'もう一度開く', exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as any).__routeUnread.status.getSnapshot().byId['readme-review'].completionUnread)).toBe(true)
  await page.evaluate(() => { window.location.hash = '/' })
  await expect(page.locator('[data-session-id="readme-review"]')).toContainText('完了・未読')
})

test('#42 不明な下位画面は未読を保持し前の会話のシートを閉じる', async ({ page }) => {
  await visit(page, '/s/readme-review')
  await expect(page.getByLabel('メッセージ入力欄')).toBeEnabled()
  await page.getByLabel('入力の補助を開く', { exact: true }).click()
  await expect(page.getByRole('heading', { name: '入力の補助', exact: true })).toBeVisible()
  await page.evaluate(() => { window.location.hash = '/s/readme-review/does-not-exist' })
  await expect(page.getByRole('heading', { name: '画面が見つかりません' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '入力の補助', exact: true })).toHaveCount(0)
  await page.evaluate(async () => {
    const { ctx } = (window as any).__routeUnread
    await ctx.mock.streamAssistant('readme-review', '表示されていない返答', { chunkMs: 0 })
    window.location.hash = '/'
  })
  await expect(page.locator('[data-session-id="readme-review"]')).toContainText('完了・未読')
  await page.evaluate(() => { window.location.hash = '/s/readme-review/does-not-exist' })
  await expect(page.getByRole('heading', { name: '画面が見つかりません' })).toBeVisible()
  expect(await page.evaluate(() => {
    const p = (window as any).__routeUnread
    return { unread: p.status.getSnapshot().byId['readme-review'].completionUnread, references: p.ctx.sessions.retainInfo('readme-review').getSnapshot().retainedBy['m3e.mainView'] ?? 0 }
  })).toEqual({ unread: true, references: 0 })
})

test('#42 queryと符号化IDのページ復帰で正しい会話を再取得する', async ({ page }) => {
  await visit(page)
  await page.evaluate(() => {
    const { ctx } = (window as any).__routeUnread
    ctx.mock.addSession({ id: '会話/a?b', displayTitle: '符号化した会話', running: false, blank: false, updatedAt: 0 }, [])
    window.location.hash = '/s/' + encodeURIComponent('会話/a?b') + '?view=chat'
  })
  await expect(page.getByRole('heading', { name: '符号化した会話', exact: true })).toBeVisible()
  await expect(page.getByLabel('メッセージ入力欄')).toBeEnabled()
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
  })
  await expect.poll(() => page.evaluate(() => (window as any).__routeUnread.owner.state.getSnapshot().visibleSessionId)).toBe('会話/a?b')
  await expect(page.getByLabel('メッセージ入力欄')).toBeEnabled()
})

test('#43 子のURLの解決中は前の会話の完了を未読にする', async ({ page }) => {
  await visit(page, '/s/readme-review')
  await expect(page.getByLabel('メッセージ入力欄')).toBeEnabled()
  await page.evaluate(() => {
    const p = (window as any).__routeUnread, ctx = p.ctx
    ctx.mock.addSession({ id: 'route-child', parentId: 'readme-review', origin: 'subagent', displayTitle: '子の会話', running: false, blank: false, updatedAt: 0 }, [])
    ctx.mock.setProjection('route-child', 'subagent', { mode: 'continuable', seq: 0 })
    ctx.mock.updateList((list: any) => ({ ...list, projectionsBySession: {} }))
    ctx.sessions.refreshProjections = async () => {
      p.resolving = true
      await new Promise<void>(resolve => { p.release = resolve })
      ctx.mock.updateList((list: any) => ({ ...list, projectionsBySession: { 'readme-review': { state: 'ready', error: null, values: { subagentCatalog: [{ id: 'route-child', mode: 'continuable', label: '子の会話', createdAt: 0 }] } } } }))
    }
    window.location.hash = '/s/route-child'
  })
  await expect.poll(() => page.evaluate(() => Boolean((window as any).__routeUnread.resolving))).toBe(true)
  await page.evaluate(async () => { await (window as any).__routeUnread.ctx.mock.streamAssistant('readme-review', '移動後に完了', { chunkMs: 0 }) })
  expect(await page.evaluate(() => (window as any).__routeUnread.status.getSnapshot().byId['readme-review'].completionUnread)).toBe(true)
  await page.evaluate(() => { (window as any).__routeUnread.release() })
  await expect.poll(() => page.evaluate(() => (window as any).__routeUnread.owner.state.getSnapshot().visibleSessionId)).toBe('route-child')
})
