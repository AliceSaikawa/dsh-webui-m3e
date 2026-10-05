import type { Page } from '@playwright/test'
import { test, expect, visit, button, action, shot, nav } from './helpers'

async function expose(page: Page) {
  await page.route('**/src/dsh/mock/context.ts*', async route => {
    const response = await route.fetch(), body = await response.text()
    expect(body.match(/\breturn ctx;?/g)).toHaveLength(1)
    await route.fulfill({ response, body: body.replace(/\breturn ctx;?/, `
      globalThis.__i16 = ctx;
      globalThis.__i16writes = [];
      const mutate = ctx.remote.settings.mutate;
      ctx.remote.settings.mutate = (...args) => { globalThis.__i16writes.push(args); return mutate(...args); };
      return ctx;`) })
  })
}
const form = (page: Page) => page.locator('.custom-provider-form')
const row = (page: Page) => page.getByRole('group', { name: '試験提供元', exact: true })
async function fill(page: Page, id = 'test-provider') {
  await button(page, 'カスタムプロバイダーを追加').click()
  await expect(form(page).getByRole('heading', { level: 2 })).toBeFocused()
  await page.getByLabel('プロバイダー ID', { exact: true }).fill(id)
  await page.getByLabel('表示名（任意）', { exact: true }).fill('試験提供元')
  await page.getByLabel('ベース URL', { exact: true }).fill('http://localhost:4321/v1')
  await page.getByLabel('モデル ID', { exact: true }).fill('test-model')
}
const writes = (page: Page) => page.evaluate(() => (window as any).__i16writes.length)

test('I16 UI lifecycle: 追加と編集、行操作、欄エラーとモデル候補を確認する', async ({ page }) => {
  await expose(page); await visit(page, '/settings/providers'); await fill(page)
  await page.getByLabel('プロバイダー ID', { exact: true }).fill('cloud')
  await button(page, '保存').click()
  await expect(page.getByText('このプロバイダー ID は使われています。別の ID を入力してください。')).toBeVisible()
  await page.getByLabel('プロバイダー ID', { exact: true }).fill('test-provider')
  await button(page, 'モデルを追加').click()
  await page.getByLabel('モデル ID', { exact: true }).last().fill('test-model')
  await button(page, '保存').click()
  await expect(page.getByText('このモデル ID は同じ一覧にあります。')).toBeVisible()
  await expect(page.getByLabel('モデル ID', { exact: true }).last()).toBeFocused()
  expect(await writes(page)).toBe(0)
  await button(page, 'モデルを削除').last().click()
  await page.getByText('詳細', { exact: true }).click()
  await page.getByLabel('コンテキスト長', { exact: true }).fill('0')
  await button(page, '保存').click()
  await expect(page.getByText('1 以上の整数を入力してください。')).toBeVisible()
  await page.getByLabel('コンテキスト長', { exact: true }).fill('4096')
  await expect(page.getByLabel('コンテキスト長', { exact: true })).toBeVisible()
  await button(page, '保存').click(); await expect(form(page)).toBeHidden()
  await expect(row(page)).toContainText('API キー：未登録')
  expect(await writes(page)).toBe(1)
  await row(page).getByRole('button', { name: '編集', exact: true }).click()
  await expect(page.getByLabel('プロバイダー ID', { exact: true })).toBeDisabled()
  await expect(page.getByLabel('ベース URL', { exact: true })).toHaveValue('http://localhost:4321/v1')
  await page.getByLabel('モデル表示名（任意）', { exact: true }).fill('新しいモデル名')
  await button(page, 'モデルを追加').click()
  await page.getByLabel('モデル ID', { exact: true }).last().fill('second-model')
  await button(page, '保存').click(); await expect(form(page)).toBeHidden()
  const ops = await page.evaluate(() => (window as any).__i16writes[1][1])
  expect(ops.map((op: any) => op.path)).toEqual([['providers', 'test-provider', 'models']])
  await button(page, '戻る').click(); await nav(page, '設定').click(); await action(page, 'モデル').first().click()
  const picker = page.locator('m3e-select[aria-label="モデル"]')
  await expect(picker).toHaveJSProperty('value', '8:deepseekdeepseek-v4')
  await picker.click()
  await expect(page.locator('m3e-option').filter({ hasText: '新しいモデル名' }).last()).toBeVisible()
})

