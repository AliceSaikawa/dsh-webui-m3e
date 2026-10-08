import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { M3eButton } from '@m3e/react/button'
import { M3eIconButton } from '@m3e/react/icon-button'
import { Icon } from '../../app/icons/Icon.tsx'
import { PageScaffold } from '../../app/shell/PageScaffold.tsx'
import { useSessionJobs } from '../../dsh/jobs.ts'
import { useDsh, type SessionJob } from '../../dsh/services.ts'
import { remoteErrorMessage, unwrapRemoteResult } from '../../dsh/remote-result.ts'
import { isLiveJob, jobDurationLabel, jobKindLabel, jobStatusLabel, sortJobs } from './operations.ts'

export function JobsScreen({ sessionId }: { sessionId: string }) {
  const roster = useSessionJobs(sessionId)
  const jobs = sortJobs(roster.rows)
  const live = jobs.some(isLiveJob)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!live) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [live, sessionId])

  return <PageScaffold title="ジョブ"><div className="st-content">
    {roster.status === 'loading' && <p className="st-muted" role="status">ジョブを読み込み中です…</p>}
    {roster.status === 'error' && <div className="st-error" role="alert"><p>ジョブを読み込めませんでした。表示中の情報は最新ではない可能性があります。</p><M3eButton onClick={roster.retry}>もう一度読み込む</M3eButton></div>}
    {jobs.length === 0 ? roster.status === 'ready' && <p className="st-muted">ジョブはありません。</p> : <ul className="st-list" aria-label="ジョブの一覧">
      {jobs.map(job => <JobRow key={`${sessionId}:${job.id}`} sessionId={sessionId} job={job} now={now} available={roster.status === 'ready'} />)}
    </ul>}
  </div></PageScaffold>
}

function JobRow({ sessionId, job, now, available }: { sessionId: string; job: SessionJob; now: number; available: boolean }) {
  const { jobs } = useDsh()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const pending = useRef(false)
  const lifetime = useRef(0)
  useLayoutEffect(() => {
    const generation = ++lifetime.current
    pending.current = false; setBusy(false); setError(''); setMessage('')
    return () => { if (lifetime.current === generation) lifetime.current++ }
  }, [job.status])
  async function stop() {
    if (pending.current || message || !available || job.status !== 'running') return
    pending.current = true
    const generation = lifetime.current
    setBusy(true); setError(''); setMessage('')
    try {
      const result = unwrapRemoteResult(await jobs.kill(sessionId, job.id))
      if (generation !== lifetime.current) return
      setMessage(result.outcome === 'requested' ? '停止を要求しました。' : 'このジョブはすでに終了しています。')
    } catch (failure) {
      if (generation === lifetime.current) setError(remoteErrorMessage(failure, 'ジョブを停止できませんでした。もう一度お試しください。'))
    } finally {
      if (generation === lifetime.current) { pending.current = false; setBusy(false) }
    }
  }
  return <li className="st-row">
    <Icon name={job.kind === 'subagent' ? 'account_tree' : 'terminal'} />
    <div className="st-row-main">
      <p className="st-title">{job.label}</p>
      <p className="st-muted">{jobKindLabel(job.kind)} ・ {jobStatusLabel(job.status)} ・ {jobDurationLabel(job, now)}</p>
      {error && <p className="st-job-error" role="alert">{error}</p>}
      {message && <p className="st-muted" role="status">{message}</p>}
    </div>
    {job.status === 'running' && <M3eIconButton aria-label={`${job.label}を停止`} disabled={!available || busy || !!message} onClick={() => { void stop() }}><Icon name="stop" /></M3eIconButton>}
    {job.status === 'failed' && <Icon name="error" className="st-job-error" />}
  </li>
}
