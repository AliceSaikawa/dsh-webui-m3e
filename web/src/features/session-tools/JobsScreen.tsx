import { useEffect, useState } from 'react'
import { Icon } from '../../app/icons/Icon.tsx'
import { PageScaffold } from '../../app/shell/PageScaffold.tsx'
import { useDsh } from '../../dsh/services.ts'
import { useSnapshot } from '../../dsh/use-snapshot.ts'
import { isLiveJob, jobDurationLabel, jobKindLabel, jobStatusLabel, sortJobs } from './operations.ts'

export function JobsScreen({ sessionId }: { sessionId: string }) {
  const { sessions } = useDsh()
  const list = useSnapshot(sessions.list)
  const jobs = sortJobs(list.jobsBySession[sessionId] ?? [])
  const live = jobs.some(isLiveJob)
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!live) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [live, sessionId])

  return <PageScaffold title="ジョブ"><div className="st-content">
    {jobs.length === 0 ? <p className="st-muted">ジョブはありません。</p> : <ul className="st-list" aria-label="ジョブの一覧">
      {jobs.map(job => <li key={job.id} className="st-row">
        <Icon name={job.kind === 'subagent' ? 'account_tree' : 'terminal'} />
        <div className="st-row-main">
          <p className="st-title">{job.label}</p>
          <p className="st-muted">{jobKindLabel(job.kind)} ・ {jobStatusLabel(job.status)} ・ {jobDurationLabel(job, now)}</p>
        </div>
        {job.status === 'failed' && <Icon name="error" className="st-job-error" />}
      </li>)}
    </ul>}
  </div></PageScaffold>
}
