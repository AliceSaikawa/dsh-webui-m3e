import { test, expect, visit, button } from './helpers'
import type { Page } from '@playwright/test'

// Issue #79: a Workspace registration retry started on the new screen must be
// awaited by the created conversation's composer, and its handoff must not
// replace input written there.
const sessionId = 'readme-review'
const workspaceId = 'ws-m3e'
const stale = '登録失敗時の古い本文'
type TestWindow = Window & {
  __m3eTestWorkspaceAttachGate?: Promise<void>
  __m3eTestWorkspaceAttachFailure?: boolean
  __m3eTestWorkspaceAttachCalls?: number
  releaseAttach?: () => void
}

async function prepare(page: Page, fail: boolean) {
  await page.addInitScript(({ sessionId, workspaceId, stale, fail }) => {
    const attachment = JSON.stringify({ workspaceId, sessionId })
    for (const key of [`new:${workspaceId}`, `session:${sessionId}`]) {
      localStorage.setItem(`m3e:composer:${key}`, stale)
      localStorage.setItem(`m3e:composer:${key}:workspaceAttachment`, attachment)
    }
    const target = window as TestWindow
    target.__m3eTestWorkspaceAttachGate = new Promise(resolve => { target.releaseAttach = resolve })
    target.__m3eTestWorkspaceAttachFailure = fail
  }, { sessionId, workspaceId, stale, fail })
}

const input = (page: Page) => page.getByLabel('メッセージ入力欄')
const retrying = (page: Page) => page.getByText('ワークスペースへの登録をやり直しています。終わるまで入力と送信はできません。')
const unfinished = (page: Page) => page.getByText('ワークスペースへの登録が未完了です')

async function retryThenMove(page: Page) {
  await visit(page, `/new?ws=${workspaceId}`)
  await expect(input(page)).toHaveValue(stale)
  await button(page, 'ワークスペースへ登録し直す').click()
  await expect(retrying(page)).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as TestWindow).__m3eTestWorkspaceAttachCalls)).toBe(1)
  await page.evaluate(id => { location.hash = `#/s/${id}` }, sessionId)
  // The created conversation's composer joins the same retry: no editing, sending or second retry.
  await expect(retrying(page)).toBeVisible()
  await expect(input(page)).toBeDisabled()
  await expect(input(page)).toHaveValue(stale)
  // The busy composer labels its disabled send button 送信中, as on the new screen.
  await expect(button(page, '送信中')).toBeDisabled()
  await expect(button(page, 'ワークスペースへ登録し直す')).toBeDisabled()
}

async function sendFromConversation(page: Page, text: string) {
  await input(page).fill(text)
  await expect(button(page, '送信')).toBeEnabled()
  await button(page, '送信').click()
  await expect(input(page)).toHaveValue('')
  await expect(page.getByText(text).first()).toBeVisible()
}

test('79a 再試行中に作成済みの会話へ移ると完了まで待ち、成功後に書いた本文を上書きせず送れる', async ({ page }) => {
  await prepare(page, false)
  await retryThenMove(page)
  await page.evaluate(() => (window as TestWindow).releaseAttach?.())
  await expect(retrying(page)).toHaveCount(0)
  await expect(unfinished(page)).toHaveCount(0)
  await expect(input(page)).toBeEnabled()
  await input(page).fill('会話画面で新しく書いた本文')
  // Nothing settles later and replaces the newer input.
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 300)))
  await expect(input(page)).toHaveValue('会話画面で新しく書いた本文')
  await sendFromConversation(page, '会話画面で新しく書いた本文')
  expect(await page.evaluate(() => (window as TestWindow).__m3eTestWorkspaceAttachCalls)).toBe(1)
  // The duplicate on the new screen was handed over, not left behind.
  await page.evaluate(id => { location.hash = `#/new?ws=${id}` }, workspaceId)
  await expect(input(page)).toHaveValue('')
  await expect(unfinished(page)).toHaveCount(0)
})

test('79b 再試行が再び失敗しても、作成済みの会話で書いた本文を保ち、そこから送れる', async ({ page }) => {
  await prepare(page, true)
  await retryThenMove(page)
  await page.evaluate(() => (window as TestWindow).releaseAttach?.())
  await expect(retrying(page)).toHaveCount(0)
  await expect(unfinished(page)).toBeVisible()
  await expect(input(page)).toBeEnabled()
  await expect(input(page)).toHaveValue(stale)
  await input(page).fill('失敗後に会話画面で書いた本文')
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 300)))
  await expect(input(page)).toHaveValue('失敗後に会話画面で書いた本文')
  await sendFromConversation(page, '失敗後に会話画面で書いた本文')
  // Sending does not repair registration; the separate retry stays available.
  await expect(unfinished(page)).toBeVisible()
  await expect(button(page, 'ワークスペースへ登録し直す')).toBeEnabled()
})
