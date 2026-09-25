import { useEffect, useState } from 'react'
import { M3eButton } from '@m3e/react/button'
import { M3eAssistChip } from '@m3e/react/chips'
import { M3eIconButton } from '@m3e/react/icon-button'
import { M3eActionList, M3eListAction } from '@m3e/react/list'
import { Icon } from '../../app/icons/Icon.tsx'
import { navigate, useRoute } from '../../app/router.ts'
import { PageScaffold } from '../../app/shell/index.ts'
import { useDsh } from '../../dsh/services.ts'
import { useSnapshot } from '../../dsh/use-snapshot.ts'
import { remoteErrorMessage, unwrapRemoteResult } from '../../dsh/remote-result.ts'
import { childFilePath, directoryChanged, directoryRequestPath, fileBreadcrumbs, fileKind, fileRoute, fileSize, sortFileEntries, workspaceFilesOf, type WorkspaceDirectoryListing } from './files.ts'
import './files.css'

export function FilesScreen({ sessionId }: { sessionId: string }) {
  const path = useRoute().query.get('path') ?? ''
  return <DirectoryScreen key={`${sessionId}:${path}`} sessionId={sessionId} path={path} />
}

function DirectoryScreen({ sessionId, path }: { sessionId: string; path: string }) {
  const { remote, sessions, connection } = useDsh()
  const api = workspaceFilesOf(remote)
  const cwd = useSnapshot(sessions.list).byId[sessionId]?.cwd
  const connectionState = useSnapshot(connection.state)
  const [listing, setListing] = useState<WorkspaceDirectoryListing>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [watchError, setWatchError] = useState('')
  const [revision, setRevision] = useState(0)
  const refresh = () => setRevision(value => value + 1)

  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    if (!api) { setError('ファイルの一覧を利用できません。'); setLoading(false); return }
    void api.list(sessionId, directoryRequestPath(path), controller.signal).then(unwrapRemoteResult).then(value => {
      if (!controller.signal.aborted) setListing(value)
    }).catch(failure => {
      if (!controller.signal.aborted) setError(remoteErrorMessage(failure, 'フォルダを読み込めませんでした。'))
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [api, sessionId, path, revision, connectionState])

  useEffect(() => {
    if (!api) return
    const controller = new AbortController()
    setWatchError('')
    void (async () => {
      try {
        for await (const frame of api.changes(sessionId, controller.signal)) {
          if (controller.signal.aborted) break
          if (frame.kind === 'ready' || directoryChanged(frame.change, cwd, path)) refresh()
        }
        if (!controller.signal.aborted) setWatchError('更新の通知が途切れました。読み直して確認できます。')
      } catch {
        if (!controller.signal.aborted) setWatchError('更新を確認できません。読み直して確認できます。')
      }
    })()
    return () => controller.abort()
  }, [api, sessionId, path, cwd, connectionState])

  const currentPath = listing?.path ?? path
  const crumbs = fileBreadcrumbs(currentPath)
  return <PageScaffold title="ファイル" actions={<M3eIconButton aria-label="一覧を読み直す" disabled={loading} onClick={refresh}><Icon name="refresh" /></M3eIconButton>}>
    <div className="session-files">
      <nav className="session-file-breadcrumbs" aria-label="現在のフォルダ">
        {crumbs.map((crumb, index) => <M3eAssistChip key={crumb.path} aria-current={index === crumbs.length - 1 ? 'location' : undefined}
          onClick={() => navigate(fileRoute(sessionId, 'files', crumb.path), { replace: true })}>
          {index === 0 && <Icon name="folder_open" slot="icon" />}{crumb.name}
        </M3eAssistChip>)}
      </nav>
      <p className="session-file-hint">読み取り専用</p>
      {watchError && <p role="status" className="session-file-notice">{watchError}</p>}
      {error && <div role="alert" className="session-file-notice"><p>{error}</p><M3eButton variant="outlined" onClick={refresh}>もう一度読み込む</M3eButton></div>}
      {loading && <p role="status" className="session-file-hint">読み込み中です…</p>}
      {listing && <M3eActionList className="session-file-list" aria-label="フォルダの中身" aria-busy={loading}>
        {sortFileEntries(listing.entries).map(entry => <M3eListAction key={`${entry.type}:${entry.name}`} onClick={() => {
          const child = childFilePath(currentPath, entry.name)
          navigate(fileRoute(sessionId, entry.type === 'directory' ? 'files' : 'file', child), { replace: entry.type === 'directory' })
        }}>
          <Icon name={entry.type === 'directory' ? 'folder' : fileKind(entry.name) === 'image' ? 'image' : 'description'} slot="leading" />
          <span className="session-file-name">{entry.name}</span>
          <span slot="supporting-text">{entry.type === 'directory' ? 'フォルダ' : fileSize(entry.size)}</span>
          <Icon name="chevron_right" slot="trailing" />
        </M3eListAction>)}
      </M3eActionList>}
      {listing && listing.entries.length === 0 && !loading && <p className="placeholder">このフォルダは空です。</p>}
      {listing?.truncated && <p className="session-file-notice">項目が多いため、一部だけ表示しています。</p>}
    </div>
  </PageScaffold>
}