test('I16 UI dismiss: キャンセル・閉じる・Escape・戻るの破棄と375pxを確認する', async ({ page }) => {
  await expose(page); await visit(page, '/settings')
  await action(page, '提供元と API キー').click()
  for (const mode of ['キャンセル', '閉じる', 'Escape', '戻る']) {
    await fill(page)
    const key = page.getByLabel('API キー（任意）', { exact: true })
    await key.fill('fake-draft'); await expect(key).toHaveAttribute('type', 'password')
    await button(page, '入力したキーを表示する').click(); await expect(key).toHaveAttribute('type', 'text')
    if (mode === 'Escape') await page.keyboard.press('Escape')
    else if (mode === '戻る') await page.goBack()
    else await button(page, mode).click()
    await expect(form(page)).toBeHidden()
    if (mode === '戻る') await action(page, '提供元と API キー').click()
    expect(await writes(page)).toBe(0)
    await button(page, 'カスタムプロバイダーを追加').click()
    await expect(key).toHaveValue(''); await expect(key).toHaveAttribute('type', 'password')
    await expect(page.getByLabel('プロバイダー ID', { exact: true })).toHaveValue('')
    await button(page, 'キャンセル').click()
  }
  await page.setViewportSize({ width: 375, height: 420 }); await fill(page)
  await expect(page.locator('m3e-bottom-sheet.full-sheet')).toHaveJSProperty('detents', ['full'])
  await expect.poll(() => page.locator('m3e-bottom-sheet.full-sheet').evaluate(element => Math.round(element.getBoundingClientRect().height))).toBe(420)
  await page.getByLabel('モデル ID', { exact: true }).focus()
  await button(page, '保存').scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await shot(page, 'issue16-375-short')
  await button(page, '保存').click(); await expect(row(page)).toBeVisible()
})

test('I16 UI blocked: 読み取り専用・名前空間なし・取得失敗の理由を出す', async ({ page }) => {
  for (const [scenario, message] of [
    ['settings-readonly', 'この DSH では設定を変更できません'],
    ['custom-no-namespace', 'この DSH ではカスタムプロバイダーを設定できません。'],
    ['custom-unavailable', '提供元と API キーの登録状況を読み込めませんでした。もう一度お試しください。'],
  ]) {
    await visit(page, '/settings/providers', scenario)
    await expect(button(page, 'カスタムプロバイダーを追加')).toBeDisabled()
    await expect(page.getByText(message, { exact: true }).first()).toBeVisible()
  }
})

test('I16 UI refused: 保存拒否と競合は自動再送せず下書きを残す', async ({ page }) => {
  await expose(page)
  for (const scenario of ['custom-rejected', 'custom-conflict']) {
    await visit(page, '/settings/providers', scenario); await fill(page)
    await page.getByLabel('API キー（任意）', { exact: true }).fill('fake-once')
    await button(page, '保存').click()
    await expect(form(page).getByRole('alert')).toHaveText(scenario === 'custom-conflict'
      ? 'ほかの場所で設定が変わりました。再読み込みして、変更内容を確認してください。'
      : 'この変更は保存できませんでした。入力内容を確認してください。')
    await expect(page.getByLabel('API キー（任意）', { exact: true })).toHaveValue('')
    await expect(page.getByLabel('ベース URL', { exact: true })).toHaveValue('http://localhost:4321/v1')
    expect(await writes(page)).toBe(1)
    if (scenario === 'custom-conflict') {
      await expect(button(page, '保存')).toBeDisabled()
      await button(page, '再読み込み').click()
      await expect(page.getByLabel('プロバイダー ID', { exact: true })).toHaveValue('')
    }
    await button(page, 'キャンセル').click()
  }
})

test('I16 UI lost: 応答喪失後は確認して既存設定を編集する', async ({ page }) => {
  await expose(page); await visit(page, '/settings/providers', 'custom-response-lost'); await fill(page)
  await button(page, '保存').click()
  await expect(form(page).getByRole('alert')).toHaveText('接続が切れました。保存できたか確認してから、もう一度お試しください。')
  await expect(button(page, '保存')).toBeDisabled()
  await page.evaluate(() => (window as any).__i16.mock.setConnectionState('connected'))
  await button(page, '保存結果を確認').click()
  await expect(page.getByLabel('プロバイダー ID', { exact: true })).toHaveValue('test-provider')
  await expect(page.getByLabel('プロバイダー ID', { exact: true })).toBeDisabled()
  expect(await writes(page)).toBe(1)
})

