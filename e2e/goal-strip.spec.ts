import { test, expect, visit, button } from './helpers'
import type { Page } from '@playwright/test'

const OBJECTIVE = '承認シートを作り、テストで操作を確かめる'
const BLOCKED = '承認シートのテストに失敗しました。原因の確認が必要です。'
const REFRESHED = '変更できませんでした。最新のゴールを読み直しました。内容を確かめて、もう一度操作してください。'
const SAVE_FAILED = '保存できませんでした。もう一度お試しください。'
const EXHAUSTED = 'ラウンド数の上限に達したため、再開できません。'

const lines = (count: number) => Array.from({ length: count }, (_, index) => `${index + 1} 行目`).join('\n')

const strip = (page: Page) => page.getByTestId('goal-strip')
const objective = (page: Page) => strip(page).locator('.goal-strip-objective')
const status = (page: Page) => strip(page).locator('.goal-strip-status')
const message = (page: Page) => strip(page).locator('.goal-strip-message')
const editDialog = (page: Page) => page.locator('m3e-dialog[aria-label="目標の編集"]')

/** Expose the mock and count goals.edit calls (same pattern as stage6c). */
async function expose(page: Page) {
  await page.route('**/src/dsh/mock/context.ts*', async route => {
    const response = await route.fetch(), body = await response.text()
    expect(body.match(/\breturn ctx;?/g)).toHaveLength(1)
    await route.fulfill({ response, body: body.replace(/\breturn ctx;?/, `
      globalThis.__goalStrip = ctx;
      globalThis.__goalEdits = 0;
      const editGoal = ctx.remote.goals.edit;
      ctx.remote.goals.edit = (...args) => { globalThis.__goalEdits++; return editGoal(...args); };
      return ctx;`) })
  })
}

const edits = (page: Page) => page.evaluate(() => (window as any).__goalEdits)

/** Replace one goals RPC so the UI read-backs, while goals.get keeps working. */
async function failGoalMethod(page: Page, method: 'pause' | 'edit') {
  await page.evaluate(method => {
    (window as any).__goalStrip.remote.goals[method] = async () => ({
      ok: false, error: { code: 'gateway/internal', message: 'x', details: {} },
    })
  }, method)
}

async function openEdit(page: Page) {
  await strip(page).getByRole('button', { name: '目標を編集', exact: true }).click()
  await expect(editDialog(page)).toBeVisible()
  return editDialog(page).getByLabel('目標', { exact: true })
}

