import type { AskUserQuestionAnswer, AskUserQuestionAnswerItem, AskUserQuestionItem } from '../../dsh/interactions-store.ts'

export interface QuestionDraft { selected: string[]; custom: string }

export function questionDraft(drafts: Readonly<Record<string, QuestionDraft>>, id: string): QuestionDraft {
  return Object.hasOwn(drafts, id) ? drafts[id]! : { selected: [], custom: '' }
}

export function hasPlanReview(items: readonly AskUserQuestionItem[]): boolean {
  return items.some(item => item.intent?.kind === 'plan-review')
}

export function buildQuestionAnswer(item: AskUserQuestionItem, draft: QuestionDraft): AskUserQuestionAnswerItem {
  const custom = draft.custom.trim()
  const available = new Set(item.options?.map(option => option.label) ?? [])
  // Plan approval is carried by intent even when no options were supplied.
  if (item.intent?.kind === 'plan-review') available.add(item.intent.approve)
  let selected = [...new Set(draft.selected)].filter(label => available.has(label))
  if (!item.multiSelect) selected = custom ? [] : selected.slice(0, 1)
  return { id: item.id, selected, ...(custom ? { custom } : {}) }
}

export function hasAnswer(item: AskUserQuestionItem, draft: QuestionDraft): boolean {
  const answer = buildQuestionAnswer(item, draft)
  return answer.selected.length > 0 || !!answer.custom
}

export function buildQuestionAnswers(items: readonly AskUserQuestionItem[], drafts: Readonly<Record<string, QuestionDraft>>): AskUserQuestionAnswer {
  return { answers: items.map(item => buildQuestionAnswer(item, questionDraft(drafts, item.id))) }
}

export function buildPlanApproval(item: AskUserQuestionItem): AskUserQuestionAnswerItem {
  if (item.intent?.kind !== 'plan-review' || !item.intent.approve.trim()) throw new Error('プランの承認の選択肢がありません。')
  return { id: item.id, selected: [item.intent.approve] }
}

export function selectOption(item: AskUserQuestionItem, draft: QuestionDraft, label: string, checked: boolean): QuestionDraft {
  if (!item.options?.some(option => option.label === label)) return draft
  return { ...draft, selected: item.multiSelect
    ? checked ? [...new Set([...draft.selected, label])] : draft.selected.filter(value => value !== label)
    : checked ? [label] : [] }
}
