import { test, expect, visit } from './helpers'

test('FR2 選択Aの例外をIDと元の例外つきで1回記録し、外へ投げずBへ移れる', async ({ page }) => {
  await page.route('**/src/dsh/mock/context.ts*', async route => {
    const response = await route.fetch(), body = await response.text()
    expect(body.match(/\breturn ctx;?/g)).toHaveLength(1)
    await route.fulfill({ response, body: body.replace(/\breturn ctx;?/, 'globalThis.__selectionReview = ctx; return ctx;') })
  })
  await visit(page)
  await page.evaluate(() => {
    const state = window as any, ctx = state.__selectionReview
    state.__selectionFailure = new Error('injected selection failure')
    state.__selectionDiagnostics = []
    const originalError = console.error.bind(console)
    console.error = (...args) => {
      // Suppress only the deliberately injected diagnostic; the fixture still
      // rejects every other console error and every unhandled exception.
      if (args[1] === state.__selectionFailure) state.__selectionDiagnostics.push(args)
      else originalError(...args)
    }
    const retain = ctx.sessions.retain.bind(ctx.sessions)
    ctx.sessions.retain = (target: any, options: any) => {
      if (target === 'readme-review' && options.source === 'm3e.mainView') throw state.__selectionFailure
      return retain(target, options)
    }
    window.location.hash = '/s/readme-review'
  })
  await expect(page.getByRole('button', { name: 'もう一度開く', exact: true })).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as any).__selectionDiagnostics.length)).toBe(1)
  expect(await page.evaluate(() => {
    const state = window as any, calls = state.__selectionDiagnostics
    return calls.map((args: any[]) => ({ message: args[0], sameError: args[1] === state.__selectionFailure, arguments: args.length }))
  })).toEqual([{ message: '会話を選択できませんでした: readme-review', sameError: true, arguments: 2 }])
  // The same snackbar already exists in 413a857:app/use-conversation-selection.ts.
  await expect(page.locator('m3e-snackbar')).toContainText('会話を開けませんでした。もう一度お試しください。')
  await page.evaluate(() => { window.location.hash = '/s/approval-sheet' })
  await expect(page.getByRole('heading', { name: '承認シートの実装', exact: true })).toBeVisible()
  await expect(page.getByLabel('メッセージ入力欄')).toBeEnabled()
  expect(await page.evaluate(() => (window as any).__selectionDiagnostics.length)).toBe(1)
})
