import { test as base, expect, type Page } from '@playwright/test'
import { startDsh, type DshHost } from './dsh-host.ts'
import { startFakeLlm, type FakeLlm } from './fake-llm.ts'

export interface Integration { readonly host: DshHost; readonly llm: FakeLlm }

export const test = base.extend<{ browserErrors: string[]; pageErrors: string[] }, { integration: Integration }>({
  integration: [async ({}, use) => {
    const llm = await startFakeLlm()
    const host = await startDsh(llm.url)
    await use({ host, llm })
    await host.stop()
    await llm.close()
  }, { scope: 'worker', timeout: 600_000 }],
  pageErrors: async ({ page }, use) => {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await use(errors)
  },
  // Same rule as the mock e2e: no uncaught exception and no console.error.
  // A test that cuts the connection on purpose opts out with test.use.
  browserErrors: [async ({ page, pageErrors }, use, info) => {
    const errors: string[] = []
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
    await use(errors)
    await info.attach('browser-errors', { body: JSON.stringify({ console: errors, page: pageErrors }, null, 2), contentType: 'application/json' })
    expect(pageErrors, '捕まえられていない例外がない').toEqual([])
    if (!info.annotations.some(note => note.type === 'expected-console-errors')) expect(errors, 'console.error がない').toEqual([])
  }, { auto: true }],
})
export { expect }

export const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true })

/**
 * Log in through the Host's own token URL as a device that already chose M3E:
 * the tapped stock index then moves to /m3e/ before any stock UI code runs.
 */
export async function login(page: Page, host: DshHost) {
  await page.context().addCookies([{ name: 'dsh-webui', value: 'm3e', url: host.origin, sameSite: 'Strict' }])
  await page.goto(host.loginUrl)
  await expect(page).toHaveURL(`${host.origin}/m3e/`)
  expect((await page.context().cookies(host.origin)).some(cookie => cookie.name.startsWith('dsh-auth-'))).toBe(true)
}

export async function openM3e(page: Page, host: DshHost, hash = '/') {
  await login(page, host)
  await page.goto(`${host.origin}/m3e/#${hash}`)
  await expect(page.locator('h1').first()).toBeVisible()
}
