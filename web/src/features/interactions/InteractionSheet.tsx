import { useId, useLayoutEffect, useRef, useState } from 'react'
import { M3eButton } from '@m3e/react/button'
import { M3eIconButton } from '@m3e/react/icon-button'
import { M3eRadio, M3eRadioGroup } from '@m3e/react/radio-group'
import { M3eCheckbox } from '@m3e/react/checkbox'
import { Icon } from '../../app/icons/Icon.tsx'
import { Markdown } from '../../app/Markdown.tsx'
import { openSheet, openFullSheet, showSnackbar, type CloseOverlay } from '../../app/overlay/index.ts'
import { navigate } from '../../app/router.ts'
import { defer, usePendingInteractions, type PendingInteraction, type PendingQuestion, type AskUserQuestionItem } from '../../dsh/interactions.ts'
import { buildPlanApproval, buildQuestionAnswers, hasAnswer, hasPlanReview, questionDraft, selectOption, type QuestionDraft } from './answers.ts'
import { PresentationQueue } from './presentation-queue.ts'
import './interactions.css'

type Origin = 'conversation' | 'inbox'
interface DraftState { index: number; drafts: Record<string, QuestionDraft>; editingPlan: boolean }
const drafts = new Map<string, DraftState>()
const presentations = new PresentationQueue()
const traceHandoffs = new Set<string>()

/** Keep partially written replies when a sheet is deferred or its route unmounts. */
export function pruneInteractionDrafts(keys: ReadonlySet<string>): void {
  for (const key of drafts.keys()) if (!keys.has(key)) drafts.delete(key)
}

export function presentInteraction(pending: PendingInteraction, { from }: { from: Origin }): CloseOverlay {
  // Entering a conversation clears 00's defer flag. Preserve it for the explicit
  // inbox -> trace handoff, including repeated effects during that same commit.
  if (from === 'conversation' && traceHandoffs.has(pending.key) && !pending.deferred) {
    defer(pending.key)
    queueMicrotask(() => traceHandoffs.delete(pending.key))
    return () => {}
  }
  traceHandoffs.delete(pending.key)
  const plan = pending.kind === 'question' && hasPlanReview(pending.items)
  const label = pending.kind === 'approval' ? 'ツールの承認' : plan ? 'プランの確認' : 'AI からの質問'
  return presentations.present(pending.key, close => (plan ? openFullSheet : openSheet)(
    <InteractionSheet pending={pending} from={from} close={close} plan={plan} />,
    { dismissible: false, label, interactionKey: pending.key, sessionId: pending.sessionId },
  ))
}

function InteractionSheet({ pending, from, close, plan }: { pending: PendingInteraction; from: Origin; close: CloseOverlay; plan: boolean }) {
  const allPending = usePendingInteractions()
  const active = allPending.some(item => item.key === pending.key)
  const sending = useRef(false)
  const cancelled = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useLayoutEffect(() => {
    const keys = new Set(allPending.map(item => item.key))
    pruneInteractionDrafts(keys)
    presentations.pruneQueued(keys)
    if (active || sending.current || cancelled.current) return
    cancelled.current = true
    close()
    showSnackbar(pending.kind === 'approval' ? '承認の要求は取り消されました' : '質問の要求は取り消されました')
  }, [active, allPending, close, pending.kind])

  async function submit(answer: () => Promise<void>) {
    if (sending.current || !active) return
    sending.current = true
    setBusy(true)
    setError('')
    try {
      await answer()
      drafts.delete(pending.key)
      close()
    } catch {
      sending.current = false
      setBusy(false)
      setError('回答を送れませんでした。もう一度お試しください。')
    }
  }
  function later() {
    if (sending.current) return
    defer(pending.key)
    close()
  }
  function trace() {
    if (sending.current) return
    if (from === 'inbox') traceHandoffs.add(pending.key)
    defer(pending.key)
    close()
    navigate(`/s/${encodeURIComponent(pending.sessionId)}/trace`, { replace: from === 'conversation' })
  }

  return <section className={`interaction-sheet${plan ? ' interaction-sheet--plan' : ''}`} data-from={from} aria-busy={busy}>
    {pending.kind === 'approval' ? <>
      <div className="interaction-heading"><Icon name="front_hand" /><h2>ツールの承認</h2></div>
      <p className="interaction-question"><strong>{pending.toolName}</strong> を実行しようとしています</p>
      {pending.reason && <p className="interaction-detail">{pending.reason}</p>}
      {pending.callId && <M3eButton variant="text" disabled={busy || !active} onClick={trace}>トレースで見る</M3eButton>}
      {error && <p className="interaction-error" role="alert">{error}</p>}
      <div className="interaction-actions"><M3eButton variant="outlined" disabled={busy || !active} onClick={() => { void submit(() => pending.answer('rejected')) }}>拒否</M3eButton>
        <M3eButton variant="filled" disabled={busy || !active} onClick={() => { void submit(() => pending.answer('allowed-once')) }}>許可（1 回）</M3eButton></div>
    </> : <QuestionSheet pending={pending} plan={plan} busy={busy || !active} error={error} later={later} submit={submit} />}
  </section>
}

