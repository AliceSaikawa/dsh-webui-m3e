import { M3eButton } from '@m3e/react/button'
import { openSheet, openFullSheet, showSnackbar, type CloseOverlay } from '../../app/overlay/index.ts'
import { defer, isPlanReview, type PendingInteraction, type ApprovalOutcome } from '../../dsh/interactions.ts'

/** Stage 05 replaces the body. The returned function closes this presentation. */
export function presentInteraction(pending: PendingInteraction, { from }: { from: 'conversation' | 'inbox' }): CloseOverlay {
  const open = isPlanReview(pending) ? openFullSheet : openSheet
  return open(close => {
    const later = () => { defer(pending.key); close() }
    async function answer(outcome: ApprovalOutcome) {
      if (pending.kind !== 'approval') return
      try { await pending.answer(outcome); close() }
      catch { showSnackbar('回答を送れませんでした') }
    }
    return <div data-from={from}>
      <h2>{pending.kind === 'approval' ? 'ツールの承認' : isPlanReview(pending) ? 'プランの確認' : 'AI からの質問'}</h2>
      {pending.kind === 'approval' ? <><p>{pending.toolName}</p>{pending.reason && <p>{pending.reason}</p>}
        <div className="actions"><M3eButton onClick={() => { void answer('rejected') }}>拒否</M3eButton><M3eButton variant="filled" onClick={() => { void answer('allowed-once') }}>許可（1 回）</M3eButton></div></>
        : pending.items.map(item => <p key={item.id}>{item.question}</p>)}
      <M3eButton onClick={later}>あとで</M3eButton>
    </div>
  }, { dismissible: false, label: pending.kind === 'approval' ? 'ツールの承認' : 'AI からの質問', interactionKey: pending.key, sessionId: pending.sessionId })
}
