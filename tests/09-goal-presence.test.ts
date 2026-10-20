import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GOAL_STRIP_MIN_VIEWPORT_HEIGHT, goalPresenceModel, goalStripFits, type GoalPresenceInput,
} from '../web/src/features/session-tools/goal-presence-model.ts'
import { sessionToolsMessages } from '../web/src/features/session-tools/messages.ts'
import type { GoalDisplayState } from '../web/src/features/session-tools/operations.ts'

const text = sessionToolsMessages.ja

function display(overrides: Partial<GoalDisplayState['goal']> & { roundsStarted?: number; activation?: GoalDisplayState['activation'] } = {}): GoalDisplayState {
  const { roundsStarted = 3, activation, ...goalPatch } = overrides
  return {
    goal: {
      id: 'goal-1', revision: 1, objective: '承認シートを作る', phase: 'active', maxGoalRounds: 8,
      ...goalPatch,
    },
    roundsStarted, createdAt: 1000, updatedAt: 2000,
    ...(activation === undefined ? {} : { activation }),
  }
}

function input(overrides: Partial<GoalPresenceInput> = {}): GoalPresenceInput {
  return {
    current: display({ activation: 'armed' }),
    activation: 'armed',
    activationReady: true,
    activationError: false,
    readOnly: false,
    busy: false,
    error: '',
    needsRefresh: false,
    editSupported: true,
    goalsSupported: true,
    connected: true,
    ...overrides,
  }
}

function modelOf(overrides: Partial<GoalPresenceInput> = {}) {
  return goalPresenceModel(input(overrides), text)
}

function visibleModel(overrides: Partial<GoalPresenceInput> = {}) {
  const model = modelOf(overrides)
  assert.equal(model.strip.kind, 'visible')
  if (model.strip.kind !== 'visible') throw new Error('expected visible')
  return model.strip.model
}

test('読込中・ゴール無し・完了ではストリップを隠す', () => {
  assert.equal(modelOf({ current: undefined }).strip.kind, 'hidden')
  assert.equal(modelOf({ current: null }).strip.kind, 'hidden')
  assert.equal(modelOf({ current: display({ phase: 'complete' }) }).strip.kind, 'hidden')

  const loading = modelOf({ current: undefined })
  assert.equal(loading.primary, undefined)
  assert.equal(loading.exhausted, false)
  assert.equal(loading.statusLine, '')

  const complete = modelOf({ current: display({ phase: 'complete' }), activation: undefined })
  assert.equal(complete.primary, undefined)
  assert.equal(complete.statusLine, '完了 ・ 3 / 8 ラウンド')
  assert.equal('strip' in complete, true)
})

test('進行中は目標・状態・一時停止と編集を出し、メッセージは出さない', () => {
  const model = modelOf()
  assert.equal(model.primary, 'pause')
  assert.equal(model.exhausted, false)
  assert.equal(model.canMutate, true)
  assert.equal(model.canEdit, true)
  assert.equal(model.statusLine, '進行中 ・ 3 / 8 ラウンド')

  const strip = visibleModel()
  assert.equal(strip.objective, '承認シートを作る')
  assert.equal(strip.statusLine, '進行中 ・ 3 / 8 ラウンド')
  assert.deepEqual(strip.actions, [
    { kind: 'pause', enabled: true },
    { kind: 'edit', enabled: true },
  ])
  assert.equal('message' in strip, false)
})

test('停止中・一時停止・行き詰まりでは再開を選ぶ', () => {
  const stopped = modelOf({ activation: 'disarmed', current: display({ activation: 'disarmed' }) })
  assert.equal(stopped.primary, 'resume')
  assert.equal(stopped.statusLine, '停止中 ・ 3 / 8 ラウンド')
  assert.deepEqual(visibleModel({ activation: 'disarmed', current: display({ activation: 'disarmed' }) }).actions, [
    { kind: 'resume', enabled: true },
    { kind: 'edit', enabled: true },
  ])

  const paused = modelOf({ activation: 'disarmed', current: display({ phase: 'paused', activation: 'disarmed' }) })
  assert.equal(paused.primary, 'resume')
  assert.equal(paused.statusLine, '一時停止 ・ 3 / 8 ラウンド')
  assert.deepEqual(visibleModel({ activation: 'disarmed', current: display({ phase: 'paused', activation: 'disarmed' }) }).actions, [
    { kind: 'resume', enabled: true },
    { kind: 'edit', enabled: true },
  ])
})

