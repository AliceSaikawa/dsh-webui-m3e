import { test, expect, visit, button, shot } from './helpers'
import type { Page } from '@playwright/test'

// The catalog controls stay in the intercepted mock browser, never in production.
async function exposeMock(page: Page) {
  await page.route('**/src/dsh/mock/context.ts*', async route => {
    const response = await route.fetch(), body = await response.text()
    expect(body.match(/\breturn ctx;?/g)).toHaveLength(1)
    await route.fulfill({ response, body: body.replace(/\breturn ctx;?/, 'globalThis.__pickerContext = ctx; return ctx;') })
  })
}
const trigger = (page: Page) => page.getByLabel('会話を切り替え', { exact: true }).filter({ has: page.locator('.material-symbols-outlined') })
const sheet = (page: Page) => page.locator('.conversation-picker')
const search = (page: Page) => page.getByLabel('会話名で検索', { exact: true })
const row = (page: Page, title: string) => sheet(page).getByRole('button').filter({ has: page.getByText(title, { exact: true }) })
async function open(page: Page) { await trigger(page).click(); await expect(sheet(page)).toBeVisible() }
async function closed(page: Page) { await expect(sheet(page)).toHaveCount(0) }
async function flush(page: Page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null))))) }
async function holdChild(page: Page) {
  await page.evaluate(() => {
    const state = window as any, ctx = state.__pickerContext
    state.__pickerCatalog = ctx.sessions.list.getSnapshot().subagentsByParent
    state.__pickerCalls = { refresh: 0, select: 0 }
    ctx.mock.updateList((list: any) => { list.subagentsByParent = {} })
    const original = ctx.sessions.openSubagent.bind(ctx.sessions)
    ctx.sessions.openSubagent = (...args: any[]) => { state.__pickerCalls.select++; return original(...args) }
    ctx.sessions.refreshSubagents = () => new Promise(resolve => { state.__pickerCalls.refresh++; state.__pickerRelease = resolve })
  })
}
async function releaseChild(page: Page) {
  await page.evaluate(() => {
    const state = window as any
    state.__pickerContext.mock.updateList((list: any) => { list.subagentsByParent = state.__pickerCatalog })
    state.__pickerRelease()
  })
  await flush(page)
}

for (const width of [375, 390]) {
  test(`03 ${width}px 会話一覧の開閉は下書き・読書位置・フォーカスを保つ`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 844 })
    await visit(page, '/s/readme-review')
    const input = page.getByLabel('メッセージ入力欄', { exact: true })
    await input.fill(`一覧を閉じても保持する本文 ${width}`)
    await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all([...document.querySelectorAll<HTMLImageElement>('.chat-scroll img')].map(image => image.decode().catch(() => {})))
    })
    await flush(page)
    const scroll = page.locator('.chat-scroll')
    await scroll.evaluate(node => { node.scrollTop = Math.max(1, (node.scrollHeight - node.clientHeight) / 3) })
    const before = await scroll.evaluate(node => node.scrollTop)
    await trigger(page).focus()
    await open(page)
    await expect(sheet(page).locator('[aria-current="page"]')).toContainText('README の見直し')
    expect(await search(page).evaluate(node => node === document.activeElement)).toBe(false)
    await expect(page.locator('.route-layer')).toHaveAttribute('inert', '')
    await shot(page, `mobile-picker-open-${width}`)
    await search(page).fill('見つからない合成の会話')
    await expect(sheet(page).getByRole('status')).toContainText('一致する会話がありません')
    await page.keyboard.press('Escape'); await closed(page)
    await expect(input).toHaveValue(`一覧を閉じても保持する本文 ${width}`)
    expect(await scroll.evaluate(node => node.scrollTop)).toBe(before)
    await expect(trigger(page)).toBeFocused()
    const bounds = await trigger(page).boundingBox()
    expect(bounds!.width).toBeGreaterThanOrEqual(44); expect(bounds!.height).toBeGreaterThanOrEqual(44)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  })

  test(`03 ${width}px 検索で通常と子の会話を切り替え下書き・子のmodeを分離する`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 844 })
    await exposeMock(page); await visit(page, '/s/readme-review')
    const input = page.getByLabel('メッセージ入力欄', { exact: true })
    await input.fill(`通常だけの下書き ${width}`)
    await open(page); await search(page).fill('承認シートの見直し')
    await row(page, '承認シートの見直し').click(); await closed(page)
    await expect(page).toHaveURL(/#\/s\/session-tools-review$/)
    await expect(input).toBeVisible(); await input.fill(`子だけの下書き ${width}`)
    expect(await page.evaluate(() => (window as any).__pickerContext.sessions.list.getSnapshot().currentAddress)).toEqual({ parentSessionId: 'approval-sheet', childSessionId: 'session-tools-review', mode: 'continuable' })
    await open(page); await search(page).fill('テストの確認')
    await row(page, 'テストの確認').click(); await closed(page)
    await expect(page).toHaveURL(/#\/s\/session-tools-tests$/)
    await expect(input).toHaveCount(0)
    await expect(page.getByText('このサブエージェントの会話は読むだけです。', { exact: true })).toBeVisible()
    await open(page); await search(page).fill('README'); await row(page, 'README の見直し').click(); await closed(page)
    await expect(input).toHaveValue(`通常だけの下書き ${width}`)
    await open(page); await search(page).fill('承認シートの見直し'); await row(page, '承認シートの見直し').click(); await closed(page)
    await expect(input).toHaveValue(`子だけの下書き ${width}`)
    await shot(page, `mobile-picker-child-${width}`)
  })
}

