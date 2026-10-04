import { test, expect, button, openM3e } from './fixtures.ts'

test('S6A 実DSHで送信直後から確定まで自分の発言が毎描画一件以内になる', async ({ page, integration }, info) => {
  await openM3e(page, integration.host)
  if (await page.getByRole('heading', { name: 'ワークスペースがありません' }).isVisible()) {
    await button(page, 'ワークスペースを追加').click()
    await button(page, 'ここを追加').click()
  }
  await button(page, '新しいセッション').click()
  await page.getByLabel('メッセージ入力欄').fill('重複確認の準備')
  await button(page, '送信').click()
  await expect(page.getByText('こんにちは。偽のモデルです。')).toBeVisible()
  await expect(button(page, '実行を停止')).toHaveCount(0)
  const text = '送信中と確定の重なりを確認'
  await page.evaluate(text => {
    const samples: { phase: string; count: number; pending: number }[] = []
    let stopped = false
    const sample = (phase: string) => {
      const rows = [...document.querySelectorAll('.chat-user')].filter(row => row.textContent?.includes(text))
      samples.push({ phase, count: rows.length, pending: rows.filter(row => row.classList.contains('chat-pending')).length })
    }
    const frame = () => { if (!stopped) { sample('frame'); requestAnimationFrame(frame) } }
    const observer = new MutationObserver(() => sample('commit'))
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
    requestAnimationFrame(frame)
    Object.assign(window, { __submissionSamples: () => { stopped = true; observer.disconnect(); sample('final'); return samples } })
  }, text)
  await page.getByLabel('メッセージ入力欄').fill(text)
  await button(page, '送信').click()
  await expect(page.locator('.chat-user:not(.chat-pending)').filter({ hasText: text })).toHaveCount(1)
  await expect(page.locator('.chat-pending').filter({ hasText: text })).toHaveCount(0)
  await expect(button(page, '実行を停止')).toHaveCount(0)
  const samples = await page.evaluate(() => (window as unknown as { __submissionSamples(): { phase: string; count: number; pending: number }[] }).__submissionSamples())
  await info.attach('submission-render-counts', { body: JSON.stringify(samples), contentType: 'application/json' })
  expect(samples.some(sample => sample.phase === 'frame' && sample.count === 1)).toBe(true)
  expect(samples.some(sample => sample.pending === 1)).toBe(true)
  expect(samples.filter(sample => sample.count > 1)).toEqual([])
})