function QuestionSheet({ pending, plan, busy, error, later, submit }: {
  pending: PendingQuestion; plan: boolean; busy: boolean; error: string; later(): void; submit(answer: () => Promise<void>): Promise<void>
}) {
  const [state, setState] = useState<DraftState>(() => drafts.get(pending.key) ?? { index: 0, drafts: {}, editingPlan: false })
  const body = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const item = pending.items[state.index]
  const draft = questionDraft(state.drafts, item?.id ?? '')
  const last = state.index === pending.items.length - 1
  const planItem = item?.intent?.kind === 'plan-review'
  const labelId = useId()

  useLayoutEffect(() => {
    if (body.current) body.current.scrollTop = 0
    heading.current?.focus({ preventScroll: true })
  }, [state.index])
  function update(next: DraftState) { drafts.set(pending.key, next); setState(next) }
  function edit(next: QuestionDraft) {
    if (item) update({ ...state, drafts: { ...state.drafts, [item.id]: next } })
  }
  function advance(nextDraft = draft) {
    if (!item || busy || !hasAnswer(item, nextDraft)) return
    const nextDrafts = { ...state.drafts, [item.id]: nextDraft }
    update({ ...state, drafts: nextDrafts })
    if (!last) {
      update({ index: state.index + 1, drafts: nextDrafts, editingPlan: false })
      return
    }
    const missing = pending.items.findIndex(question => !hasAnswer(question, questionDraft(nextDrafts, question.id)))
    if (missing >= 0) { update({ index: missing, drafts: nextDrafts, editingPlan: false }); return }
    void submit(() => pending.answer(buildQuestionAnswers(pending.items, nextDrafts)))
  }

  return <>
    <header className="interaction-heading">
      {plan ? <M3eIconButton aria-label="あとで" disabled={busy} onClick={later}><Icon name="close" /></M3eIconButton> : <Icon name="help" />}
      <h2>{plan ? 'プランの確認' : 'AI からの質問'}</h2>
    </header>
    {pending.items.length > 0 && <p className="interaction-progress" aria-live="polite">質問 {state.index + 1} / {pending.items.length}</p>}
    <div className="interaction-body" ref={body}>
      {item ? <>
        {item.header && <p className="interaction-item-header">{item.header}</p>}
        <h3 id={labelId} className="interaction-question" ref={heading} tabIndex={-1}>{item.question}</h3>
        {item.detail && (planItem ? <Markdown>{item.detail}</Markdown> : <p className="interaction-detail">{item.detail}</p>)}
        {planItem ? state.editingPlan && <label className="interaction-custom">直してほしいこと
          <textarea rows={5} autoFocus value={draft.custom} disabled={busy} onChange={event => edit({ selected: [], custom: event.target.value })} />
        </label> : <QuestionFields item={item} draft={draft} disabled={busy} labelId={labelId} onChange={edit} />}
      </> : <p role="alert">質問の内容を読み取れませんでした。あとで開き直してください。</p>}
      {error && <p className="interaction-error" role="alert">{error}</p>}
    </div>
    <footer className="interaction-footer">
      {state.index > 0 && <M3eButton disabled={busy} onClick={() => update({ ...state, index: state.index - 1, editingPlan: false })}>前の質問</M3eButton>}
      <div className="interaction-actions">
        {planItem && item ? state.editingPlan ? <>
          <M3eButton variant="outlined" disabled={busy} onClick={() => update({ ...state, editingPlan: false })}>プランに戻る</M3eButton>
          <M3eButton variant="filled" disabled={busy || !draft.custom.trim()} onClick={() => advance({ selected: [], custom: draft.custom })}>{last ? '修正をお願いする' : '次へ'}</M3eButton>
        </> : <>
          <M3eButton variant="outlined" disabled={busy} onClick={() => update({ ...state, editingPlan: true })}>直してほしい</M3eButton>
          <M3eButton variant="filled" disabled={busy || !item.intent?.approve.trim()} onClick={() => advance({ selected: buildPlanApproval(item).selected, custom: '' })}>{item.intent?.approve}</M3eButton>
        </> : <>
          <M3eButton variant="outlined" disabled={busy} onClick={later}>あとで</M3eButton>
          {item && <M3eButton variant="filled" disabled={busy || !hasAnswer(item, draft)} onClick={() => advance()}>{last ? '回答する' : '次へ'}</M3eButton>}
        </>}
      </div>
    </footer>
  </>
}

function QuestionFields({ item, draft, disabled, labelId, onChange }: {
  item: AskUserQuestionItem; draft: QuestionDraft; disabled: boolean; labelId: string; onChange(draft: QuestionDraft): void
}) {
  const options = item.options ?? []
  const fields = options.map(option => {
    const content = <span className="interaction-option-text"><span>{option.label}</span>{option.description && <small>{option.description}</small>}</span>
    return <label className="interaction-option" key={option.label}>{item.multiSelect
      ? <M3eCheckbox checked={draft.selected.includes(option.label)} disabled={disabled}
        onChange={event => onChange(selectOption(item, draft, option.label, (event.currentTarget as HTMLElement & { checked: boolean }).checked))} />
      : <M3eRadio value={option.label} checked={draft.selected.includes(option.label)} disabled={disabled}
        onChange={() => onChange(selectOption(item, draft, option.label, true))} />}{content}</label>
  })
  return <>
    {options.length > 0 && (item.multiSelect
      ? <div className="interaction-options" role="group" aria-labelledby={labelId}>{fields}</div>
      : <M3eRadioGroup className="interaction-options" aria-labelledby={labelId}>{fields}</M3eRadioGroup>)}
    <label className="interaction-custom">その他（自由に書く）
      <textarea rows={3} value={draft.custom} disabled={disabled} onChange={event => onChange({ ...draft, custom: event.target.value })} />
    </label>
    {!item.multiSelect && options.length > 0 && draft.custom.trim() && <p className="interaction-hint">自由入力の内容を回答します。</p>}
  </>
}
