import { test, expect, visit, button } from './helpers'
import type { Page } from '@playwright/test'

// Issue #79 / #128: a Workspace registration retry started on the new screen
// must be awaited by the created conversation's composer, and its handoff must
// not replace input written there. DSH 0.2.1 reuses a named Session only while
// it is an unarchived blank member of the requested Workspace and otherwise
// creates one (dsh-api-session-controller/lib/index.js:769, lib/types/agent.js:483),
// so a conversation whose attach failed can no longer be registered itself: the
// retry follows the identity the Host reports, moving the body there.
const recordedId = 'readme-review'
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
    const attachment = JSON.stringify({ workspaceId, sessionId, baseline: { text: stale } })
    for (const key of [`new:${workspaceId}`, `session:${sessionId}`]) {
      localStorage.setItem(`m3e:composer:${key}`, stale)
      localStorage.setItem(`m3e:composer:${key}:workspaceAttachment`, attachment)
    }
    const target = window as TestWindow
    target.__m3eTestWorkspaceAttachGate = new Promise(resolve => { target.releaseAttach = resolve })
    target.__m3eTestWorkspaceAttachFailure = fail
  }, { sessionId: recordedId, workspaceId, stale, fail })
}

const input = (page: Page) => page.getByLabel('メッセージ入力欄')
const retrying = (page: Page) => page.getByText('ワークスペースへの登録をやり直しています。終わるまで入力と送信はできません。')
const unfinished = (page: Page) => page.getByText('ワークスペースへの登録が未完了です')
const attachCalls = (page: Page) => page.evaluate(() => (window as TestWindow).__m3eTestWorkspaceAttachCalls)

/** The retry target stored for the conversation the test is standing on. */
const storedRetryTarget = (page: Page) => page.evaluate(() => {
  const id = decodeURIComponent(location.hash.replace(/^#\/s\//, ''))
  const raw = localStorage.getItem(`m3e:composer:session:${id}:workspaceAttachment`)
  return raw === null ? null : JSON.parse(raw) as { workspaceId: string; sessionId: string }
})

const currentSession = (page: Page) =>
  page.evaluate(() => decodeURIComponent(location.hash.replace(/^#\/s\//, '')))

/** Waits until M3E stands on a Host-minted conversation other than `previous`. */
async function movedToAnotherSession(page: Page, previous: string): Promise<string> {
  await expect.poll(async () => {
    const id = await currentSession(page)
    return id !== previous && /^session-\d+$/.test(id) ? id : ''
  }).not.toBe('')
  return currentSession(page)
}

async function startRetryFromNewScreen(page: Page) {
  await visit(page, `/new?ws=${workspaceId}`)
  await expect(input(page)).toHaveValue(stale)
  await button(page, 'ワークスペースへ登録し直す').click()
  await expect(retrying(page)).toBeVisible()
  await expect.poll(() => attachCalls(page)).toBe(1)
}

// The recorded conversation's composer joins the shared retry: no editing,
// sending or second retry while it runs.
async function joinPendingRetry(page: Page) {
  await page.evaluate(id => { location.hash = `#/s/${id}` }, recordedId)
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

test('79a 登録できない会話の再試行は、Host が登録した新しい会話へ下書きを移す', async ({ page }) => {
  await prepare(page, false)
  await startRetryFromNewScreen(page)
  await joinPendingRetry(page)
  await page.evaluate(() => (window as TestWindow).releaseAttach?.())
  // The recorded conversation is full, so the Host makes a new one and M3E moves the body there.
  await movedToAnotherSession(page, recordedId)
  await expect(retrying(page)).toHaveCount(0)
  await expect(unfinished(page)).toHaveCount(0)
  await expect(input(page)).toBeEnabled()
  await expect(input(page)).toHaveValue(stale)
  await input(page).fill('会話画面で新しく書いた本文')
  // Nothing settles later and replaces the newer input.
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 300)))
  await expect(input(page)).toHaveValue('会話画面で新しく書いた本文')
  await sendFromConversation(page, '会話画面で新しく書いた本文')
  expect(await attachCalls(page)).toBe(1)
  // The duplicate on the new screen was handed over, not left behind.
  await page.evaluate(id => { location.hash = `#/new?ws=${id}` }, workspaceId)
  await expect(input(page)).toHaveValue('')
  await expect(unfinished(page)).toHaveCount(0)
  // The recorded conversation keeps no registration wait either.
  await page.evaluate(id => { location.hash = `#/s/${id}` }, recordedId)
  await expect(input(page)).toHaveValue('')
  await expect(unfinished(page)).toHaveCount(0)
})

test('79b 再試行が再び失敗しても、Host が作った会話で下書きを保ち、そこから送れる', async ({ page }) => {
  await prepare(page, true)
  await startRetryFromNewScreen(page)
  await joinPendingRetry(page)
  await page.evaluate(() => (window as TestWindow).releaseAttach?.())
  const created = await movedToAnotherSession(page, recordedId)
  // The failed attach reports the identity the Host made and leaves it unregistered,
  // so that is the identity the next retry names.
  await expect(await storedRetryTarget(page)).toEqual({ workspaceId, sessionId: created, baseline: { text: stale } })
  await expect(retrying(page)).toHaveCount(0)
  await expect(unfinished(page)).toBeVisible()
  await expect(input(page)).toBeEnabled()
  await expect(input(page)).toHaveValue(stale)
  // A second failed retry moves the body to the newest identity again.
  await button(page, 'ワークスペースへ登録し直す').click()
  const second = await movedToAnotherSession(page, created)
  await expect.poll(() => attachCalls(page)).toBe(2)
  await expect(await storedRetryTarget(page)).toEqual({ workspaceId, sessionId: second, baseline: { text: stale } })
  await expect(unfinished(page)).toBeVisible()
  await expect(input(page)).toBeEnabled()
  await expect(input(page)).toHaveValue(stale)
  await input(page).fill('失敗後に会話画面で書いた本文')
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 300)))
  await expect(input(page)).toHaveValue('失敗後に会話画面で書いた本文')
  await sendFromConversation(page, '失敗後に会話画面で書いた本文')
  // Sending does not repair registration or start another create; the separate retry stays available.
  await expect(unfinished(page)).toBeVisible()
  await expect(button(page, 'ワークスペースへ登録し直す')).toBeEnabled()
  expect(await attachCalls(page)).toBe(2)
  // The body lives on the newest conversation only, not on the new screen or the superseded ones.
  await page.evaluate(id => { location.hash = `#/new?ws=${id}` }, workspaceId)
  await expect(input(page)).toHaveValue('')
  await expect(unfinished(page)).toHaveCount(0)
  await page.evaluate(id => { location.hash = `#/s/${id}` }, created)
  await expect(input(page)).toHaveValue('')
  await expect(unfinished(page)).toHaveCount(0)
  await page.evaluate(id => { location.hash = `#/s/${id}` }, recordedId)
  await expect(input(page)).toHaveValue('')
  await expect(unfinished(page)).toHaveCount(0)
})

