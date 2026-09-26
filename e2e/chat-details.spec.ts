import { test, expect, visit, shot, button } from './helpers'

test('02c 画像拡大・長いツール結果の全文表示', async ({ page }) => {
  await visit(page, '/s/chat-samples')
  await expect(page.getByText('確認事項.txt', { exact: true })).toBeVisible()
  await page.locator('.chat-tool').click()
  await expect(button(page, '続きを表示')).toBeVisible()
  await shot(page, '02-long-result-preview')
  await button(page, '続きを表示').click()
  await expect(page.locator('.chat-detail')).toContainText('210 行目の確認結果')
  await expect(page.locator('.chat-detail')).toContainText('入れ子の最後の結果です。')
  await page.getByRole('button', { name: '手順の画像.pngを全画面で表示', exact: true }).click()
  await expect(page.getByRole('dialog', { name: '画像の表示' })).toBeVisible()
  await expect(page.locator('.chat-image-full img')).toBeVisible()
  await shot(page, '02-image-full')
  await button(page, '閉じる').click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('02d 古いチャット履歴を2ページ読み込み末尾へ戻る', async ({ page }) => {
  await visit(page, '/s/chat-long')
  await expect(page.locator('.chat-user')).toHaveCount(25)
  // Scrolling to the top loads a page automatically. A click after Playwright
  // scrolls the button into view would trigger a second page unintentionally.
  await page.locator('.chat-scroll').evaluate(node => { node.scrollTop = 0 })
  await expect(page.locator('.chat-user')).toHaveCount(50)
  await page.locator('.chat-scroll').evaluate(node => { node.scrollTop = 0 })
  await expect(page.locator('.chat-user')).toHaveCount(75)
  await expect(button(page, '前のメッセージを読み込む')).toHaveCount(0)
  await expect(page.locator('.chat-user').first()).toContainText('1 回目の確認をお願いします。')
  await shot(page, '02-older-history')
  await button(page, '最新へ').click()
  await expect.poll(() => page.locator('.chat-scroll').evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThan(3)
})

test('02e 生成中の過去閲覧位置をタブ往復後も保つ', async ({ page }) => {
  await visit(page, '/s/chat-long-streaming', 'chat-long-streaming')
  const chat = page.locator('.chat-scroll')
  await expect(page.locator('.chat-assistant[aria-busy="true"]')).toBeVisible()
  await chat.hover()
  await page.mouse.wheel(0, -600)
  await chat.evaluate(node => { node.scrollTop = 420; node.dispatchEvent(new Event('scroll')) })
  await expect(button(page, '最新へ')).toBeVisible()
  const streaming = await page.locator('.chat-assistant[aria-busy="true"]').textContent()
  await page.getByRole('tab', { name: 'トレース', exact: true }).click()
  // Wait for real streaming progress, without modifying application state.
  await expect(page.locator('.chat-assistant[aria-busy="true"]')).not.toHaveText(streaming ?? '')
  await page.getByRole('tab', { name: 'チャット', exact: true }).click()
  await expect.poll(() => chat.evaluate(node => node.scrollTop)).toBeCloseTo(420, 0)
  await shot(page, '02-streaming-restored')
  await button(page, '最新へ').click()
  await expect.poll(() => chat.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThan(4)
})

test('02f 処理エラーの表示', async ({ page }) => {
  await visit(page, '/s/chat-error', 'chat-error')
  await expect(page.getByText('AI の処理が止まりました', { exact: true })).toBeVisible()
  await expect(page.getByLabel('メッセージ入力欄')).toBeVisible()
  await shot(page, '02-agent-error')
})

test('02g 読込エラーから再読込・一覧への復帰', async ({ page }) => {
  await visit(page, '/s/chat-open-error', 'open-error')
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByLabel('メッセージ入力欄')).toHaveCount(0)
  await shot(page, '02-open-error')
  await button(page, '読み直す').click()
  await expect(page.getByRole('alert')).toBeVisible()
  await button(page, '一覧に戻る').click()
  await expect(page).toHaveURL(/#\/$/)
})

test('04b トレース検索消去で末尾へ戻る', async ({ page }, info) => {
  await visit(page, '/s/trace-example/trace')
  await shot(page, '04-example')
  await page.getByLabel('記録を検索').fill('要約')
  await expect(page.locator('[data-trace-row]')).toHaveCount(2)
  await shot(page, '04-compaction')
  await page.getByLabel('記録を検索').fill('')
  await expect(page.getByLabel('記録を検索')).toHaveValue('')
  await shot(page, '04-cleared-search')
  await info.attach('scroll-after-clear', { body: JSON.stringify(await page.locator('.trace-scroll').evaluate(node => ({ top: node.scrollTop, height: node.scrollHeight, viewport: node.clientHeight }))), contentType: 'application/json' })
  await expect.poll(() => page.locator('.trace-scroll').evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThan(4)
})

test('04c トレースの失敗・未確定の試行', async ({ page }) => {
  await visit(page, '/s/trace-failure-example/trace')
  await expect(page.getByText(/未確定の試行 1 回/)).toBeVisible()
  await shot(page, '04-failure')
})

test('04d 長いトレースを初めて開いたとき末尾を表示する', async ({ page }) => {
  await visit(page, '/s/chat-long/trace')
  const trace = page.locator('.trace-scroll')
  await expect.poll(() => trace.evaluate(node => node.scrollHeight - node.clientHeight)).toBeGreaterThan(500)
  await shot(page, '04-long-trace-initial')
  await expect.poll(() => trace.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop)).toBeLessThan(4)
})
