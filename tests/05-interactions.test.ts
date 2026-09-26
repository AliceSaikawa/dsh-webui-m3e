import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildPlanApproval, buildQuestionAnswer, buildQuestionAnswers, hasAnswer, hasPlanReview, selectOption } from '../web/src/features/interactions/answers.ts'
import { PresentationQueue } from '../web/src/features/interactions/presentation-queue.ts'
import { questionPresentation } from '../web/src/features/interactions/presentation.ts'
import { InteractionStore, type AskUserQuestionItem } from '../web/src/dsh/interactions-store.ts'

const question: AskUserQuestionItem = { id: 'database', question: 'どちらにしますか', options: [{ label: '選択肢 A' }, { label: '選択肢 B' }] }
const plan: AskUserQuestionItem = { id: 'plan', question: '進めますか', detail: '# 計画', intent: { kind: 'plan-review', approve: 'このプランで進める' } }

test('単独のプランでは進捗と質問の見出し・題名を出さず、本文は変更しない', () => {
  const item = Object.freeze({ ...plan, header: 'プラン', question: '計画' })
  assert.deepEqual(questionPresentation([item], 0), { standalonePlan: true, progress: undefined, header: undefined, title: undefined })
  assert.equal(item.detail, '# 計画')
})

test('通常の質問は進捗から始まり、1 問だけでも問いと見出しを残す', () => {
  const item = { ...question, header: 'データベース' }
  assert.deepEqual(questionPresentation([item], 0), { standalonePlan: false, progress: '質問 1 / 1', header: 'データベース', title: 'どちらにしますか' })
  assert.equal(questionPresentation([item, { ...item, id: 'next' }], 0).progress, '質問 1 / 2')
  assert.equal(questionPresentation([item, { ...item, id: 'next' }], 1).progress, '質問 2 / 2')
})

test('プランと通常質問が混在するときは進捗と各問いの題名を残す', () => {
  assert.deepEqual(questionPresentation([plan, question], 0), { standalonePlan: false, progress: '質問 1 / 2', header: undefined, title: plan.question })
  assert.deepEqual(questionPresentation([plan, question], 1), { standalonePlan: false, progress: '質問 2 / 2', header: undefined, title: question.question })
})

test('存在しない問いの進捗や題名を作らない', () => {
  const absent = { standalonePlan: false, progress: undefined, header: undefined, title: undefined }
  assert.deepEqual(questionPresentation([], 0), absent)
  assert.deepEqual(questionPresentation([question], 1), absent)
})

test('単一選択は 1 件だけを answers に入れ、入力を変えない', () => {
  const draft = { selected: ['選択肢 B', '選択肢 A'], custom: '' }
  assert.deepEqual(buildQuestionAnswers([question], { database: draft }), { answers: [{ id: 'database', selected: ['選択肢 B'] }] })
  assert.deepEqual(draft, { selected: ['選択肢 B', '選択肢 A'], custom: '' })
})

test('単一選択では自由入力を優先し、前後の空白だけを除く', () => {
  assert.deepEqual(buildQuestionAnswer(question, { selected: ['選択肢 A'], custom: '  別の案\nでお願いします  ' }), { id: 'database', selected: [], custom: '別の案\nでお願いします' })
  assert.deepEqual(buildQuestionAnswer(question, { selected: ['選択肢 B'], custom: ' \n ' }), { id: 'database', selected: ['選択肢 B'] })
})

test('複数選択は自由入力と併用し、存在しない選択肢と重複を除く', () => {
  assert.deepEqual(buildQuestionAnswer({ ...question, multiSelect: true }, { selected: ['選択肢 B', '不存在', '選択肢 A', '選択肢 B'], custom: ' 補足 ' }), { id: 'database', selected: ['選択肢 B', '選択肢 A'], custom: '補足' })
})

test('選択肢がない問いは自由入力だけを返し、空白だけの回答は未回答になる', () => {
  const text = { id: 'text', question: '希望を書いてください' }
  assert.deepEqual(buildQuestionAnswer(text, { selected: ['届いていない選択肢'], custom: ' 希望 ' }), { id: 'text', selected: [], custom: '希望' })
  assert.equal(hasAnswer(text, { selected: ['届いていない選択肢'], custom: ' \n ' }), false)
  assert.equal(hasAnswer(text, { selected: [], custom: '希望' }), true)
  assert.equal(hasAnswer(question, { selected: ['選択肢 A'], custom: '' }), true)
  assert.equal(hasAnswer(question, { selected: [], custom: '' }), false)
})

