import { useEffect, useMemo, useRef, useState } from 'react'
import { M3eButton } from '@m3e/react/button'
import { M3eIconButton } from '@m3e/react/icon-button'
import { Icon } from '../../app/icons/Icon.tsx'
import { Markdown } from '../../app/Markdown.tsx'
import { useRoute } from '../../app/router.ts'
import { PageScaffold } from '../../app/shell/index.ts'
import { useDsh } from '../../dsh/services.ts'
import { useSnapshot } from '../../dsh/use-snapshot.ts'
import { remoteErrorMessage, unwrapRemoteResult } from '../../dsh/remote-result.ts'
import { appendFilePage, fileChanged, fileExtension, fileKind, fileName, fileReadErrorMessage, fileSize, FileVersionChanged, imageMediaTypes, nextFilePageRequest, readImageFile, readTextFilePage, workspaceFilesOf, type FilePageRequest, type FileTextContent, type WorkspaceFileStat } from './files.ts'
import './files.css'

export function FileScreen({ sessionId }: { sessionId: string }) {
  const path = useRoute().query.get('path') ?? ''
  return <FileContent key={`${sessionId}:${path}`} sessionId={sessionId} path={path} />
}

function FileContent({ sessionId, path }: { sessionId: string; path: string }) {
  const { remote, connection } = useDsh()
  // Cordis returns a new traced namespace on access; keep effect dependencies stable.
  const api = useMemo(() => workspaceFilesOf(remote), [remote])
  const connectionState = useSnapshot(connection.state)
  const kind = fileKind(path)
  const [view, setView] = useState<'rendered' | 'source'>('rendered')
  const [text, setText] = useState<FileTextContent>()
  const [imageUrl, setImageUrl] = useState('')
  const [metadata, setMetadata] = useState<WorkspaceFileStat>()
  const metadataRef = useRef<WorkspaceFileStat | undefined>(undefined)
  const [binary, setBinary] = useState(kind === 'binary')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [watchError, setWatchError] = useState('')
  const [changed, setChanged] = useState(false)
  const [revision, setRevision] = useState(0)
  const [request, setRequest] = useState<FilePageRequest>({ offset: 1, requestId: 0 })
  const textRef = useRef<FileTextContent | undefined>(undefined)
  const loadGuard = useRef(false)
  const markMetadata = (value: WorkspaceFileStat) => { metadataRef.current = value; setMetadata(value) }
  const reload = () => { loadGuard.current = true; setRequest(value => nextFilePageRequest(value, 1)); setRevision(value => value + 1) }

  useEffect(() => {
    const controller = new AbortController()
    let objectUrl = ''
    setLoading(true)
    loadGuard.current = true
    setError('')
    if (request.offset === 1) {
      textRef.current = undefined
      metadataRef.current = undefined
      setText(undefined); setMetadata(undefined); setImageUrl(''); setChanged(false); setBinary(kind === 'binary')
    }
    void (async () => {
      try {
        if (!api || !path) throw new Error('ファイルを利用できません。')
        if (kind === 'binary') {
          const stat = unwrapRemoteResult(await api.stat(sessionId, path, controller.signal))
          if (!controller.signal.aborted) markMetadata(stat)
        } else if (kind === 'image') {
          const image = await readImageFile(api, sessionId, path, controller.signal)
          if (controller.signal.aborted) return
          objectUrl = URL.createObjectURL(new Blob([image.data], { type: imageMediaTypes[fileExtension(path)] }))
          markMetadata(image); setImageUrl(objectUrl)
        } else {
          const result = await readTextFilePage(api, sessionId, path, request.offset, controller.signal)
          if (controller.signal.aborted) return
          if (result.kind === 'binary') {
            setBinary(true); markMetadata(result.metadata)
            return
          }
          const content = appendFilePage(textRef.current, result.page)
          textRef.current = content
          markMetadata(content); setText(content)
        }
      } catch (failure) {
        if (controller.signal.aborted) return
        if (failure instanceof FileVersionChanged) { setChanged(true); setError('読み込み中にファイルが変わりました。読み直してください。') }
        else setError(fileReadErrorMessage(failure))
      } finally {
        if (!controller.signal.aborted) { setLoading(false); loadGuard.current = false }
      }
    })()
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [api, sessionId, path, kind, request])

  useEffect(() => {
    if (!api || !path) return
    const controller = new AbortController()
    setWatchError('')
    void (async () => {
      try {
        for await (const frame of api.changes(sessionId, path, controller.signal)) {
          if (controller.signal.aborted) break
          const file = metadataRef.current
          if (!file) continue
          if (frame.kind === 'change' && !fileChanged(frame.change, file)) continue
          // Notifications can arrive late; stat confirms the current revision.
          // Ready frames also close the gap while opening or reconnecting the watch.
          const result = await api.stat(sessionId, path, controller.signal)
          if (controller.signal.aborted) break
          const current = metadataRef.current
          if (current && (!result.ok || result.value.version !== current.version
            || result.value.absolutePath !== current.absolutePath)) setChanged(true)
        }
        if (!controller.signal.aborted) setWatchError('更新の通知が途切れました。読み直して確認できます。')
      } catch (failure) {
        if (!controller.signal.aborted) setWatchError(remoteErrorMessage(failure, '更新を確認できません。読み直して確認できます。'))
      }
    })()
    return () => controller.abort()
  }, [api, sessionId, path, connectionState, revision, metadata?.absolutePath, metadata?.version])

  return <PageScaffold title={fileName(path)} actions={<M3eIconButton aria-label="ファイルを読み直す" disabled={loading} onClick={reload}><Icon name="refresh" /></M3eIconButton>}>
    <article className="session-file-content">
      {changed && <div className="session-file-notice" role="status"><p>ファイルが更新されました</p><M3eButton variant="tonal" disabled={loading} onClick={reload}>読み直す</M3eButton></div>}
      {watchError && <p className="session-file-notice" role="status">{watchError}</p>}
      {kind === 'markdown' && !binary && <div className="session-file-switch" role="group" aria-label="表示方法">
        <M3eButton variant={view === 'rendered' ? 'tonal' : 'outlined'} aria-pressed={view === 'rendered'} onClick={() => setView('rendered')}>表示</M3eButton>
        <M3eButton variant={view === 'source' ? 'tonal' : 'outlined'} aria-pressed={view === 'source'} onClick={() => setView('source')}>元の文字</M3eButton>
      </div>}
      {metadata && <p className="session-file-hint">{fileSize(metadata.bytes)} ・ 読み取り専用</p>}
      {error && <div className="session-file-notice" role="alert"><p>{error}</p><M3eButton variant="outlined" disabled={loading} onClick={reload}>最初から読み直す</M3eButton></div>}
      {loading && <p className="session-file-hint" role="status">読み込み中です…</p>}
      {binary && metadata && <div className="placeholder"><Icon name="draft" /><p>{fileName(path)}</p><p>このファイルは表示できません</p></div>}
      {imageUrl && <img className="session-file-image" src={imageUrl} alt={fileName(path)} onError={() => setError('画像を表示できませんでした。')} />}
      {!binary && text && (kind === 'markdown' && view === 'rendered' ? <Markdown>{text.text}</Markdown> : <pre className="session-file-text"><code>{text.text}</code></pre>)}
      {!binary && text && !text.eof && <div className="session-file-more"><M3eButton variant="tonal" disabled={loading || changed} onClick={() => {
        if (loadGuard.current) return
        loadGuard.current = true
        setRequest(value => nextFilePageRequest(value, text.nextOffset))
      }}>続きを読み込む</M3eButton></div>}
      {!binary && text?.eof && text.text.length === 0 && <p className="placeholder">このファイルは空です。</p>}
    </article>
  </PageScaffold>
}
