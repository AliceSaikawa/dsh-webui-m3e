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
  en: null,
  zh: null,
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
  en: null,
  zh: null,
})
