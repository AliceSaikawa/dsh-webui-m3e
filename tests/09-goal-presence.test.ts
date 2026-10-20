import assert from 'node:assert/strict'
import test from 'node:test'
import { goalStripVisible } from '../web/src/features/session-tools/goal-strip-model.ts'
import { goalPrimaryAction, type GoalDisplayState } from '../web/src/features/session-tools/operations.ts'

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

function base(overrides: Partial<Parameters<typeof goalStripVisible>[0]> = {}) {
  const current = overrides.current !== undefined ? overrides.current : display({ activation: 'armed' })
  return {
    current,
    activation: current && typeof current === 'object' ? (current.activation ?? 'armed') : undefined,
    activationReady: true,
    readOnly: false,
    busy: false,
    error: '',
    needsRefresh: false,
    canEdit: true,
    goalsSupported: true,
    connected: true,
    statusLine: '進行中 ・ 3 / 8 ラウンド',
    ...overrides,
  }
}

test('ストリップは読込中・無し・完了を隠し、進行中は目標と操作を出す', () => {
  assert.equal(goalStripVisible(base({ current: undefined })).kind, 'hidden')
  assert.equal(goalStripVisible(base({ current: null })).kind, 'hidden')
  assert.equal(goalStripVisible(base({ current: display({ phase: 'complete' }) })).kind, 'hidden')

  const visible = goalStripVisible(base())
  assert.equal(visible.kind, 'visible')
  if (visible.kind !== 'visible') throw new Error('expected visible')
  assert.equal(visible.model.objective, '承認シートを作る')
  assert.equal(visible.model.statusLine, '進行中 ・ 3 / 8 ラウンド')
  assert.equal(visible.model.primary, 'pause')
  assert.equal(visible.model.canMutate, true)
  assert.equal(visible.model.canEdit, true)
})

test('ストリップは一時停止と行き詰まりでも表示し、停止中は再開を選ぶ', () => {
  const paused = goalStripVisible(base({
    current: display({ phase: 'paused', activation: 'disarmed' }),
    activation: 'disarmed',
    statusLine: '一時停止 ・ 3 / 8 ラウンド',
  }))
  assert.equal(paused.kind, 'visible')
  if (paused.kind === 'visible') assert.equal(paused.model.primary, 'resume')

  const blocked = goalStripVisible(base({
    current: display({
      phase: 'blocked', activation: 'disarmed',
      blockedReason: { code: 'verification-failed', message: 'テストに失敗しました' },
    }),
    activation: 'disarmed',
    statusLine: '行き詰まり ・ 3 / 8 ラウンド',
  }))
  assert.equal(blocked.kind, 'visible')
  if (blocked.kind === 'visible') {
    assert.equal(blocked.model.primary, 'resume')
    assert.equal(blocked.model.blockedMessage, 'テストに失敗しました')
  }

  const disarmed = display({ phase: 'active', activation: 'disarmed' })
  assert.equal(goalPrimaryAction(disarmed.goal, 'disarmed'), 'resume')
  const strip = goalStripVisible(base({ current: disarmed, activation: 'disarmed', statusLine: '停止中 ・ 3 / 8 ラウンド' }))
  assert.equal(strip.kind, 'visible')
  if (strip.kind === 'visible') assert.equal(strip.model.primary, 'resume')
})

test('子の会話と未準備では操作を出さず、編集能力も折る', () => {
  const child = goalStripVisible(base({ readOnly: true }))
  assert.equal(child.kind, 'visible')
  if (child.kind === 'visible') {
    assert.equal(child.model.canMutate, false)
    assert.equal(child.model.canEdit, false)
  }

  const notReady = goalStripVisible(base({ activationReady: false, activation: undefined }))
  assert.equal(notReady.kind, 'visible')
  if (notReady.kind === 'visible') assert.equal(notReady.model.canMutate, false)

  const noEdit = goalStripVisible(base({ canEdit: false }))
  assert.equal(noEdit.kind, 'visible')
  if (noEdit.kind === 'visible') assert.equal(noEdit.model.canEdit, false)
})

test('ラウンド上限では exhausted になり、エラー文はインラインに載る', () => {
  const exhausted = goalStripVisible(base({
    current: display({ phase: 'paused', activation: 'disarmed', roundsStarted: 8 }),
    activation: 'disarmed',
  }))
  assert.equal(exhausted.kind, 'visible')
  if (exhausted.kind === 'visible') {
    assert.equal(exhausted.model.exhausted, true)
    assert.equal(exhausted.model.primary, 'resume')
    assert.equal(exhausted.model.canMutate, true)
  }

  const errored = goalStripVisible(base({ error: '変更できませんでした。' }))
  assert.equal(errored.kind, 'visible')
  if (errored.kind === 'visible') assert.equal(errored.model.inlineError, '変更できませんでした。')
})
