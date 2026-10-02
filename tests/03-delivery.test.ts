import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentContext, BeginSubmissionInput, PromptContentPart, SessionFace, SessionSummary } from '../web/src/dsh/services.ts'
import type { CommandDescriptor, ModelSelection, PlanProjection } from '../web/src/features/composer/api.ts'
import { deliverDraft, pendingDelivery, type DeliveryOptions } from '../web/src/features/composer/delivery.ts'
import { clearDraft, readDraft, writeDraft, type Draft } from '../web/src/features/composer/drafts.ts'
import { RemoteCallError } from '../web/src/dsh/remote-result.ts'
import type { PreparedImage } from '../web/src/features/composer/types.ts'

const image: PreparedImage = {
  id: 'picture', name: '写真.png', previewUrl: 'data:image/png;base64,aW1hZ2U=', width: 10, height: 20,
  prompt: { type: 'image', mediaType: 'image/png', data: 'aW1hZ2U=', name: '写真.png' },
  attachment: { type: 'image', value: { previewUrl: 'data:image/png;base64,aW1hZ2U=', name: '写真.png', width: 10, height: 20 } },
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function harness(label: string) {
  const id = `delivery-${label}`
  const key = `new:${label}`
  const calls: string[] = []
  const prompts: { content: PromptContentPart[]; mode: 'queue' | 'steer'; requestId?: string }[] = []
  const submissions: BeginSubmissionInput[] = []
  const failure = { code: 'test/send', message: 'failed', details: {} }
  let promptFails = false
  let promptFailure = failure
  let createFailure: unknown
  let createWait: Promise<void> | undefined
  let modelWait: Promise<void> | undefined
  let commandWait: Promise<void> | undefined
  let commandMatches = true
  let scopeAvailable = true
  let subagent: unknown = null
  let summary: SessionSummary | undefined
  let removed = false
  let plan: PlanProjection = { active: false, pending: false }
  const commands: CommandDescriptor[] = [{ name: 'plan', description: '計画を切り替える' }]
  const face = {
    sessionId: id,
    projections: { faceOf: () => ({ getSnapshot: () => plan, subscribe: () => () => {} }) },
    getSnapshot: () => ({ sessionId: id, subagent, removed }),
    async command(line: string) {
      calls.push(`command:${line}`)
      if (commandWait) await commandWait
      if (commandMatches && line === '/plan') plan = { active: !plan.active, pending: false }
      if (commandMatches && line === '/plan off') plan = { active: false, pending: false }
      return { ok: true, value: { matched: commandMatches } }
    },
    beginSubmission(input: BeginSubmissionInput) {
      calls.push('begin')
      submissions.push(input)
      return { requestId: `request-${submissions.length}`, abandon: () => { calls.push('abandon') } }
    },
    async prompt(content: PromptContentPart[], mode: 'queue' | 'steer', _signal?: AbortSignal, requestId?: string) {
      calls.push('prompt')
      prompts.push({ content, mode, requestId })
      return promptFails ? { ok: false, error: promptFailure } : { ok: true, value: { accepted: true } }
    },
  } as unknown as SessionFace
  const scope = {} as AgentContext
  const sessions: DeliveryOptions['sessions'] = {
    list: { getSnapshot: () => ({ ids: [], byId: summary ? { [id]: summary } : {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined }), subscribe: () => () => {} },
    async create(input) {
      calls.push(`create:${input?.workspaceId}`)
      if (createWait) await createWait
      if (createFailure) throw createFailure
      return id
    },
    scope(sessionId) { calls.push(`scope:${sessionId}`); return scopeAvailable ? scope : undefined },
    sessionOf() { return face },
    async refresh() { calls.push('refresh') },
  }
  const api: DeliveryOptions['api'] = {
    async selectModel(sessionId, selection) { calls.push(`model:${sessionId}`); if (modelWait) await modelWait; return selection },
    async listCommands(sessionId) { calls.push(`commands:${sessionId}`); return commands },
  }
  clearDraft(key)
  clearDraft(`session:${id}`)
  const options: DeliveryOptions = { target: { kind: 'new', workspaceId: label }, draftKey: key, sessions, api, mode: 'queue' }
  return {
    id, key, options, calls, prompts, submissions, failure,
    put(draft: Partial<Draft>) { writeDraft(key, { text: '', images: [], ...draft }) },
    existing(mode: 'queue' | 'steer' = 'queue'): DeliveryOptions {
      return { ...options, target: { kind: 'session', sessionId: id }, draftKey: `session:${id}`, mode }
    },
    failPrompt(value = true) { promptFails = value },
    setPromptFailure(code: string) { promptFailure = { code, message: 'synthetic diagnostic', details: {} }; promptFails = true },
    failCreate(error: unknown) { createFailure = error },
    waitCreate(value: Promise<void>) { createWait = value },
    waitModel(value: Promise<void>) { modelWait = value },
    waitCommand(value: Promise<void>) { commandWait = value },
    matchCommand(value: boolean) { commandMatches = value },
    setScopeAvailable(value: boolean) { scopeAvailable = value },
    setSubagent(value: unknown) { subagent = value },
    setSummary(value: SessionSummary) { summary = value },
    setRemoved(value: boolean) { removed = value },
    setPlan(value: PlanProjection) { plan = value },
  }
}

test('reading or editing a new draft does not create a session, and empty sends never create one', async () => {
  const h = harness('empty')
  assert.equal(readDraft(h.key).text, '')
  h.put({ text: '   ' })
  assert.deepEqual(h.calls, [])
  const result = await deliverDraft(h.options)
  assert.ok(result.error)
  assert.deepEqual(h.calls, [])
  assert.equal(readDraft(h.key).text, '   ')
})

test('first send creates exactly one session, sends image and text, and clears both drafts', async () => {
  const h = harness('first')
  h.put({ text: 'この画像を確認してください', images: [image] })
  const result = await deliverDraft(h.options)
  assert.deepEqual(result, { createdId: h.id })
  assert.deepEqual(h.calls, ['create:first', `scope:${h.id}`, 'begin', 'prompt'])
  assert.deepEqual(h.submissions[0], { mode: 'queue', text: 'この画像を確認してください', attachments: [image.attachment] })
  assert.deepEqual(h.prompts[0], { content: [image.prompt, { type: 'text', text: 'この画像を確認してください' }], mode: 'queue', requestId: 'request-1' })
  assert.deepEqual(readDraft(h.key), { text: '', images: [] })
  assert.deepEqual(readDraft(`session:${h.id}`), { text: '', images: [] })
})

test('existing sends retain the selected steer mode and accept an image-only message', async () => {
  const h = harness('steer')
  writeDraft(`session:${h.id}`, { text: '', images: [image] })
  const result = await deliverDraft(h.existing('steer'))
  assert.deepEqual(result, {})
  assert.deepEqual(h.calls, [`scope:${h.id}`, 'begin', 'prompt'])
  assert.equal(h.submissions[0]?.mode, 'steer')
  assert.deepEqual(h.prompts[0]?.content, [image.prompt])
  assert.equal(h.prompts[0]?.mode, 'steer')
})

test('failed steering retains the delivery mode with the draft for retry', async () => {
  const h = harness('steer-failure')
  writeDraft(`session:${h.id}`, { text: '割り込ませる内容', images: [] })
  h.failPrompt()
  assert.ok((await deliverDraft(h.existing('steer'))).error)
  assert.equal(readDraft(`session:${h.id}`).retryMode, 'steer')
  assert.equal(readDraft(`session:${h.id}`).text, '割り込ませる内容')
})

test('session creation failure preserves the new draft including images and choices', async () => {
  const h = harness('create-failure')
  const error = new Error('creation failed')
  const model: ModelSelection = { provider: 'local', model: 'small', reasoningEffort: 'low' }
  h.put({ text: '送信', images: [image], model, permission: 'limited', plan: true })
  h.failCreate(error)
  const result = await deliverDraft(h.options)
  assert.equal(result.error, error)
  assert.equal(result.createdId, undefined)
  assert.deepEqual(h.calls, ['create:create-failure'])
  const retained = readDraft(h.key)
  assert.equal(retained.text, '送信')
  assert.deepEqual(retained.images, [image])
  assert.deepEqual(retained.model, model)
  assert.equal(retained.permission, 'limited')
  assert.equal(retained.plan, true)
  assert.match(retained.error ?? '', /セッションを作れませんでした/u)
})

test('failed first prompt transfers the whole draft, abandons its echo, and retries without another create or plan toggle', async () => {
  const h = harness('first-failure')
  const model: ModelSelection = { provider: 'local', model: 'small', reasoningEffort: 'high' }
  h.put({ text: '画像を確認', images: [image], model, permission: 'limited', plan: true })
  h.failPrompt()
  const result = await deliverDraft(h.options)
  assert.equal(result.createdId, h.id)
  assert.ok(result.error)
  assert.deepEqual(h.calls, ['create:first-failure', `scope:${h.id}`, `model:${h.id}`, 'command:/permission limited', 'command:/plan', 'begin', 'prompt', 'abandon'])
  assert.deepEqual(readDraft(h.key), { text: '', images: [] })
  const retained = readDraft(`session:${h.id}`)
  assert.equal(retained.text, '画像を確認')
  assert.deepEqual(retained.images, [image])
  assert.deepEqual(retained.model, model)
  assert.equal(retained.permission, 'limited')
  assert.equal(retained.plan, true)
  assert.match(retained.error ?? '', /メッセージを送れませんでした/u)
  h.failPrompt(false)
  assert.deepEqual(await deliverDraft(h.existing()), {})
  assert.equal(h.calls.filter(call => call.startsWith('create:')).length, 1)
  assert.equal(h.calls.filter(call => call === 'command:/plan').length, 1)
  assert.equal(h.prompts.length, 2)
  assert.deepEqual(readDraft(`session:${h.id}`), { text: '', images: [] })
})

test('a remounted new composer joins the same in-flight send and cannot create twice', async () => {
  const h = harness('joined')
  const gate = deferred<void>()
  h.put({ text: '一度だけ送る' })
  h.waitCreate(gate.promise)
  const first = deliverDraft(h.options)
  const remounted = deliverDraft({ ...h.options })
  assert.equal(first, remounted)
  assert.deepEqual(h.calls, ['create:joined'])
  gate.resolve()
  assert.deepEqual(await first, { createdId: h.id })
  assert.equal(h.prompts.length, 1)
  assert.ok((await deliverDraft(h.options)).error)
  assert.equal(h.calls.filter(call => call.startsWith('create:')).length, 1)
})

test('known commands execute without a pending prompt; unknown or disappeared commands send text', async () => {
  for (const [label, text, matched, expectedCommand] of [
    ['known', '/plan off', true, true],
    ['unknown', '/unknown argument', true, false],
    ['disappeared', '/plan off', false, true],
  ] as const) {
    const h = harness(label)
    writeDraft(`session:${h.id}`, { text, images: [] })
    h.matchCommand(matched)
    assert.deepEqual(await deliverDraft(h.existing()), {})
    assert.ok(h.calls.includes(`commands:${h.id}`))
    assert.equal(h.calls.includes(`command:${text}`), expectedCommand)
    assert.equal(h.prompts.length, label === 'known' ? 0 : 1)
    if (label !== 'known') assert.deepEqual(h.prompts[0]?.content, [{ type: 'text', text }])
  }
})

test('known commands reject simultaneous image attachments while retaining the draft', async () => {
  const h = harness('command-image')
  const key = `session:${h.id}`
  writeDraft(key, { text: '/plan', images: [image] })
  assert.ok((await deliverDraft(h.existing())).error)
  assert.deepEqual(h.calls, [`scope:${h.id}`, `commands:${h.id}`])
  assert.deepEqual(readDraft(key).images, [image])
  assert.equal(readDraft(key).text, '/plan')
})

test('コマンド一覧が取得できなければスラッシュ入力を送らず保持し、復旧後に判定し直す', async () => {
  for (const [label, text, isCommand] of [
    ['list-known', '/plan off', true],
    ['list-unknown', '/unknown argument', false],
  ] as const) {
    const h = harness(label)
    const key = `session:${h.id}`
    const failure = new Error('Catalog unavailable')
    const listCommands = h.options.api.listCommands
    h.options.api.listCommands = async () => { throw failure }
    writeDraft(key, { text, images: isCommand ? [] : [image] })
    assert.equal((await deliverDraft(h.existing('steer'))).error, failure)
    assert.equal(readDraft(key).text, text)
    assert.deepEqual(readDraft(key).images, isCommand ? [] : [image])
    assert.equal(readDraft(key).retryMode, 'steer')
    assert.equal(h.submissions.length, 0)
    assert.equal(h.prompts.length, 0)
    assert.equal(h.calls.some(call => call.startsWith('command:')), false)
    h.options.api.listCommands = listCommands
    assert.deepEqual(await deliverDraft(h.existing('steer')), {})
    assert.equal(h.calls.includes(`command:${text}`), isCommand)
    assert.equal(h.prompts.length, isCommand ? 0 : 1)
    if (!isCommand) assert.deepEqual(h.prompts[0]?.content, [image.prompt, { type: 'text', text }])
    assert.deepEqual(readDraft(key), { text: '', images: [] })
  }
})

test('creation followed by a missing scope still transfers the draft to the created session', async () => {
  const h = harness('missing-scope')
  h.put({ text: 'あとで再送', images: [image] })
  h.setScopeAvailable(false)
  const result = await deliverDraft(h.options)
  assert.equal(result.createdId, h.id)
  assert.ok(result.error)
  assert.deepEqual(readDraft(h.key), { text: '', images: [] })
  assert.equal(readDraft(`session:${h.id}`).text, 'あとで再送')
  assert.deepEqual(readDraft(`session:${h.id}`).images, [image])
  assert.equal(h.prompts.length, 0)
})

test('read-only and removed sessions reject sending, including a change during preparation', async () => {
  for (const kind of ['subagent', 'removed'] as const) {
    const h = harness(kind)
    writeDraft(`session:${h.id}`, { text: '送れない内容', images: [] })
    if (kind === 'subagent') h.setSubagent({ parentSessionId: 'parent', childSessionId: h.id })
    else h.setRemoved(true)
    assert.ok((await deliverDraft(h.existing())).error)
    assert.equal(h.prompts.length, 0)
    assert.equal(readDraft(`session:${h.id}`).text, '送れない内容')
  }
  const h = harness('changed')
  const gate = deferred<void>()
  writeDraft(`session:${h.id}`, { text: '送信中に削除', images: [], model: { provider: 'local', model: 'small' } })
  h.waitModel(gate.promise)
  const flight = deliverDraft(h.existing())
  h.setRemoved(true)
  gate.resolve()
  assert.ok((await flight).error)
  assert.equal(h.prompts.length, 0)
})

test('verified continuable children accept queue and steer using their existing session', async () => {
  for (const mode of ['queue', 'steer'] as const) {
    const h = harness(`child-${mode}`)
    h.setSummary({ id: h.id, origin: 'subagent', parentId: 'parent', displayTitle: '子', running: true, blank: false, updatedAt: 0 })
    h.setSubagent({ address: { parentSessionId: 'parent', childSessionId: h.id, mode: 'continuable' } })
    writeDraft(`session:${h.id}`, { text: '続けて確認してください', images: [] })
    assert.deepEqual(await deliverDraft(h.existing(mode)), {})
    assert.deepEqual(h.calls, [`scope:${h.id}`, 'prompt'])
    assert.equal(h.submissions.length, 0)
    assert.equal(h.prompts.length, 1)
    assert.equal(h.prompts[0]?.mode, mode)
    assert.equal(readDraft(`session:${h.id}`).text, '')
  }
})

test('one-shot, unverified, and mismatched child addresses preserve the draft without preparation or sending', async () => {
  for (const kind of ['one-shot', 'unknown-mode', 'wrong-parent', 'wrong-child', 'no-address', 'no-metadata'] as const) {
    const h = harness(`child-${kind}`)
    h.setSummary({ id: h.id, origin: 'subagent', parentId: 'parent', displayTitle: '子', running: false, blank: false, updatedAt: 0 })
    if (kind !== 'no-metadata') h.setSubagent(kind === 'no-address' ? {} : { address: {
      parentSessionId: kind === 'wrong-parent' ? 'other' : 'parent',
      childSessionId: kind === 'wrong-child' ? 'other' : h.id,
      mode: kind === 'one-shot' ? 'one-shot' : kind === 'unknown-mode' ? 'unknown' : 'continuable',
    } })
    writeDraft(`session:${h.id}`, { text: '失わない下書き', images: [], model: { provider: 'local', model: 'small' } })
    assert.ok((await deliverDraft(h.existing())).error)
    assert.deepEqual(h.calls, [`scope:${h.id}`])
    assert.equal(h.prompts.length, 0)
    assert.equal(readDraft(`session:${h.id}`).text, '失わない下書き')
  }
})

test('a child becoming read-only or changing parent during preparation cannot send', async () => {
  for (const kind of ['mode', 'parent'] as const) {
    const h = harness(`child-change-${kind}`)
    const row: SessionSummary = { id: h.id, origin: 'subagent', parentId: 'parent', displayTitle: '子', running: true, blank: false, updatedAt: 0 }
    h.setSummary(row)
    h.setSubagent({ address: { parentSessionId: 'parent', childSessionId: h.id, mode: 'continuable' } })
    const gate = deferred<void>()
    h.waitModel(gate.promise)
    writeDraft(`session:${h.id}`, { text: '準備中に状態が変わる', images: [], model: { provider: 'local', model: 'small' } })
    const flight = deliverDraft(h.existing())
    if (kind === 'mode') h.setSubagent({ address: { parentSessionId: 'parent', childSessionId: h.id, mode: 'one-shot' } })
    else h.setSummary({ ...row, parentId: 'other' })
    gate.resolve()
    assert.ok((await flight).error)
    assert.equal(h.submissions.length, 0)
    assert.equal(h.prompts.length, 0)
    assert.equal(readDraft(`session:${h.id}`).text, '準備中に状態が変わる')
  }
})

test('a command disappearing while a child becomes read-only cannot fall through to a prompt', async () => {
  const h = harness('child-command-became-readonly')
  h.setSummary({ id: h.id, origin: 'subagent', parentId: 'parent', displayTitle: '子', running: true, blank: false, updatedAt: 0 })
  h.setSubagent({ address: { parentSessionId: 'parent', childSessionId: h.id, mode: 'continuable' } })
  h.matchCommand(false)
  const gate = deferred<void>()
  h.waitCommand(gate.promise)
  writeDraft(`session:${h.id}`, { text: '/plan off', images: [] })
  const flight = deliverDraft(h.existing())
  await Promise.resolve()
  assert.ok(h.calls.includes('command:/plan off'))
  h.setSubagent({ address: { parentSessionId: 'parent', childSessionId: h.id, mode: 'one-shot' } })
  gate.resolve()
  assert.ok((await flight).error)
  assert.equal(h.prompts.length, 0)
  assert.equal(h.submissions.length, 0)
  assert.equal(readDraft(`session:${h.id}`).text, '/plan off')
})

test('a remounted child composer joins its first send mode without duplicating preparation or submission', async () => {
  const h = harness('child-remount')
  h.setSubagent({ address: { parentSessionId: 'parent', childSessionId: h.id, mode: 'continuable' } })
  const gate = deferred<void>()
  h.waitModel(gate.promise)
  writeDraft(`session:${h.id}`, { text: '子へ一度だけ送る', images: [], model: { provider: 'local', model: 'small' } })
  const first = deliverDraft(h.existing('steer'))
  const joined = deliverDraft(h.existing('queue'))
  assert.equal(first, joined)
  gate.resolve()
  assert.deepEqual(await first, {})
  assert.equal(h.calls.filter(call => call.startsWith('model:')).length, 1)
  assert.equal(h.prompts.length, 1)
  assert.equal(h.prompts[0]?.mode, 'steer')
})

test('a child backend rejection preserves its draft and delivery mode for one retry', async () => {
  const h = harness('child-admission-denied')
  h.setSubagent({ address: { parentSessionId: 'parent', childSessionId: h.id, mode: 'continuable' } })
  writeDraft(`session:${h.id}`, { text: '拒否された子の追加依頼', images: [image] })
  h.failPrompt()
  const failure = (await deliverDraft(h.existing('steer'))).error
  assert.ok(failure instanceof RemoteCallError)
  assert.equal(failure.rpcError, h.failure)
  assert.equal(readDraft(`session:${h.id}`).text, '拒否された子の追加依頼')
  assert.deepEqual(readDraft(`session:${h.id}`).images, [image])
  assert.equal(readDraft(`session:${h.id}`).retryMode, 'steer')
  h.failPrompt(false)
  assert.deepEqual(await deliverDraft(h.existing(readDraft(`session:${h.id}`).retryMode)), {})
  assert.equal(h.prompts.length, 2)
  assert.equal(h.prompts[1]?.mode, 'steer')
  assert.deepEqual(h.prompts[1]?.content, [image.prompt, { type: 'text', text: '拒否された子の追加依頼' }])
  assert.equal(readDraft(`session:${h.id}`).text, '')
})

test('a pending plan change is treated as the next effective state and is not toggled again', async () => {
  const h = harness('pending-plan')
  writeDraft(`session:${h.id}`, { text: '計画を立てる', images: [], plan: true })
  h.setPlan({ active: false, pending: true })
  assert.deepEqual(await deliverDraft(h.existing()), {})
  assert.equal(h.calls.some(call => call.startsWith('command:')), false)
})

test('image preparation prevents creation without replacing the pending draft', async () => {
  const h = harness('preparing')
  h.put({ text: '画像の準備を待つ', preparingImages: 2, images: [image], plan: true })
  const before = readDraft(h.key)
  const result = await deliverDraft(h.options)
  assert.match(String(result.error), /画像を準備/u)
  assert.deepEqual(h.calls, [])
  assert.equal(readDraft(h.key), before)
})

test('wrapped partial-creation failure recovers the existing identity and keeps all draft choices for resend', async () => {
  const h = harness('partial')
  const model = { provider: 'local', model: 'small', reasoningEffort: 'high' }
  h.put({ text: 'まだ送っていない内容', images: [image], model, permission: 'limited', plan: true })
  const failure = { rpcError: { code: 'session/workspace-attach-failed', details: { sessionId: h.id, workspaceId: 'partial' } } }
  h.failCreate(failure)
  const result = await deliverDraft(h.options)
  assert.equal(result.createdId, h.id)
  assert.equal(result.sessionReady, true)
  assert.equal(result.error, failure)
  assert.equal(h.prompts.length, 0)
  assert.deepEqual(readDraft(h.key), { text: '', images: [] })
  const retained = readDraft(`session:${h.id}`)
  assert.equal(retained.text, 'まだ送っていない内容')
  assert.deepEqual(retained.images, [image])
  assert.deepEqual(retained.model, model)
  assert.equal(retained.permission, 'limited')
  assert.equal(retained.plan, true)
  assert.deepEqual(retained.workspaceAttachment, { workspaceId: 'partial', sessionId: h.id })
  assert.match(retained.error ?? '', /まだ送信されていません/u)
  assert.deepEqual(await deliverDraft(h.existing()), {})
  assert.equal(h.calls.filter(call => call.startsWith('create:')).length, 1)
  assert.deepEqual(readDraft(`session:${h.id}`), { text: '', images: [], workspaceAttachment: retained.workspaceAttachment })
})

test('a recovered ID remains on the new screen while its scope is missing, and retry never creates another session', async () => {
  const h = harness('partial-delayed')
  h.put({ text: '一覧を待つ', images: [image], permission: 'limited' })
  h.setScopeAvailable(false)
  h.failCreate({ rpcError: { code: 'session/workspace-attach-failed', details: { sessionId: h.id, workspaceId: 'partial-delayed' } } })
  const first = await deliverDraft(h.options)
  assert.equal(first.sessionReady, false)
  assert.equal(first.createdId, h.id)
  assert.ok(h.calls.includes('refresh'))
  assert.deepEqual(readDraft(h.key).workspaceAttachment, { workspaceId: 'partial-delayed', sessionId: h.id })
  assert.deepEqual(readDraft(h.key).images, [image])
  assert.equal((await deliverDraft(h.options)).sessionReady, false)
  assert.equal(h.calls.filter(call => call.startsWith('create:')).length, 1)
  h.setScopeAvailable(true)
  assert.deepEqual(await deliverDraft(h.options), { createdId: h.id })
  assert.equal(h.calls.filter(call => call.startsWith('create:')).length, 1)
  assert.equal(h.prompts.length, 1)
  assert.deepEqual(readDraft(h.key), { text: '', images: [] })
  assert.equal(readDraft(`session:${h.id}`).text, '')
  assert.deepEqual(readDraft(`session:${h.id}`).workspaceAttachment, { workspaceId: 'partial-delayed', sessionId: h.id })
})

test('unknown failures and missing published IDs remain creation failures without inventing an identity', async () => {
  for (const [label, code, sessionId] of [
    ['unknown-error', 'gateway/disconnected', 'some-id'],
    ['missing-id', 'session/workspace-attach-failed', undefined],
    ['empty-id', 'session/workspace-attach-failed', ''],
  ] as const) {
    const h = harness(label)
    h.put({ text: '下書きを残す', images: [image] })
    h.failCreate({ rpcError: { code, details: { workspaceId: label, sessionId } } })
    const result = await deliverDraft(h.options)
    assert.equal(result.createdId, undefined)
    assert.ok(result.error)
    assert.equal(readDraft(h.key).text, '下書きを残す')
    assert.deepEqual(readDraft(h.key).images, [image])
    assert.equal(readDraft(h.key).workspaceAttachment, undefined)
    assert.equal(h.calls.some(call => call.startsWith('scope:')), false)
  }
})

test('an uncertain prompt response retains the draft without claiming rejection or automatically retrying', async () => {
  for (const code of ['gateway/internal', 'gateway/cancelled']) {
    const h = harness(`uncertain-${code}`)
    h.setPromptFailure(code)
    writeDraft(`session:${h.id}`, { text: '応答を失った依頼', images: [image] })
    const result = await deliverDraft(h.existing('steer'))
    assert.ok(result.error)
    const retained = readDraft(`session:${h.id}`)
    assert.equal(retained.deliveryOutcome, 'unknown')
    assert.match(retained.error ?? '', /送信結果を確認できません/)
    assert.equal(retained.text, '応答を失った依頼')
    assert.deepEqual(retained.images, [image])
    assert.equal(retained.retryMode, 'steer')
    assert.equal(h.prompts.length, 1)
    const failedPreparation = h.existing('steer')
    failedPreparation.api = { ...failedPreparation.api, selectModel: async () => { throw new Error('synthetic retry preparation loss') } }
    writeDraft(`session:${h.id}`, { ...retained, model: { provider: 'retry-provider', model: 'retry-model' } })
    assert.ok((await deliverDraft(failedPreparation)).error)
    assert.equal(readDraft(`session:${h.id}`).deliveryOutcome, 'unknown')
    assert.equal(h.prompts.length, 1)
    h.setPromptFailure('subagent/parent-unavailable')
    assert.ok((await deliverDraft(h.existing('steer'))).error)
    assert.equal(readDraft(`session:${h.id}`).deliveryOutcome, 'unknown')
    assert.match(readDraft(`session:${h.id}`).error ?? '', /送信結果を確認できません/)
    assert.equal(h.prompts.length, 2)
    h.failPrompt(false)
    assert.deepEqual(await deliverDraft(h.existing('steer')), {})
    assert.equal(h.prompts.length, 3)
    assert.equal(readDraft(`session:${h.id}`).deliveryOutcome, undefined)
  }
})

test('an explicit Host rejection and a preparation failure remain distinct from an uncertain prompt response', async () => {
  const rejected = harness('explicit-rejection')
  rejected.setPromptFailure('subagent/parent-unavailable')
  writeDraft(`session:${rejected.id}`, { text: '明確に拒否される依頼', images: [] })
  assert.ok((await deliverDraft(rejected.existing())).error)
  assert.equal(readDraft(`session:${rejected.id}`).deliveryOutcome, undefined)
  assert.equal(rejected.prompts.length, 1)
  const preparation = harness('failed-preparation')
  writeDraft(`session:${preparation.id}`, { text: '/plan', images: [] })
  const options = preparation.existing()
  options.api = { ...options.api, listCommands: async () => { throw new Error('synthetic preparation loss') } }
  assert.ok((await deliverDraft(options)).error)
  assert.equal(readDraft(`session:${preparation.id}`).deliveryOutcome, undefined)
  assert.equal(preparation.prompts.length, 0)
})

test('new and created session composers share preparation, delivery and cleanup on success or rejection', async () => {
  for (const outcome of ['success', 'test/send', 'gateway/internal']) {
    const reject = outcome !== 'success'
    const h = harness(`created-alias-${outcome}`)
    const gate = deferred<void>()
    h.put({ text: '作成済み画面でも一度だけ送る', model: { provider: 'local', model: 'small' } })
    h.waitModel(gate.promise)
    if (reject) h.setPromptFailure(outcome)
    const first = deliverDraft(h.options)
    let joined: Promise<unknown> | undefined
    try {
      await Promise.resolve()
      assert.equal(pendingDelivery(`session:${h.id}`), first)
      assert.equal(readDraft(`session:${h.id}`).text, '作成済み画面でも一度だけ送る')
      joined = deliverDraft(h.existing('steer'))
      assert.equal(joined, first)
      gate.resolve()
      const result = await first
      assert.equal(Boolean(result.error), reject)
      assert.equal(h.calls.filter(call => call.startsWith('model:')).length, 1)
      assert.equal(h.prompts.length, 1)
      assert.equal(h.prompts[0]?.mode, 'queue')
      assert.equal(pendingDelivery(h.key), undefined)
      assert.equal(pendingDelivery(`session:${h.id}`), undefined)
      assert.equal(readDraft(`session:${h.id}`).text, reject ? '作成済み画面でも一度だけ送る' : '')
      assert.equal(readDraft(`session:${h.id}`).deliveryOutcome, outcome === 'gateway/internal' ? 'unknown' : undefined)
    } finally { gate.resolve(); await Promise.allSettled([first, ...(joined ? [joined] : [])]) }
  }
})

test('read-only or removed changes during model preparation block subsequent permission and plan operations', async () => {
  for (const removed of [false, true]) {
    const h = harness(`stale-preparation-${removed}`)
    h.setSubagent({ address: { parentSessionId: 'parent', childSessionId: h.id, mode: 'continuable' } })
    const gate = deferred<void>()
    h.waitModel(gate.promise)
    writeDraft(`session:${h.id}`, { text: '後続の変更は送らない', images: [], model: { provider: 'local', model: 'small' }, permission: 'limited', plan: true })
    const first = deliverDraft(h.existing())
    if (removed) h.setRemoved(true)
    else h.setSubagent({ address: { parentSessionId: 'parent', childSessionId: h.id, mode: 'one-shot' } })
    gate.resolve()
    assert.ok((await first).error)
    assert.deepEqual(h.calls.filter(call => call.startsWith('command:')), [])
    assert.equal(h.prompts.length, 0)
    assert.equal(readDraft(`session:${h.id}`).text, '後続の変更は送らない')
  }
})

test('a capability change while permission is awaiting blocks later plan changes', async () => {
  const h = harness('stale-after-permission')
  h.setSubagent({ address: { parentSessionId: 'parent', childSessionId: h.id, mode: 'continuable' } })
  const gate = deferred<void>()
  h.waitCommand(gate.promise)
  writeDraft(`session:${h.id}`, { text: '計画は切り替えない', images: [], permission: 'limited', plan: true })
  const flight = deliverDraft(h.existing())
  assert.ok(h.calls.includes('command:/permission limited'))
  h.setSubagent({ address: { parentSessionId: 'parent', childSessionId: h.id, mode: 'one-shot' } })
  gate.resolve()
  assert.ok((await flight).error)
  assert.deepEqual(h.calls.filter(call => call.startsWith('command:')), ['command:/permission limited'])
  assert.equal(h.prompts.length, 0)
})

test('disappeared commands use the latest ordinary or child echo policy after their await', async () => {
  for (const becomesChild of [true, false]) {
    const h = harness(`latest-echo-${becomesChild}`)
    if (!becomesChild) h.setSubagent({ address: { parentSessionId: 'parent', childSessionId: h.id, mode: 'continuable' } })
    h.matchCommand(false)
    const gate = deferred<void>()
    h.waitCommand(gate.promise)
    writeDraft(`session:${h.id}`, { text: '/plan off', images: [] })
    const flight = deliverDraft(h.existing())
    await Promise.resolve()
    assert.ok(h.calls.includes('command:/plan off'))
    h.setSubagent(becomesChild ? { address: { parentSessionId: 'parent', childSessionId: h.id, mode: 'continuable' } } : null)
    gate.resolve()
    assert.deepEqual(await flight, {})
    assert.equal(h.submissions.length, becomesChild ? 0 : 1)
    assert.equal(h.prompts.length, 1)
    assert.equal(h.prompts[0]?.requestId, becomesChild ? undefined : 'request-1')
  }
})

test('a retained new origin joins an existing session flight without sending or deleting its distinct draft', async () => {
  for (const outcome of ['success', 'test/send', 'gateway/internal']) {
    const h = harness(`retained-join-${outcome}`)
    const attachment = { workspaceId: h.key.slice(4), sessionId: h.id }
    h.put({ text: '元画面に残る別の未送信文章', workspaceAttachment: attachment })
    writeDraft(`session:${h.id}`, { text: '会話画面から先に送る文章', images: [], model: { provider: 'local', model: 'small' }, workspaceAttachment: attachment })
    const gate = deferred<void>()
    h.waitModel(gate.promise)
    if (outcome !== 'success') h.setPromptFailure(outcome)
    const first = deliverDraft(h.existing())
    let joined: Promise<unknown> | undefined
    try {
      joined = deliverDraft(h.options)
      assert.equal(joined, first)
      assert.equal(pendingDelivery(h.key), first)
      assert.equal(pendingDelivery(`session:${h.id}`), first)
      gate.resolve()
      const result = await first
      assert.equal(Boolean(result.error), outcome !== 'success')
      assert.equal(h.calls.filter(call => call.startsWith('model:')).length, 1)
      assert.equal(h.prompts.length, 1)
      assert.equal(readDraft(h.key).text, '元画面に残る別の未送信文章')
      assert.equal(pendingDelivery(h.key), undefined)
      assert.equal(pendingDelivery(`session:${h.id}`), undefined)
      assert.equal(readDraft(`session:${h.id}`).deliveryOutcome, outcome === 'gateway/internal' ? 'unknown' : undefined)
    } finally { gate.resolve(); await Promise.allSettled([first, ...(joined ? [joined] : [])]) }
  }
})

test('a valid retained creation registers both keys synchronously and an invalid attachment cannot join another conversation', async () => {
  const h = harness('synchronous-retained')
  const gate = deferred<void>()
  h.put({ text: '保持したIDへ一度だけ送る', model: { provider: 'local', model: 'small' }, workspaceAttachment: { workspaceId: h.key.slice(4), sessionId: h.id } })
  h.waitModel(gate.promise)
  const first = deliverDraft(h.options)
  try {
    assert.equal(pendingDelivery(h.key), first)
    assert.equal(pendingDelivery(`session:${h.id}`), first)
    assert.equal(deliverDraft(h.existing()), first)
    gate.resolve()
    assert.deepEqual(await first, { createdId: h.id })
    assert.equal(h.calls.filter(call => call.startsWith('create:')).length, 0)
    assert.equal(h.prompts.length, 1)
  } finally { gate.resolve(); await first }
  const invalid = harness('invalid-retained-join')
  const hold = deferred<void>()
  invalid.waitModel(hold.promise)
  writeDraft(`session:${invalid.id}`, { text: '保留する会話の本文', images: [], model: { provider: 'local', model: 'small' } })
  invalid.put({ text: '誤った復旧情報の下書き', workspaceAttachment: { workspaceId: 'wrong-workspace', sessionId: invalid.id } })
  const existing = deliverDraft(invalid.existing())
  try {
    assert.equal(pendingDelivery(invalid.key), undefined)
    assert.ok((await deliverDraft(invalid.options)).error)
    assert.equal(pendingDelivery(`session:${invalid.id}`), existing)
    assert.equal(invalid.prompts.length, 0)
  } finally { hold.resolve(); await existing }
})