test('03 大きな既存一覧も50行以内にし上限より後の会話を検索できる', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await exposeMock(page); await visit(page, '/s/readme-review')
  await page.evaluate(() => {
    const ctx = (window as any).__pickerContext
    for (let index = 0; index < 500; index++) ctx.mock.addSession({ id: `picker-synthetic-${index}`, displayTitle: index === 499 ? '最後の Needle 長い日本語の会話名を確認するための合成会話' : `合成の会話 ${index}`, running: false, blank: false, updatedAt: index }, [])
  })
  await open(page)
  await expect(sheet(page).locator('.conversation-picker-row')).toHaveCount(50)
  await expect(sheet(page)).toContainText('先頭 50 件')
  await search(page).fill('NEEDLE')
  await expect(sheet(page).locator('.conversation-picker-row')).toHaveCount(1)
  await expect(sheet(page)).toContainText('最後の Needle')
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  const bounds = await sheet(page).locator('.conversation-picker-row').boundingBox()
  expect(bounds!.width).toBeLessThanOrEqual(375); expect(bounds!.height).toBeGreaterThanOrEqual(64)
  await shot(page, 'mobile-picker-bounded-search-375')
  await page.getByLabel('会話名の検索を消去', { exact: true }).click()
  await expect(search(page)).toHaveValue('')
  await expect(sheet(page).locator('.conversation-picker-row')).toHaveCount(50)
})

for (const mode of ['escape-start', 'close', 'route-away'] as const) {
  test(`03 子の取得中 ${mode} は後着応答からの会話選択を取り消す`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await exposeMock(page); await visit(page, '/s/readme-review'); await holdChild(page)
    await open(page); await search(page).fill('承認シートの見直し')
    await row(page, '承認シートの見直し').click()
    await expect(sheet(page).getByRole('status')).toContainText('会話を開いています')
    await expect(row(page, '承認シートの見直し')).toBeDisabled()
    if (mode === 'escape-start') {
      // Release inside native closing, before its animation/closed callback.
      await page.evaluate(() => document.querySelector('.conversation-picker')!.closest('m3e-bottom-sheet')!.addEventListener('closing', () => {
        const state = window as any
        state.__pickerContext.mock.updateList((list: any) => { list.subagentsByParent = state.__pickerCatalog })
        state.__pickerRelease()
      }, { once: true }))
      await page.keyboard.press('Escape')
    } else if (mode === 'close') { await sheet(page).getByRole('button', { name: '閉じる', exact: true }).click(); await releaseChild(page) }
    else { await page.evaluate(() => { window.location.hash = '/' }); await expect(page.locator('.home-session').first()).toBeVisible(); await releaseChild(page) }
    await closed(page); await flush(page)
    await expect(page).toHaveURL(mode === 'route-away' ? /#\/$/ : /#\/s\/readme-review$/)
    expect(await page.evaluate(() => (window as any).__pickerCalls)).toEqual({ refresh: 1, select: 0 })
  })
}