test('I16 UI partial: 設定だけ成功したらキーだけ再試行する', async ({ page }) => {
  await expose(page); await visit(page, '/settings/providers', 'custom-partial'); await fill(page)
  await page.getByLabel('API キー（任意）', { exact: true }).fill('fake-first')
  await button(page, '保存').click()
  await expect(form(page).getByRole('alert')).toHaveText('提供元の設定は保存しましたが、API キーを保存できませんでした。入力し直してください。')
  await expect(page.getByLabel('API キー（任意）', { exact: true })).toHaveValue('')
  expect(await writes(page)).toBe(1)
  await page.getByLabel('API キー（任意）', { exact: true }).fill('fake-second')
  await button(page, 'API キーを保存').click(); await expect(form(page)).toBeHidden()
  expect(await writes(page)).toBe(1)
  await expect(row(page)).toContainText('API キー：登録済み')
})

test('I16 UI late: 二重送信せず閉じたあとからキーを送らない', async ({ page }) => {
  await expose(page); await visit(page, '/settings/providers', 'custom-slow'); await fill(page)
  await page.getByLabel('API キー（任意）', { exact: true }).fill('fake-discard')
  await button(page, '保存').dblclick()
  await expect.poll(() => page.evaluate(() => (window as any).__i16.mock.remoteOf('customProviderTest').pendingSaves())).toBe(1)
  await expect(page.getByText('保存しています…', { exact: true })).toBeVisible()
  await expect(page.getByLabel('API キー（任意）', { exact: true })).toHaveValue('')
  await button(page, '閉じる').click()
  await expect(form(page)).toBeHidden()
  expect(await row(page).count()).toBe(0)
  await page.evaluate(() => (window as any).__i16.mock.remoteOf('customProviderTest').releaseSaves())
  await expect(row(page)).toContainText('API キー：未登録')
  expect(await writes(page)).toBe(1)
  await button(page, 'カスタムプロバイダーを追加').click()
  await expect(page.getByLabel('プロバイダー ID', { exact: true })).toHaveValue('')
})

test('I16 UI URL: HTTP以外を欄エラーで止めIPv6と前後空白を扱う', async ({ page }) => {
  await expose(page); await visit(page, '/settings/providers'); await fill(page)
  const url = page.getByLabel('ベース URL', { exact: true })
  for (const value of ['not a url', 'ftp://localhost', '   ', 'http://']) {
    await url.fill(value); await button(page, '保存').click()
    await expect(form(page).getByRole('alert')).toHaveText(value.trim()
      ? 'http:// または https:// で始まる URL を入力してください。' : 'ベース URL を入力してください。')
    await expect(url).toBeFocused()
    expect(await writes(page)).toBe(0)
  }
  await url.fill('  https://[::1]:1234/v1  ')
  await button(page, '保存').click(); await expect(form(page)).toBeHidden()
  const ops = await page.evaluate(() => (window as any).__i16writes[0][1])
  expect(ops[0].value.baseURL).toBe('https://[::1]:1234/v1')
  await row(page).getByRole('button', { name: '編集', exact: true }).click()
  await expect(url).toHaveValue('https://[::1]:1234/v1')
})

test('I16 UI saving M39: 設定とキーを待つ間は保存ボタンを無効にする', async ({ page }) => {
  await expose(page)
  for (const withKey of [false, true]) {
    await page.goto('about:blank')
    await visit(page, '/settings/providers', 'custom-slow'); await fill(page)
    if (withKey) {
      await page.getByLabel('API キー（任意）', { exact: true }).fill('fake-pending-key')
      await page.evaluate(() => {
        const w = window as any, settings = w.__i16.remote.settings
        const mutate = settings.mutate, describe = settings.describe
        let committed = false
        const held = new Promise<void>(resolve => { w.__releaseKey = resolve })
        settings.mutate = async (...args: any[]) => { const result = await mutate(...args); committed = true; return result }
        settings.describe = async (...args: any[]) => {
          const result = await describe(...args)
          if (committed) { w.__keyWaiting = true; await held }
          return result
        }
      })
    }
    await button(page, '保存').click()
    await expect.poll(() => page.evaluate(() => (window as any).__i16.mock.remoteOf('customProviderTest').pendingSaves())).toBe(1)
    await expect(button(page, '保存')).toBeDisabled()
    await page.evaluate(() => (window as any).__i16.mock.remoteOf('customProviderTest').releaseSaves())
    if (withKey) {
      await expect.poll(() => page.evaluate(() => (window as any).__keyWaiting === true)).toBe(true)
      await expect(page.getByText('保存しています…', { exact: true })).toBeVisible()
      await expect(button(page, '保存')).toBeDisabled()
      await expect(page.getByLabel('API キー（任意）', { exact: true })).toHaveValue('')
      await page.evaluate(() => (window as any).__releaseKey())
    }
    await expect(form(page)).toBeHidden()
    await expect(row(page)).toContainText(withKey ? 'API キー：登録済み' : 'API キー：未登録')
    expect(await writes(page)).toBe(1)
  }
})

