import type { Page } from '@playwright/test'
import { test, expect, visit, action, button } from './helpers'

const syntheticKey = 'synthetic-issue27-input'
const input = (page: Page) => page.getByLabel('API キー', { exact: true })
const cloud = (page: Page) => action(page, 'クラウド提供元')

async function setup(page: Page, attach = false, provider = 'クラウド提供元') {
  await page.route('**/src/dsh/mock/context.ts*', async route => {
    const response = await route.fetch(), body = await response.text()
    expect(body.match(/\breturn ctx;?/g)).toHaveLength(1)
    await route.fulfill({ response, body: body.replace(/\breturn ctx;?/, `
      globalThis.__keyLifetime = { ctx, writes: 0 };
      ${attach ? `
      {
        let named = false;
        const describe = ctx.remote.settings.describe;
        ctx.remote.settings.describe = async () => {
          const result = await describe();
          if (result.ok && !named) delete result.value.namespaces.find(row => row.ns === 'llm-pi-ai').value.providers.cloud.apiKeyEnv;
          return result;
        };
        const list = ctx.remote.llm.listProviders;
        ctx.remote.llm.listProviders = async () => { const result = await list(); if (result.ok) result.value = result.value.filter(row => row.id !== 'cloud'); return result; };
        const update = ctx.remote.settings.update;
        ctx.remote.settings.update = async (...args) => { const result = await update(...args); if (result.ok) named = true; return result; };
      }
      ` : ''}
      return ctx;`) })
  })
  await visit(page, '/settings/providers')
  await expect(cloud(page)).toContainText('API キー：未登録')
  await page.evaluate(() => {
    const probe = (window as any).__keyLifetime
    const set = probe.ctx.remote.credentials.set
    probe.ctx.remote.credentials.set = (...args: any[]) => { probe.writes++; return set(...args) }
  })
  await action(page, provider).click()
  await expect(input(page)).toBeEnabled()
}

async function hold(page: Page, stage: 'describe' | 'attach' | 'send') {
  await page.evaluate(stage => {
    const probe = (window as any).__keyLifetime
    const api = stage === 'send' ? probe.ctx.remote.credentials : probe.ctx.remote.settings
    const method = stage === 'attach' ? 'update' : stage === 'send' ? 'set' : 'describe'
    const original = api[method]
    const held = new Promise<void>(resolve => { probe.release = resolve })
    probe.started = false; probe.finished = false
    api[method] = async (...args: any[]) => {
      api[method] = original
      probe.started = true
      // settings.update has already attached the reference before its response is held.
      const result = stage === 'describe' ? undefined : await original(...args)
      await held
      probe.finished = true
      return stage === 'describe' ? original(...args) : result
    }
  }, stage)
}

