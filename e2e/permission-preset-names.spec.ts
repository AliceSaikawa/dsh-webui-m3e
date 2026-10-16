import { test, expect, visit } from './helpers'
import type { Page } from '@playwright/test'

/**
 * Expose the mock context and let one test pretend the Host names the built-in
 * presets after their machine key with the stock English descriptions, which is
 * what a real DSH sends.
 */
async function expose(page: Page, extra = '') {
  await page.route('**/src/dsh/mock/context.ts*', async route => {
    const response = await route.fetch(), body = await response.text()
    expect(body.match(/\breturn ctx;?/g)).toHaveLength(1)
    await route.fulfill({ response, body: body.replace(/\breturn ctx;?/, `globalThis.__permissionNames = ctx; ${extra} return ctx;`) })
  })
}

const renameToKeys = `
  const original = ctx.remote.permissionPresets.catalog.bind(ctx.remote.permissionPresets);
  const rename = option => ({ ...option, name: option.value, description: option.value === 'workspace-write'
    ? 'Write inside the workspace and permitted temporary directories; wider retries require approval.'
    : 'Full file access without approval prompts.' });
  ctx.remote.permissionPresets.catalog = async () => {
    const result = await original();
    if (!result.ok) return result;
    return { ok: true, value: { ...result.value,
      options: [...result.value.options.map(rename), { value: 'auto', name: 'auto', description: 'Run without a sandbox after an experimental same-model review.' }],
      defaultOptions: result.value.defaultOptions.map(rename) } };
  };
`

const sheet = (page: Page) => page.locator('m3e-bottom-sheet[aria-label="権限の選び直し"]')
const chip = (page: Page) => page.locator('.composer-permission-label')

function commandRuns(page: Page): Promise<number> {
  return page.evaluate(() => {
    const ctx = (globalThis as any).__permissionNames
    return ctx.mock.getRecords('readme-review').filter((record: any) => record.type === 'command/run').length
  })
}

test('#103 キーのままのプリセット名と標準の英語の説明を日本語にして出す', async ({ page }) => {
  await expose(page, renameToKeys)
  await visit(page, '/s/readme-review')
  await expect(chip(page)).toHaveText('ワークスペース書込')
  await chip(page).click()
  await expect(sheet(page)).toBeVisible()
  const rows = sheet(page).locator('.composer-sheet-row')
  await expect(rows).toHaveCount(3)
  const workspace = rows.nth(0)
  await expect(workspace).toHaveAccessibleName(/^ワークスペース書込 /)
  await expect(workspace.locator('small')).toHaveText('作業フォルダと許可された一時フォルダの中に書き込めます。範囲を広げるときは確認します。')
  await expect(workspace).toHaveAttribute('aria-pressed', 'true')
  const full = rows.nth(1)
  await expect(full).toHaveAccessibleName(/^フル アクセス /)
  await expect(full.locator('small')).toHaveText('確認なしで、すべてのファイルにアクセスできます。')
  const auto = rows.nth(2)
  await expect(auto).toHaveAccessibleName(/^自動レビュー（実験的） /)
  await expect(auto.locator('small')).toHaveText('サンドボックスなしで動きます。ツールを呼び出すたびに、同じモデルが実験的に確認します。')
  // Auto runs without a sandbox, so its row carries the warning glyph.
  await expect(auto.locator('.composer-sheet-icon')).toHaveText('warning')
})

test('#103 今と同じプリセットを選び直しても /permission を送らない', async ({ page }) => {
  await expose(page)
  await visit(page, '/s/readme-review')
  await expect(chip(page)).toHaveText('ワークスペース書込')
  await chip(page).click()
  await expect(sheet(page)).toBeVisible()
  const before = await commandRuns(page)
  await sheet(page).locator('.composer-sheet-row[aria-pressed="true"]').click()
  await expect(sheet(page)).toHaveCount(0)
  await expect(chip(page)).toHaveText('ワークスペース書込')
  // The buggy path awaited the command before closing, so this is already settled.
  expect(await commandRuns(page)).toBe(before)
  // A different preset still switches and sends the command.
  await chip(page).click()
  await expect(sheet(page)).toBeVisible()
  await sheet(page).locator('.composer-sheet-row', { hasText: 'フル アクセス' }).click()
  await expect(chip(page)).toHaveText('フル アクセス')
  await expect.poll(() => commandRuns(page)).toBe(before + 1)
})
