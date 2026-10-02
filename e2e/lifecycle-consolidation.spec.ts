import { test, expect, visit, button, shot } from './helpers'

for (const width of [375, 390]) {
  test(`03 ${width}px 新規送信中の作成済み会話へ繰り返し戻っても入力と送信を共有する`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 844 })
    await page.addInitScript(() => {
      const state = window as Window & { __m3eTestSelectModelGate?: Promise<void>; __m3eTestReleaseSelectModel?: () => void }
      state.__m3eTestSelectModelGate = new Promise(resolve => { state.__m3eTestReleaseSelectModel = resolve })
    })
    await visit(page, '/new?ws=ws-m3e')
    await button(page, '入力の補助を開く').click()
    await page.locator('m3e-bottom-sheet[aria-label="入力の補助"] m3e-select[aria-label="モデル"]').click()
    await page.locator('m3e-option').filter({ hasText: 'ローカル / ローカル（ollama）' }).last().click()
    await page.keyboard.press('Escape')
    const text = `新規から同じ会話へ一度だけ ${width}`
    await page.getByLabel('メッセージ入力欄', { exact: true }).fill(text)
    await button(page, '送信').click()
    await expect.poll(() => page.evaluate(() => (window as Window & { __m3eTestSelectModelSessionId?: string }).__m3eTestSelectModelSessionId)).toBeTruthy()
    const id = await page.evaluate(() => (window as Window & { __m3eTestSelectModelSessionId?: string }).__m3eTestSelectModelSessionId!)
    for (let attempt = 0; attempt < 3; attempt++) {
      await button(page, '戻る').click()
      await page.locator(`.home-session[data-session-id="${id}"] .home-session-button`).click()
      const input = page.getByLabel('メッセージ入力欄', { exact: true })
      await expect(input).toHaveValue(text)
      if (attempt === 0) await shot(page, `03-created-pending-${width}`)
      await expect(input).toBeDisabled()
      await expect(button(page, '送信中')).toBeDisabled()
    }
    await page.evaluate(() => { (window as Window & { __m3eTestReleaseSelectModel?: () => void }).__m3eTestReleaseSelectModel?.() })
    await expect(page.getByLabel('メッセージ入力欄', { exact: true })).toHaveValue('')
    await expect(page.getByLabel('自分のメッセージ', { exact: true }).filter({ hasText: text })).toHaveCount(1)
  })

  test(`03 ${width}px 結果情報の保存容量不足でも編集した本文と別会話を再読込で保つ`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 844 })
    await page.addInitScript(() => {
      const state = window as Window & { __m3eTestChildLoseResponseOnce?: boolean }
      state.__m3eTestChildLoseResponseOnce = true
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = function(key, value) {
        if (key.endsWith(':deliveryOutcome')) throw new DOMException('synthetic metadata quota exceeded', 'QuotaExceededError')
        original.call(this, key, value)
      }
    })
    await visit(page, '/s/readme-review')
    await page.getByLabel('メッセージ入力欄', { exact: true }).fill(`別の会話の本文 ${width}`)
    await page.evaluate(() => { window.location.hash = '/s/session-tools-review' })
    await button(page, '実行を停止').click()
    const input = page.getByLabel('メッセージ入力欄', { exact: true })
    await input.fill('編集する前の合成下書き')
    await button(page, '送信').click()
    await expect(page.getByRole('alert')).toContainText('送信結果が不明です')
    await input.fill(`保存できる編集後の本文 ${width}`)
    await page.reload()
    await expect(input).toBeVisible()
    await shot(page, `03-partial-storage-reloaded-${width}`)
    await expect(input).toHaveValue(`保存できる編集後の本文 ${width}`)
    await page.evaluate(() => { window.location.hash = '/s/readme-review' })
    await expect(input).toHaveValue(`別の会話の本文 ${width}`)
  })

  test(`09 ${width}px 送信を保留して会話を反復しても別会話の入力とフォーカスを守る`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 844 })
    await page.addInitScript(() => {
      const state = window as Window & { __m3eTestChildPromptGate?: Promise<void>; __m3eTestReleaseChildPrompt?: () => void }
      state.__m3eTestChildPromptGate = new Promise(resolve => { state.__m3eTestReleaseChildPrompt = resolve })
    })
    await visit(page, '/s/session-tools-review')
    await button(page, '実行を停止').click()
    const input = page.getByLabel('メッセージ入力欄', { exact: true })
    const text = `反復しても子に一件 ${width}`
    await input.fill(text)
    await button(page, '送信').dblclick()
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.evaluate(() => { window.location.hash = '/s/session-tools-tests' })
      await expect(input).toHaveCount(0)
      await page.evaluate(() => { window.location.hash = '/s/readme-review' })
      await input.fill(`別の下書き ${width}`)
      await page.evaluate(() => { window.location.hash = '/s/session-tools-review' })
      await expect(input).toBeDisabled()
      await expect(input).toHaveValue(text)
    }
    await page.evaluate(() => { window.location.hash = '/s/readme-review' })
    await expect(input).toHaveValue(`別の下書き ${width}`)
    await input.focus()
    await page.evaluate(() => { (window as Window & { __m3eTestReleaseChildPrompt?: () => void }).__m3eTestReleaseChildPrompt?.() })
    await expect(input).toBeFocused()
    await expect(input).toHaveValue(`別の下書き ${width}`)
    await page.evaluate(() => { window.location.hash = '/s/session-tools-review' })
    await expect(input).toHaveValue('')
    await expect(page.getByLabel('自分のメッセージ', { exact: true }).filter({ hasText: text })).toHaveCount(1)
    expect(await page.evaluate(() => (window as Window & { __m3eTestChildPromptCalls?: number }).__m3eTestChildPromptCalls)).toBe(1)
  })

  test(`03 ${width}px キーボードで再送した後は同じ会話の入力へ戻る`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 844 })
    await page.addInitScript(() => { (window as Window & { __m3eTestChildLoseResponseOnce?: boolean }).__m3eTestChildLoseResponseOnce = true })
    await visit(page, '/s/session-tools-review')
    await button(page, '実行を停止').click()
    const input = page.getByLabel('メッセージ入力欄', { exact: true })
    await input.fill(`キーボードで再送する依頼 ${width}`)
    await button(page, '送信').click()
    const retry = page.getByRole('alert').getByRole('button', { name: 'もう一度送る', exact: true })
    await expect(retry).toBeEnabled()
    await retry.focus()
    await page.keyboard.press('Enter')
    await expect(input).toHaveValue('')
    await expect(page.getByRole('alert')).toHaveCount(0)
    await shot(page, `03-keyboard-retry-completed-${width}`)
    await expect(input).toBeFocused()
  })

  test(`03 ${width}px キーボード再送中の会話切替で別の入力からフォーカスを奪わない`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 844 })
    await page.addInitScript(() => { (window as Window & { __m3eTestChildLoseResponseOnce?: boolean }).__m3eTestChildLoseResponseOnce = true })
    await visit(page, '/s/session-tools-review')
    await button(page, '実行を停止').click()
    const input = page.getByLabel('メッセージ入力欄', { exact: true })
    await input.fill(`再送中に会話を切り替える依頼 ${width}`)
    await button(page, '送信').click()
    await page.evaluate(() => {
      const state = window as Window & { __m3eTestChildPromptGate?: Promise<void>; __m3eTestReleaseChildPrompt?: () => void }
      state.__m3eTestChildPromptGate = new Promise(resolve => { state.__m3eTestReleaseChildPrompt = resolve })
    })
    const retry = page.getByRole('alert').getByRole('button', { name: 'もう一度送る', exact: true })
    await retry.focus()
    await page.keyboard.press('Enter')
    await expect(input).toBeDisabled()
    await page.evaluate(() => { window.location.hash = '/s/readme-review' })
    await input.fill(`フォーカスを保つ別の下書き ${width}`)
    await expect(input).toBeFocused()
    await page.evaluate(() => { (window as Window & { __m3eTestReleaseChildPrompt?: () => void }).__m3eTestReleaseChildPrompt?.() })
    await expect(input).toBeFocused()
    await expect(input).toHaveValue(`フォーカスを保つ別の下書き ${width}`)
    await page.evaluate(() => { window.location.hash = '/s/session-tools-review' })
    await expect(input).toHaveValue('')
  })
}
