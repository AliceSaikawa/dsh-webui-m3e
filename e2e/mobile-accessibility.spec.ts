import { test, expect, visit, button } from './helpers'
import type { InteractionStore, PendingQuestion } from '../web/src/dsh/interactions-store.ts'

declare global { interface Window {
  __a11yStore?: InteractionStore
  __a11yResolve?: () => void
  __a11yReject?: () => void
  __a11yClose?: () => void
} }

test('画像の全画面シートは見出しへフォーカスし、閉じると開いた画像へ戻る', async ({ page }) => {
  await visit(page, '/s/chat-samples')
  const trigger = button(page, '入力画像.pngを全画面で表示')
  await trigger.focus()
  await page.keyboard.press('Enter')
  const heading = page.locator('.chat-image-full h2')
  await expect(heading).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(button(page, '閉じる')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('.chat-image-full')).toHaveCount(0)
  await expect(trigger).toBeFocused()
})

test('画像シートは割込みから戻っても見出しへ移動し、閉じるボタンで入口へ戻る', async ({ page }) => {
  await visit(page, '/s/chat-samples')
  const trigger = button(page, '入力画像.pngを全画面で表示')
  await trigger.focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.chat-image-full h2')).toBeFocused()
  await page.evaluate(async () => {
    const path = '/m3e/src/app/overlay/store.ts'
    const { openSheet } = await import(path)
    window.__a11yClose = openSheet('割込みの確認', { label: '割込みの確認' })
  })
  await expect(page.getByRole('dialog', { name: '割込みの確認' })).toBeVisible()
  await page.evaluate(() => window.__a11yClose!())
  await expect(page.locator('.chat-image-full h2')).toBeFocused()
  await button(page, '閉じる').click()
  await expect(trigger).toBeFocused()
})

