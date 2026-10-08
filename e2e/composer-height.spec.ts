import { test, expect, visit } from './helpers'

const lines = (count: number) => Array.from({ length: count }, (_, index) => `${index + 1} 行目`).join('\n')

test('03height 空欄は44px以上で、下端のタップでも入力できる', async ({ page }) => {
  await visit(page, '/s/readme-review')
  const input = page.getByLabel('メッセージ入力欄')
  await expect.poll(async () => (await input.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  const box = (await input.boundingBox())!
  await page.mouse.click(box.x + 10, box.y + box.height - 2)
  await expect(input).toBeFocused()
})

test('03height 六行を表示し、八行と折り返す長文は六行で止まる', async ({ page }) => {
  await visit(page, '/s/readme-review')
  const input = page.getByLabel('メッセージ入力欄')
  const metrics = () => input.evaluate(node => {
    const css = getComputedStyle(node)
    return { height: node.getBoundingClientRect().height, scroll: node.scrollHeight, client: node.clientHeight,
      limit: parseFloat(css.lineHeight) * 6 + parseFloat(css.paddingTop) + parseFloat(css.paddingBottom) }
  })
  await input.fill(lines(6))
  await expect.poll(async () => { const m = await metrics(); return Math.abs(m.height - m.limit) }).toBeLessThanOrEqual(1)
  await input.fill(lines(8))
  await expect.poll(async () => { const m = await metrics(); return m.height - m.limit }).toBeLessThanOrEqual(1)
  expect((await metrics()).scroll).toBeGreaterThan((await metrics()).client)
  await input.fill('長い入力文です。'.repeat(100))
  await expect.poll(async () => { const m = await metrics(); return m.height - m.limit }).toBeLessThanOrEqual(1)
  await input.fill('')
  await expect.poll(async () => (await input.boundingBox())!.height).toBe(44)
})

test('03height 横向きでも本文を残し、低い表示領域でも操作行を切らない', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 })
  await visit(page, '/s/readme-review')
  await page.getByLabel('メッセージ入力欄').fill(lines(8))
  await expect.poll(async () => (await page.locator('.chat-scroll').boundingBox())!.height).toBeGreaterThanOrEqual(48)
  await page.setViewportSize({ width: 844, height: 222 })
  await expect.poll(() => page.locator('.composer-controls').evaluate(node => node.getBoundingClientRect().bottom - window.innerHeight)).toBeLessThanOrEqual(0)
  expect((await page.getByLabel('メッセージ入力欄').boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(async () => (await page.getByLabel('メッセージ入力欄').boundingBox())!.height).toBe(154)
})

test('03height 低い表示領域の添付画像は枠内でスクロールし、補助と送信に到達できる', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 222 })
  await visit(page, '/s/readme-review')
  await page.locator('input[type="file"]').setInputFiles({ name: '確認.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5AAAAABJRU5ErkJggg==', 'base64') })
  await expect(page.locator('.composer-images img')).toHaveCount(1)
  const send = page.getByRole('button', { name: '送信', exact: true })
  await expect(send).toBeEnabled()
  await send.scrollIntoViewIfNeeded()
  expect((await send.boundingBox())!.y + (await send.boundingBox())!.height).toBeLessThanOrEqual(222)
  await page.getByRole('button', { name: '入力の補助を開く', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '入力の補助', exact: true })).toBeVisible()
})

test('03height 低い表示領域でも実行中の停止と順番待ちを操作できる', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 222 })
  await visit(page, '/s/chat-long-streaming', 'chat-long-streaming')
  await page.getByLabel('メッセージ入力欄').fill(lines(8))
  for (const label of ['実行を停止', '順番待ち', '送り方を選ぶ']) {
    const control = page.getByRole('button', { name: label, exact: true })
    await control.scrollIntoViewIfNeeded()
    const box = (await control.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(222)
  }
  await page.getByRole('button', { name: '実行を停止', exact: true }).click()
  await expect(page.getByRole('button', { name: '送信', exact: true })).toBeVisible()
})
