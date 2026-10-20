import type { Locator, Page } from '@playwright/test'
import { button, expect, shot, test, visit } from './helpers.ts'

test.use({ permissions: ['clipboard-read', 'clipboard-write'] })

const selectSheet = (page: Page) => page.locator('m3e-bottom-sheet[aria-label="テキストを選択"]')

async function closeSelect(page: Page) {
  await selectSheet(page).getByRole('button', { name: '閉じる', exact: true }).click()
  await expect(selectSheet(page)).toHaveCount(0)
}

async function hold(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded()
  await expect(target).toBeVisible()
  const before = await target.boundingBox()
  await page.waitForTimeout(150)
  let bounds = await target.boundingBox()
  if (before && bounds && Math.hypot(bounds.x - before.x, bounds.y - before.y) > 2) {
    await page.waitForTimeout(400)
    bounds = await target.boundingBox()
  }
  expect(bounds).not.toBeNull()
  const x = bounds!.x + Math.min(24, bounds!.width / 2)
  const y = bounds!.y + Math.min(12, Math.max(8, bounds!.height / 2))
  await page.mouse.move(x, y)
  await page.mouse.down()
  await expect(button(page, 'テキストを選択')).toBeVisible()
  await page.mouse.up()
  await expect(button(page, 'ここから分岐')).toBeVisible()
}

async function selectInside(root: Locator, needle: string) {
  const selected = await root.evaluate((node, expected) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
    let current = walker.nextNode()
    while (current) {
      const value = current.textContent ?? ''
      const index = value.indexOf(expected)
      if (index >= 0) {
        const range = document.createRange()
        range.setStart(current, index)
        range.setEnd(current, index + expected.length)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
        return selection?.toString() ?? ''
      }
      current = walker.nextNode()
    }
    return ''
  }, needle)
  expect(selected).toBe(needle)
  return selected
}

test('02s 長押しの全部コピーと分岐を残し、一部を選んでコピーできる', async ({ page }) => {
  await visit(page, '/s/readme-review')
  await expect(page.locator('.chat-user img')).toBeVisible()
  const assistant = page.locator('.chat-assistant .chat-message-action').first()
  await hold(page, assistant.locator('p').first())
  await expect(button(page, 'コピー')).toBeVisible()
  await shot(page, '02-select-actions')
  await button(page, 'テキストを選択').click()
  const sheet = selectSheet(page)
  const body = sheet.locator('.chat-select-body')
  await expect(sheet).toBeVisible()
  await expect(body).toContainText('PWA の手順を README に足しました。')
  await expect(body).toHaveCSS('user-select', 'text')
  const callout = await body.evaluate(node => getComputedStyle(node).getPropertyValue('-webkit-touch-callout'))
  expect(callout === 'default' || callout === '').toBeTruthy()
  await selectInside(body, 'PWA の手順')
  await page.evaluate(() => document.execCommand('copy'))
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('PWA の手順')
  await shot(page, '02-select-assistant')
  await closeSelect(page)

  const bubble = page.locator('.chat-user .chat-bubble').first()
  await hold(page, bubble)
  await button(page, 'テキストを選択').click()
  const plain = page.locator('[data-chat-select="plain"] .chat-select-body')
  await expect(plain).toContainText('README の手順を見直して')
  await selectInside(plain, '手順を見直')
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('手順を見直')
  await closeSelect(page)

  const message = page.locator('.chat-assistant .chat-message-action p').first()
  const box = await message.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.move(box!.x + 20, box!.y + 12)
  await page.mouse.down()
  await page.mouse.move(box!.x + 20, box!.y + 40)
  await page.waitForTimeout(700)
  await page.mouse.up()
  await expect(page.getByRole('heading', { name: 'メッセージの操作' })).toHaveCount(0)
})

test('02t 自分の文字はそのまま、コードブロックだけ、生成中の続きをコピーできる', async ({ page }) => {
  await visit(page, '/s/message-select', 'message-select')
  const user = page.locator('.chat-user .chat-bubble')
  await hold(page, user)
  await button(page, 'コピー').click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('星は *そのまま* 出します。パスは /tmp/partial.txt です。')
  await hold(page, user)
  await button(page, 'テキストを選択').click()
  const plain = page.locator('[data-chat-select="plain"] .chat-select-body')
  await expect(plain).toContainText('*そのまま*')
  await closeSelect(page)

  await hold(page, page.getByText('必要なコマンドだけをコピーできます。'))
  await button(page, 'テキストを選択').click()
  const rendered = page.locator('[data-chat-select="markdown"] .chat-select-body')
  await expect(rendered).toContainText('必要なコマンドだけをコピーできます。')
  await expect(rendered).not.toContainText('**コマンド**')
  await expect(rendered.locator('pre')).toContainText('pnpm test --reporter=dot')
  await button(page, 'このブロックをコピー').click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('pnpm test --reporter=dot')
  await expect(page.getByText('コードブロックをコピーしました。')).toBeVisible()
  await selectInside(rendered, '/mock/dsh-webui-m3e/README.md')
  await shot(page, '02-select-code')
  await closeSelect(page)

  const chat = page.locator('.chat-scroll')
  await expect.poll(() => chat.evaluate(node => node.scrollHeight - node.clientHeight)).toBeGreaterThan(200)
  await chat.evaluate(node => { node.scrollTop = node.scrollHeight })
  const bottom = await chat.evaluate(node => node.scrollTop)
  await chat.hover()
  await page.mouse.wheel(0, -400)
  await expect.poll(() => chat.evaluate(node => node.scrollTop)).toBeLessThan(bottom - 80)
})

test('02u 生成中に開いた操作から、その後届いた本文を選べる', async ({ page }) => {
  await visit(page, '/s/message-select-stream', 'message-select')
  const live = page.locator('.chat-assistant')
  await expect(live).toContainText('SELECT-MID')
  await expect(live).not.toContainText('SELECT-END')
  await hold(page, live.locator('.chat-message-action'))
  await expect(live).toContainText('SELECT-END', { timeout: 20_000 })
  await button(page, 'テキストを選択').click()
  const body = page.locator('[data-chat-select="markdown"] .chat-select-body')
  await expect(body).toContainText('SELECT-END')
  await selectInside(body, 'SELECT-END')
})

test('02v 全部コピーに失敗したら選択シートを案内する', async ({ page }) => {
  await visit(page, '/s/readme-review')
  await page.evaluate(() => {
    navigator.clipboard.writeText = async () => { throw new DOMException('denied', 'NotAllowedError') }
  })
  await hold(page, page.locator('.chat-assistant .chat-message-action p').first())
  await button(page, 'コピー').click()
  await expect(page.getByRole('alert')).toContainText('「テキストを選択」を開いて、必要な部分を選んでコピーしてください。')
  await expect(button(page, 'テキストを選択')).toBeEnabled()
})