test('ドロワーは開くと内部へフォーカスし、Escapeで閉じて入口へ戻る', async ({ page }) => {
  await visit(page)
  const trigger = button(page, 'ワークスペースを切り替え')
  await trigger.focus()
  await page.keyboard.press('Enter')
  const drawer = page.getByRole('dialog', { name: 'ワークスペースを切り替え' })
  await expect(drawer.getByRole('button', { name: '閉じる' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.locator('m3e-drawer-container')).toHaveJSProperty('start', false)
  await expect(trigger).toBeFocused()
})

test('モーダルドロワーのTabとShift+Tabは背景へ抜けない', async ({ page }) => {
  await visit(page)
  await button(page, 'ワークスペースを切り替え').click()
  const drawer = page.getByRole('dialog', { name: 'ワークスペースを切り替え' })
  // Set the initial focus explicitly so this separately checks the native M3E
  // focus trap rather than depending on the application's entry-focus fix.
  await drawer.getByRole('button', { name: '閉じる' }).focus()
  for (const key of ['Tab', 'Shift+Tab']) {
    for (let index = 0; index < 8; index++) {
      await page.keyboard.press(key)
      await expect.poll(() => drawer.evaluate(node => node.contains(document.activeElement))).toBe(true)
    }
  }
})

test('ドロワーの選択・閉じる・外側タップでも入口へ復帰する', async ({ page }) => {
  await visit(page)
  const trigger = button(page, 'ワークスペースを切り替え')
  const drawer = page.getByRole('dialog', { name: 'ワークスペースを切り替え' })
  for (const method of ['selection', 'close', 'scrim']) {
    await trigger.focus()
    await page.keyboard.press('Enter')
    await expect(drawer.getByRole('button', { name: '閉じる' })).toBeFocused()
    if (method === 'selection') {
      await drawer.locator('m3e-nav-menu').focus()
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
    } else if (method === 'close') await drawer.getByRole('button', { name: '閉じる' }).click()
    else await page.locator('m3e-drawer-container .scrim').click({ position: { x: 385, y: 100 } })
    await expect(page.locator('m3e-drawer-container')).toHaveJSProperty('start', false)
    await expect(trigger).toBeFocused()
  }
})

test('通常の質問の見出しはh2から始まる', async ({ page }) => {
  await visit(page, '/s/05-db-choice', 'question')
  await expect(page.getByRole('heading', { name: 'どちらのデータベースにしますか', level: 2 })).toBeVisible()
  await expect(page.locator('.interaction-sheet h3')).toHaveCount(0)
})

test('プランと通常の問いが混ざる場合はシートのh2の下にh3を置く', async ({ page }) => {
  await page.route('**/src/features/interactions/mock.ts*', async route => {
    const response = await route.fetch(), body = await response.text()
    const questions = /questions: \[structuredClone\(planQuestion\)\]/
    expect(body.match(new RegExp(questions.source, 'g'))).toHaveLength(1)
    await route.fulfill({ response, body: body.replace(questions,
      'questions: [structuredClone(planQuestion), ...structuredClone(databaseQuestions)]') })
  })
  await visit(page, '/s/05-auth-redesign', 'plan')
  await expect(page.getByRole('heading', { name: 'プランの確認', level: 2 })).toBeVisible()
  await expect(page.getByRole('heading', { name: '認証の作り直し', level: 3 })).toBeVisible()
  await button(page, 'このプランで進める').click()
  await expect(page.getByRole('heading', { name: 'どちらのデータベースにしますか', level: 3 })).toBeVisible()
})

test('ドロワーから操作シートへ移ると入口へフォーカスを奪い戻さない', async ({ page }) => {
  await visit(page)
  const trigger = button(page, 'ワークスペースを切り替え')
  await trigger.click()
  await page.locator('.home-drawer m3e-nav-menu').focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Shift+F10')
  const sheet = page.locator('m3e-bottom-sheet')
  await expect(sheet).toBeVisible()
  await expect.poll(() => sheet.evaluate(node => node.contains(document.activeElement))).toBe(true)
  await expect(trigger).not.toBeFocused()
})

test('回答の送信中はbusy領域の外で通知し、失敗時に通知を解除して再試行できる', async ({ page }) => {
  await page.route('**/src/dsh/interactions.ts*', async route => {
    const response = await route.fetch(), body = await response.text()
    const creation = /const store = new InteractionStore\(\);?/
    expect(body.match(new RegExp(creation.source, 'g'))).toHaveLength(1)
    await route.fulfill({ response, body: body.replace(creation, '$& globalThis.__a11yStore = store;') })
  })
  await visit(page, '/s/05-db-choice', 'question')
  await expect(page.getByRole('heading', { name: 'どちらのデータベースにしますか' })).toBeVisible()
  await page.evaluate(() => {
    const pending = window.__a11yStore!.getSnapshot().find(item => item.kind === 'question') as PendingQuestion
    const original = pending.answer.bind(pending)
    pending.answer = async answer => {
      await new Promise<void>((resolve, reject) => {
        window.__a11yResolve = resolve
        window.__a11yReject = () => reject(new Error('テスト用の送信失敗'))
      })
      await original(answer)
    }
  })
  await page.getByText('PostgreSQL', { exact: true }).click()
  await button(page, '次へ').click()
  await page.getByText('データの移行', { exact: true }).click()
  await button(page, '回答する').click()
  const sheet = page.locator('.interaction-sheet')
  await expect(sheet).toHaveAttribute('aria-busy', 'true')
  const status = page.getByRole('status').filter({ hasText: '回答を送信しています' })
  await expect(status).toBeVisible()
  expect(await status.evaluate(node => node.closest('[aria-busy="true"]') === null)).toBe(true)
  await page.evaluate(() => window.__a11yReject!())
  await expect(sheet).toHaveAttribute('aria-busy', 'false')
  await expect(status).toHaveCount(0)
  await expect(page.getByRole('alert')).toContainText('回答を送れませんでした')
  await button(page, '回答する').click()
  await expect(status).toBeVisible()
  await page.evaluate(() => window.__a11yResolve!())
  await expect(sheet).toHaveCount(0)
})
