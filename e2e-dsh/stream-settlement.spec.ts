import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Page } from '@playwright/test'
import { test as base, expect, button, openM3e } from './fixtures.ts'
import { dshInstall, root, startDsh, type DshHost } from './dsh-host.ts'
import { startFakeLlm } from './fake-llm.ts'

const scenarios = [
  { mark: 'M3E-SPARSE-3', name: '番号3が単独で届く', indices: [3], texts: ['番号3だけの返答です。'] },
  { mark: 'M3E-REVERSE-4-2', name: '番号4から2の順に届く', indices: [4, 2], texts: ['先に届いた番号4です。', '次に届いた番号2です。'] },
]
const fixtureDir = join(root, 'tmp', 'dsh-integration', `stream-fixture-${process.pid}-${Date.now()}`)
const gateOf = (mark: string) => join(fixtureDir, `${mark}.release`)
const test = base.extend({
  integration: [async ({}, use) => {
    const llm = await startFakeLlm()
    let host: DshHost | undefined
    try {
      await mkdir(fixtureDir, { recursive: true })
      const plugin = join(fixtureDir, 'stream.mjs')
      const nativeLlm = pathToFileURL(join(dshInstall(), 'node_modules', '@deepseek-ai', 'dsh-llm', 'lib', 'index.js')).href
      // Script only model chunks at the documented native waterfall. The Host
      // assembler, persistence, transport, controller and React are unchanged.
      await writeFile(plugin, `
import { existsSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { isAgentLoopRequest } from ${JSON.stringify(nativeLlm)};
const scenarios = ${JSON.stringify(scenarios.map(s => ({ ...s, gate: gateOf(s.mark) })))};
export const inject = ['llm'];
export function apply(ctx) {
  ctx.on('llm/stream', async function* (options, next) {
    const input = options.messages.filter(m => m.role === 'user')
      .flatMap(m => m.content.filter(b => b.type === 'text').map(b => b.text)).join(' ');
    const scenario = scenarios.find(s => input.includes(s.mark));
    if (!isAgentLoopRequest(options) || !scenario) { yield* next(); return; }
    for (const [position, index] of scenario.indices.entries()) {
      const text = scenario.texts[position];
      yield { type: 'block-start', index, blockType: 'text' };
      yield { type: 'text-delta', index, text };
      yield { type: 'block-end', index, block: { type: 'text', text } };
    }
    const deadline = Date.now() + 30000;
    while (!existsSync(scenario.gate)) {
      if (Date.now() > deadline) throw new Error('画面確認の待機が期限切れ');
      await delay(20);
    }
    yield { type: 'finish', reason: { kind: 'stop' } };
  });
}
`)
      host = await startDsh(llm.url, { preserveRuns: true, basePatch: [
        { insert: [{ id: 'm3e-stream-settlement-test', name: plugin }] },
      ] })
      await use({ host, llm })
    } finally { await host?.stop(); await llm.close() }
  }, { scope: 'worker', timeout: 600_000 }],
})

async function observeRecords(page: Page) {
  await page.addInitScript(() => {
    let facade: any
    Object.defineProperty(window, '__ModuleLoader__', {
      configurable: true, get: () => facade,
      set(value) {
        facade = value
        let load = value.load.bind(value)
        const observe = (plugin: any) => plugin.id !== '@deepseek-ai/dsh-api-session-controller' ? load(plugin) : load({
          ...plugin, factory(require: any) {
            const exported = plugin.factory(require), apply = exported.apply
            return { ...exported, apply(ctx: any) {
              const result = apply(ctx)
              ;(window as any).__settlementSessions = ctx.sessions
              return result
            } }
          },
        })
        Object.defineProperty(value, 'load', { configurable: true, get: () => observe, set: next => { load = next.bind(value) } })
      },
    })
  })
}
async function wireState(page: Page, id: string) {
  return page.evaluate(sessionId => {
    const entries = (window as any).__settlementSessions.binding(sessionId).eventSource.getSnapshot().entries
    return {
      indices: [...new Set(entries.filter((entry: any) => entry.type === 'transient')
        .map((entry: any) => entry.event.data.chunk.index).filter((index: unknown) => typeof index === 'number'))],
      accepted: entries.filter((entry: any) => entry.type === 'event' && entry.event.type === 'assistant/message')
        .map((entry: any) => entry.event),
    }
  }, id)
}