// Issue #153: the Host publishes the conversation it mints before the create
// response arrives. That conversation's composer is not part of the shared
// retry, so input written there must survive the response.
type PublishedFirstWindow = Window & {
  __m3eTestMockContextReady?: (ctx: any) => void
  __m3eTestMinted?: string
  releaseAttach?: () => void
}
async function preparePublishedFirst(page: Page, fail: boolean) {
  await page.addInitScript(({ sessionId, workspaceId, stale, fail }) => {
    const attachment = JSON.stringify({ workspaceId, sessionId, baseline: { text: stale } })
    for (const key of [`new:${workspaceId}`, `session:${sessionId}`]) {
      localStorage.setItem(`m3e:composer:${key}`, stale)
      localStorage.setItem(`m3e:composer:${key}:workspaceAttachment`, attachment)
    }
    const target = window as PublishedFirstWindow
    const gate = new Promise<void>(resolve => { target.releaseAttach = resolve })
    target.__m3eTestMockContextReady = ctx => {
      const create = ctx.sessions.create.bind(ctx.sessions)
      ctx.mock.patch('sessions.create', async (input: { sessionId?: string; workspaceId?: string } = {}) => {
        if (!input.sessionId || !input.workspaceId) return create(input)
        const created: string = await create(input)
        target.__m3eTestMinted = created
        await gate
        if (!fail) return created
        ctx.mock.updateWorkspace(input.workspaceId, (workspace: { sessionIds: string[] }) => ({ sessionIds: workspace.sessionIds.filter(id => id !== created) }))
        const details = { sessionId: created, workspaceId: input.workspaceId }
        throw Object.assign(new Error('ワークスペースへ登録できませんでした。'), { rpcError: { code: 'session/workspace-attach-failed', message: 'ワークスペースへ登録できませんでした。', details } })
      })
    }
  }, { sessionId: recordedId, workspaceId, stale, fail })
}

for (const outcome of ['success', 'failure'] as const) {
  test(`153 ${outcome}: 応答の前に新しい会話で書いた本文は、再試行の完了で上書きされない`, async ({ page }) => {
    await preparePublishedFirst(page, outcome === 'failure')
    await visit(page, `/new?ws=${workspaceId}`)
    await expect(input(page)).toHaveValue(stale)
    await button(page, 'ワークスペースへ登録し直す').click()
    await expect(retrying(page)).toBeVisible()
    await expect.poll(() => page.evaluate(() => (window as PublishedFirstWindow).__m3eTestMinted ?? '')).not.toBe('')
    const minted = await page.evaluate(() => (window as PublishedFirstWindow).__m3eTestMinted!)
    expect(minted).not.toBe(recordedId)
    await page.evaluate(id => { location.hash = `#/s/${id}` }, minted)
    await expect(input(page)).toBeEnabled()
    await input(page).fill('新しい会話を開いて書いた本文')
    await page.evaluate(() => (window as PublishedFirstWindow).releaseAttach?.())
    if (outcome === 'failure') await expect(unfinished(page)).toBeVisible()
    else await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 300)))
    await expect(input(page)).toHaveValue('新しい会話を開いて書いた本文')
    expect(await currentSession(page)).toBe(minted)
    if (outcome === 'failure') {
      // The minted conversation is the one the next retry names.
      await expect(await storedRetryTarget(page)).toEqual({ workspaceId, sessionId: minted, baseline: { text: '新しい会話を開いて書いた本文' } })
      await expect(button(page, 'ワークスペースへ登録し直す')).toBeEnabled()
    } else {
      await expect(unfinished(page)).toHaveCount(0)
    }
    // The retried body stays on the new screen as an ordinary draft.
    await page.evaluate(id => { location.hash = `#/new?ws=${id}` }, workspaceId)
    await expect(input(page)).toHaveValue(stale)
    await expect(unfinished(page)).toHaveCount(0)
    // The recorded conversation only copied the same body, so the copy is gone.
    await page.evaluate(id => { location.hash = `#/s/${id}` }, recordedId)
    await expect(input(page)).toHaveValue('')
    await expect(unfinished(page)).toHaveCount(0)
  })
}
