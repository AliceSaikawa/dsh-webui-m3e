import { defineMessages } from '../i18n/catalog.ts'

/**
 * Texts for failures the Host reports (web/src/dsh/remote-result.ts). The
 * per-code messages are looked up through `REMOTE_CODE_KEYS`; the others cover
 * a family of codes or a failure with no code. Host diagnostics are not
 * translated and never shown. English and Chinese are added by the
 * translation PRs (docs/design/11-i18n.md).
 */
export const remoteErrorMessages = defineMessages({
  ja: {
    failed: '処理に失敗しました。もう一度お試しください。',
    cancelled: '操作を取り消しました。',
    disconnected: '接続できません。接続を確認して、もう一度お試しください。',
    timeout: '応答を待ちきれませんでした。もう一度お試しください。',
    badRequest: '送信内容を確認して、もう一度お試しください。',
    gatewayInternal: 'サーバーでエラーが発生しました。しばらく待ってから、もう一度お試しください。',
    sessionNotFound: '会話が見つかりません。',
    sessionTitleInvalid: '会話の題名を入力してください。',
    sessionAgentBusy: '実行中の処理が終わってから、もう一度お試しください。',
    sessionModelUnavailable: '選んだモデルを利用できません。モデルを選び直してください。',
    providerModelsUnavailable: 'この提供元で利用できるモデルがありません。提供元の設定を確認するか、モデルを選び直してください。',
    projectionsUnavailable: '会話の状態を読み込めませんでした。会話を開き直してください。',
    writerHeld: 'この会話はほかの処理が操作中です。処理が終わってから、もう一度お試しください。',
    forkUnavailable: 'この位置からは会話を分岐できません。',
    queueItemNotFound: 'このメッセージはすでに順番待ちから外れています。',
    steerUnavailable: 'このメッセージでは実行中の処理に割り込めません。',
    attachmentInvalid: '添付ファイルを送れません。内容やサイズを確認してください。',
    workspaceInvalidPath: 'このフォルダを利用できません。パスを確認してください。',
    workspaceNameConflict: '同じ名前のワークスペースがあります。',
    workspaceMoveInvalid: 'この場所には移動できません。',
    credentialsUnavailable: 'API キーの登録状況を確認する機能を利用できません。DSH の構成を確認してください。',
    workspaceSessionActive: '実行中の会話はアーカイブできません。実行を止めてから、もう一度お試しください。',
    watchUnsupported: 'このファイルの更新通知は利用できません。読み直して確認してください。',
    pickerUnavailable: 'フォルダの選択を利用できません。',
    pickerUnreadable: 'このフォルダを読み取れません。',
    pickerExists: '同じ名前のフォルダがすでにあります。',
    pickerCreateFailed: 'フォルダを作れませんでした。',
  },
  en: {
    failed: 'The operation failed. Try again.',
    cancelled: 'The operation was cancelled.',
    disconnected: 'Could not connect. Check your connection and try again.',
    timeout: 'The request timed out. Try again.',
    badRequest: 'Check what you sent and try again.',
    gatewayInternal: 'The server encountered an error. Wait a moment, then try again.',
    sessionNotFound: 'The conversation was not found.',
    sessionTitleInvalid: 'Enter a title for the conversation.',
    sessionAgentBusy: 'Wait for the running operation to finish, then try again.',
    sessionModelUnavailable: 'The selected model is unavailable. Choose a different model.',
    providerModelsUnavailable: 'This provider has no available models. Check the provider settings or choose a different model.',
    projectionsUnavailable: 'Could not load the conversation state. Open the conversation again.',
    writerHeld: 'Another operation is using this conversation. Wait for it to finish, then try again.',
    forkUnavailable: 'You cannot branch the conversation from this point.',
    queueItemNotFound: 'This message is no longer in the queue.',
    steerUnavailable: 'This message cannot steer the running operation.',
    attachmentInvalid: 'Could not send the attachment. Check its contents and size.',
    workspaceInvalidPath: 'This folder cannot be used. Check the path.',
    workspaceNameConflict: 'A workspace with the same name already exists.',
    workspaceMoveInvalid: 'The workspace cannot be moved here.',
    credentialsUnavailable: 'Cannot check whether the API key is registered. Check the DSH configuration.',
    workspaceSessionActive: 'A running conversation cannot be archived. Stop the run, then try again.',
    watchUnsupported: 'File change notifications are unavailable. Reload to check.',
    pickerUnavailable: 'The folder picker is unavailable.',
    pickerUnreadable: 'This folder cannot be read.',
    pickerExists: 'A folder with the same name already exists.',
    pickerCreateFailed: 'Could not create the folder.',
  },
  zh: {
    failed: '操作失败，请重试。',
    cancelled: '操作已取消。',
    disconnected: '无法连接。请检查网络连接后重试。',
    timeout: '等待响应超时，请重试。',
    badRequest: '请检查发送内容后重试。',
    gatewayInternal: '服务器发生错误，请稍候后重试。',
    sessionNotFound: '找不到对话。',
    sessionTitleInvalid: '请输入对话标题。',
    sessionAgentBusy: '请等待当前操作结束后重试。',
    sessionModelUnavailable: '所选模型不可用，请重新选择模型。',
    providerModelsUnavailable: '此提供方没有可用的模型。请检查提供方设置，或重新选择模型。',
    projectionsUnavailable: '无法加载对话状态，请重新打开对话。',
    writerHeld: '此对话正被其他操作占用，请等待操作结束后重试。',
    forkUnavailable: '无法从此位置分支对话。',
    queueItemNotFound: '此消息已不在队列中。',
    steerUnavailable: '此消息无法插话发送。',
    attachmentInvalid: '无法发送附件，请检查内容和大小。',
    workspaceInvalidPath: '无法使用此文件夹，请检查路径。',
    workspaceNameConflict: '已存在同名工作区。',
    workspaceMoveInvalid: '无法移动到此处。',
    credentialsUnavailable: '无法确认 API 密钥的注册状态，请检查 DSH 配置。',
    workspaceSessionActive: '正在运行的对话无法归档，请停止运行后重试。',
    watchUnsupported: '此文件不支持更新通知，请重新加载确认。',
    pickerUnavailable: '无法使用文件夹选择。',
    pickerUnreadable: '无法读取此文件夹。',
    pickerExists: '已存在同名文件夹。',
    pickerCreateFailed: '无法创建文件夹。',
  },
})

