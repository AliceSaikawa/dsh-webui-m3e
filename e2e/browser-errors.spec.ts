import type { Page } from '@playwright/test'
import { expect, test } from './helpers.ts'

// The automatic browserErrors fixture in helpers.ts. Cases that the fixture
// must reject use test.fail(): they pass only when the fixture fails them.

const logError = (page: Page, text: string) => page.evaluate(message => console.error(message), text)
const throwUncaught = async (page: Page, pageErrors: string[], text: string) => {
  await page.evaluate(message => { setTimeout(() => { throw new Error(message) }) }, text)
  await expect.poll(() => pageErrors.length).toBe(1)
}

test.describe('想定エラーを宣言したテスト', () => {
  test.use({ expectedErrors: [/synthetic/g] })

  test('宣言した console.error は、g フラグでも複数回でも許可される', async ({ page, browserErrors }) => {
    await page.setContent('<p>ok</p>')
    await logError(page, 'synthetic failure')
    await logError(page, 'synthetic failure')
    await expect.poll(() => browserErrors.length).toBe(2)
  })

  test('同じ文言でも捕まえられていない例外は許可されない', async ({ page, pageErrors }) => {
    test.fail()
    await page.setContent('<p>ok</p>')
    await logError(page, 'synthetic failure')
    await throwUncaught(page, pageErrors, 'synthetic failure')
  })

  test('宣言していない console.error は許可されない', async ({ page, browserErrors }) => {
    test.fail()
    await page.setContent('<p>ok</p>')
    await logError(page, 'synthetic failure')
    await logError(page, 'something else')
    await expect.poll(() => browserErrors.length).toBe(2)
  })

  test('宣言したのに発生しなかった想定エラーは失敗にする', async ({ page }) => {
    test.fail()
    await page.setContent('<p>ok</p>')
  })
})

test('宣言がなければ console.error は 1 件でも失敗にする', async ({ page, browserErrors }) => {
  test.fail()
  await page.setContent('<p>ok</p>')
  await logError(page, 'synthetic failure')
  await expect.poll(() => browserErrors.length).toBe(1)
})
