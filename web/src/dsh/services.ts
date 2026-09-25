import { createContext, createElement, useContext, useMemo, type ReactNode } from 'react'
import type { ObservableSnapshot } from './use-snapshot.ts'

export type { ObservableSnapshot } from './use-snapshot.ts'

/** Browser-facing contracts restated from the installed DSH client controllers. */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue }
export interface RemoteFailure {
  readonly code: string
  readonly message: string
  readonly details: Readonly<Record<string, unknown>>
  readonly isDSHRemoteError?: true
}
export type RemoteResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: RemoteFailure }
export type ConnectionState = 'connected' | 'disconnected' | 'connecting'
export interface Connection {
  readonly state: ObservableSnapshot<ConnectionState>
  reconnect(): void
}

export interface ImageAttachmentRef {
  attachmentId: string
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  bytes: number
  width: number
  height: number
  name?: string
  originalDimensions?: { width: number; height: number }
}
export interface FileAttachmentRef { attachmentId: string; name: string; bytes: number }
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'image'; attachment: ImageAttachmentRef }
  | { type: 'file'; attachment: FileAttachmentRef }
  | { type: 'tool-call'; id: string; name: string; arguments: string }
  | { type: 'tool-result'; toolCallId: string; content: ContentBlock[]; isError?: boolean }
export type PromptContentPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly mediaType: ImageAttachmentRef['mediaType']; readonly data: string; readonly name?: string }
  | { readonly type: 'file'; readonly receiptId: string }
export type QueueAction =
  | { readonly kind: 'edit'; readonly content: readonly ContentBlock[] }
  | { readonly kind: 'remove' }
  | { readonly kind: 'steer' }

export interface SubagentAddress {
  readonly parentSessionId: string
  readonly childSessionId: string
  readonly mode: 'one-shot' | 'continuable'
}
export interface SessionSummary {
  id: string
  title?: string
  displayTitle: string
  cwd?: string
  parentId?: string
  origin?: 'subagent'
  running: boolean
  completed?: boolean
  blank: boolean
  updatedAt: number
  projectionValues?: Readonly<Record<string, unknown>>
}
export interface SessionJob {
  readonly id: string
  readonly kind: string
  readonly label: string
  readonly status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  readonly detail?: string
  readonly startedAt: number
  readonly finishedAt?: number
}
/** Domain-specific catalog rows are narrowed by the session-tools feature. */
export interface SubagentCatalogSnapshot {
  readonly parentAvailable?: boolean
  readonly state: 'loading' | 'ready' | 'error'
  readonly error: RemoteFailure | null
  readonly [key: string]: unknown
}
export interface SessionListState {
  ids: string[]
  byId: Record<string, SessionSummary>
  current: string | undefined
  phase: 'pending' | 'ready'
  subagentsByParent: Readonly<Record<string, SubagentCatalogSnapshot>>
  jobsBySession: Readonly<Record<string, readonly SessionJob[]>>
  currentAddress: SubagentAddress | undefined
}
export interface WorkspaceView {
  readonly workspaceId: string
  readonly path: string
  readonly title: string
  readonly sessionIds: readonly string[]
  readonly createdAt: string
  readonly updatedAt: string
}
export interface WorkspaceSnapshot {
  readonly items: readonly WorkspaceView[]
  readonly archivedSessionIds: readonly string[]
  readonly state: 'idle' | 'loading' | 'error'
  readonly phase: 'pending' | 'ready'
  readonly error: RemoteFailure | null
}
export interface IWorkspaces {
  readonly list: ObservableSnapshot<WorkspaceSnapshot>
  create(input: { path: string }): Promise<WorkspaceView>
  rename(workspaceId: string, title: string): Promise<WorkspaceView>
  delete(workspaceId: string): Promise<void>
  insertBefore(workspaceId: string, beforeWorkspaceId?: string): Promise<void>
  archiveSession(sessionId: string): Promise<void>
  insertSessionBefore(workspaceId: string, sessionId: string, beforeSessionId?: string): Promise<WorkspaceView>
}
export interface QueuedMessage {
  readonly id: string
  readonly messageId: string
  readonly placement: 'queued' | 'steering' | 'context'
  readonly rpcId?: string
  readonly content: readonly ContentBlock[]
  readonly preview: string
  readonly text: string | null
}
export type PendingSubmissionAttachment =
  | { readonly type: 'image'; readonly value: { readonly previewUrl: string; readonly name?: string; readonly width?: number; readonly height?: number } }
  | { readonly type: 'file'; readonly value: FileAttachmentRef }
