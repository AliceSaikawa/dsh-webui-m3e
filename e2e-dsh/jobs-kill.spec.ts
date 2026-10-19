import type { Page } from '@playwright/test'
import { test, expect, button, openM3e } from './fixtures.ts'
import { dshVersion } from './dsh-host.ts'
import { MARK } from './fake-llm.ts'
import type { DshServices } from '../web/src/dsh/services.ts'

declare global {
  interface Window {
    /** The client Workspace controller, held by exposeWorkspaceController(). */
    __dshJobsCleanup?: { root: { workspaces?: DshServices['workspaces'] } }
  }
}

/**
 * The DSH client Workspace controller, exposed for cleanup. The instrumented
 * plugin still loads and applies normally; its public RPC (workspace/delete)
 * keeps reaching the real Host — the hook only holds the controller face, the
 * same approach as ./rpc.spec.ts's __rpcReview.
 */
type ModuleFacade = { load(plugin: Plugin): unknown }
type Plugin = { id: string; factory: (require: unknown) => { apply?: (ctx: { root?: unknown }) => unknown } }

/** Install the cleanup hook before the page boots the DSH client. */
async function exposeWorkspaceController(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let facade: ModuleFacade
    Object.defineProperty(window, '__ModuleLoader__', {
      configurable: true, get: () => facade,
      set(value: ModuleFacade) {
        facade = value
        let load = value.load.bind(value)
        const observe = (plugin: Plugin) => plugin.id !== '@deepseek-ai/dsh-api-workspace-controller' ? load(plugin) : load({
          ...plugin, factory(require: unknown) {
            const exported = plugin.factory(require)
            const apply = exported.apply
            if (typeof apply !== 'function') return exported
            return { ...exported, apply(ctx: { root?: unknown }) {
              const result = apply.call(exported, ctx)
              window.__dshJobsCleanup = { root: (ctx.root ?? ctx) as NonNullable<Window['__dshJobsCleanup']>['root'] }
              return result
            } }
          },
        })
        Object.defineProperty(value, 'load', { configurable: true, get: () => observe, set: (next: ModuleFacade['load']) => { load = next.bind(value) } })
      },
    })
  })
}

/**
 * Remove every Workspace registered at `home` (the one this spec adds through
 * the folder picker). `removing` keeps polling after another delete request;
 * `gone` means the Host's Workspace follow stream no longer lists one.
 */
async function removeHostWorkspace(page: Page, home: string): Promise<'booting' | 'removing' | 'gone'> {
  return page.evaluate(async home => {
    const face = window.__dshJobsCleanup?.root?.workspaces
    if (face?.delete === undefined) return 'booting'
    const snapshot = face.list.getSnapshot()
    const target = snapshot.items.find(item => item.path === home)
    if (target === undefined) return snapshot.phase === 'ready' ? 'gone' : 'booting'
    await face.delete(target.workspaceId)
    return 'removing'
  }, home)
}

test(`DSH ${dshVersion}: 合成バックグラウンドジョブを一覧から停止し購読で停止済みになる`, async ({ page, integration }) => {
  await exposeWorkspaceController(page)
  await openM3e(page, integration.host)
  await button(page, 'ワークスペースを追加').click()
  await button(page, 'ここを追加').click()
  await button(page, '新しいセッション').click()
  await page.getByLabel('メッセージ入力欄').fill(`${MARK.job} 合成ジョブの停止確認`)
  await button(page, '送信').click()
  await expect(page).toHaveURL(/#\/s\/[^/]+$/)
  // Depending on the isolated profile's approval policy, approve this test-only sleep.
  const approved = button(page, '許可（1 回）')
  const response = page.getByText('ツールの結果を受け取りました。', { exact: true })
  await expect(approved.or(response)).toBeVisible()
  if (await approved.isVisible()) await approved.click()
  await expect(response).toBeVisible()
  const sessionId = decodeURIComponent(new URL(page.url()).hash.slice('#/s/'.length))
  await page.goto(`${integration.host.origin}/m3e/#/s/${encodeURIComponent(sessionId)}/jobs`)
  const stop = page.getByRole('button', { name: /を停止$/ })
  await expect(stop).toHaveCount(1)
  await stop.click()
  await expect(page.getByRole('list', { name: 'ジョブの一覧' })).toContainText('停止済み')
  await expect(stop).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test.afterEach(async ({ page, integration }) => {
  const host = integration.host
  // Runs even when the test failed. Unregister the Workspace this spec added
  // (the folder picker's default, the Host's home) through DSH's public RPC; the
  // folder and conversations stay, only the Workspace record goes (dsh-workspace
  // lib/index.js delete). One run shares the Host and DSH_HOME across specs, so
  // without this real-dsh.spec.ts would not start from an empty Workspace list.
  await page.goto(`${host.origin}/m3e/#/`)
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => removeHostWorkspace(page, host.workspace), { timeout: 30_000 }).toBe('gone')
  // The next spec starts from the empty state; check it on screen.
  await expect(page.locator('h1').first()).toHaveText('一覧')
})