test('I16 UI input M22: 継承を外して選択しなければ欄エラーで保存しない', async ({ page }) => {
  await expose(page); await visit(page, '/settings/providers'); await fill(page)
  await page.getByText('詳細', { exact: true }).click()
  await page.getByLabel('提供元の既定値を使う', { exact: true }).uncheck()
  await button(page, '保存').click()
  await expect(form(page).getByRole('alert')).toHaveText('入力種別を 1 つ以上選んでください。')
  await expect(page.locator('.custom-modalities')).toBeFocused()
  expect(await writes(page)).toBe(0)
  await page.getByLabel('画像', { exact: true }).check()
  await button(page, '保存').click(); await expect(form(page)).toBeHidden()
  expect(await page.evaluate(() => (window as any).__i16writes[0][1][0].value.models[0].input)).toEqual(['image'])
})

test('I16 UI destinations: 衝突中のキー操作を止め参照先だけの状態を案内する', async ({ page }) => {
  await expose(page); await visit(page, '/settings/providers'); await fill(page, 'LOCAL-API')
  await button(page, '保存').click(); await expect(form(page)).toBeHidden()
  await page.evaluate(async () => {
    const settings = (window as any).__i16.remote.settings
    const ns = (await settings.describe()).value.namespaces.find((row: any) => row.ns === 'llm-pi-ai')
    const result = await settings.mutate(ns.ns, [
      { op: 'set', path: ['providers', 'cloud', 'apiKeyEnv'], value: 'LOCAL_API_API_KEY' },
      { op: 'set', path: ['providers', 'LOCAL-API', 'apiKeyEnv'], value: 'LOCAL_API_API_KEY' },
    ], ns.revision)
    if (!result.ok) throw new Error('設定できません')
  })
  await expect(row(page)).toContainText('別の提供元とキーの参照名が重なります。')
  await expect(row(page)).toContainText('登録状況を確認できません')
  await expect(row(page).getByRole('button', { name: 'API キー', exact: true })).toBeDisabled()
  await row(page).getByRole('button', { name: '編集', exact: true }).click()
  await expect(form(page)).toContainText('この画面ではキーを登録・削除できません。')
  await page.getByLabel('API キー（任意）', { exact: true }).fill('fake-reopened-collision')
  const before = await writes(page)
  await button(page, '保存').click()
  await expect(form(page).getByRole('alert')).toContainText('参照名が重なります')
  expect(await writes(page)).toBe(before)
  await form(page).getByRole('button', { name: '閉じる', exact: true }).click()
  await page.evaluate(async () => {
    const settings = (window as any).__i16.remote.settings
    const ns = (await settings.describe()).value.namespaces.find((row: any) => row.ns === 'llm-pi-ai')
    if (!(await settings.mutate(ns.ns, [{ op: 'set', path: ['providers', 'cloud', 'apiKeyEnv'], value: 'PI_AI_API_KEY' }], ns.revision)).ok) throw new Error('設定できません')
  })
  await expect(row(page)).toContainText('キーの参照先だけが設定されています。キーを登録するまで、この提供元を使えない場合があります。')
  await row(page).getByRole('button', { name: '編集', exact: true }).click()
  await expect(form(page)).toContainText('キーの参照先だけが設定されています。')
  await page.getByLabel('API キー（任意）', { exact: true }).fill('fake-retry-after-reference')
  await button(page, '保存').click(); await expect(form(page)).toBeHidden()
  await expect(row(page)).toContainText('API キー：登録済み')
  await expect(row(page)).not.toContainText('キーの参照先だけが設定されています。')
})
