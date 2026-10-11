import { test, expect, visit, button } from './helpers'
import { test as bootTest, type Page } from '@playwright/test'

async function expose(page: Page, extra = '') {
  await page.route('**/src/dsh/mock/context.ts*', async route => {
    const response = await route.fetch(), body = await response.text()
    expect(body.match(/\breturn ctx;?/g)).toHaveLength(1)
    await route.fulfill({ response, body: body.replace(/\breturn ctx;?/, `globalThis.__malformed = ctx; ${extra} return ctx;`) })
  })
}

test('不正な質問projectionが起動時と更新時に届いても画面と正常な質問を維持する', async ({ page }) => {
  await expose(page, "ctx.mock.setProjection('approval-sheet', 'userQuestions', { active: {}, settled: [] });")
  await visit(page, '/s/approval-sheet')
  await expect(page.getByLabel('メッセージ入力欄')).toBeEnabled()
  await page.evaluate(() => (window as any).__malformed.mock.setProjection('approval-sheet', 'userQuestions', { active: [null, { state: 'continued', callId: 'valid', questions: [{ id: 'q', question: '有効な質問', options: [{ label: 'はい' }, null] }] }], settled: [] }))
  await expect(page.getByRole('heading', { name: '有効な質問', exact: true })).toBeVisible()
  await button(page, 'あとで').click()
  await expect(page.getByLabel('メッセージ入力欄')).toBeEnabled()
})

test('共有参照が指数的に広がる設定でも項目を制限し、画面から戻れる', async ({ page }) => {
  await expose(page); await visit(page)
  await page.evaluate(() => {
    const ctx = (window as any).__malformed
    const refs: Record<string, unknown> = { 16: { type: 'object', dict: { enabled: 17 } }, 17: { type: 'boolean' } }
    for (let i = 15; i >= 0; i--) refs[i] = { type: 'intersect', list: [i + 1, i + 1] }
    ctx.mock.patch('remote.settings.describe', async () => ({ ok: true, value: { writable: true, namespaces: [{ ns: 'synthetic-complex', autoGenerate: true, revision: 1, applies: 'live', schema: { uid: 0, refs }, value: { enabled: true } }] } }))
    location.hash = '/settings/other'
  })
  await expect(page.getByText('設定の定義が複雑なため表示できません。標準の画面で確認してください。', { exact: false })).toBeVisible()
  await expect(page.locator('.settings-field')).toHaveCount(1)
  await button(page, '戻る').click()
  await expect(page.getByRole('list', { name: 'セッション一覧', exact: true })).toBeVisible()
})

test('不正な画像と深い引数のトレースを開いて検索・詳細表示できる', async ({ page }) => {
  await expose(page); await visit(page)
  await page.evaluate(() => {
    const kit = (window as any).__malformed.mock
    const id = 'approval-sheet'
    kit.appendEvent(id, 'user/message', { role: 'user', content: [{ type: 'image', attachment: null }, { type: 'text', text: '不正画像の隣の本文' }] })
    let deep = 'null'
    for (let i = 0; i < 300; i++) deep = '{"child":' + deep + '}'
    kit.appendEvent(id, 'tool/call', { callId: 'deep-arguments', name: 'synthetic-tool', arguments: deep })
    location.hash = '/s/approval-sheet/trace'
  })
  await expect(page.locator('[data-trace-row]').filter({ hasText: '不正画像の隣の本文' })).toBeVisible()
  await page.getByLabel('記録を検索', { exact: true }).fill('不正画像')
  await expect(page.locator('[data-trace-row]')).toHaveCount(1)
  await page.getByLabel('記録を検索', { exact: true }).fill('')
  await page.locator('[data-trace-row]').filter({ hasText: 'synthetic-tool' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog')).toContainText('synthetic-tool')
})

test('設定の拒否文は入力値や内部パスを含むHost診断を表示しない', async ({ page }) => {
  await expose(page); await visit(page, '/settings/other')
  await page.evaluate(() => (window as any).__malformed.mock.patch('remote.settings.update', async () => ({ ok: false, error: { code: 'settings/rejected', message: '入力 synthetic-private-value を /synthetic/internal/path で拒否', details: {} } })))
  const section = page.locator('.settings-namespace').filter({ has: page.getByRole('heading', { name: 'example-extension', exact: true }) })
  await section.getByLabel('名前', { exact: true }).fill('拒否される入力')
  await section.getByLabel('名前', { exact: true }).press('Tab')
  await expect(section.getByRole('alert')).toHaveText('この値は設定できません。入力内容を確認してください。')
  await expect(page.locator('body')).not.toContainText('synthetic-private-value')
  await expect(page.locator('body')).not.toContainText('/synthetic/internal/path')
})

test('200件の設定通知を受けてもブラウザのdescribeは同時に1件だけ実行する', async ({ page }) => {
  await expose(page); await visit(page, '/settings/other')
  await expect(page.getByLabel('名前', { exact: true })).toBeVisible()
  await page.evaluate(async () => {
    const ctx = (window as any).__malformed
    const original = ctx.remote.settings.describe.bind(ctx.remote.settings)
    const pending: (() => void)[] = []
    ;(window as any).__describe33 = { calls: 0, pending }
    ctx.remote.settings.describe = async () => {
      ;(window as any).__describe33.calls++
      await new Promise<void>(resolve => pending.push(resolve))
      return original()
    }
    for (let revision = 1; revision <= 200; revision++) await ctx.mock.emit('settings/document-updated', 'example-extension', { additionalArgs: [revision] })
  })
  expect(await page.evaluate(() => (window as any).__describe33.calls)).toBe(1)
  await page.evaluate(() => (window as any).__describe33.pending[0]())
  await expect.poll(() => page.evaluate(() => (window as any).__describe33.calls)).toBe(2)
  await page.evaluate(() => (window as any).__describe33.pending[1]())
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  expect(await page.evaluate(() => (window as any).__describe33.calls)).toBe(2)
  await expect(page.getByLabel('名前', { exact: true })).toHaveValue('追加機能')
})

bootTest('起動の成功処理中に初期化が例外になっても復帰リンクを表示する', async ({ page }) => {
  const unhandled: string[] = []
  page.on('pageerror', error => unhandled.push(error.message))
  await expose(page, "ctx.sessions.list.getSnapshot = () => { throw new Error('synthetic initialization failure'); };")
  await page.goto('/m3e/?mock')
  await expect(page.getByText('起動に失敗しました。ページを読み直してください。', { exact: false })).toBeVisible()
  await expect(page.getByRole('link', { name: '今の画面に戻す' })).toHaveAttribute('href', '/?ui=classic')
  expect(unhandled).toEqual([])
})
