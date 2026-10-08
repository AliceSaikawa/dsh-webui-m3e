import { test, expect, visit, button } from './helpers'
import type { Page } from '@playwright/test'

const path = 'docs/ui-spec.md'
const route = `/s/approval-sheet/file?path=${encodeURIComponent(path)}`
const notice = (page: Page) => page.getByText('ファイルが更新されました', { exact: true })

async function setup(page: Page) {
  await page.route('**/src/dsh/mock/context.ts*', async request => {
    const response = await request.fetch(), body = await response.text()
    expect(body.match(/\breturn ctx;?/g)).toHaveLength(1)
    await request.fulfill({ response, body: body.replace(/\breturn ctx;?/, 'globalThis.__revisionContext = ctx; return ctx;') })
  })
  await visit(page)
  await page.evaluate(async path => {
    // @ts-expect-error Vite serves this browser module directly.
    const { createWorkspaceFilesMock } = await import('/m3e/src/features/session-tools/mock-files.ts')
    const fixture = createWorkspaceFilesMock()
    const text = (label: string) => Array.from({ length: 6000 }, (_, i) => `${label} ${i + 1}`).join('\n')
    fixture.updateText(path, text('最新'))
    const loaded = await fixture.remote.stat('approval-sheet', path)
    if (!loaded.ok) throw new Error('fixture stat failed')
    const state = {
      fixture, completed: 0, stats: 0, hold: false, fail: false,
      pending: [] as { signal?: AbortSignal; resolve(): void }[],
      emit(version: string | null) { fixture.publishChange(version === null ? { absolutePath: loaded.value.absolutePath, absent: true } : { absolutePath: loaded.value.absolutePath, version }) },
      update(label: string) { fixture.updateText(path, text(label)) },
    }
    const remote = {
      ...fixture.remote,
      async stat(id: string, file: string, signal?: AbortSignal) {
        state.stats++
        const result = state.fail ? { ok: false, error: { code: 'workspace-file/not-found', message: '見つかりません。', details: {} } } : await fixture.remote.stat(id, file, signal)
        state.fail = false
        if (state.hold) {
          state.hold = false
          await new Promise<void>(resolve => state.pending.push({ signal, resolve }))
        }
        return result
      },
      changes(id: string, file: string, signal?: AbortSignal) {
        const stream = fixture.remote.changes(id, file, signal)
        return { ...stream, async *[Symbol.asyncIterator]() {
          for await (const frame of stream) { yield frame; state.completed++ }
        } }
      },
    }
    ;(window as any).__revisionRace = state
    ;(window as any).__revisionContext.mock.patch('remote.workspaceFiles', remote)
  }, path)
  await page.evaluate(route => { location.hash = route }, route)
  await expect(button(page, '続きを読み込む')).toBeEnabled()
  await button(page, '元の文字').click()
  await expect(page.locator('.session-file-text')).toContainText('最新 5000')
  await expect.poll(() => page.evaluate(() => (window as any).__revisionRace.completed)).toBeGreaterThan(0)
}
async function emit(page: Page, version: string | null) {
  const before = await page.evaluate(() => (window as any).__revisionRace.completed)
  await page.evaluate(version => (window as any).__revisionRace.emit(version), version)
  await expect.poll(() => page.evaluate(() => (window as any).__revisionRace.completed)).toBeGreaterThan(before)
}

test('古い版・未知の版・古い削除通知を繰り返し受けても最新6000行を最後まで読める', async ({ page }) => {
  await setup(page)
  for (const version of ['mock-1', 'opaque-z', 'mock-1', null]) {
    await emit(page, version)
    await expect(notice(page)).toHaveCount(0)
    await expect(button(page, '続きを読み込む')).toBeEnabled()
  }
  await button(page, '続きを読み込む').click()
  await expect(button(page, '続きを読み込む')).toHaveCount(0)
  const lines = (await page.locator('.session-file-text').innerText()).split('\n')
  expect(lines).toHaveLength(6000)
  expect(lines[0]).toBe('最新 1'); expect(lines[5999]).toBe('最新 6000')
})

test('実際に版が変わったときだけ追加読込を止め、読み直した新版へ古い通知が届いても止めない', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => (window as any).__revisionRace.update('更新後'))
  await expect(notice(page)).toBeVisible()
  await expect(button(page, '続きを読み込む')).toBeDisabled()
  await button(page, '読み直す').click()
  await expect(page.locator('.session-file-text')).toContainText('更新後 5000')
  await emit(page, 'mock-2')
  await expect(notice(page)).toHaveCount(0)
  await expect(button(page, '続きを読み込む')).toBeEnabled()
})

test('表示中と同じ版の反復通知ではstatを増やさない', async ({ page }) => {
  await setup(page)
  const before = await page.evaluate(() => (window as any).__revisionRace.stats)
  await emit(page, 'mock-2'); await emit(page, 'mock-2')
  expect(await page.evaluate(() => (window as any).__revisionRace.stats)).toBe(before)
  await expect(notice(page)).toHaveCount(0)
})

for (const destination of ['reload', 'other-file']) test(`古いstat応答が${destination}後に届いても表示を更新扱いしない`, async ({ page }) => {
  await setup(page)
  await page.evaluate(() => { const state = (window as any).__revisionRace; state.hold = true; state.update('更新後') })
  await expect.poll(() => page.evaluate(() => (window as any).__revisionRace.pending.length)).toBe(1)
  if (destination === 'reload') {
    await page.evaluate(() => (window as any).__revisionRace.update('再更新'))
    await button(page, 'ファイルを読み直す').click()
    await expect(page.locator('.session-file-text')).toContainText('再更新 5000')
  } else {
    await page.evaluate(() => { location.hash = '/s/approval-sheet/file?path=README.md' })
    await expect(page.getByRole('heading', { name: 'README.md', exact: true })).toBeVisible()
    await expect(page.locator('.session-file-hint').filter({ hasText: '読み取り専用' })).toBeVisible()
  }
  expect(await page.evaluate(() => (window as any).__revisionRace.pending[0].signal.aborted)).toBe(true)
  await page.evaluate(() => (window as any).__revisionRace.pending[0].resolve())
  // Let the released promise and the watch continuation settle before checking the screen.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await expect(notice(page)).toHaveCount(0)
  if (destination === 'reload') await expect(button(page, '続きを読み込む')).toBeEnabled()
})

test('statがファイル消失を返したら安全に追加読込を止める', async ({ page }) => {
  await setup(page)
  await page.evaluate(() => { (window as any).__revisionRace.fail = true })
  await emit(page, null)
  await expect(notice(page)).toBeVisible()
  await expect(button(page, '続きを読み込む')).toBeDisabled()
})
