import { useEffect, useMemo, useState } from 'react'
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
import { useLocale, useMessages } from '../../i18n/index.ts'
import { sessionToolsMessages } from './messages.ts'
import './files.css'

export function FilesScreen({ sessionId }: { sessionId: string }) {
  const path = useRoute().query.get('path') ?? ''
  return <DirectoryScreen key={`${sessionId}:${path}`} sessionId={sessionId} path={path} />
}

function DirectoryScreen({ sessionId, path }: { sessionId: string; path: string }) {
  const text = useMessages(sessionToolsMessages)
  const locale = useLocale()
  const { remote, sessions, connection } = useDsh()
  // A fresh traced namespace must not restart reads and watches on each render.
  const api = useMemo(() => workspaceFilesOf(remote), [remote])
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
    if (!api) { setError(text.listUnavailable); setLoading(false); return }
    void api.list(sessionId, directoryRequestPath(path), controller.signal).then(unwrapRemoteResult).then(value => {
      if (!controller.signal.aborted) setListing(value)
    }).catch(failure => {
      if (!controller.signal.aborted) setError(remoteErrorMessage(failure, text.listFailed))
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [api, sessionId, path, revision, connectionState])

  useEffect(() => {
    if (!api) return
    const controller = new AbortController()
    setWatchError('')
    void (async () => {
      try {
        for await (const frame of api.changes(sessionId, directoryRequestPath(path), controller.signal)) {
          if (controller.signal.aborted) break
          if (frame.kind === 'ready' || directoryChanged(frame.change, cwd, path)) refresh()
        }
        if (!controller.signal.aborted) setWatchError(text.watchInterrupted)
      } catch (failure) {
        if (!controller.signal.aborted) setWatchError(remoteErrorMessage(failure, text.watchUnavailable))
      }
    })()
    return () => controller.abort()
  }, [api, sessionId, path, cwd, connectionState])

  const currentPath = listing?.path ?? path
  const crumbs = fileBreadcrumbs(currentPath, text)
  return <PageScaffold title={text.files} actions={<M3eIconButton aria-label={text.reloadList} disabled={loading} onClick={refresh}><Icon name="refresh" /></M3eIconButton>}>
    <div className="session-files">
      <nav className="session-file-breadcrumbs" aria-label={text.currentFolder}>
        {crumbs.map((crumb, index) => <M3eAssistChip key={crumb.path} aria-current={index === crumbs.length - 1 ? 'location' : undefined}
          onClick={() => navigate(fileRoute(sessionId, 'files', crumb.path), { replace: true })}>
          {index === 0 && <Icon name="folder_open" slot="icon" />}{crumb.name}
        </M3eAssistChip>)}
      </nav>
      <p className="session-file-hint">{text.readOnly}</p>
      {watchError && <p role="status" className="session-file-notice">{watchError}</p>}
      {error && <div role="alert" className="session-file-notice"><p>{error}</p><M3eButton variant="outlined" onClick={refresh}>{text.reloadOnce}</M3eButton></div>}
      {loading && <p role="status" className="session-file-hint">{text.loading}</p>}
      {listing && <M3eActionList className="session-file-list" aria-label={text.folderContents} aria-busy={loading}>
        {sortFileEntries(listing.entries, locale).map(entry => <M3eListAction key={`${entry.type}:${entry.name}`} onClick={() => {
          const child = childFilePath(currentPath, entry.name)
          navigate(fileRoute(sessionId, entry.type === 'directory' ? 'files' : 'file', child), { replace: entry.type === 'directory' })
        }}>
          <Icon name={entry.type === 'directory' ? 'folder' : fileKind(entry.name) === 'image' ? 'image' : 'description'} slot="leading" />
          <span className="session-file-name">{entry.name}</span>
          <span slot="supporting-text">{entry.type === 'directory' ? text.directoryKind : fileSize(entry.size, locale, text)}</span>
          <Icon name="chevron_right" slot="trailing" />
        </M3eListAction>)}
      </M3eActionList>}
      {listing && listing.entries.length === 0 && !loading && <p className="placeholder">{text.folderEmpty}</p>}
      {listing?.truncated && <p className="session-file-notice">{text.truncated}</p>}
    </div>
  </PageScaffold>
}