test('操作できない入力では操作を無効にし、編集能力が無ければ編集を出さない', () => {
  const busy = visibleModel({ busy: true })
  assert.deepEqual(busy.actions, [
    { kind: 'pause', enabled: false },
    { kind: 'edit', enabled: false },
  ])
  assert.equal(modelOf({ busy: true }).canMutate, false)

  assert.equal(modelOf({ needsRefresh: true }).canMutate, false)
  assert.equal(modelOf({ activationReady: false }).canMutate, false)
  assert.equal(modelOf({ activation: undefined }).canMutate, false)
  assert.equal(modelOf({ connected: false }).canMutate, false)
  assert.equal(modelOf({ goalsSupported: false }).canMutate, false)

  const noEdit = modelOf({ editSupported: false })
  assert.equal(noEdit.canEdit, false)
  assert.deepEqual(visibleModel({ editSupported: false }).actions, [{ kind: 'pause', enabled: true }])
})

test('子の会話は操作を出さず、編集もできない', () => {
  const model = modelOf({ readOnly: true })
  assert.equal(model.canMutate, false)
  assert.equal(model.canEdit, false)
  assert.deepEqual(visibleModel({ readOnly: true }).actions, [])
})

test('読込エラーでは読み直しだけを出し、エラー文を載せる', () => {
  const model = visibleModel({ error: '変更できませんでした。' })
  assert.deepEqual(model.actions, [{ kind: 'reload', enabled: true }])
  assert.deepEqual(model.message, { tone: 'error', text: '変更できませんでした。' })

  const busy = visibleModel({ error: '変更できませんでした。', busy: true })
  assert.deepEqual(busy.actions, [{ kind: 'reload', enabled: false }])
})

test('実行状態の確認失敗では再試行だけを出し、失敗の文を載せる', () => {
  const model = visibleModel({ activationError: true })
  assert.deepEqual(model.actions, [{ kind: 'retry-activation', enabled: true }])
  assert.deepEqual(model.message, { tone: 'error', text: 'ゴールの実行状態を確認できませんでした。' })

  const offline = visibleModel({ activationError: true, connected: false })
  assert.deepEqual(offline.actions, [{ kind: 'retry-activation', enabled: false }])
})

test('行き詰まりの理由は情報メッセージとして出し、操作は残す', () => {
  const model = visibleModel({
    activation: 'disarmed',
    current: display({
      phase: 'blocked', activation: 'disarmed',
      blockedReason: { code: 'verification-failed', message: 'テストに失敗しました' },
    }),
  })
  assert.deepEqual(model.actions, [
    { kind: 'resume', enabled: true },
    { kind: 'edit', enabled: true },
  ])
  assert.deepEqual(model.message, { tone: 'info', text: 'テストに失敗しました' })
  assert.equal(modelOf({
    activation: 'disarmed',
    current: display({
      phase: 'blocked', activation: 'disarmed',
      blockedReason: { code: 'verification-failed', message: 'テストに失敗しました' },
    }),
  }).statusLine, '行き詰まり ・ 3 / 8 ラウンド')
})

test('ラウンド上限では再開を無効にし、上限の情報メッセージを載せる', () => {
  const overrides = {
    activation: 'disarmed' as const,
    current: display({ phase: 'paused', activation: 'disarmed', roundsStarted: 8 }),
  }
  const model = modelOf(overrides)
  assert.equal(model.primary, 'resume')
  assert.equal(model.exhausted, true)
  assert.equal(model.canMutate, true)
  assert.deepEqual(visibleModel(overrides).actions, [
    { kind: 'resume', enabled: false },
    { kind: 'edit', enabled: true },
  ])
  assert.deepEqual(visibleModel(overrides).message, { tone: 'info', text: 'ラウンド数の上限に達したため、再開できません。' })
})

test('状態の行は位相と実行状態から組み立てる', () => {
  assert.equal(modelOf({ activation: undefined }).statusLine, '状態未確認 ・ 3 / 8 ラウンド')
  assert.equal(modelOf({ activation: 'armed' }).statusLine, '進行中 ・ 3 / 8 ラウンド')
  assert.equal(modelOf({ activation: 'disarmed' }).statusLine, '停止中 ・ 3 / 8 ラウンド')
  assert.equal(modelOf({
    activation: 'disarmed', current: display({ phase: 'paused', activation: 'disarmed', roundsStarted: 0 }),
  }).statusLine, '一時停止 ・ 0 / 8 ラウンド')
  assert.equal(modelOf({ current: display({ phase: 'complete' }) }).statusLine, '完了 ・ 3 / 8 ラウンド')
})

test('高さ 400px 未満ではストリップを描かない', () => {
  assert.equal(GOAL_STRIP_MIN_VIEWPORT_HEIGHT, 400)
  assert.equal(goalStripFits(399), false)
  assert.equal(goalStripFits(400), true)
  assert.equal(goalStripFits(800), true)
})
