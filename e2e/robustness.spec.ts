import { test, expect, visit, button, shot } from './helpers'
import type { Page } from '@playwright/test'

// Response interception instruments only this mock browser. None of these
// diagnostics or response controls is added to product modules or the SDK.
async function instrument(page: Page) {
  await page.addInitScript(() => {
    const state = window as any
    state.__robustnessPointerListeners = new Set()
    const add = document.addEventListener.bind(document)
    const remove = document.removeEventListener.bind(document)
    document.addEventListener = ((type: string, listener: unknown, options: unknown) => {
      if (type === 'pointerdown') state.__robustnessPointerListeners.add(listener)
      return add(type, listener as EventListener, options as AddEventListenerOptions)
    }) as typeof document.addEventListener
    document.removeEventListener = ((type: string, listener: unknown, options: unknown) => {
      if (type === 'pointerdown') state.__robustnessPointerListeners.delete(listener)
      return remove(type, listener as EventListener, options as EventListenerOptions)
    }) as typeof document.removeEventListener
  })
  for (const [file, transform] of [
    ['features/composer/drafts.ts', (body: string) => `${body}\nglobalThis.__robustnessDrafts = () => ({ keys: drafts.size, subscriberKeys: listeners.size, subscribers: [...listeners.values()].reduce((n, set) => n + set.size, 0), preparationKeys: preparations.size, preparations: [...preparations.values()].reduce((n, set) => n + set.size, 0), images: [...drafts.values()].reduce((n, draft) => n + draft.images.length, 0) });`],
    ['features/composer/delivery.ts', (body: string) => `${body}\nglobalThis.__robustnessFlights = () => ({ aliases: flights.size, owners: flightKeys.size });`],
    ['dsh/mock/observable.ts', (body: string) => {
      expect(body.match(/const listeners =[^\n]+/g)).toHaveLength(1)
      return body.replace(/const listeners =[^\n]+/, original => `${original}
        const metrics = globalThis.__robustnessObservables ??= { active: 0, created: 0 };
        metrics.created++;
        const add = listeners.add.bind(listeners), remove = listeners.delete.bind(listeners);
        listeners.add = value => { const size = listeners.size; const result = add(value); metrics.active += listeners.size - size; return result; };
        listeners.delete = value => { const result = remove(value); if (result) metrics.active--; return result; };`)
    }],
    ['dsh/mock/context.ts', (body: string) => {
      expect(body.match(/\breturn ctx;?/g)).toHaveLength(1)
      return body.replace(/\breturn ctx;?/, `globalThis.__robustnessContext = ctx;
        globalThis.__robustnessMock = () => ({ models: models.size, timers: timers.size, startup: startupEvents.size, handlers: [...handlers.values()].reduce((n, set) => n + set.size, 0), handlerKeys: handlers.size, submissions: [...models.values()].reduce((n, model) => n + model.submissions.size, 0), attachments: attachments.size, records: [...models.values()].reduce((n, model) => n + model.records.length, 0) });
        return ctx;`)
    }],
  ] as const) {
    await page.route(`**/src/${file}*`, async route => {
      const response = await route.fetch()
      await route.fulfill({ response, body: transform(await response.text()) })
    })
  }
}
async function metrics(page: Page) {
  return page.evaluate(() => {
    const state = window as any
    return { drafts: state.__robustnessDrafts(), flights: state.__robustnessFlights(), mock: state.__robustnessMock(), observable: { ...state.__robustnessObservables }, pointerdown: state.__robustnessPointerListeners.size,
      storageKeys: Object.keys(localStorage).filter(key => key.startsWith('m3e:composer:')).sort() }
  })
}
async function navigate(page: Page, id: string) {
  await page.evaluate(value => { window.location.hash = value ? `/s/${value}` : '/' }, id)
  if (id) {
    const title = await page.evaluate(id => (window as any).__robustnessContext.sessions.list.getSnapshot().byId[id].displayTitle, id)
    await expect(page.locator('h1').first()).toHaveText(title)
  } else await expect(page.locator('.home-session').first()).toBeVisible()
  if (id === 'readme-review' || id === 'session-tools-review') await expect(page.getByLabel('メッセージ入力欄', { exact: true })).toBeVisible()
  else await expect(page.getByLabel('メッセージ入力欄', { exact: true })).toHaveCount(0)
}
async function flushResponses(page: Page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(null)))))
}
async function settled(page: Page) {
  await expect.poll(async () => (await metrics(page)).mock.timers).toBe(0)
  await expect.poll(async () => (await metrics(page)).drafts.subscribers).toBe(0)
  return metrics(page)
}
function resources(value: Awaited<ReturnType<typeof metrics>>) {
  const { records: _records, ...mock } = value.mock
  return { ...value, mock }
}
for (const width of [375, 390]) {
  test(`03 ${width}px 固定会話を反復し切断・再接続しても購読と保持状態が増えない`, async ({ page }, info) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width, height: width === 375 ? 812 : 844 })
    await instrument(page)
    await visit(page, '/')
    const input = page.getByLabel('メッセージ入力欄', { exact: true })
    // Warm the exact identity/route set before comparing retained resources.
    for (let warm = 0; warm < 2; warm++) {
      await navigate(page, 'readme-review'); await input.fill(`通常の保持本文 ${width}`)
      await navigate(page, 'session-tools-review'); await input.fill(`子の保持本文 ${width}`)
      await navigate(page, 'session-tools-tests')
      await navigate(page, '')
    }
    const baseline = await settled(page)
    const observations = []
    for (let cycle = 0; cycle < 6; cycle++) {
      await page.evaluate(() => { (window as any).__robustnessContext.connection.state.set('disconnected') })
      await navigate(page, 'readme-review')
      await expect(input).toHaveValue(`通常の保持本文 ${width}`)
      await expect(button(page, '送信')).toBeDisabled()
      await navigate(page, 'session-tools-review')
      await expect(input).toHaveValue(`子の保持本文 ${width}`)
      await expect(button(page, '順番待ち')).toBeDisabled()
      await button(page, '再接続').click()
      await expect(button(page, '順番待ち')).toBeEnabled()
      await page.getByRole('tab', { name: 'トレース', exact: true }).click()
      await expect(input).toHaveCount(0)
      await page.getByRole('tab', { name: 'チャット', exact: true }).click()
      await expect(input).toHaveValue(`子の保持本文 ${width}`)
      await navigate(page, 'session-tools-tests')
      await navigate(page, '')
      const current = await settled(page)
      expect(resources(current)).toEqual(resources(baseline))
      observations.push({ cycle, ...current })
    }
    await navigate(page, 'readme-review')
    await expect(input).toHaveValue(`通常の保持本文 ${width}`)
    await shot(page, `robustness-disconnected-repeat-${width}`)
    await info.attach('bounded-resource-observations', { body: JSON.stringify({ baseline, observations }), contentType: 'application/json' })
  })

  test(`03 ${width}px 古い候補応答を後から返しても最新候補と別会話を汚さない`, async ({ page }, info) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width, height: width === 375 ? 812 : 844 })
    await instrument(page)
    await visit(page, '/s/readme-review')
    await page.evaluate(() => {
      const state = window as any, ctx = state.__robustnessContext
      state.__robustnessRequests = { commands: [], files: [], holdCommands: false }
      const requests = state.__robustnessRequests, original = ctx.remote.commands.list.bind(ctx.remote.commands)
      ctx.mock.patch('remote.commands.list', (sessionId: string) => requests.holdCommands ? new Promise(resolve => { requests.commands.push({ sessionId, resolve }) }) : original(sessionId))
      ctx.mock.patch('remote.fileReferences.list', (sessionId: string, query: string, signal: AbortSignal) => new Promise(resolve => { requests.files.push({ sessionId, query, signal, resolve }) }))
    })
    const input = page.getByLabel('メッセージ入力欄', { exact: true }), observations = []
    for (let cycle = 0; cycle < 4; cycle++) {
      await input.fill('/fresh')
      const count = await page.evaluate(() => (window as any).__robustnessRequests.commands.length)
      await page.evaluate(async () => {
        const state = window as any
        state.__robustnessRequests.holdCommands = true
        await state.__robustnessContext.mock.emit('commands/change', {})
        await state.__robustnessContext.mock.emit('commands/change', {})
        state.__robustnessRequests.holdCommands = false
      })
      await expect.poll(() => page.evaluate(() => (window as any).__robustnessRequests.commands.length)).toBe(count + 2)
      await page.evaluate(({ count, cycle }) => { (window as any).__robustnessRequests.commands[count + 1].resolve({ ok: true, value: [{ name: `fresh${cycle}`, description: '最新の合成候補' }] }) }, { count, cycle })
      await expect(page.getByLabel('コマンドの候補')).toContainText(`/fresh${cycle}`)
      await page.evaluate(({ count, cycle }) => { (window as any).__robustnessRequests.commands[count].resolve({ ok: true, value: [{ name: `stale${cycle}`, description: '古い合成候補' }] }) }, { count, cycle })
      await flushResponses(page)
      await expect(page.getByLabel('コマンドの候補')).toContainText(`/fresh${cycle}`)
      await expect(page.getByText(`/stale${cycle}`, { exact: true })).toHaveCount(0)
      await input.fill(`@old${cycle}`)
      await expect.poll(() => page.evaluate(cycle => (window as any).__robustnessRequests.files.filter((request: any) => request.query === `old${cycle}`).length, cycle)).toBe(1)
      await input.fill(`@new${cycle}`)
      await expect.poll(() => page.evaluate(cycle => (window as any).__robustnessRequests.files.filter((request: any) => request.query === `new${cycle}`).length, cycle)).toBe(1)
      await page.evaluate(cycle => { (window as any).__robustnessRequests.files.find((request: any) => request.query === `new${cycle}`).resolve({ ok: true, value: [{ path: `new${cycle}.md`, kind: 'file' }] }) }, cycle)
      await expect(page.getByLabel('ファイルの候補')).toContainText(`new${cycle}.md`)
      const oldAborted = await page.evaluate(cycle => {
        const request = (window as any).__robustnessRequests.files.find((request: any) => request.query === `old${cycle}`)
        request.resolve({ ok: true, value: [{ path: `old${cycle}.md`, kind: 'file' }] })
        return request.signal.aborted
      }, cycle)
      expect(oldAborted).toBe(true)
      await flushResponses(page)
      await expect(page.getByLabel('ファイルの候補')).toContainText(`new${cycle}.md`)
      await expect(page.getByText(`old${cycle}.md`, { exact: true })).toHaveCount(0)
      await input.fill(`@foreign${cycle}`)
      await expect.poll(() => page.evaluate(cycle => (window as any).__robustnessRequests.files.filter((request: any) => request.query === `foreign${cycle}`).length, cycle)).toBe(1)
      await navigate(page, 'session-tools-review')
      await input.fill(`子だけの本文 ${cycle}`)
      await page.evaluate(cycle => { (window as any).__robustnessRequests.files.find((request: any) => request.query === `foreign${cycle}`).resolve({ ok: true, value: [{ path: `foreign${cycle}.md`, kind: 'file' }] }) }, cycle)
      await flushResponses(page)
      await expect(input).toHaveValue(`子だけの本文 ${cycle}`)
      await expect(page.getByLabel('ファイルの候補')).toHaveCount(0)
      await expect(page.getByLabel('コマンドの候補')).toHaveCount(0)
      observations.push({ cycle, oldFileSignalAborted: oldAborted, newerThenOlderThenOtherConversation: true })
      await navigate(page, 'readme-review')
    }
    await shot(page, `robustness-reordered-candidates-${width}`)
    await info.attach('deterministic-release-order', { body: JSON.stringify(observations), contentType: 'application/json' })
  })

  test(`03 ${width}px 二会話の保留応答を逆順で返し切断しても送信状態を混ぜない`, async ({ page }, info) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width, height: width === 375 ? 812 : 844 })
    await instrument(page)
    await visit(page, '/s/readme-review')
    await navigate(page, 'session-tools-review')
    await button(page, '実行を停止').click()
    await navigate(page, '')
    const baseline = await settled(page), observations = []
    await page.evaluate(() => {
      const state = window as any, ctx = state.__robustnessContext
      state.__robustnessPrompts = []
      const retain = ctx.sessions.retain.bind(ctx.sessions), patched = new WeakSet()
      ctx.sessions.retain = (...args: any[]) => {
        const reference = retain(...args), sessionId = reference.sessionId
        const face = reference.binding.session
        if (!['readme-review', 'session-tools-review'].includes(sessionId) || patched.has(face)) return reference
        patched.add(face)
        const original = face.prompt.bind(face)
        face.prompt = async (...args: any[]) => {
          // Cases 0/2 hold the known synthetic response after acceptance;
          // case 1 holds before acceptance to test explicit disconnected refusal.
          const beforeAcceptance = state.__robustnessBeforeAcceptance
          const result = beforeAcceptance ? undefined : await original(...args)
          await new Promise(resolve => { state.__robustnessPrompts.push({ sessionId, release: resolve, released: false, phase: beforeAcceptance ? 'before-acceptance' : 'accepted-response-held' }) })
          return beforeAcceptance ? original(...args) : result
        }
        return reference
      }
    })
    const input = page.getByLabel('メッセージ入力欄', { exact: true })
    async function release(sessionId: string) {
      await page.evaluate(sessionId => {
        const request = (window as any).__robustnessPrompts.find((request: any) => request.sessionId === sessionId && !request.released)
        if (!request) throw new Error('expected held prompt missing')
        request.released = true; request.release()
      }, sessionId)
    }
    for (let cycle = 0; cycle < 3; cycle++) {
      const a = `通常だけへの保留依頼 ${width}-${cycle}`, b = `子だけへの保留依頼 ${width}-${cycle}`
      await page.evaluate(cycle => { (window as any).__robustnessBeforeAcceptance = cycle === 1 }, cycle)
      const beforeCalls = await page.evaluate(() => (window as any).__robustnessPrompts.length)
      await navigate(page, 'readme-review'); await input.fill(a); await button(page, '送信').click()
      await navigate(page, 'session-tools-review'); await input.fill(b); await button(page, '送信').click()
      await expect.poll(() => page.evaluate(() => (window as any).__robustnessPrompts.length)).toBe(beforeCalls + 2)
      await navigate(page, 'readme-review')
      await expect(input).toHaveValue(a); await expect(input).toBeDisabled()
      if (cycle === 0) await shot(page, `robustness-accepted-pending-${width}`)
      if (cycle === 1) await page.evaluate(() => { (window as any).__robustnessContext.connection.state.set('disconnected') })
      await release('session-tools-review')
      await expect.poll(async () => (await metrics(page)).flights.owners).toBe(1)
      await expect(input).toHaveValue(a); await expect(input).toBeDisabled()
      if (cycle === 0) await shot(page, `robustness-accepted-pending-${width}`)
      if (cycle === 1) {
        await navigate(page, 'session-tools-review')
        await expect(input).toHaveValue(b)
        await expect(page.getByRole('alert')).toContainText('接続')
        expect(await page.evaluate(() => (window as any).__robustnessPrompts.length)).toBe(beforeCalls + 2)
        await button(page, '再接続').click()
        await expect(button(page, '送信')).toBeEnabled()
        await page.getByRole('alert').getByRole('button', { name: 'もう一度送る', exact: true }).click()
        await expect.poll(() => page.evaluate(() => (window as any).__robustnessPrompts.length)).toBe(beforeCalls + 3)
        await release('session-tools-review')
        await expect(input).toHaveValue('')
      }
      await release('readme-review')
      await expect.poll(async () => (await metrics(page)).flights.owners).toBe(0)
      for (const [id, text] of [['readme-review', a], ['session-tools-review', b]]) {
        await navigate(page, id)
        await expect(input).toHaveValue('')
        await expect(page.getByLabel('自分のメッセージ', { exact: true }).filter({ hasText: text })).toHaveCount(1)
        await expect(page.getByLabel('自分のメッセージ', { exact: true }).filter({ hasText: id === 'readme-review' ? b : a })).toHaveCount(0)
        await expect(page.getByLabel('送信中のメッセージ', { exact: true })).toHaveCount(0)
      }
      await page.evaluate(async () => {
        const ctx = (window as any).__robustnessContext
        for (const id of ['readme-review', 'session-tools-review']) await ctx.sessions.using(id, { source: 'm3e.testStop' }, (reference: any) => reference.binding.session.cancel())
      })
      await navigate(page, '')
      const current = await settled(page)
      expect(resources(current)).toEqual(resources(baseline))
      observations.push({ cycle, calls: (await page.evaluate(() => (window as any).__robustnessPrompts.length)) - beforeCalls, childBeforeNormal: true, phase: cycle === 1 ? 'pre-acceptance-disconnected-refusal' : 'post-acceptance-response-order', ...current })
    }
    await navigate(page, 'session-tools-review')
    await shot(page, `robustness-reordered-delivery-${width}`)
    await info.attach('interleaved-flight-resources', { body: JSON.stringify({ baseline, observations }), contentType: 'application/json' })
  })
}