export interface PendingSubmission {
  readonly requestId: string
  readonly placement: 'transcript' | 'queued' | 'steering'
  readonly time: number
  readonly text: string
  readonly attachments: readonly PendingSubmissionAttachment[]
}
export type PendingSubmissionRetirement =
  | { readonly reason: 'observed'; readonly attachments: readonly (ImageAttachmentRef | FileAttachmentRef)[] }
  | { readonly reason: 'failed' }
export interface BeginSubmissionInput {
  readonly mode: 'queue' | 'steer'
  readonly text: string
  readonly attachments: readonly PendingSubmissionAttachment[]
  readonly onRetire?: (retirement: PendingSubmissionRetirement) => void
}
export interface SubmissionHandle { readonly requestId: string; abandon(): void }
export interface SessionSnapshot {
  readonly sessionId: string
  readonly queue: readonly QueuedMessage[]
  readonly pendingSubmissions: readonly PendingSubmission[]
  readonly running: boolean
  readonly subagent: { readonly address: SubagentAddress; readonly parentAvailable?: boolean } | null
  readonly removed: boolean
  readonly openState: 'cold' | 'loading' | 'open' | 'error'
  readonly openError: RemoteFailure | null
  readonly hasMore: boolean
  readonly loadingOlder: boolean
  readonly promptError: { readonly op: 'send' | 'stop'; readonly error: RemoteFailure } | null
  readonly blank: boolean
  readonly lastAgentError: string | null
  readonly promptAttempted: boolean
  readonly awaitingFirstTurn: boolean
}
export interface ProjectionsFace { faceOf(key: string): ObservableSnapshot<unknown> }
export interface ISession {
  readonly sessionId: string
  readonly projections: ProjectionsFace
  beginSubmission(input: BeginSubmissionInput): SubmissionHandle
  prompt(content: PromptContentPart[], mode: 'queue' | 'steer', signal?: AbortSignal, requestId?: string): Promise<RemoteResult<{ accepted: true }>>
  updateQueue(itemId: string, action: QueueAction): Promise<RemoteResult<{ accepted: true }>>
  cancel(): Promise<RemoteResult<{ accepted: true }>>
  rename(title: string): Promise<RemoteResult<{ title: string; seq: number }>>
  loadOlder(): Promise<void>
  loadThrough(seq: number): Promise<void>
  command(line: string): Promise<RemoteResult<{ matched: boolean }>>
  readAttachment(attachmentId: string): Promise<RemoteResult<{ attachment: ImageAttachmentRef; data: Uint8Array }>>
}
/** The actual controller face is itself the lifecycle observable. */
export type SessionFace = ISession & ObservableSnapshot<SessionSnapshot>

export interface SessionWireEvent {
  readonly type: string
  readonly seq: number
  readonly time: number
  readonly data: JsonValue
  readonly ignorable?: true
  readonly sourceEventSeqs?: JsonValue
  readonly surfaceOp?: JsonValue
}
export interface LlmFailure {
  readonly message: string
  readonly code: string
  readonly status?: number
  readonly providerRetryAfterMs?: number
  readonly requestId?: string
}
export type FinishReason =
  | { readonly kind: 'stop' | 'tool-calls' | 'max-tokens' }
  | { readonly kind: 'aborted' | 'error'; readonly failure: LlmFailure }
