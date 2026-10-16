import { test as base, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { finalStatus, reviewConsoleErrors } from './browser-errors.ts'

export const shots = fileURLToPath(new URL('../tmp/e2e-shots/', import.meta.url))
// Same rule as e2e-dsh: no uncaught exception and no console.error.
// Tests that deliberately feed broken data declare the console errors they
// expect with `test.use({ expectedErrors: [/pattern/] })`. Nothing is allowed
// by default, uncaught exceptions are never allowed, and a declared pattern
// that never occurs fails the test so it cannot go stale.
export const test = base.extend<{ pageErrors: string[]; browserErrors: string[]; expectedErrors: RegExp[] }>({
  expectedErrors: [[], { option: true }],
  pageErrors: async ({ page }, use) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await use(errors)
  },
  browserErrors: [async ({ page, pageErrors, expectedErrors, browserName }, use, info) => {
    const errors: string[] = []
    // Firefox's text() reduces an Error argument to "Error". Rebuild the text
    // from the arguments there, in arrival order, so patterns match Chromium's.
    let pending = Promise.resolve()
    page.on('console', message => {
      if (message.type() !== 'error') return
      if (browserName === 'chromium') { errors.push(message.text()); return }
      pending = pending.then(async () => {
        const parts = await Promise.all(message.args().map(handle => handle.evaluate(value => value instanceof Error ? `${value.name}: ${value.message}` : String(value))))
          .catch(() => undefined)
        // Browser-generated messages have no arguments; keep their text.
        errors.push(parts?.length ? parts.join(' ') : message.text())
      })
    })
    await use(errors)
    await pending
    const { unexpected, missing } = reviewConsoleErrors(errors, expectedErrors)
    // Playwright sets the body status before fixture teardown; the type is only
    // optional. Treating a missing status as passed applies every check below.
    const bodyStatus = info.status ?? 'passed'
    // Missing declarations count only when the body passed, so an earlier
    // failure stays the first report.
    const missed = bodyStatus === 'passed' ? missing : []
    const fixtureFails = pageErrors.length > 0 || unexpected.length > 0 || missed.length > 0
    // Save evidence only for an unexpected final result: test.fail() cases that
    // this fixture fails as expected get no screenshot, and a passing body that
    // this fixture fails does.
    if (finalStatus(bodyStatus, fixtureFails) !== info.expectedStatus) {
      await mkdir(shots, { recursive: true })
      await page.screenshot({ path: `${shots}failure-${info.title.match(/^\S+/)?.[0]}.png` })
    }
    await info.attach('browser-errors', {
      body: JSON.stringify({ console: errors, page: pageErrors, expected: expectedErrors.map(String) }, null, 2),
      contentType: 'application/json',
    })
    expect(pageErrors, '捕まえられていない例外がない').toEqual([])
    expect(unexpected, 'console.error がない').toEqual([])
    expect(missed.map(String), '宣言した想定エラーがすべて発生した').toEqual([])
  }, { auto: true }],
})
export { expect }

export async function visit(page: Page, route = '/', scenario?: string) {
  await page.goto(`/m3e/?mock${scenario ? `&scenario=${scenario}` : ''}#${route}`)
  await expect(page.locator('h1').first()).toBeVisible()
  // The icon font (font-display: block) moves rows and buttons when it loads.
  // Firefox spaces Playwright's mousedown and mouseup further apart than
  // Chromium, so a click during that shift can land on two elements.
  await page.evaluate(() => document.fonts.ready.then(() => undefined))
}

export async function shot(page: Page, name: string) {
  await mkdir(shots, { recursive: true })
  await page.screenshot({ path: `${shots}${name}.png`, animations: 'disabled' })
}

// M3E custom elements expose some roles through ElementInternals. Use their
// public label/text at the host when a component has no native button child.
export const nav = (page: Page, name: string) => page.locator('m3e-nav-item').filter({ hasText: name })
export const action = (page: Page, name: string | RegExp) => page.locator('m3e-list-action').filter({ hasText: name })
export const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

export async function menu(page: Page, name: string) {
  await page.getByLabel('会話のメニュー', { exact: true }).filter({ has: page.locator('m3e-menu-trigger') }).click()
  await page.locator('m3e-menu-item').filter({ hasText: name }).click()
}

export async function dismiss(page: Page) {
  await page.keyboard.press('Escape')
  await expect(page.locator('[role="dialog"][aria-modal="true"]')).toHaveCount(0)
}
