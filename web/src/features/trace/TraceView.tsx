/** active is false while the mounted view is hidden; suspend scroll/focus effects. */
export function TraceView({ sessionId }: { sessionId: string; active: boolean }) {
  return <div className="placeholder" data-session={sessionId}><h2>トレース</h2><p>記録の表示を準備しています</p></div>
}
