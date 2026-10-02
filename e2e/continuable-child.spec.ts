import { test, expect, visit, shot, button } from './helpers'

test('09 continuableの子に追記し、one-shotの子は読むだけにする', async ({ page }) => {
  await visit(page, '/s/session-tools-review')
  const input = page.getByLabel('メッセージ入力欄', { exact: true })
  await expect(page.getByRole('heading', { name: '承認シートの見直し', exact: true })).toBeVisible()
  await shot(page, '09-continuable-before-send')
  await expect(input).toBeVisible()
  await input.fill('子の会話への追加依頼を確認してください')
  await button(page, '順番待ち').click()
  await expect(input).toHaveValue('')
  await expect(button(page, '順番待ち 1 件')).toBeVisible()
  await shot(page, '09-continuable-queued')
  await page.getByRole('tab', { name: 'トレース', exact: true }).click()
  await expect(input).toHaveCount(0)
  await page.getByRole('tab', { name: 'チャット', exact: true }).click()
  await expect(button(page, '順番待ち 1 件')).toBeVisible()
  await visit(page, '/s/session-tools-tests')
  await expect(page.getByLabel('メッセージ入力欄', { exact: true })).toHaveCount(0)
  await expect(page.getByText('このサブエージェントの会話は読むだけです。', { exact: true })).toBeVisible()
  await shot(page, '09-one-shot-readonly')
})

test('09 continuableの子でも切断中の下書きを保ち、再接続後に一度だけ送る', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await visit(page, '/s/session-tools-review', 'disconnected')
  const input = page.getByLabel('メッセージ入力欄', { exact: true })
  const text = '再接続後に子の会話へ追加する依頼'
  await input.fill(text)
  await expect(button(page, '順番待ち')).toBeDisabled()
  await shot(page, '09-child-disconnected-draft')
  await button(page, '再接続').click()
  await expect(button(page, '順番待ち')).toBeEnabled()
  await expect(input).toHaveValue(text)
  await button(page, '順番待ち').click()
  await expect(input).toHaveValue('')
  await button(page, '順番待ち 1 件').click()
  await expect(page.getByText(text, { exact: true })).toHaveCount(1)
  await shot(page, '09-child-reconnected-queue')
})

test('09 continuableの子の実行へ割り込み、停止後も追記できる', async ({ page }) => {
  await visit(page, '/s/session-tools-review')
  const input = page.getByLabel('メッセージ入力欄', { exact: true })
  const text = '子の実行への割り込みを確認する'
  await input.fill(text)
  await button(page, '送り方を選ぶ').click()
  await button(page, '割り込み').click()
  await expect(input).toHaveValue('')
  await button(page, '実行を停止').click()
  await expect(button(page, '送信')).toBeVisible()
  await expect(page.getByLabel('自分のメッセージ', { exact: true }).filter({ hasText: text })).toHaveCount(1)
  await expect(page).toHaveURL(/#\/s\/session-tools-review$/)
  await input.fill('停止後の下書き')
  await expect(button(page, '送信')).toBeEnabled()
  await shot(page, '09-child-interrupted-stopped')
})

test('09 子のSDKが別の送信IDを使っても、受信済みの発言が送信中として残らない', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as Window & { __m3eTestChildRequestIdMismatch?: boolean }).__m3eTestChildRequestIdMismatch = true
  })
  await visit(page, '/s/session-tools-review')
  await button(page, '実行を停止').click()
  await expect(button(page, '送信')).toBeVisible()
  const text = '子の追加依頼は一度だけ表示する'
  await page.getByLabel('メッセージ入力欄', { exact: true }).fill(text)
  await button(page, '送信').click()
  await expect(page.getByLabel('自分のメッセージ', { exact: true }).filter({ hasText: text })).toHaveCount(1)
  await shot(page, '09-child-wire-id-after-accepted')
  await expect(page.getByLabel('送信中のメッセージ', { exact: true })).toHaveCount(0)
  await expect(page.getByText(text, { exact: true })).toHaveCount(1)
})

test('09 子の送信待ちで会話を切り替えても、二重送信せず別の下書きを保つ', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.addInitScript(() => {
    const state = window as Window & {
      __m3eTestChildRequestIdMismatch?: boolean
      __m3eTestChildPromptGate?: Promise<void>
      __m3eTestReleaseChildPrompt?: () => void
    }
    state.__m3eTestChildRequestIdMismatch = true
    state.__m3eTestChildPromptGate = new Promise(resolve => { state.__m3eTestReleaseChildPrompt = resolve })
  })
  await visit(page, '/s/session-tools-review')
  await button(page, '実行を停止').click()
  const text = '送信待ちの子だけに届ける依頼'
  await page.getByLabel('メッセージ入力欄', { exact: true }).fill(text)
  await button(page, '送信').dblclick()
  await expect(button(page, '送信中')).toBeDisabled()
  await expect(page.getByLabel('メッセージ入力欄', { exact: true })).toBeDisabled()
  await shot(page, '09-child-pending-send')
  await page.evaluate(() => { window.location.hash = '/s/readme-review' })
  const other = page.getByLabel('メッセージ入力欄', { exact: true })
  await expect(other).toBeEnabled()
  await other.fill('別の会話に残す下書き')
  await page.evaluate(() => {
    ;(window as Window & { __m3eTestReleaseChildPrompt?: () => void }).__m3eTestReleaseChildPrompt?.()
  })
  await expect(other).toHaveValue('別の会話に残す下書き')
  await expect(page).toHaveURL(/#\/s\/readme-review$/)
  await shot(page, '09-child-delivered-other-draft')
  await page.evaluate(() => { window.location.hash = '/s/session-tools-review' })
  await expect(page.getByLabel('メッセージ入力欄', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('自分のメッセージ', { exact: true }).filter({ hasText: text })).toHaveCount(1)
  await expect(page.getByLabel('送信中のメッセージ', { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => (window as Window & { __m3eTestChildPromptCalls?: number }).__m3eTestChildPromptCalls)).toBe(1)
  await shot(page, '09-child-switch-return')
})