test('131 ゴールの帯に目標と状態を出し、押すとゴール画面を開く', async ({ page }) => {
  await visit(page, '/s/approval-sheet')
  await expect(strip(page)).toBeVisible()
  await expect(page.getByRole('group', { name: '現在のゴール' })).toHaveCount(1)
  await expect(objective(page)).toHaveText(OBJECTIVE)
  await expect(status(page)).toHaveText('進行中 ・ 3 / 8 ラウンド')
  await strip(page).locator('.goal-strip-body').click()
  await expect(page).toHaveURL(/#\/s\/approval-sheet\/goal$/)
  await expect(page.getByRole('heading', { name: 'ゴール', exact: true })).toBeVisible()
  await expect(page.getByText(OBJECTIVE, { exact: true })).toBeVisible()
})

test('131 帯から順に一時停止し、再開する', async ({ page }) => {
  await visit(page, '/s/approval-sheet')
  await expect(status(page)).toHaveText('進行中 ・ 3 / 8 ラウンド')
  await strip(page).getByRole('button', { name: '一時停止', exact: true }).click()
  await expect(status(page)).toHaveText('一時停止 ・ 3 / 8 ラウンド')
  await expect(page.locator('m3e-snackbar:popover-open').last()).toContainText('ゴールを一時停止しました')
  await expect(strip(page).getByRole('button', { name: '再開', exact: true })).toBeEnabled()
  await strip(page).getByRole('button', { name: '再開', exact: true }).click()
  await expect(status(page)).toHaveText('進行中 ・ 3 / 8 ラウンド')
  await expect(page.locator('m3e-snackbar:popover-open').last()).toContainText('ゴールを再開しました')
  await expect(strip(page).getByRole('button', { name: '一時停止', exact: true })).toBeEnabled()
})

test('131 目標を編集し、変更なしでは保存RPCを呼ばず、失敗では入力を残す', async ({ page }) => {
  await expose(page)
  await visit(page, '/s/approval-sheet')
  await expect(status(page)).toHaveText('進行中 ・ 3 / 8 ラウンド')

  const field = await openEdit(page)
  await expect(field).toHaveValue(OBJECTIVE)
  await field.fill('テストで確かめた目標')
  await editDialog(page).getByRole('button', { name: '保存', exact: true }).click()
  await expect(editDialog(page)).toHaveCount(0)
  await expect(objective(page)).toHaveText('テストで確かめた目標')
  expect(await edits(page)).toBe(1)

  // Unchanged text closes as success without sending goals.edit.
  const same = await openEdit(page)
  await expect(same).toHaveValue('テストで確かめた目標')
  await same.fill('テストで確かめた目標')
  await editDialog(page).getByRole('button', { name: '保存', exact: true }).click()
  await expect(editDialog(page)).toHaveCount(0)
  expect(await edits(page)).toBe(1)
  await expect(objective(page)).toHaveText('テストで確かめた目標')

  // A rejected edit keeps the dialog, its alert and the typed text.
  await failGoalMethod(page, 'edit')
  const failing = await openEdit(page)
  await failing.fill('保存に失敗する目標')
  await editDialog(page).getByRole('button', { name: '保存', exact: true }).click()
  await expect(editDialog(page)).toBeVisible()
  await expect(editDialog(page).getByRole('alert')).toHaveText(SAVE_FAILED)
  await expect(failing).toHaveValue('保存に失敗する目標')
  await editDialog(page).getByRole('button', { name: 'キャンセル', exact: true }).click()
  await expect(editDialog(page)).toHaveCount(0)
})

test('131 一時停止の失敗は帯にエラーを出し、読み直すで元に戻る', async ({ page }) => {
  await expose(page)
  await visit(page, '/s/approval-sheet')
  await expect(status(page)).toHaveText('進行中 ・ 3 / 8 ラウンド')
  await failGoalMethod(page, 'pause')
  await strip(page).getByRole('button', { name: '一時停止', exact: true }).click()
  await expect(strip(page).getByRole('alert')).toHaveText(REFRESHED)
  // Only the reload action remains while the strip reports the failure.
  await expect(strip(page).locator('.goal-strip-actions m3e-icon-button')).toHaveCount(1)
  await expect(strip(page).getByRole('button', { name: '読み直す', exact: true })).toBeEnabled()
  for (const name of ['一時停止', '再開', '目標を編集']) await expect(strip(page).getByRole('button', { name, exact: true })).toHaveCount(0)
  await strip(page).getByRole('button', { name: '読み直す', exact: true }).click()
  await expect(strip(page).getByRole('alert')).toHaveCount(0)
  await expect(strip(page).getByRole('button', { name: '一時停止', exact: true })).toBeEnabled()
})

test('131 行き詰まりは理由を、上限到達は再開できないことを伝える', async ({ page }) => {
  await visit(page, '/s/approval-sheet', 'goal-blocked')
  await expect(status(page)).toHaveText('行き詰まり ・ 3 / 8 ラウンド')
  await expect(message(page)).toHaveText(BLOCKED)
  await expect(strip(page).getByRole('alert')).toHaveCount(0)
  await expect(strip(page).getByRole('button', { name: '再開', exact: true })).toBeEnabled()

  await visit(page, '/s/approval-sheet', 'goal-exhausted')
  await expect(status(page)).toHaveText('一時停止 ・ 8 / 8 ラウンド')
  await expect(message(page)).toHaveText(EXHAUSTED)
  await expect(strip(page).getByRole('alert')).toHaveCount(0)
  await expect(strip(page).getByRole('button', { name: '再開', exact: true })).toBeDisabled()
})

test('131 低い表示領域では帯を出さず、操作行も切らない', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 222 })
  await visit(page, '/s/approval-sheet')
  await expect(page.getByLabel('メッセージ入力欄')).toBeVisible()
  await expect(strip(page)).toHaveCount(0)
  await expect.poll(() => page.locator('.composer-controls').evaluate(node => node.getBoundingClientRect().bottom - window.innerHeight)).toBeLessThanOrEqual(0)
  await page.setViewportSize({ width: 844, height: 390 })
  await expect(strip(page)).toHaveCount(0)
  // The same goal renders once the viewport reaches the 400px threshold, so the
  // zero above comes from the height rule rather than from missing data.
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(strip(page)).toBeVisible()
  await expect(objective(page)).toHaveText(OBJECTIVE)
})

test('131 帯があっても会話の高さを残し、帯と入力欄が重ならない', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 450 })
  await visit(page, '/s/approval-sheet')
  await expect(strip(page)).toBeVisible()
  await page.getByLabel('メッセージ入力欄').fill(lines(8))
  await expect(strip(page)).toBeVisible()
  await expect.poll(async () => (await page.locator('.chat-scroll').boundingBox())!.height).toBeGreaterThanOrEqual(48)

  await visit(page, '/s/approval-sheet', 'goal-blocked')
  await page.getByLabel('メッセージ入力欄').fill(lines(8))
  await expect(message(page)).toHaveText(BLOCKED)
  await expect.poll(async () => (await page.locator('.chat-scroll').boundingBox())!.height).toBeGreaterThanOrEqual(48)
  const stripBox = (await strip(page).boundingBox())!
  const inputBox = (await page.getByLabel('メッセージ入力欄').boundingBox())!
  expect(stripBox.y + stripBox.height).toBeLessThanOrEqual(inputBox.y)
})

