import assert from 'node:assert/strict'
import test from 'node:test'
import type { AgentContext, BeginSubmissionInput, PromptContentPart, SessionFace } from '../web/src/dsh/services.ts'
import type { CommandDescriptor, ModelSelection, PlanProjection } from '../web/src/features/composer/api.ts'
import { deliverDraft, type DeliveryOptions } from '../web/src/features/composer/delivery.ts'
import { clearDraft, readDraft, writeDraft, type Draft } from '../web/src/features/composer/drafts.ts'
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
  let createFailure: unknown
  let createWait: Promise<void> | undefined
  let modelWait: Promise<void> | undefined
  let commandMatches = true
  let scopeAvailable = true
  let subagent: unknown = null
  let removed = false
  let plan: PlanProjection = { active: false, pending: false }
  const commands: CommandDescriptor[] = [{ name: 'plan', description: '計画を切り替える' }]
  const face = {
    sessionId: id,
    projections: { faceOf: () => ({ getSnapshot: () => plan, subscribe: () => () => {} }) },
    getSnapshot: () => ({ subagent, removed }),
    async command(line: string) {
      calls.push(`command:${line}`)
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
      return promptFails ? { ok: false, error: failure } : { ok: true, value: { accepted: true } }
    },
  } as unknown as SessionFace
  const scope = {} as AgentContext
  const sessions: DeliveryOptions['sessions'] = {
    async create(input) {
      calls.push(`create:${input?.workspaceId}`)
      if (createWait) await createWait
      if (createFailure) throw createFailure
      return id
    },
    scope(sessionId) { calls.push(`scope:${sessionId}`); return scopeAvailable ? scope : undefined },
    sessionOf() { return face },
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
    failCreate(error: unknown) { createFailure = error },
    waitCreate(value: Promise<void>) { createWait = value },
    waitModel(value: Promise<void>) { modelWait = value },
    matchCommand(value: boolean) { commandMatches = value },
    setScopeAvailable(value: boolean) { scopeAvailable = value },
    setSubagent(value: unknown) { subagent = value },
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

test('a pending plan change is treated as the next effective state and is not toggled again', async () => {
  const h = harness('pending-plan')
  writeDraft(`session:${h.id}`, { text: '計画を立てる', images: [], plan: true })
  h.setPlan({ active: false, pending: true })
  assert.deepEqual(await deliverDraft(h.existing()), {})
  assert.equal(h.calls.some(call => call.startsWith('command:')), false)
})
