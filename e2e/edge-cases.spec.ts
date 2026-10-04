import { test, expect, visit, shot, nav, action, button } from './helpers'

test('01d ワークスペースなしから追加画面へ進んで戻れる', async ({ page }) => {
  await visit(page, '/', 'no-workspace')
  await expect(page.getByRole('heading', { name: 'ワークスペースがありません' })).toBeVisible()
  await expect(page.locator('.home-session-button')).toHaveCount(0)
  await expect(button(page, '新しいセッション')).toBeDisabled()
  await shot(page, '01-no-workspace')
  await button(page, 'ワークスペースを追加').click()
  await expect(page.locator('h1')).toHaveText('フォルダを選ぶ')
  await button(page, 'フォルダの選択を閉じる').click()
  await expect(page).toHaveURL(/#\/$/)
  await expect(page.getByRole('heading', { name: 'ワークスペースがありません' })).toBeVisible()
})

test('01e 一覧読込中は空表示せず8秒後に復帰操作を案内する', async ({ page }) => {
  await visit(page, '/', 'home-pending')
  await expect(page.getByRole('status', { name: 'セッションを読み込み中' })).toBeVisible()
  await expect(page.getByText('まだセッションがありません', { exact: true })).toHaveCount(0)
  await expect(button(page, 'セッション一覧を読み直す')).toHaveCount(0)
  await expect(button(page, '新しいセッション')).toBeDisabled()
  await shot(page, '01-pending-initial')
  await expect(page.getByText('一覧の読み込みが完了していません。', { exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(button(page, 'セッション一覧を読み直す')).toBeEnabled()
  await expect(button(page, '画面を再読み込み')).toBeEnabled()
  await shot(page, '01-pending-recovery')
  await button(page, 'セッション一覧を読み直す').click()
  await expect(page.locator('.home-session-button')).not.toHaveCount(0)
  await expect(page.getByRole('status', { name: 'セッションを読み込み中' })).toHaveCount(0)
})

test('01f フォルダの一部表示を案内する', async ({ page }) => {
  await visit(page, '/workspaces/add', 'picker-truncated')
  await expect(page.getByText('1,000 件を超えるフォルダは一部だけ表示します', { exact: true })).toBeVisible()
  await expect(page.locator('.home-folder-row')).not.toHaveCount(0)
  await expect(button(page, 'ここを追加')).toBeEnabled()
  await shot(page, '01-picker-truncated')
})

test('01g 端末専用のフォルダ選択には理由を表示して追加を禁止する', async ({ page }) => {
  await visit(page, '/', 'native-unavailable')
  await page.locator('m3e-icon-button[aria-label="ワークスペースを切り替え"]').click()
  await page.locator('[data-add-workspace]').click()
  await expect(page.locator('h1')).toHaveText('フォルダを選ぶ')
  await expect(page.getByRole('alert')).toContainText('この DSH は端末のフォルダ選択だけに対応しているため、iPhone などのブラウザからワークスペースを追加できません。')
  await expect(button(page, 'ここを追加')).toBeDisabled()
  await expect(button(page, 'もう一度読み込む')).toHaveCount(0)
  await shot(page, '01-picker-native-unavailable')
})

test('01h フォルダ選択非対応では追加入口を隠す', async ({ page }) => {
  await visit(page, '/', 'picker-unavailable')
  await page.locator('m3e-icon-button[aria-label="ワークスペースを切り替え"]').click()
  await expect(page.locator('.home-drawer[aria-modal="true"]')).toBeVisible()
  await expect(page.locator('[data-add-workspace]')).toHaveCount(0)
  await shot(page, '01-picker-unavailable')
})

test('08c 読み取り専用の設定は編集できない', async ({ page }) => {
  await visit(page, '/settings/other', 'settings-readonly')
  await expect(page.getByText('この DSH では設定を変更できません', { exact: true })).toBeVisible()
  await expect(page.getByLabel('名前', { exact: true })).toBeDisabled()
  await expect(page.getByLabel('待機時間', { exact: true })).toBeDisabled()
  await expect(page.locator('m3e-switch[aria-label="有効にする"]')).toHaveJSProperty('disabled', true)
  await expect(page.locator('m3e-select[aria-label="動作モード"]')).toHaveJSProperty('disabled', true)
  await shot(page, '08-readonly')
})

test('08d 設定保存の競合は再取得して次の編集を保存できる', async ({ page }) => {
  await visit(page, '/settings/other', 'settings-conflict')
  const input = page.getByLabel('名前', { exact: true })
  await expect(input).toHaveValue('追加機能')
  await input.fill('競合する変更')
  await input.press('Tab')
  await expect(page.getByText('ほかの場所で設定が変わりました。読み直しました', { exact: true })).toBeVisible()
  await expect(input).toHaveValue('追加機能')
  await shot(page, '08-conflict')
  await input.fill('読み直した後の変更')
  await input.press('Tab')
  await expect(page.getByText('保存しました', { exact: true })).toBeVisible()
  await expect(input).toHaveValue('読み直した後の変更')
  await button(page, '戻る').click()
  await nav(page, '設定').click()
  await action(page, 'そのほか').click()
  await expect(page.getByLabel('名前', { exact: true })).toHaveValue('読み直した後の変更')
})

test('08e 設定保存の拒否は項目に理由を表示して入力を保持する', async ({ page }) => {
  await visit(page, '/settings/other', 'settings-rejected')
  const input = page.getByLabel('名前', { exact: true })
  await input.fill('保存が拒否される変更')
  await input.press('Tab')
  await expect(page.getByRole('alert')).toHaveText('この値は管理者の設定によって許可されていません。')
  await expect(input).toHaveValue('保存が拒否される変更')
  await expect(input).toHaveAttribute('aria-invalid', 'true')
  await shot(page, '08-rejected')
})

test('08f APIキーだけが読み取り専用の場合は登録状況を表示する', async ({ page }) => {
  await visit(page, '/settings/providers', 'settings-keys-readonly')
  await expect(action(page, 'ディープシーク')).toContainText('API キー：登録済み（変更できません）')
  await expect(action(page, 'クラウド提供元')).toContainText('API キー：未登録（変更できません）')
  await expect(action(page, 'ディープシーク')).toHaveJSProperty('disabled', true)
  await expect(action(page, 'クラウド提供元')).toHaveJSProperty('disabled', true)
  await expect(action(page, 'ローカル')).toContainText('キーは不要')
  await button(page, '戻る').click()
  await nav(page, '設定').click()
  await action(page, 'そのほか').click()
  await expect(page.getByLabel('名前', { exact: true }).first()).toBeEnabled()
  await shot(page, '08-keys-readonly')
})

test('08g APIキーの照会失敗を未登録として表示しない', async ({ page }) => {
  await visit(page, '/settings/providers', 'settings-keys-unavailable')
  await expect(page.getByRole('alert')).toHaveText('一部の API キーの登録状況を確認できません。再読み込みしてください。')
  await expect(action(page, 'ディープシーク')).toContainText('登録状況を確認できません')
  await expect(action(page, 'クラウド提供元')).toContainText('登録状況を確認できません')
  await expect(action(page, 'クラウド提供元')).not.toContainText('未登録')
  await expect(action(page, 'クラウド提供元')).toHaveJSProperty('disabled', true)
  await shot(page, '08-keys-unavailable')
  await button(page, '再読み込み').click()
  await expect(page.getByRole('alert')).toHaveText('一部の API キーの登録状況を確認できません。再読み込みしてください。')
})

test('09d 長いMarkdownを5000行から6000行へ追加して表示方法を切り替える', async ({ page }) => {
  await visit(page, '/s/approval-sheet/files')
  await page.locator('m3e-list-action').filter({ has: page.locator('.session-file-name').filter({ hasText: /^docs$/ }) }).click()
  await expect(page.getByRole('navigation', { name: '現在のフォルダ' })).toContainText('docs')
  await shot(page, '09-files-docs')
  await action(page, 'ui-spec.md').click()
  await expect(page.locator('h1')).toHaveText('ui-spec.md')
  await expect(page.locator('.session-file-content .markdown')).toContainText('5000 行目:')
  await button(page, '元の文字').click()
  const source = page.locator('.session-file-text code')
  await expect.poll(async () => (await source.textContent())?.split('\n').length).toBe(5000)
  await expect(source).not.toContainText('5001 行目:')
  await shot(page, '09-file-source-5000')
  await button(page, '続きを読み込む').click()
  await expect.poll(async () => (await source.textContent())?.split('\n').length).toBe(6000)
  const lines = (await source.textContent())!.split('\n')
  expect(lines[0]).toBe('1 行目: スマートフォン向けの画面の仕様です。')
  expect(lines[4999]).toBe('5000 行目: スマートフォン向けの画面の仕様です。')
  expect(lines[5000]).toBe('5001 行目: スマートフォン向けの画面の仕様です。')
  expect(lines[5999]).toBe('6000 行目: スマートフォン向けの画面の仕様です。')
  await expect(button(page, '続きを読み込む')).toHaveCount(0)
  await button(page, '表示').click()
  await expect(source).toHaveCount(0)
  await expect(page.locator('.session-file-content .markdown')).toContainText('6000 行目:')
  await shot(page, '09-file-rendered-6000')
  await button(page, '戻る').click()
  await expect(page.locator('h1')).toHaveText('ファイル')
  await page.getByRole('navigation', { name: '現在のフォルダ' }).locator('m3e-assist-chip').first().click()
  await expect(action(page, 'README.md')).toBeVisible()
})

for (const [id, file, name] of [
  ['09e', 'sample.bin', 'バイナリ'],
  ['09f', 'unknown-format', '拡張子なしのバイナリ'],
  ['09g', 'undecodable.data', '文字として読めない未知形式'],
] as const) {
  test(`${id} ${name}は読み取り専用の情報と表示不可の案内を出す`, async ({ page }) => {
    await visit(page, '/s/approval-sheet/files')
    await action(page, file).click()
    await expect(page.locator('h1')).toHaveText(file)
    await expect(page.getByText('このファイルは表示できません', { exact: true })).toBeVisible()
    await expect(page.locator('.session-file-hint')).toContainText('読み取り専用')
    await expect(page.locator('.session-file-text')).toHaveCount(0)
    await shot(page, `09-file-${file.replace('.', '-')}`)
  })
}

for (const [id, file, message] of [
  ['09h', 'too-large.txt', 'ファイルが大きいため表示できません。'],
  ['09i', 'too-large.png', '画像は 10 MB まで表示できます。上限内で読み込みを完了できませんでした。'],
] as const) {
  test(`${id} ${file}は上限の理由と読み直しを表示する`, async ({ page }) => {
    await visit(page, '/s/approval-sheet/files')
    await action(page, file).click()
    await expect(page.locator('h1')).toHaveText(file)
    await expect(page.getByRole('alert')).toContainText(message)
    await expect(page.locator('.session-file-image')).toHaveCount(0)
    await shot(page, `09-file-${file.replace('.', '-')}`)
    await button(page, '最初から読み直す').click()
    await expect(page.getByRole('alert')).toContainText(message)
  })
}

test('09j 行き詰まりのゴールに理由を表示して再開できる', async ({ page }) => {
  await visit(page, '/s/approval-sheet/goal', 'goal-blocked')
  const goal = page.getByRole('region', { name: '現在のゴール' })
  await expect(goal).toContainText('行き詰まり')
  await expect(goal).toContainText('承認シートのテストに失敗しました。原因の確認が必要です。')
  await expect(button(page, '再開')).toBeEnabled()
  await shot(page, '09-goal-blocked')
  await button(page, '再開').click()
  await expect(goal).toContainText('進行中')
  await expect(goal).not.toContainText('原因の確認が必要です。')
  await expect(button(page, '一時停止')).toBeEnabled()
})

test('09k 停止中のゴールは1回の再開で進行中に戻る', async ({ page }) => {
  await visit(page, '/s/approval-sheet/goal', 'goal-disarmed')
  const goal = page.getByRole('region', { name: '現在のゴール' })
  await expect(goal).toContainText('停止中')
  await expect(button(page, '再開')).toBeEnabled()
  await shot(page, '09-goal-disarmed')
  await button(page, '再開').click()
  await expect(goal).toContainText('進行中')
  await expect(button(page, '再開')).toHaveCount(0)
  await expect(button(page, '一時停止')).toBeEnabled()
})
