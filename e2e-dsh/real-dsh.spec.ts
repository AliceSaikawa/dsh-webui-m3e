/**
 * The M3E page against a real DSH Host (only the model is fake).
 * Each passing test here is evidence about the Host and its transport for the
 * DSH release in the test title; it says nothing about a real model, Safari,
 * an iPhone, a reverse proxy, or a production DSH_HOME.
 */
import { test, expect, button, login, openM3e } from './fixtures.ts'
import { dshVersion } from './dsh-host.ts'
import { MARK, textOf, type ChatRequest } from './fake-llm.ts'
import { SUPPORTED_DSH_VERSION } from '../src/shared/dsh-compat.ts'
import type { Page } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

const toolResults = (requests: readonly ChatRequest[], callId: string) => requests.flatMap(request =>
  request.messages.filter(message => message.role === 'user').flatMap(message =>
    message.content.filter(block => block.type === 'tool_result' && block.tool_use_id === callId).map(block => textOf(block.content))))

async function newSession(page: Page, text: string) {
  await button(page, '新しいセッション').click()
  await page.getByLabel('メッセージ入力欄').fill(text)
  await button(page, '送信').click()
  await expect(page).toHaveURL(/#\/s\/[^/]+$/)
  return decodeURIComponent(new URL(page.url()).hash.replace(/^#\/s\//, ''))
}

const sessions: { greeting?: string; slow?: string } = {}
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

test(`DSH ${dshVersion}: 接続して一覧を出し、index は埋め込みを拒否する`, async ({ page, integration }) => {
  const { host } = integration
  test.info().annotations.push({ type: 'dsh-version', description: host.version })
  // M3E_DSH_VERSION may point elsewhere; the pinned release is the one this plugin claims.
  if (!process.env.M3E_DSH_VERSION) expect(host.version).toBe(SUPPORTED_DSH_VERSION)
  await login(page, host)
  const index = await page.goto(`${host.origin}/m3e/`)
  expect(index?.status()).toBe(200)
  expect(index?.headers()['content-security-policy']).toBe("frame-ancestors 'none'")
  expect(index?.headers()['x-frame-options']).toBe('DENY')
  await expect(page.locator('h1').first()).toHaveText('一覧')
  await expect(page.getByText('起動に失敗しました', { exact: false })).toHaveCount(0)
  await expect(page.getByText('DSH との接続が切れました')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'ワークスペースがありません' })).toBeVisible()
})

test(`DSH ${dshVersion}: 同じ Host のページからでも iframe には表示されない`, async ({ page, integration }) => {
  const { host } = integration
  // The browser reports the refused frame as a console error; that is the point.
  test.info().annotations.push({ type: 'expected-console-errors', description: 'frame-ancestors による拒否' })
  const refusals: string[] = []
  page.on('console', message => { if (message.type() === 'error' && /frame-ancestors|X-Frame-Options|Refused to (display|frame)/i.test(message.text())) refusals.push(message.text()) })
  await login(page, host)
  // A same-origin embedding page: only this one URL is answered by the test, the frame itself is the real Host.
  await page.route(`${host.origin}/m3e-embedding-probe`, route => route.fulfill({ contentType: 'text/html', body: `<iframe id="probe" src="${host.origin}/m3e/" width="390" height="600"></iframe>` }))
  await page.goto(`${host.origin}/m3e-embedding-probe`)
  await expect.poll(() => refusals.length).toBeGreaterThan(0)
  const frame = page.frames().find(candidate => candidate !== page.mainFrame())
  expect(frame).toBeDefined()
  await expect(frame!.locator('h1')).toHaveCount(0)
})

test(`DSH ${dshVersion}: フォルダを選んでワークスペースを追加する`, async ({ page, integration }) => {
  await openM3e(page, integration.host)
  await button(page, 'ワークスペースを追加').click()
  await expect(page.locator('h1')).toHaveText('フォルダを選ぶ')
  await button(page, 'ここを追加').click()
  await expect(page).toHaveURL(/#\/$/)
  await expect(button(page, '新しいセッション')).toBeEnabled()
})

test(`DSH ${dshVersion}: 最初の送信でセッションを作り、返答を受け取る`, async ({ page, integration }) => {
  const { host, llm } = integration
  await openM3e(page, host)
  const before = llm.requests.length
  sessions.greeting = await newSession(page, '統合試験のあいさつ')
  await expect(page.getByText('こんにちは。偽のモデルです。')).toBeVisible()
  await expect(page.getByText('統合試験のあいさつ', { exact: true })).toHaveCount(1)
  const sent = llm.requests.slice(before).filter(request => request.tools?.length)
  expect(sent.length).toBeGreaterThan(0)
  expect(sent.some(request => request.messages.some(message => message.role === 'user' && textOf(message.content).includes('統合試験のあいさつ')))).toBe(true)
  await expect(button(page, '実行を停止')).toHaveCount(0)
})

test(`DSH ${dshVersion}: 再読み込みでセッションの履歴と一覧を取り直す`, async ({ page, integration }) => {
  expect(sessions.greeting).toBeDefined()
  await openM3e(page, integration.host, `/s/${encodeURIComponent(sessions.greeting!)}`)
  await expect(page.getByText('統合試験のあいさつ', { exact: true })).toBeVisible()
  await expect(page.getByText('こんにちは。偽のモデルです。')).toBeVisible()
  await page.goto(`${integration.host.origin}/m3e/#/`)
  await expect(page.locator('.home-session-button').filter({ hasText: '会話：統合試験のあいさつ' })).toBeVisible()
})

test(`DSH ${dshVersion}: 返答を少しずつ表示し、停止できる`, async ({ page, integration }) => {
  const { host, llm } = integration
  await openM3e(page, host)
  const abandonedBefore = llm.abandoned.length
  sessions.slow = await newSession(page, `${MARK.slow} 停止の確認`)
  await expect(page.getByText('第3節。', { exact: false })).toBeVisible()
  await expect(page.getByText('第200節。', { exact: false })).toHaveCount(0)
  await expect(button(page, '実行を停止')).toBeVisible()
  await button(page, '実行を停止').click()
  await expect(button(page, '実行を停止')).toHaveCount(0)
  await expect.poll(() => llm.abandoned.length).toBeGreaterThan(abandonedBefore)
  const shown = await page.locator('.conversation-screen').innerText()
  await page.waitForTimeout(1500)
  expect(await page.locator('.conversation-screen').innerText()).toBe(shown)
  await expect(page.getByText('第200節。', { exact: false })).toHaveCount(0)
})

test(`DSH ${dshVersion}: ツールの承認を許可すると結果がモデルへ返る`, async ({ page, integration }) => {
  const { host, llm } = integration
  await openM3e(page, host)
  await newSession(page, `${MARK.approval} 承認の確認`)
  await expect(page.getByText('bash を実行しようとしています')).toBeVisible()
  await button(page, '許可（1 回）').click()
  await expect(page.getByText('ツールの結果を受け取りました。')).toBeVisible()
  const results = toolResults(llm.requests, 'call-approval')
  expect(results.length).toBeGreaterThan(0)
  expect(results.at(-1)).toContain('m3e-approval-ok')
})

test(`DSH ${dshVersion}: ツールの承認を拒否するとコマンドを実行しない`, async ({ page, integration }) => {
  const { host, llm } = integration
  await openM3e(page, host)
  const before = llm.requests.length
  await newSession(page, `${MARK.approval} 拒否の確認`)
  await expect(page.getByText('bash を実行しようとしています')).toBeVisible()
  await button(page, '拒否').click()
  await expect(page.getByText('ツールの結果を受け取りました。')).toBeVisible()
  const results = toolResults(llm.requests.slice(before), 'call-approval')
  expect(results.length).toBeGreaterThan(0)
  expect(results.at(-1)).not.toContain('m3e-approval-ok')
})

test(`DSH ${dshVersion}: 質問に答えると回答がモデルへ返る`, async ({ page, integration }) => {
  const { host, llm } = integration
  await openM3e(page, host)
  const before = llm.requests.length
  await newSession(page, `${MARK.question} 質問の確認`)
  await expect(page.getByText('統合試験の質問です。どちらを選びますか？')).toBeVisible()
  await page.getByText('赤', { exact: true }).click()
  await button(page, '回答する').click()
  await expect(page.getByText('ツールの結果を受け取りました。')).toBeVisible()
  const results = toolResults(llm.requests.slice(before), 'call-question')
  expect(results.length).toBeGreaterThan(0)
  expect(results.at(-1)).toContain('赤')
})

test(`DSH ${dshVersion}: 会話の切り替えシートで検索して別のセッションへ移る`, async ({ page, integration }) => {
  expect(sessions.greeting && sessions.slow).toBeTruthy()
  await openM3e(page, integration.host, `/s/${encodeURIComponent(sessions.slow!)}`)
  await expect(page.getByText(`${MARK.slow} 停止の確認`, { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '会話を切り替え' }).click()
  await page.getByLabel('会話名で検索').fill('あいさつ')
  const rows = page.locator('.conversation-picker-row')
  await expect(rows).toHaveCount(1)
  await rows.click()
  await expect(page).toHaveURL(new RegExp(`#/s/${encodeURIComponent(sessions.greeting!)}$`))
  await expect(page.getByText('統合試験のあいさつ', { exact: true })).toBeVisible()
  await expect(page.getByText(`${MARK.slow} 停止の確認`, { exact: true })).toHaveCount(0)
  await expect(page.locator('h1').first()).toHaveText('会話：統合試験のあいさつ')
})

test(`DSH ${dshVersion}: 実行中の送信は順番待ちに入り、終わったあとにモデルへ届く`, async ({ page, integration }) => {
  const { host, llm } = integration
  await openM3e(page, host)
  const held = llm.holdTurn(`${MARK.medium} 順番待ちの確認`)
  const before = llm.requests.length
  try {
    await newSession(page, `${MARK.medium} 順番待ちの確認`)
    await expect(page.getByText('段落1。', { exact: false })).toBeVisible()
    await page.getByLabel('メッセージ入力欄').fill('順番待ちの追記')
    await button(page, '順番待ち').click()
    await expect(page.getByText('順番待ち 1 件')).toBeVisible()
    expect(held.first).toBeDefined()
    expect(held.continuation).toBeUndefined()
    expect(llm.requests.slice(before).some(request => JSON.stringify(request.messages).includes('順番待ちの追記'))).toBe(false)
    held.releaseStep()
    await expect.poll(() => held.continuation).toBeDefined()
    expect(toolResults([held.continuation!], 'call-delivery-step').join('')).toContain('m3e-delivery-step')
    expect(JSON.stringify(held.continuation!.messages)).not.toContain('順番待ちの追記')
    expect(held.completed).toBe(false)
    await expect(page.getByText('順番待ち 1 件')).toBeVisible()
    held.releaseTurn()
    await expect(page.getByText('段落20。', { exact: false })).toBeVisible()
    await expect(page.getByText('こんにちは。偽のモデルです。')).toBeVisible()
    await expect(page.getByText('順番待ち 1 件')).toHaveCount(0)
    const queued = llm.requests.filter(request => request.tools?.length && textOf(request.messages.filter(message => message.role === 'user').at(-1)?.content).includes('順番待ちの追記'))
    expect(queued.length).toBeGreaterThan(0)
    // The queued message reached the model only after the first reply finished.
    expect(JSON.stringify(queued[0]!.messages)).toContain('段落20。')
    expect(JSON.stringify(queued[0]!.messages)).toContain('複数ステップの返答が完了しました。')
    expect(llm.requests.indexOf(queued[0]!)).toBeGreaterThan(llm.requests.indexOf(held.continuation!))
  } finally { held.releaseStep(); held.releaseTurn() }
})

test(`DSH ${dshVersion}: 実行中に割り込みで送ると同じ会話のモデルへ届く`, async ({ page, integration }) => {
  const { host, llm } = integration
  await openM3e(page, host)
  const before = llm.requests.length
  const held = llm.holdTurn(`${MARK.medium} 割り込みの確認`)
  try {
    await newSession(page, `${MARK.medium} 割り込みの確認`)
    await expect(page.getByText('段落1。', { exact: false })).toBeVisible()
    await page.getByLabel('メッセージ入力欄').fill('割り込みの追記')
    await button(page, '送り方を選ぶ').click()
    await page.getByText('割り込み', { exact: true }).click()
    // DSH publishes the durable user message at the next step, after this ack.
    await expect(page.getByLabel('メッセージ入力欄')).toHaveValue('')
    // Both inbox placements use this label; next-step delivery distinguishes steer.
    await expect(page.getByText('順番待ち 1 件')).toBeVisible()
    expect(held.first).toBeDefined()
    expect(held.continuation).toBeUndefined()
    held.releaseStep()
    await expect.poll(() => held.continuation).toBeDefined()
    expect(toolResults([held.continuation!], 'call-delivery-step').join('')).toContain('m3e-delivery-step')
    expect(JSON.stringify(held.continuation!.messages)).toContain('割り込みの追記')
    expect(JSON.stringify(held.continuation!.messages)).not.toContain('複数ステップの返答が完了しました。')
    expect(held.completed).toBe(false)
    await expect(page.getByText('順番待ち 1 件')).toHaveCount(0)
    await expect.poll(() => llm.requests.slice(before).some(request => request.tools?.length
      && request.messages.some(message => message.role === 'user' && textOf(message.content).includes('割り込みの追記'))), { timeout: 30_000 }).toBe(true)
    await expect(page.getByRole('article', { name: '自分のメッセージ' }).filter({ hasText: '割り込みの追記' })).toHaveCount(1)
    held.releaseTurn()
    await expect(button(page, '実行を停止')).toHaveCount(0, { timeout: 30_000 })
  } finally { held.releaseStep(); held.releaseTurn() }
})

test(`DSH ${dshVersion}: 画像を添付して送るとモデルへ画像が届く`, async ({ page, integration }) => {
  const { host, llm } = integration
  await openM3e(page, host)
  const before = llm.requests.length
  await button(page, '新しいセッション').click()
  await page.locator('input[type="file"]').setInputFiles({ name: '統合試験.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1PX, 'base64') })
  await expect(page.locator('.composer-images img')).toBeVisible()
  await page.getByLabel('メッセージ入力欄').fill('画像の確認')
  await button(page, '送信').click()
  await expect(page.getByText('こんにちは。偽のモデルです。')).toBeVisible()
  const sent = llm.requests.slice(before).find(request => request.tools?.length
    && request.messages.some(message => message.role === 'user' && textOf(message.content).includes('画像の確認')))
  expect(sent).toBeDefined()
  const user = sent!.messages.filter(message => message.role === 'user' && Array.isArray(message.content))
  expect(JSON.stringify(user)).toMatch(/"type":"image"/)
})

test.describe('接続の断絶', () => {
  // The Host is stopped on purpose, so the browser logs failed connection
  // attempts. Uncaught exceptions still fail the test.
  test.beforeEach(() => { test.info().annotations.push({ type: 'expected-console-errors', description: 'DSH を意図的に停止する' }) })

  test(`DSH ${dshVersion}: Host が止まると再接続中を出し、再起動すると自動で戻って送信を続けられる`, async ({ page, integration }) => {
    const { host } = integration
    await openM3e(page, host, `/s/${encodeURIComponent(sessions.greeting!)}`)
    await expect(page.getByText('統合試験のあいさつ', { exact: true })).toBeVisible()
    await host.stop()
    await expect(page.getByRole('progressbar', { name: '再接続中' })).toBeVisible()
    await page.getByLabel('メッセージ入力欄').fill('再接続後の送信')
    await expect(button(page, '送信')).toBeDisabled()
    await host.restart()
    // No button press: the transport reconnects on its own.
    await expect(page.getByRole('progressbar', { name: '再接続中' })).toHaveCount(0, { timeout: 45_000 })
    await expect(page.getByText('DSH との接続が切れました')).toHaveCount(0)
    await button(page, '送信').click()
    await expect(page.getByText('こんにちは。偽のモデルです。')).toHaveCount(2)
    await expect(page.getByRole('article', { name: '自分のメッセージ' }).filter({ hasText: '再接続後の送信' })).toHaveCount(1)
    await expect(page.getByLabel('メッセージ入力欄')).toHaveValue('')
  })

  // docs/ui-spec.md「接続が切れたとき」: the progress bar should turn into the
  // banner when reconnecting fails. With DSH 0.1.5-rc.3 the transport keeps
  // retrying in the connecting state, so the banner never appears while the
  // Host is down (observed for 90 s). DSH 0.2.0-rc.2 still has no banner
  // within this test's 30 s window, so the existing expected failure remains.
  test(`DSH ${dshVersion}: 既知の差 — Host が止まったままでも「接続が切れました」に切り替わらない`, async ({ page, integration }) => {
    test.fail(true, '仕様との既知の差。docs/dsh-compatibility.md を参照')
    const { host } = integration
    await openM3e(page, host)
    await host.stop()
    try {
      await expect(page.getByText('DSH との接続が切れました')).toBeVisible({ timeout: 30_000 })
    } finally {
      await host.restart()
    }
  })
})
