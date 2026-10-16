import type { Page } from '@playwright/test'
import { expect, login, test } from './fixtures.ts'

/**
 * Issue #91: a Safari tab that the OS discarded in the background comes back
 * without its SameSite=Strict login cookie (WebKit bug 200345). A navigation
 * started from another site drops the same cookie, so these tests use one to
 * stand in for the restored tab. They do not reproduce Safari's restore itself.
 */
const OTHER_SITE = 'http://other-site.m3e.invalid/'

async function openFromOtherSite(page: Page, target: string) {
  await page.route(`${OTHER_SITE}**`, route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><a id="go" href="${target}">open</a>`,
  }))
  await page.goto(OTHER_SITE)
  await page.click('#go')
}

/** Document requests for the M3E index, with the status each one got. */
function indexLoads(page: Page, origin: string) {
  const loads: number[] = []
  page.on('response', response => {
    const url = new URL(response.url())
    if (url.origin === origin && url.pathname === '/m3e/' && response.request().resourceType() === 'document') loads.push(response.status())
  })
  return loads
}

test('別のサイトから開いて Cookie が送られなくても、同じサイトから開き直して一覧を出す', async ({ page, integration }, info) => {
  // The first document load is a 401 by design; the browser logs it.
  info.annotations.push({ type: 'expected-console-errors', description: 'the cross-site load of /m3e/ is a 401' })
  const { host } = integration
  await login(page, host)
  const loads = indexLoads(page, host.origin)
  await openFromOtherSite(page, `${host.origin}/m3e/`)
  await expect(page).toHaveURL(`${host.origin}/m3e/`)
  await expect(page.locator('h1').first()).toBeVisible()
  await expect(page.getByText('ログインの情報を確かめられませんでした')).toHaveCount(0)
  expect(loads).toEqual([401, 200])
})

test('ログインしていなければ、自動では 1 回だけ開き直し、日本語の案内を出す', async ({ page, integration }, info) => {
  info.annotations.push({ type: 'expected-console-errors', description: 'both loads of /m3e/ are 401' })
  const { host } = integration
  const loads = indexLoads(page, host.origin)
  await page.goto(`${host.origin}/m3e/`)
  await expect(page.getByRole('heading', { name: 'ログインの情報を確かめられませんでした' })).toBeVisible()
  await expect(page.getByRole('button', { name: '開き直す' })).toBeVisible()
  // Give a looping page time to show itself before counting.
  await page.waitForTimeout(1_500)
  expect(loads).toEqual([401, 401])
  expect(await page.locator('script[src], link[href], img').count()).toBe(0)
})

test('token 付きの /m3e/ と、ログイン後の標準の画面は DSH の応答のまま', async ({ page, integration }) => {
  const { host } = integration
  const token = new URL(host.loginUrl).search
  const tokenized = await page.request.get(`${host.origin}/m3e/${token}`, { maxRedirects: 0 })
  expect(tokenized.status()).toBe(401)
  expect(tokenized.headers()['content-type']).toContain('text/plain')
  const login = await page.request.get(host.loginUrl, { maxRedirects: 0 })
  expect(login.status()).toBe(303)
})