export interface TokenUsage {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens?: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
  readonly reasoningTokens?: number
}
export type StreamChunk =
  | { readonly type: 'block-start'; readonly index: number; readonly blockType: ContentBlock['type'] }
  | { readonly type: 'text-delta'; readonly index: number; readonly text: string }
  | { readonly type: 'reasoning-delta'; readonly index: number; readonly text: string }
  | { readonly type: 'tool-call-delta'; readonly index: number; readonly id: string; readonly name?: string; readonly argumentsDelta: string }
  | { readonly type: 'block-end'; readonly index: number; readonly block: ContentBlock }
  | { readonly type: 'usage'; readonly usage: TokenUsage }
  | { readonly type: 'finish'; readonly reason: FinishReason; readonly replayState?: unknown }
export interface AssistantLiveChunkEvent {
  readonly type: 'assistant/live-chunk'
  readonly seq: number
  readonly time: number
  readonly data: { readonly attemptId: string; readonly turn: number; readonly step: number; readonly chunk: StreamChunk }
}
export type SessionEventLikeEntry =
  | { readonly type: 'event'; readonly event: SessionWireEvent }
  | { readonly type: 'transient'; readonly event: AssistantLiveChunkEvent }
export type SessionEventChange =
  | { readonly kind: 'replace' | 'prepend' | 'append'; readonly entries: readonly SessionEventLikeEntry[] }
  | { readonly kind: 'settle-assistant'; readonly attemptId: string; readonly entry?: { readonly type: 'event'; readonly event: SessionWireEvent } }
export interface SessionEventWindow {
  readonly entries: readonly SessionEventLikeEntry[]
  readonly hasMore: boolean
  readonly revision: number
  readonly change: SessionEventChange
}
export interface AgentContext { readonly remote: DshRemote; readonly [key: string]: unknown }
export interface SessionBinding {
  readonly sessionId: string
  readonly session: SessionFace
  readonly eventSource: ObservableSnapshot<SessionEventWindow>
  readonly ctx: AgentContext
}
export interface ISessions {
  readonly list: ObservableSnapshot<SessionListState>
  readonly searchResultLimit: number
  create(opts?: { workspaceId?: string; cwd?: string; sessionId?: string }): Promise<string>
  open(id: string): void
  openSubagent(address: SubagentAddress): void
  subagentAddress(id: string): SubagentAddress | undefined
  setSubagentCatalogOpen(parentSessionId: string, open: boolean): void
  refreshSubagents(parentSessionId: string): Promise<void>
  clear(): void
  refresh(): Promise<void>
  search(query: string, signal: AbortSignal): Promise<RemoteResult<{ items: { sessionId: string; snippet: string }[]; hasMore: boolean }>>
  fork(opts: { sessionId: string; atSeq?: number; increaseTitle?: boolean }): Promise<string>
  scope(id: string): AgentContext | undefined
  scopeOf(ctx: unknown): string | undefined
  sessionOf(ctx: unknown): SessionFace | undefined
  binding(id: string): SessionBinding | undefined
}
/** Each feature narrows its RPC namespace locally; no stock UI package is imported. */
export interface DshRemote { readonly [namespace: string]: unknown }
export interface DshContext {
  readonly connection: Connection
  readonly sessions: ISessions
  readonly workspaces: IWorkspaces
  readonly remote: DshRemote
}
export interface DshServices extends DshContext { readonly ctx: DshContext }

const ServicesContext = createContext<DshServices | null>(null)

/** The Workspace controller is ctx.workspaces; remote.workspace is the raw RPC. */
export function servicesOf(ctx: unknown): DshServices {
  const root = ctx as DshContext
  return { ctx: root, connection: root.connection, sessions: root.sessions, workspaces: root.workspaces, remote: root.remote }
}

export function DshProvider({ ctx, children }: { ctx: unknown; children: ReactNode }) {
  const services = useMemo(() => servicesOf(ctx), [ctx])
  return createElement(ServicesContext.Provider, { value: services }, children)
}

export function useDsh(): DshServices {
  const services = useContext(ServicesContext)
  if (services === null) throw new Error('DSH の接続先が設定されていません。')
  return services
}