/**
 * Names and descriptions that replace the Host's stock text for the built-in
 * permission presets (web/src/dsh/permission-presets.ts).
 */
export const permissionPresetMessages = defineMessages({
  ja: {
    readOnly: '読み取りのみ',
    workspaceWrite: 'ワークスペース書込',
    dangerFullAccess: 'フル アクセス',
    autoReview: '自動レビュー（実験的）',
    custom: 'カスタム',
    workspaceWriteDescription: '作業フォルダと許可された一時フォルダの中に書き込めます。範囲を広げるときは確認します。',
    dangerFullAccessDescription: '確認なしで、すべてのファイルにアクセスできます。',
    autoReviewDescription: 'サンドボックスなしで動きます。ツールを呼び出すたびに、同じモデルが実験的に確認します。',
  },
  en: {
    readOnly: 'Read Only',
    workspaceWrite: 'Workspace Write',
    dangerFullAccess: 'Full access',
    autoReview: 'Auto review',
    custom: 'Custom',
    workspaceWriteDescription: 'Write inside the workspace and permitted temporary directories; wider retries require approval.',
    dangerFullAccessDescription: 'Full file access without approval prompts.',
    autoReviewDescription: 'Run without a sandbox after an experimental same-model review of every native tool call and PTC inner call.',
  },
  zh: {
    readOnly: '仅可查看',
    workspaceWrite: '工作区内修改',
    dangerFullAccess: '完全权限',
    autoReview: '自动审查',
    custom: '自定义',
    workspaceWriteDescription: '可在工作区与允许的临时目录内写入；扩大范围时需要审批。',
    dangerFullAccessDescription: '无需确认即可访问所有文件。',
    autoReviewDescription: '无沙箱运行；每次原生工具调用和 PTC 内层调用前由同一模型进行实验性审查。',
  },
})

/**
 * Failures while resolving or opening a conversation
 * (web/src/dsh/session-navigation.ts, conversation-selection.ts, session.ts).
 * The UI usually shows its own fallback for these plain errors, but the
 * messages still come from the page language.
 */
export const navigationErrorMessages = defineMessages({
  ja: {
    sessionMissing: '会話が見つかりません。',
    parentMissing: '親の会話が見つかりません。',
    childChanged: '子の会話の情報が変わりました。もう一度お試しください。',
    childUnavailable: '子の会話の情報を読み込めませんでした。',
    openFailed: '会話を開けませんでした。',
  },
  en: {
    sessionMissing: 'The conversation was not found.',
    parentMissing: 'The parent conversation was not found.',
    childChanged: 'The child conversation changed. Try again.',
    childUnavailable: 'Could not load the child conversation.',
    openFailed: 'Could not open the conversation.',
  },
  zh: {
    sessionMissing: '找不到对话。',
    parentMissing: '找不到父对话。',
    childChanged: '子对话的信息已变化，请重试。',
    childUnavailable: '无法加载子对话的信息。',
    openFailed: '无法打开对话。',
  },
})

/**
 * Internal rejection reasons of the interaction store
 * (web/src/dsh/interactions-store.ts). The sheet shows its own failure text;
 * these messages only explain the cause to callers and in logs.
 */
export const interactionErrorMessages = defineMessages({
  ja: {
    questionCancelled: '回答の前に質問が取り消されました。',
    approvalCancelled: '承認の要求が取り消されました。',
    requestFinished: 'この要求への回答はすでに終了しています。',
    alreadyRegistered: 'この接続には対応待ちの受け取りがすでに登録されています。',
  },
  en: {
    questionCancelled: 'The question was cancelled before it was answered.',
    approvalCancelled: 'The approval request was cancelled.',
    requestFinished: 'This request has already been answered.',
    alreadyRegistered: 'This connection already has a handler for pending requests.',
  },
  zh: {
    questionCancelled: '问题在回答前已被取消。',
    approvalCancelled: '审批请求已取消。',
    requestFinished: '此请求已结束，无法再回答。',
    alreadyRegistered: '此连接已注册待处理请求的处理程序。',
  },
})

/** Developer failures of the service layer (web/src/dsh/services.ts). They are not shown as text. */
export const serviceErrorMessages = defineMessages({
  ja: {
    connectionMissing: 'DSH の接続先が設定されていません。',
  },
  en: {
    connectionMissing: 'No DSH connection is configured.',
  },
  zh: {
    connectionMissing: '未设置 DSH 的连接地址。',
  },
})
