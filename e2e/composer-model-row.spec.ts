import { test, expect, visit, button } from './helpers'
import type { Page } from '@playwright/test'

// A wrap puts a child on a second line, which moves its top by the row height.
// The spacer is excluded because it has no height of its own.
// M3E keeps a 48px square touch target centered in the 44px icon button, so its
// scrollWidth is 2px wider than the row and the last icon button alone makes
// `scrollWidth - clientWidth` 2 even without a model name. Real overflow (a
// label that does not shrink) adds far more than that.
async function expectOneLine(page: Page) {
  const geometry = await page.locator('.composer-controls').evaluate(node => ({
    overflow: node.scrollWidth - node.clientWidth,
    tops: Array.from(node.children)
      .map(child => child.getBoundingClientRect())
      .filter(rect => rect.height > 0)
      .map(rect => rect.top),
  }))
  expect(geometry.overflow, '下の行が横にはみ出さない').toBeLessThanOrEqual(4)
  expect(Math.max(...geometry.tops) - Math.min(...geometry.tops), '下の行が 1 行に収まる').toBeLessThanOrEqual(4)
}

test('CMR1 下の行にモデル名を出して 1 行に保ち、そこからモデルの選択を開く', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 844 })
  await visit(page, '/s/readme-review')
  const row = page.locator('.composer-controls')
  const model = row.getByRole('button', { name: /^モデル：/ })
  await expect(model).toBeVisible()
  await expectOneLine(page)
  await model.click()
  await expect(page.getByRole('heading', { name: 'モデルの選択' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'モデルの選択' })).toHaveCount(0)
  // The running row adds the stop and split buttons; it must fit the same line.
  // On a narrow phone there is no room left for a readable model name.
  await visit(page, '/s/approval-sheet')
  await expect(button(page, '実行を停止')).toBeVisible()
  await expect(page.locator('.composer-controls').getByRole('button', { name: /^モデル：/ })).toBeHidden()
  await expectOneLine(page)
})

test('CMR2 実行中でも幅が足りればモデル名を読める幅で出し、1 行に保つ', async ({ page }) => {
  await page.setViewportSize({ width: 440, height: 956 })
  await visit(page, '/s/approval-sheet')
  await expect(button(page, '実行を停止')).toBeVisible()
  const model = page.locator('.composer-controls').getByRole('button', { name: /^モデル：/ })
  await expect(model).toBeVisible()
  expect((await model.boundingBox())!.width, 'モデル名のボタンが読める幅を持つ').toBeGreaterThanOrEqual(56)
  await expectOneLine(page)
})
