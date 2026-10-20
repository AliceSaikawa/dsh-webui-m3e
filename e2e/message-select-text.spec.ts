import { test, expect, visit, button } from './helpers'
import type { Page } from '@playwright/test'

const message = (page: Page) => page.locator('.chat-assistant .chat-message-action').first()

async function holdMessage(page: Page) {
  const bounds = await message(page).boundingBox()
  expect(bounds).not.toBeNull()
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + 10)
  await page.mouse.down()
  return bounds!
}

test('02s 長押しのシートから「テキストを選択」を開き、元の文字の一部を選べる', async ({ page }) => {
  await visit(page, '/s/readme-review')
  await holdMessage(page)
  // Existing actions stay, the new one is added.
  await expect(button(page, 'コピー')).toBeVisible()
  await expect(button(page, 'ここから分岐')).toBeVisible()
  await expect(button(page, 'テキストを選択')).toBeVisible()
  await page.mouse.up()
  const source = await message(page).evaluate(element => (element.querySelector('p') as HTMLElement).innerText)
  await button(page, 'テキストを選択').click()

  const body = page.getByTestId('chat-select-text')
  await expect(body).toBeVisible()
  await expect(page.getByRole('heading', { name: 'テキストを選択' })).toBeVisible()
  // The actions sheet is replaced, not stacked.
  await expect(button(page, 'ここから分岐')).toBeHidden()
  const style = await body.evaluate(element => {
    const computed = getComputedStyle(element)
    return { userSelect: computed.userSelect || computed.webkitUserSelect, callout: computed.getPropertyValue('-webkit-touch-callout') }
  })
  expect(style.userSelect).toBe('text')
  // The shown text is the source of the message, not a re-rendering of it.
  expect((await body.innerText()).replace(/\s+/g, ' ')).toContain(source.replace(/\s+/g, ' ').slice(0, 20))

  // A partial range selects with the browser's own selection, and the sheet does not swallow it.
  const selected = await body.evaluate(element => {
    const node = element.firstChild as Text
    const range = document.createRange()
    range.setStart(node, 2)
    range.setEnd(node, 7)
    const selection = getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    return { selected: selection.toString(), expected: node.data.slice(2, 7) }
  })
  expect(selected.selected).toBe(selected.expected)
  expect(selected.selected).toHaveLength(5)

  await button(page, '閉じる').click()
  await expect(body).toBeHidden()
  await expect(message(page)).toBeVisible()
})

test('02t 10px を超えて動かした長押しは、今までどおりシートを開かない', async ({ page }) => {
  await visit(page, '/s/readme-review')
  const bounds = await holdMessage(page)
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 10 + 24, { steps: 4 })
  await page.waitForTimeout(800)
  await page.mouse.up()
  await expect(button(page, 'テキストを選択')).toBeHidden()
  await expect(page.getByRole('heading', { name: 'メッセージの操作' })).toBeHidden()
})