for (const scenario of scenarios) {
  test(`I48 実DSH: ${scenario.name}場合も確定前後の行と順序を保持する`, async ({ page, integration }, info) => {
    await observeRecords(page)
    await openM3e(page, integration.host)
    if (await page.getByRole('heading', { name: 'ワークスペースがありません' }).isVisible()) {
      await button(page, 'ワークスペースを追加').click()
      await button(page, 'ここを追加').click()
    }
    await button(page, '新しいセッション').click()
    await page.getByLabel('メッセージ入力欄').fill(`${scenario.mark} 確定前後の表示を確認`)
    await button(page, '送信').click()
    await expect(page).toHaveURL(/#\/s\/[^/]+$/)
    const id = decodeURIComponent(new URL(page.url()).hash.replace(/^#\/s\//, ''))
    const selector = '[data-chat-key]:has(> .chat-assistant)'
    const rows = page.locator(selector)
    await expect(rows).toHaveText(scenario.texts)
    await expect(button(page, '実行を停止')).toBeVisible()
    const live = await wireState(page, id)
    expect(live.indices).toEqual(scenario.indices)
    expect(live.accepted).toHaveLength(0)
    const beforeKeys = await rows.evaluateAll(elements => elements.map(row => row.getAttribute('data-chat-key')))
    expect(beforeKeys.map(key => Number(key!.split(':').at(-1)))).toEqual(scenario.indices)
    const beforeImage = info.outputPath('before.png')
    await page.screenshot({ path: beforeImage })
    await info.attach('確定前の画面', { path: beforeImage, contentType: 'image/png' })
    await page.evaluate(selector => {
      const state = { elements: [...document.querySelectorAll(selector)], frames: [] as (string | null)[][], observer: undefined as MutationObserver | undefined }
      const capture = () => state.frames.push([...document.querySelectorAll(selector)].map(row => row.getAttribute('data-chat-key')))
      capture()
      state.observer = new MutationObserver(capture)
      state.observer.observe(document.querySelector('.chat-transcript') ?? document.body, { childList: true, subtree: true, attributes: true })
      ;(window as any).__settlementDom = state
    }, selector)
    await writeFile(gateOf(scenario.mark), 'release')
    await expect(button(page, '実行を停止')).toHaveCount(0)
    await expect(rows).toHaveText(scenario.texts)
    const after = await wireState(page, id)
    expect(after.accepted).toHaveLength(1)
    expect(after.accepted[0].data.message.content).toEqual(scenario.texts.map(text => ({ type: 'text', text })))
    const settled = await page.evaluate(selector => {
      const state = (window as any).__settlementDom
      state.observer.disconnect()
      const current = [...document.querySelectorAll(selector)]
      return { sameElements: current.length === state.elements.length && current.every((row, i) => row === state.elements[i]), frames: state.frames }
    }, selector)
    expect(settled.sameElements, '確定によって行のDOMを作り直さない').toBe(true)
    expect(settled.frames.length, '確定中のDOM変更も観測した').toBeGreaterThan(1)
    for (const keys of settled.frames) expect(keys, '確定途中も重複・入れ替わりがない').toEqual(beforeKeys)
    await info.attach('実DSHの採用記録と行の観測', { body: JSON.stringify({ live, after, beforeKeys, settled }, null, 2), contentType: 'application/json' })
    const afterImage = info.outputPath('after.png')
    await page.screenshot({ path: afterImage })
    await info.attach('確定後の画面', { path: afterImage, contentType: 'image/png' })
    await page.reload()
    await expect(rows).toHaveText(scenario.texts)
    expect(await rows.evaluateAll(elements => elements.map(row => row.getAttribute('data-chat-key')))).toEqual(beforeKeys)
  })
}
