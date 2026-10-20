import { test, expect, visit, button } from './helpers'
import type { Locator, Page } from '@playwright/test'

const message = (page: Page) => page.locator('.chat-assistant .chat-message-action').first()

async function holdMessage(page: Page, target: Locator = message(page)) {
  await target.scrollIntoViewIfNeeded()
  const bounds = await target.boundingBox()
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
    return { userSelect: computed.userSelect || computed.webkitUserSelect }
  })
  // `-webkit-touch-callout: default` is WebKit-only: Chromium does not parse it, so it is not checked here
  // (docs/design/02-chat.md lists it as unverified until a real iPhone).
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
  // Closing returns straight to the conversation: the actions sheet is not shown again under it.
  // Wait out the close animation of the selection sheet, which is when a stale actions sheet would show again.
  await page.waitForTimeout(500)
  await expect(page.getByRole('heading', { name: 'メッセージの操作' })).toBeHidden()
  await expect(button(page, 'ここから分岐')).toBeHidden()
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

async function openSelection(page: Page, target: Locator) {
  await holdMessage(page, target)
  await expect(button(page, 'テキストを選択')).toBeVisible()
  await page.mouse.up()
  await button(page, 'テキストを選択').click()
  const body = page.getByTestId('chat-select-text')
  await expect(body).toBeVisible()
  return body
}

test('02u AI の本文は描画した Markdown ではなく、記号を含む元の文字を選べる', async ({ page }) => {
  await visit(page, '/s/chat-long')
  const last = page.locator('.chat-assistant .chat-message-action').last()
  await expect(last.locator('h3')).toContainText('75 回目の確認')
  // The rendered message shows a heading and a list; the selection sheet shows the source around them.
  expect(await last.innerText()).not.toContain('###')
  const body = await openSelection(page, last)
  // innerText keeps the line breaks (white-space: pre-wrap); toHaveText would normalise them.
  expect(await body.innerText()).toBe('### 75 回目の確認\n\n会話の表示と古い履歴の読み込みを確認しました。\n\n- メッセージの順序を保ちます。\n- 読んでいる位置を保ちます。')
  await expect(body.locator('h3, ul, li')).toHaveCount(0)
})

test('02v 自分の吹き出しも同じ「テキストを選択」で、元の文字を選べる', async ({ page }) => {
  await visit(page, '/s/chat-long')
  const mine = page.locator('.chat-user .chat-message-action').last()
  await expect(mine).toContainText('75 回目の確認をお願いします。')
  const body = await openSelection(page, mine)
  await expect(body).toHaveText('75 回目の確認をお願いします。')
  await button(page, '閉じる').click()
  await expect(body).toBeHidden()
})

test('02w 生成中の本文でも「テキストを選択」を開ける（長押しを始めた時点の本文）', async ({ page }) => {
  await visit(page, '/s/chat-long-streaming', 'chat-long-streaming')
  const streaming = page.locator('.chat-assistant[aria-busy="true"] .chat-message-action')
  await expect(streaming).toBeVisible()
  const body = await openSelection(page, streaming)
  expect((await body.innerText()).length).toBeGreaterThan(0)
  await expect(page.getByRole('heading', { name: 'テキストを選択' })).toBeVisible()
  await button(page, '閉じる').click()
  await expect(body).toBeHidden()
})

test('02x 「テキストを選択」を同じフレームで 2 回押しても、選ぶ画面は 1 枚しか開かない', async ({ page }) => {
  await visit(page, '/s/readme-review')
  await holdMessage(page)
  await expect(button(page, 'テキストを選択')).toBeVisible()
  await page.mouse.up()
  await button(page, 'テキストを選択').evaluate(element => { (element as HTMLElement).click(); (element as HTMLElement).click() })
  await expect(page.getByTestId('chat-select-text')).toHaveCount(1)
  // Only the top overlay is mounted, so a duplicate shows up after closing the first: nothing may remain below it.
  await button(page, '閉じる').click()
  await expect(page.getByTestId('chat-select-text')).toHaveCount(0)
  await page.waitForTimeout(500)
  await expect(page.getByTestId('chat-select-text')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'メッセージの操作' })).toBeHidden()
})

test('02y 選ぶ画面を閉じたあとも、同じメッセージをもう一度長押しして選べる', async ({ page }) => {
  await visit(page, '/s/readme-review')
  for (let round = 0; round < 3; round++) {
    const body = await openSelection(page, message(page))
    await expect(body).toBeVisible()
    await button(page, '閉じる').click()
    await expect(body).toBeHidden()
  }
})
