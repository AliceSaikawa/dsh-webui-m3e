import { test as base, expect, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

export const shots = fileURLToPath(new URL('../tmp/e2e-shots/', import.meta.url))
export const test = base.extend<{ browserErrors: string[] }>({
  browserErrors: [async ({ page }, use, info) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await use(errors)
    await mkdir(shots, { recursive: true })
    if (info.status !== info.expectedStatus) {
      await page.screenshot({ path: `${shots}failure-${info.title.match(/^\S+/)?.[0]}.png` })
    }
    await info.attach('browser-errors', { body: JSON.stringify(errors, null, 2), contentType: 'application/json' })
    expect(errors, 'ブラウザ例外・console.error がない').toEqual([])
  }, { auto: true }],
})
export { expect }

export async function visit(page: Page, route = '/', scenario?: string) {
  await page.goto(`/m3e/?mock${scenario ? `&scenario=${scenario}` : ''}#${route}`)
  await expect(page.locator('h1').first()).toBeVisible()
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
