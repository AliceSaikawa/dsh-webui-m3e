import type { Page } from '@playwright/test'
import { test, expect, visit, action, shot } from './helpers'

// The "一般" section at the top of the settings tab: preferences that the stock
// screen keeps under Settings → General, saved in the same places.

async function expose(page: Page) {
  await page.route('**/src/dsh/mock/context.ts*', async route => {
    const response = await route.fetch(), body = await response.text()
    expect(body.match(/\breturn ctx;?/g)).toHaveLength(1)
    await route.fulfill({ response, body: body.replace(/\breturn ctx;?/, 'globalThis.__general = ctx; return ctx;') })
  })
}
const stored = (page: Page, ns: string) => page.evaluate(async ns => {
  const result = await (window as any).__general.remote.settings.describe()
  const row = result.value.namespaces.find((item: any) => item.ns === ns)
  return { user: row.user, value: row.value, revision: row.revision }
}, ns)
// What another screen (the stock one) would do: save through the shared document.
const saveElsewhere = (page: Page, ns: string, patch: object) => page.evaluate(async ({ ns, patch }) => {
  const settings = (window as any).__general.remote.settings
  const row = (await settings.describe()).value.namespaces.find((item: any) => item.ns === ns)
  const result = await settings.update(ns, patch, row.revision)
  if (!result.ok) throw new Error(result.error.message)
}, { ns, patch })

const section = (page: Page) => page.locator('section[aria-labelledby="settings-general"]')
const codingView = (page: Page) => section(page).getByRole('switch', { name: 'コーディングビューを表示', exact: true })
const card = (page: Page, name: string) => page.locator('.settings-preset-card').filter({ has: page.locator('.settings-preset-name', { hasText: name }) })

test('G1 設定のトップに「一般」があり、コーディングビューは標準の画面と同じくオンで始まる', async ({ page }) => {
  await visit(page, '/settings')
  await expect(section(page).getByRole('heading', { name: '一般', exact: true })).toBeVisible()
  await expect(codingView(page)).toBeChecked()
  await expect(section(page)).toContainText('オフにすると、PTC モードと最小モードを選べなくなります。')
  // The section sits between the device card and the DSH pages.
  const headings = await page.locator('.settings-section > h2').allTextContents()
  expect(headings).toEqual(['この端末', '一般', 'DSH の設定'])
  // Rows follow the stock order of the ones M3E offers: coding view, work details, collapse timing, performance.
  await expect(section(page).locator('.settings-field')).toHaveCount(4)
  await shot(page, 'general-coding-view')
})

test('G2 オフにすると ui-settings の enabled に false を保存し、PTC と最小がモードの一覧から消える', async ({ page }) => {
  await expose(page)
  await visit(page, '/settings')
  await codingView(page).click()
  await expect(codingView(page)).not.toBeChecked()
  await expect(section(page).getByText('保存しました', { exact: true })).toBeVisible()
  expect(await stored(page, 'ui-settings')).toEqual({ user: { enabled: false }, value: { enabled: false }, revision: 1 })
  await action(page, 'モード').click()
  await expect(card(page, '標準モード')).toBeVisible()
  await expect(card(page, 'PTC モード')).toHaveCount(0)
  await expect(card(page, '最小モード')).toHaveCount(0)
  await page.goBack()
  await codingView(page).click()
  await expect(codingView(page)).toBeChecked()
  expect((await stored(page, 'ui-settings')).value).toEqual({ enabled: true })
  await action(page, 'モード').click()
  await expect(card(page, 'PTC モード')).toBeVisible()
  await expect(card(page, '最小モード')).toBeVisible()
})

test('G3 標準の画面で変えた値が反映され、ほかの画面から戻しても同じ保存先を使う', async ({ page }) => {
  await expose(page)
  await visit(page, '/settings')
  await expect(codingView(page)).toBeChecked()
  await saveElsewhere(page, 'ui-settings', { enabled: false })
  await expect(codingView(page)).not.toBeChecked()
  await saveElsewhere(page, 'ui-settings', { enabled: true })
  await expect(codingView(page)).toBeChecked()
})

test('G4 保存が競合したら読み直したと知らせ、入力は残して「もう一度保存する」で保存できる', async ({ page }) => {
  await expose(page)
  await visit(page, '/settings', 'settings-conflict')
  await codingView(page).click()
  await expect(page.getByText('ほかの場所で設定が変わりました。読み直しました')).toBeVisible()
  await expect(section(page).getByRole('status').filter({ hasText: '入力は残っています' })).toBeVisible()
  expect((await stored(page, 'ui-settings')).value).toEqual({ enabled: true })
  await section(page).getByRole('button', { name: 'もう一度保存する' }).click()
  await expect.poll(async () => (await stored(page, 'ui-settings')).value).toEqual({ enabled: false })
  await expect(codingView(page)).not.toBeChecked()
})

test('G5 Host が拒否したら、その理由を項目の下に出して保存済みの値は変えない', async ({ page }) => {
  await expose(page)
  await visit(page, '/settings', 'settings-rejected')
  await codingView(page).click()
  await expect(section(page).getByRole('alert')).toHaveText('この値は管理者の設定によって許可されていません。')
  expect((await stored(page, 'ui-settings')).value).toEqual({ enabled: true })
})

