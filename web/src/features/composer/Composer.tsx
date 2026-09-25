export type ComposerTarget = { kind: 'session'; sessionId: string } | { kind: 'new'; workspaceId: string }
export function Composer({ target }: { target: ComposerTarget }) {
  return <div className="composer-placeholder" data-testid="composer" data-target={target.kind}>
    <textarea aria-label="メッセージ入力欄" placeholder="入力欄の準備中です" readOnly rows={2} />
  </div>
}