test('組み込みプロパティと同名の問いでも、未入力と入力済みの回答を区別する', () => {
  const item = { id: 'constructor', question: '希望を書いてください' }
  assert.deepEqual(buildQuestionAnswers([item], {}), { answers: [{ id: 'constructor', selected: [] }] })
  assert.deepEqual(buildQuestionAnswers([item], { [item.id]: { selected: [], custom: '回答' } }), { answers: [{ id: 'constructor', selected: [], custom: '回答' }] })
})

test('選択の変更ではラジオを置き換え、チェックボックスは追加と解除をする', () => {
  const draft = { selected: ['選択肢 A'], custom: '入力中' }
  assert.deepEqual(selectOption(question, draft, '選択肢 B', true), { selected: ['選択肢 B'], custom: '入力中' })
  const multi = { ...question, multiSelect: true }
  assert.deepEqual(selectOption(multi, draft, '選択肢 B', true), { selected: ['選択肢 A', '選択肢 B'], custom: '入力中' })
  assert.deepEqual(selectOption(multi, draft, '選択肢 A', false), { selected: [], custom: '入力中' })
  assert.equal(selectOption(question, draft, '不存在', true), draft)
})

test('問いのどこかに plan-review があれば専用表示の対象になる', () => {
  assert.equal(hasPlanReview([]), false)
  assert.equal(hasPlanReview([question]), false)
  assert.equal(hasPlanReview([question, plan]), true)
  assert.equal(hasPlanReview([plan, question]), true)
})

test('プラン承認は options がなくても intent.approve をそのまま返す', () => {
  const answer = buildPlanApproval(plan)
  assert.deepEqual(answer, { id: 'plan', selected: ['このプランで進める'] })
  assert.deepEqual(buildQuestionAnswer(plan, { selected: answer.selected, custom: '' }), answer)
  assert.deepEqual(buildPlanApproval({ ...plan, intent: { kind: 'plan-review', approve: ' この内容で実装する ' } }), { id: 'plan', selected: [' この内容で実装する '] })
  assert.throws(() => buildPlanApproval(question), /選択肢がありません/)
})

test('プランと普通の問いが混在しても、すべてを元の順序で回答し修正希望は custom に入れる', () => {
  const drafts = { database: { selected: ['選択肢 A'], custom: '' }, plan: { selected: [], custom: '手順を直してほしい' } }
  assert.deepEqual(buildQuestionAnswers([plan, question], drafts), { answers: [
    { id: 'plan', selected: [], custom: '手順を直してほしい' }, { id: 'database', selected: ['選択肢 A'] },
  ] })
  assert.deepEqual(buildQuestionAnswers([question], {}), { answers: [{ id: 'database', selected: [] }] })
})

test('同じ要求を二重表示せず、次の要求は先のシートが閉じた後に開く', () => {
  const queue = new PresentationQueue()
  const events: string[] = []
  const open = (key: string) => () => { events.push(`open:${key}`); return () => { events.push(`close:${key}`) } }
  const first = queue.present('a', open('a'))
  assert.equal(queue.present('a', open('duplicate')), first)
  const second = queue.present('b', open('b'))
  assert.deepEqual(events, ['open:a'])
  first()
  first()
  assert.deepEqual(events, ['open:a', 'close:a', 'open:b'])
  second()
  assert.deepEqual(events, ['open:a', 'close:a', 'open:b', 'close:b'])
})

test('待機中に取り消されたシートを飛ばして次へ進み、開き直しを妨げない', () => {
  const queue = new PresentationQueue()
  const shown: string[] = []
  const open = (key: string) => () => { shown.push(key); return () => {} }
  const first = queue.present('a', open('a'))
  const cancelled = queue.present('b', open('b'))
  const third = queue.present('c', open('c'))
  queue.pruneQueued(new Set(['a', 'c']))
  cancelled()
  first()
  assert.deepEqual(shown, ['a', 'c'])
  third()
  queue.present('a', open('a'))()
  assert.deepEqual(shown, ['a', 'c', 'a'])
})

test('同一セッションに承認と質問が届いても到着順に個別回答できる', async () => {
  const store = new InteractionStore()
  const approvalResult = store.requestApproval('same', { toolName: 'bash' })
  const questionResult = store.requestQuestion('same', { questions: [question] })
  const [approval, pendingQuestion] = store.getSnapshot()
  if (approval?.kind !== 'approval' || pendingQuestion?.kind !== 'question') assert.fail('要求がありません')
  assert.equal(store.getSnapshot().find(item => !item.deferred), approval)
  await approval.answer('allowed-once')
  assert.equal(await approvalResult, 'allowed-once')
  assert.equal(store.getSnapshot().find(item => !item.deferred), pendingQuestion)
  const answer = buildQuestionAnswers(pendingQuestion.items, { database: { selected: ['選択肢 A'], custom: '' } })
  await pendingQuestion.answer(answer)
  assert.deepEqual(await questionResult, answer)
  assert.deepEqual(store.getSnapshot(), [])
})
