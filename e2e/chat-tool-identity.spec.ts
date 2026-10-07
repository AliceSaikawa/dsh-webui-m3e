import { test, expect, visit, button } from './helpers'

test('同じcall IDを再利用した二つのツール行と詳細が、それぞれの引数と結果を表示する', async ({ page }) => {
  await visit(page, '/s/chat-reused-tool-ids', 'chat-reused-tool-ids')
  const rows = page.locator('.chat-tool')
  await expect(rows).toHaveCount(2)
  for (const [index, path, result, other] of [
    [0, '最初の資料.txt', '最初の資料の結果です。', '次の資料の結果です。'],
    [1, '次の資料.txt', '次の資料の結果です。', '最初の資料の結果です。'],
  ] as const) {
    await expect(rows.nth(index)).toContainText(path)
    await rows.nth(index).click()
    const detail = page.locator('.chat-detail')
    await expect(detail).toContainText(path)
    await expect(detail).toContainText(result)
    await expect(detail).not.toContainText(other)
    await button(page, '閉じる').click()
    await expect(detail).toHaveCount(0)
  }
})
