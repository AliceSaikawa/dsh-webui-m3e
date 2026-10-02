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
  request.messages.filter(message => message.role === 'tool' && message.tool_call_id === callId).map(message => textOf(message.content)))

async function newSession(page: Page, text: string) {
  await button(page, '新しいセッション').click()
  await page.getByLabel('メッセージ入力欄').fill(text)
  await button(page, '送信').click()
  await expect(page).toHaveURL(/#\/s\/[^/]+$/)
  return decodeURIComponent(new URL(page.url()).hash.replace(/^#\/s\//, ''))
}

const sessions: { greeting?: string; slow?: string } = {}

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
  // Host is down (observed for 90 s). Recorded as a known gap, not fixed here.
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