for (const change of ['remove', 'archive', 'parent', 'origin', 'blank'] as const) {
  test(`03 子の取得中 ${change} へ変化した候補を選択せず再選択できる`, async ({ page }) => {
    await exposeMock(page); await visit(page, '/s/readme-review'); await holdChild(page)
    await open(page); await search(page).fill('承認シートの見直し'); await row(page, '承認シートの見直し').click()
    await expect.poll(() => page.evaluate(() => (window as any).__pickerCalls.refresh)).toBe(1)
    await page.evaluate(async change => {
      const ctx = (window as any).__pickerContext
      if (change === 'archive') await ctx.workspaces.archiveSession('session-tools-review')
      else ctx.mock.updateList((list: any) => {
        if (change === 'remove') list.ids = list.ids.filter((id: string) => id !== 'session-tools-review')
        else list.byId['session-tools-review'] = { ...list.byId['session-tools-review'], ...(change === 'parent' ? { parentId: 'readme-review' } : change === 'origin' ? { origin: undefined } : { blank: true }) }
      })
    }, change)
    await releaseChild(page)
    await expect(sheet(page).getByRole('alert')).toContainText('状態が変わりました')
    await expect(page).toHaveURL(/#\/s\/readme-review$/)
    expect(await page.evaluate(() => (window as any).__pickerCalls.select)).toBe(0)
    await search(page).fill('README'); await row(page, 'README の見直し').click(); await closed(page)
  })
}

test('03 キーボードで別の会話を選び閉じた後のフォーカスを確認する', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await visit(page, '/s/readme-review'); await trigger(page).focus(); await open(page)
  await search(page).fill('承認シートの見直し')
  await row(page, '承認シートの見直し').focus(); await page.keyboard.press('Enter'); await closed(page)
  await expect(page).toHaveURL(/#\/s\/session-tools-review$/)
  await expect(trigger(page)).toBeFocused()
  await info.attach('keyboard-selection-focus', { body: JSON.stringify(await page.evaluate(() => ({ tag: document.activeElement?.tagName, label: document.activeElement?.getAttribute('aria-label'), body: document.activeElement === document.body }))), contentType: 'application/json' })
})

for (const mode of ['one-shot', 'unknown', 'error'] as const) {
  test(`03 待機後の子カタログ ${mode} を最新状態で確認する`, async ({ page }) => {
    await exposeMock(page); await visit(page, '/s/readme-review')
    await page.getByLabel('メッセージ入力欄', { exact: true }).fill('最新mode確認前の通常下書き')
    await holdChild(page); await open(page); await search(page).fill('承認シートの見直し')
    await row(page, '承認シートの見直し').click()
    await page.evaluate(mode => {
      const state = window as any, parent = state.__pickerCatalog['approval-sheet']
      state.__pickerCatalog = { 'approval-sheet': mode === 'error'
        ? { state: 'error', error: { code: 'gateway/internal', message: '合成の取得失敗', details: {} } }
        : { ...parent, entries: parent.entries.map((entry: any) => entry.id === 'session-tools-review' ? { ...entry, mode } : entry) } }
    }, mode)
    await releaseChild(page)
    if (mode === 'one-shot') {
      await closed(page); await expect(page).toHaveURL(/#\/s\/session-tools-review$/)
      await expect(page.getByLabel('メッセージ入力欄', { exact: true })).toHaveCount(0)
      await expect(page.getByText('このサブエージェントの会話は読むだけです。', { exact: true })).toBeVisible()
      await open(page); await search(page).fill('README'); await row(page, 'README の見直し').click(); await closed(page)
    } else {
      await expect(sheet(page).getByRole('alert')).toBeVisible()
      expect(await page.evaluate(() => (window as any).__pickerCalls.select)).toBe(0)
      await sheet(page).getByRole('button', { name: '閉じる', exact: true }).click(); await closed(page)
    }
    await expect(page.getByLabel('メッセージ入力欄', { exact: true })).toHaveValue('最新mode確認前の通常下書き')
  })
}

test('03 閉鎖完了前に別会話へ移ったキーボードfocusを奪わない', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await visit(page, '/s/readme-review'); await open(page); await search(page).fill('承認シートの見直し')
  await row(page, '承認シートの見直し').focus(); await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#\/s\/session-tools-review$/)
  await page.evaluate(() => { window.location.hash = '/s/readme-review' })
  await closed(page)
  const input = page.getByLabel('メッセージ入力欄', { exact: true })
  await input.focus(); await flush(page); await expect(input).toBeFocused()
})