for (const stage of ['describe', 'attach'] as const) test(`#27 ${stage}待機中に閉じたキー入力は送信しない`, async ({ page }) => {
  await setup(page, stage === 'attach')
  await input(page).fill(syntheticKey)
  await hold(page, stage)
  await button(page, '保存').click()
  await expect.poll(() => page.evaluate(() => (window as any).__keyLifetime.started)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(input(page)).toBeHidden()
  await page.evaluate(() => (window as any).__keyLifetime.release())
  await expect(cloud(page)).toBeEnabled()
  expect(await page.evaluate(() => (window as any).__keyLifetime.writes)).toBe(0)
  await expect(cloud(page)).toContainText('API キー：未登録')
  await cloud(page).click()
  await expect(input(page)).toHaveValue('')
  await expect(input(page)).toHaveAttribute('type', 'password')
})

test('#27 切断したキー入力と表示状態は再接続しても復元しない', async ({ page }) => {
  await setup(page)
  await input(page).fill(syntheticKey)
  await button(page, '入力したキーを表示する').click()
  await expect(input(page)).toHaveAttribute('type', 'text')
  await page.evaluate(() => (window as any).__keyLifetime.ctx.mock.setConnectionState('disconnected'))
  await expect(input(page)).toBeDisabled()
  await expect(input(page)).toHaveValue('')
  await expect(input(page)).toHaveAttribute('type', 'password')
  await page.evaluate(() => (window as any).__keyLifetime.ctx.mock.setConnectionState('connected'))
  await expect(input(page)).toBeEnabled()
  await expect(input(page)).toHaveValue('')
  await expect(button(page, '保存')).toBeDisabled()
  expect(await page.evaluate(() => (window as any).__keyLifetime.writes)).toBe(0)
})

test('#27 キーは入力のプロパティだけに保持し属性やHTMLへ複製しない', async ({ page }) => {
  await setup(page)
  await input(page).fill(syntheticKey)
  for (const visible of [false, true, false]) {
    if (visible) await button(page, '入力したキーを表示する').click()
    else if (await input(page).getAttribute('type') === 'text') await button(page, '入力したキーを隠す').click()
    await expect(input(page)).toHaveValue(syntheticKey)
    expect(await input(page).getAttribute('value')).toBeNull()
    expect(await page.locator('html').innerHTML()).not.toContain(syntheticKey)
  }
})

test('#27 正常保存は一度だけ送信し入力を消す', async ({ page }) => {
  await setup(page)
  await input(page).fill(syntheticKey)
  await hold(page, 'send')
  await button(page, '保存').click()
  await expect.poll(() => page.evaluate(() => (window as any).__keyLifetime.started)).toBe(true)
  await expect(input(page)).toHaveValue('')
  await button(page, '保存').dispatchEvent('click')
  await input(page).dispatchEvent('keydown', { key: 'Enter' })
  expect(await page.evaluate(() => (window as any).__keyLifetime.writes)).toBe(1)
  await page.evaluate(() => (window as any).__keyLifetime.release())
  await expect(input(page)).toBeHidden()
  await expect(cloud(page)).toContainText('API キー：登録済み')
})

test('#27 シート削除と照会解放が同じタスクでもキーを送らない', async ({ page }) => {
  await setup(page)
  await input(page).fill(syntheticKey)
  await hold(page, 'describe')
  await button(page, '保存').click()
  await expect.poll(() => page.evaluate(() => (window as any).__keyLifetime.started)).toBe(true)
  await page.evaluate(async () => {
    // @ts-expect-error Vite serves this browser module.
    const { getOverlays } = await import('/m3e/src/app/overlay/store.ts')
    getOverlays().at(-1).close()
    ;(window as any).__keyLifetime.release()
  })
  await expect(input(page)).toBeHidden()
  await expect(cloud(page)).toBeEnabled()
  expect(await page.evaluate(() => (window as any).__keyLifetime.writes)).toBe(0)
})

test('#27 照会待機中の切断と再接続後も古い入力を送らない', async ({ page }) => {
  await setup(page)
  await input(page).fill(syntheticKey)
  await hold(page, 'describe')
  await button(page, '保存').click()
  await expect.poll(() => page.evaluate(() => (window as any).__keyLifetime.started)).toBe(true)
  await page.evaluate(() => {
    const p = (window as any).__keyLifetime
    p.ctx.mock.setConnectionState('disconnected')
    p.ctx.mock.setConnectionState('connected')
    p.release()
  })
  await expect(input(page)).toBeEnabled()
  await expect(input(page)).toHaveValue('')
  await expect(button(page, '保存')).toBeDisabled()
  expect(await page.evaluate(() => (window as any).__keyLifetime.writes)).toBe(0)
  // The stale result does not leave the new connection busy or close its sheet.
  await input(page).fill('synthetic-reconnect-retry')
  await button(page, '保存').click()
  await expect(cloud(page)).toContainText('API キー：登録済み')
  expect(await page.evaluate(() => (window as any).__keyLifetime.writes)).toBe(1)
})

test('#27 送信済みの応答後に閉じたシートや成功通知を復元しない', async ({ page }) => {
  await setup(page)
  await input(page).fill(syntheticKey)
  await hold(page, 'send')
  await button(page, '保存').click()
  await expect.poll(() => page.evaluate(() => (window as any).__keyLifetime.started)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(input(page)).toBeHidden()
  await page.evaluate(() => (window as any).__keyLifetime.release())
  await expect(cloud(page)).toBeEnabled()
  await expect(cloud(page)).toContainText('API キー：登録済み')
  await expect(page.getByText('API キーを保存しました', { exact: true })).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__keyLifetime.writes)).toBe(1)
})

test('#27 削除確認をキャンセルした入力欄は空の伏せ字に戻る', async ({ page }) => {
  await setup(page, false, 'ディープシーク')
  await input(page).fill(syntheticKey)
  await button(page, '入力したキーを表示する').click()
  await button(page, '登録を消す').click()
  await expect(page.getByRole('heading', { name: 'API キーの登録を消す', exact: true })).toBeVisible()
  await button(page, 'キャンセル').click()
  await expect(input(page)).toBeVisible()
  await expect(input(page)).toHaveValue('')
  await expect(input(page)).toHaveAttribute('type', 'password')
  await expect(button(page, '保存')).toBeDisabled()
})
