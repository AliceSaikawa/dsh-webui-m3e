import { defineMessages, messagesOf, type Translation } from '../../i18n/catalog.ts'
import { SOURCE_LOCALE } from '../../i18n/locale.ts'

/**
 * Trace tab and record detail texts (web/src/features/trace). Japanese is the
 * source; English and Chinese are added by the translation PRs
 * (docs/design/11-i18n.md). A message that inserts a value is one function per
 * whole sentence, and units ("ミリ秒", "秒", "バイト", "件") live here too.
 * Values, file names and tool names from the Host are not translated.
 */
export const traceMessages = defineMessages({
  ja: {
    // Trace tab (TraceView.tsx)
    viewLabel: 'トレース',
    loadOlder: '前の記録を読み込む',
    loading: '読み込み中…',
    loadOlderFailed: '前の記録を読み込めませんでした。もう一度お試しください。',
    emptyLoaded: 'まだ記録がありません。',
    emptyLoading: '会話を読み込んでいます…',
    noMatches: '一致する記録がありません。',
    partialHistory: '開始前の記録は未読み込みです。',
    turnRecords: '記録',
    turnRecordsOf: (turn: number) => `ターン ${turn} の記録`,
    rowOpenLabel: (title: string, description: string) => `${title}、${description}、詳細を開く`,
    searchSummary: (loaded: number, partial: number) => partial > 0
      ? `読み込み済みの記録から ${loaded} 件。ほかに大きな記録 ${partial} 件は一部だけを検索しました`
      : `読み込み済みの記録から ${loaded} 件`,
    searchClear: '検索を消す',
    searchLabel: '記録を検索',
    searchPlaceholder: '種類・ツール名・本文で検索',
    recordSheetLabel: '記録の詳細',

    // Record row summaries (rowDescription / turnHeading in model.ts)
    assistantRow: 'アシスタント',
    userRow: 'ユーザー',
    compactionRow: '要約',
    toolTitle: (name: string) => `ツール：${name}`,
    subtoolTitle: (name: string) => `サブツール：${name}`,
    toolNameUnknown: '名前不明',
    attachmentOnly: '添付のみ',
    rowRunning: '開始済み・実行中',
    outputTokens: (count: string) => `出力 ${count} トークン`,
    uncommittedAttempts: (count: number) => `未確定の試行 ${count} 回`,
    detailsSeparator: ' ・ ',
    turnLabel: (turn: number) => `ターン ${turn}`,
    turnNumberUnknown: 'ターン番号不明',
    turnRunning: '実行中',
    durationUnmeasured: '時間未計測',
    durationTotal: (duration: string) => `合計 ${duration}`,
    tokenCount: (count: string) => `${count} トークン`,
    tokensUnrecorded: 'トークン未記録',

    // Duration units (model.ts)
    durationNotMeasured: '未計測',
    durationInvalid: '不明',
    durationMilliseconds: (value: string) => `${value} ミリ秒`,
    durationSeconds: (value: string) => `${value} 秒`,
    durationMinutesSeconds: (minutes: string, seconds: string) => `${minutes} 分 ${seconds} 秒`,

    // Termination labels and reasons (model.ts)
    terminationError: '失敗',
    terminationAborted: '中断',
    terminationBlocked: '実行見送り',
    terminationMaxTokens: '上限到達',
    toolFailed: '処理に失敗しました。',
    modelRunFailed: 'モデルの実行に失敗しました。',
    modelOutputAborted: 'モデルの出力が中断されました。',
    outputLimitReached: '出力トークンの上限に達しました。',
    turnRunFailed: 'ターンの実行に失敗しました。',
    turnInterrupted: '終了が記録されないまま、実行が中断されました。',
    turnBlocked: '実行前の確認で処理が見送られました。',
    abortedByUser: 'ユーザーの操作で停止しました。',
    abortedByParent: '親セッションの操作で停止しました。',
    abortedByDispose: 'セッションが閉じられたため停止しました。',
    abortedLegacy: '中断の理由は記録されていません。',
    abortedByHook: (reason: string) => reason ? `フックにより停止しました。 ${reason}` : 'フックにより停止しました。',
    abortedFallback: '実行が中断されました。',
    interruptedPartial: '途中までの出力を残して中断しました。',

    // Safe JSON marks (model.ts formatJson)
    jsonOmittedCycle: '〔循環参照のため省略〕',
    jsonOmittedDepth: (limit: string) => `〔入れ子が深すぎるため省略（${limit} 段まで表示）〕`,
    jsonOmittedLimit: (limit: string) => `〔以降を省略（${limit} 要素まで表示）〕`,
    jsonUnreadable: '〔内容を表示できません〕',
    attachmentFallback: '添付',

    // Record detail sheet (RecordSheet.tsx)
    imageLoadFailed: '画像を読み込めませんでした。',
    imageFallbackName: '添付画像',
    imageInfo: (name: string, width: number, height: number, bytes: string) => `${name}（${width} × ${height}、${bytes} バイト）`,
    imageShow: '画像を表示',
    contentEmpty: '本文は記録されていません。',
    reasoningSummary: '思考',
    toolCallSummary: (name: string) => `ツール呼び出し：${name}`,
    toolOutputSummary: (failed: boolean) => failed ? 'ツールの結果・失敗' : 'ツールの結果',
    fileInfo: (name: string, bytes: string) => `添付ファイル：${name}（${bytes} バイト）`,
    contentUnsupported: 'この内容は表示に対応していません。',
    jsonNote: '〔〕の印は、省略した位置とその理由です。元のデータの文字列ではありません。',
    durationLabel: '所要時間',
    recordHeading: (title: string, turn: number | null) => turn === null ? title : `${title}（ターン ${turn}）`,
    terminationStatus: (label: string, message: string) => `${label}：${message}`,
    failureWithReason: (error: string) => `失敗：${error}`,
    nestedDepth: (depth: number) => `入れ子の深さ：${depth}`,
    recordContentLabel: '記録の内容',
    tokensLabel: 'トークン',
    uncommittedAttemptsLabel: '確定しなかった試行',
    uncommittedAttemptsSupporting: (count: number) => `未確定の試行 ${count} 回`,
    attemptFailed: (index: number, label: string, message: string) => `試行 ${index}：${label}・${message}`,
    attemptNoReason: (index: number) => `試行 ${index}：終了理由は記録されていません。`,
    inputLabel: '入力',
    inputNote: '読み込み済みの入力記録です。未読み込みの履歴や内部の指示は含みません。',
    outputLabel: '出力',
    argumentsLabel: '引数',
    notRecordedSupporting: '記録されていません',
    argumentsNotRecorded: '引数は記録されていません。',
    resultLabel: '結果',
    resultWaitingBody: '結果を待っています。',
    bodyAndAttachments: '本文と添付',
    close: '閉じる',

    // Record row supporting texts (record-summary.ts)
    recordInputSupporting: '送ったメッセージとツールの結果',
    durationWithFirstOutput: (duration: string, first: string) => `${duration}（最初の出力まで ${first}）`,
    notRecorded: '未記録',
    usageNone: 'トークン数は記録されていません',
    usageSummary: (input: string, output: string, cacheRead: string, cacheWrite: string) =>
      `入力 ${input}（キャッシュを除く） ・ 出力 ${output} ・ キャッシュ読み込み ${cacheRead} ・ キャッシュ書き込み ${cacheWrite}`,
    compactionBuilding: '要約を作っています',
    compactionSummary: 'まとめた要約',
    outputSummary: (reasoning: number, text: number, calls: number) => `思考 ${reasoning} ・ テキスト ${text} ・ ツール呼び出し ${calls}`,
    resultWaitingSupporting: '結果を待っています',
  },
  en: null,
  zh: null,
})

/** The Japanese messages; React-external helpers use this as their default. */
export type TraceMessages = Translation<typeof traceMessages.ja>
export const traceText = messagesOf(traceMessages, SOURCE_LOCALE)