test('131 /goal で偽データのゴールを作り、コマンド入力の吹き出しを出す', async ({ page }) => {
  await visit(page, '/s/readme-review')
  await expect(strip(page)).toHaveCount(0)
  await page.getByLabel('メッセージ入力欄').fill('/goal 新しい目標を立てる')
  await button(page, '送信').click()
  await expect(strip(page)).toBeVisible()
  await expect(objective(page)).toHaveText('新しい目標を立てる')
  await expect(status(page)).toHaveText('進行中 ・ 0 / 8 ラウンド')
  const bubble = page.locator('.chat-command-input')
  await expect(bubble).toHaveCount(1)
  await expect(bubble).toHaveAttribute('aria-label', 'コマンド入力')
  await expect(bubble).toContainText('/goal 新しい目標を立てる')
  const alignment = await bubble.evaluate(node => {
    const parent = node.parentElement!.getBoundingClientRect(), child = node.getBoundingClientRect()
    return { left: child.left - parent.left, right: parent.right - child.right }
  })
  expect(alignment.right).toBeLessThanOrEqual(1)
  expect(alignment.left).toBeGreaterThan(1)
})

test('131 停止中（disarmed）の進行中ゴールは「停止中」と再開を出し、帯の再開で進行中に戻る', async ({ page }) => {
  await visit(page, '/s/approval-sheet', 'goal-disarmed')
  await expect(status(page)).toHaveText('停止中 ・ 3 / 8 ラウンド')
  await expect(strip(page).getByRole('alert')).toHaveCount(0)
  await expect(strip(page).getByRole('button', { name: '一時停止', exact: true })).toHaveCount(0)
  await expect(strip(page).getByRole('button', { name: '再開', exact: true })).toBeEnabled()
  await strip(page).getByRole('button', { name: '再開', exact: true }).click()
  await expect(status(page)).toHaveText('進行中 ・ 3 / 8 ラウンド')
  await expect(page.locator('m3e-snackbar:popover-open').last()).toContainText('ゴールを再開しました')
  await expect(strip(page).getByRole('button', { name: '再開', exact: true })).toHaveCount(0)
  await expect(strip(page).getByRole('button', { name: '一時停止', exact: true })).toBeEnabled()
})

const SETTLED_STATUS = {
  default: '進行中 ・ 3 / 8 ラウンド',
  'goal-disarmed': '停止中 ・ 3 / 8 ラウンド',
  'goal-blocked': '行き詰まり ・ 3 / 8 ラウンド',
  'goal-exhausted': '一時停止 ・ 8 / 8 ラウンド',
} as const

for (const scenario of [undefined, 'goal-disarmed', 'goal-blocked', 'goal-exhausted'] as const) {
  test(`131 帯とゴール画面は状態・理由・操作の可否が食い違わない（${scenario ?? '進行中'}）`, async ({ page }) => {
    await visit(page, '/s/approval-sheet', scenario)
    // Wait for the settled state: the first render shows「状態未確認」until activation is known.
    await expect(status(page)).toHaveText(SETTLED_STATUS[scenario ?? 'default'])
    const names = ['一時停止', '再開', '目標を編集'] as const
    const stripView = {
      objective: await objective(page).innerText(),
      status: await status(page).innerText(),
      message: (await message(page).count()) ? await message(page).innerText() : '',
      actions: await Promise.all(names.map(async name => {
        const target = strip(page).getByRole('button', { name, exact: true })
        return (await target.count()) === 0 ? 'none' : (await target.isDisabled()) ? 'disabled' : 'enabled'
      })),
    }
    await strip(page).locator('.goal-strip-body').click()
    await expect(page).toHaveURL(/#\/s\/approval-sheet\/goal$/)
    const region = page.getByRole('region', { name: '現在のゴール' })
    await expect(region).toBeVisible()
    // The screen mounts its own presence hook, so its status and button states settle after the first
    // render (activation unconfirmed → disabled buttons). Poll instead of reading once.
    await expect.poll(async () => ({
      objective: await region.getByRole('heading').innerText(),
      status: await region.locator('.st-goal-status').innerText(),
      // Every message paragraph on the screen: the blocked reason in the card, the exhausted note below it.
      // Reading them all (not just the strip's text) also catches a message only the screen shows.
      message: (await page.locator('.st-goal-card p:not(.st-goal-status), .st-content > p.st-muted, .st-error p').allInnerTexts()).join('\n'),
      actions: await Promise.all(names.map(async name => {
        const target = page.locator('.st-goal-actions').getByRole('button', { name, exact: true })
        return (await target.count()) === 0 ? 'none' : (await target.isDisabled()) ? 'disabled' : 'enabled'
      })),
    })).toEqual(stripView)
  })
}