test('G6 書き込めない DSH では無効にし、ほかの設定と同じ案内を 1 つだけ出す', async ({ page }) => {
  await visit(page, '/settings', 'settings-readonly')
  await expect(page.getByText('この DSH では設定を変更できません', { exact: true })).toHaveCount(1)
  await expect(codingView(page)).toHaveJSProperty('disabled', true)
})

test('G7 一般の行は DSH の設定の汎用ページには出ない', async ({ page }) => {
  await visit(page, '/settings/other')
  await expect(page.getByRole('switch', { name: 'コーディングビューを表示' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'ui-settings' })).toHaveCount(0)
})

const choice = (page: Page, label: string) => section(page).locator(`m3e-select[aria-label="${label}"]`)
// The select's own text also lists every option, so read the option it has selected.
const shown = (page: Page, label: string) => choice(page, label).evaluate((el: any) => el.selected.map((option: any) => option.textContent.trim()).join(','))
async function pick(page: Page, label: string, option: string) {
  await choice(page, label).click()
  await page.locator('m3e-option').filter({ hasText: option }).last().click()
}

test('G8 作業の詳細・折りたたむタイミング・パフォーマンスと使用状況は、標準の画面と同じ既定を選んで始まる', async ({ page }) => {
  await visit(page, '/settings')
  await expect.poll(() => shown(page, '作業の詳細')).toBe('詳細')
  await expect.poll(() => shown(page, '折りたたむタイミング')).toBe('回答の完了時')
  await expect.poll(() => shown(page, 'パフォーマンスと使用状況')).toBe('詳細')
  await expect(section(page)).toContainText('ツール呼び出しをどこまで詳しく表示するかを選びます。')
  await shot(page, 'general-chat-display')
})

test('G17 幅 320px でも「一般」の題名が切れない', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 })
  await visit(page, '/settings')
  await expect(section(page).locator('m3e-form-field label[slot="label"]')).toHaveCount(3)
  const clipped = await section(page).locator('m3e-form-field label[slot="label"]').evaluateAll(labels =>
    labels.filter(label => label.scrollWidth > label.clientWidth).map(label => label.textContent))
  expect(clipped).toEqual([])
})

test('G9 選ぶとその項目だけを ui-chat に保存し、選んだ表示に変わる', async ({ page }) => {
  await expose(page)
  await visit(page, '/settings')
  await pick(page, '作業の詳細', '完全に展開')
  await expect.poll(() => shown(page, '作業の詳細')).toBe('完全に展開')
  await expect.poll(async () => (await stored(page, 'ui-chat')).user).toEqual({ transcriptView: 'verbose' })
  await pick(page, '折りたたむタイミング', '次のメッセージの送信時')
  await expect.poll(async () => (await stored(page, 'ui-chat')).user).toEqual({ transcriptView: 'verbose', collapseTiming: 'next-input' })
  await pick(page, 'パフォーマンスと使用状況', '簡潔')
  await expect.poll(async () => (await stored(page, 'ui-chat')).value).toEqual({
    transcriptView: 'verbose', collapseTiming: 'next-input', performanceUsage: 'compact', linkOpening: 'sidebar' })
  // Leaving the settings tab and coming back reads the saved values back (a reload would reset the mock).
  await action(page, 'モード').click()
  await page.goBack()
  await expect.poll(() => shown(page, '作業の詳細')).toBe('完全に展開')
  await expect.poll(() => shown(page, 'パフォーマンスと使用状況')).toBe('簡潔')
})

test('G10 標準の画面が保存した値が反映される。古い normal は「詳細」として出す', async ({ page }) => {
  await expose(page)
  await visit(page, '/settings')
  await saveElsewhere(page, 'ui-chat', { transcriptView: 'compact', performanceUsage: 'compact' })
  await expect.poll(() => shown(page, '作業の詳細')).toBe('簡潔')
  await expect.poll(() => shown(page, 'パフォーマンスと使用状況')).toBe('簡潔')
  await saveElsewhere(page, 'ui-chat', { transcriptView: 'normal' })
  await expect.poll(() => shown(page, '作業の詳細')).toBe('詳細')
})

test('G11 保存が競合したら読み直したと知らせ、選んだ値は残して「もう一度保存する」で保存できる', async ({ page }) => {
  await expose(page)
  await visit(page, '/settings', 'settings-conflict')
  await pick(page, '折りたたむタイミング', '次のメッセージの送信時')
  await expect(page.getByText('ほかの場所で設定が変わりました。読み直しました')).toBeVisible()
  await expect.poll(() => shown(page, '折りたたむタイミング')).toBe('次のメッセージの送信時')
  expect((await stored(page, 'ui-chat')).user).toEqual({})
  await section(page).getByRole('button', { name: 'もう一度保存する' }).click()
  await expect.poll(async () => (await stored(page, 'ui-chat')).user).toEqual({ collapseTiming: 'next-input' })
})

test('G12 Host が拒否したら理由を項目の下に出す。書き込めない DSH では選べない', async ({ page }) => {
  await expose(page)
  await visit(page, '/settings', 'settings-rejected')
  await pick(page, '作業の詳細', '簡潔')
  await expect(section(page).getByRole('alert')).toHaveText('この値は管理者の設定によって許可されていません。')
  expect((await stored(page, 'ui-chat')).user).toEqual({})
  await visit(page, '/settings', 'settings-readonly')
  await expect(choice(page, '作業の詳細')).toHaveJSProperty('disabled', true)
  await expect(choice(page, 'パフォーマンスと使用状況')).toHaveJSProperty('disabled', true)
})
