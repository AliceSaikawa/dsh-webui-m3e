import { defineMessages, messagesOf, type Translation } from '../../i18n/catalog.ts'
import { SOURCE_LOCALE } from '../../i18n/locale.ts'

/**
 * Texts for the message actions sheet and the text selection sheet
 * (web/src/features/chat/MessageActions.tsx). The rest of the chat screen is
 * moved in its own migration PR (docs/design/11-i18n.md). Terms follow the DSH
 * standard UI and docs/i18n/glossary.md: copy / 复制, copied / 复制成功,
 * branch / 分支, conversation / 对话.
 */
export const messageActionMessages = defineMessages({
  ja: {
    title: 'メッセージの操作',
    copy: 'コピー',
    copied: 'コピーしました。',
    copyFailed: 'コピーできませんでした。「テキストを選択」から本文を選んでコピーしてください。',
    selectText: 'テキストを選択',
    selectTitle: 'テキストを選択',
    selectHint: '文字を長押ししてから、ドラッグで範囲を選び、コピーします。',
    fork: 'ここから分岐',
    forking: '分岐しています…',
    forkUnavailable: '送信・生成が確定すると、この位置から分岐できます。',
    forkCreated: 'このメッセージからの分岐を作成しました。',
    openFork: '分岐した会話を開く',
    close: '閉じる',
  },
  en: {
    title: 'Message actions',
    copy: 'Copy',
    copied: 'Copied.',
    copyFailed: 'Could not copy. Choose “Select text” to select the text and copy it.',
    selectText: 'Select text',
    selectTitle: 'Select text',
    selectHint: 'Touch and hold the text, then drag to select a range and copy it.',
    fork: 'Branch from here',
    forking: 'Branching…',
    forkUnavailable: 'You can branch from this point once sending or generating is confirmed.',
    forkCreated: 'A branch from this message was created.',
    openFork: 'Open the branched conversation',
    close: 'Close',
  },
  zh: {
    title: '消息操作',
    copy: '复制',
    copied: '复制成功。',
    copyFailed: '无法复制。请点击“选择文本”选中文本后再复制。',
    selectText: '选择文本',
    selectTitle: '选择文本',
    selectHint: '长按文字后拖动选择范围，然后复制。',
    fork: '从这里分支',
    forking: '正在分支…',
    forkUnavailable: '发送或生成确认后，才能从这里分支。',
    forkCreated: '已从这条消息创建分支。',
    openFork: '打开分支对话',
    close: '关闭',
  },
})

/**
 * Chat tab texts (web/src/features/chat/ChatView.tsx, ChatSheets.tsx,
 * model.ts). Japanese is the source; a message that inserts a value is one
 * function per whole sentence, and units ("ミリ秒", "秒", "分", "バイト") live
 * here too. Values the Host sends, tool names and file names are not
 * translated.
 */
export const chatMessages = defineMessages({
  ja: {
    // ChatView.tsx
    viewLabel: 'チャット',
    userMessageLabel: '自分のメッセージ',
    assistantMessageLabel: 'AI のメッセージ',
    pendingMessageLabel: '送信中のメッセージ',
    commandInputLabel: 'コマンド入力',
    thinking: '考えています…',
    thoughtContent: '考えた内容',
    reasoningWaiting: '内容を待っています…',
    statusRunning: '実行中',
    statusFailed: '失敗',
    statusDone: '完了',
    toolFallbackName: 'ツール',
    toolDetailLabel: 'ツール呼び出しの詳細',
    toolMetaSeparator: ' ・ ',
    systemPrompt: 'システムプロンプト',
    recalledContext: '別の会話から参照',
    injectedContext: '追加された文脈',
    loadOlder: '前のメッセージを読み込む',
    loadOlderFailed: '前のメッセージを読み込めませんでした。もう一度お試しください。',
    loadingConversation: '会話を読み込んでいます…',
    loadingOlder: '前のメッセージを読み込んでいます…',
    emptyTitle: '何をしますか',
    emptyBody: '下の入力欄からメッセージを送れます。',
    awaitingResponse: 'AI の応答を待っています…',
    generating: '返事を生成しています…',
    stopped: 'AI の処理が止まりました',
    toLatest: '最新へ',
    pendingSending: '送信中…',

    // model.ts
    // `command` is the slash command (`/name`), or undefined when the row has no name.
    commandFailed: (command: string | undefined) => command ? `${command} の実行に失敗しました` : 'コマンドの実行に失敗しました',
    commandFailedNoReason: '詳しい理由は記録されていません。',
    commandSucceeded: (command: string | undefined) => command ? `${command} を実行しました` : 'コマンドを実行しました',
    commandResultReceived: (command: string | undefined) => command ? `${command} の結果を受け取りました` : 'コマンドの結果を受け取りました',
    durationUnknown: '不明',
    durationMilliseconds: (value: string) => `${value} ミリ秒`,
    durationSeconds: (value: string) => `${value} 秒`,
    durationMinutesSeconds: (minutes: string, seconds: string) => `${minutes} 分 ${seconds} 秒`,

    // ChatSheets.tsx, fork-operation.ts
    sheetsUnavailable: '会話のシートを開けませんでした。',
    forkFailed: '会話を分岐できませんでした。',
  },
  en: {
    // ChatView.tsx
    viewLabel: 'Chat',
    userMessageLabel: 'Your message',
    assistantMessageLabel: 'AI message',
    pendingMessageLabel: 'Sending message',
    commandInputLabel: 'Command input',
    thinking: 'Thinking…',
    thoughtContent: 'Thoughts',
    reasoningWaiting: 'Waiting for content…',
    statusRunning: 'Running',
    statusFailed: 'Failed',
    statusDone: 'Completed',
    toolFallbackName: 'Tool',
    toolDetailLabel: 'Tool call details',
    toolMetaSeparator: ' · ',
    systemPrompt: 'System prompt',
    recalledContext: 'Referenced from another conversation',
    injectedContext: 'Added context',
    loadOlder: 'Load earlier messages',
    loadOlderFailed: 'Could not load earlier messages. Try again.',
    loadingConversation: 'Loading the conversation…',
    loadingOlder: 'Loading earlier messages…',
    emptyTitle: 'What would you like to do?',
    emptyBody: 'You can send a message from the field below.',
    awaitingResponse: 'Waiting for the AI response…',
    generating: 'Generating a reply…',
    stopped: 'The AI stopped working',
    toLatest: 'Go to latest',
    pendingSending: 'Sending…',

    // model.ts
    commandFailed: (command: string | undefined) => `${command ?? 'Command'} failed`,
    commandFailedNoReason: 'No detailed reason was recorded.',
    commandSucceeded: (command: string | undefined) => command ? `Ran ${command}` : 'Ran the command',
    commandResultReceived: (command: string | undefined) => command ? `Received the result of ${command}` : 'Received the command result',
    durationUnknown: 'Unknown',
    durationMilliseconds: (value: string) => `${value} ms`,
    durationSeconds: (value: string) => `${value} s`,
    durationMinutesSeconds: (minutes: string, seconds: string) => `${minutes} min ${seconds} s`,

    // ChatSheets.tsx, fork-operation.ts
    sheetsUnavailable: 'Could not open the conversation sheet.',
    forkFailed: 'Could not branch the conversation.',
  },
  zh: {
    // ChatView.tsx
    viewLabel: '对话',
    userMessageLabel: '你的消息',
    assistantMessageLabel: 'AI 消息',
    pendingMessageLabel: '发送中的消息',
    commandInputLabel: '指令输入',
    thinking: '正在思考…',
    thoughtContent: '思考内容',
    reasoningWaiting: '等待内容…',
    statusRunning: '运行中',
    statusFailed: '失败',
    statusDone: '已完成',
    toolFallbackName: '工具',
    toolDetailLabel: '工具调用详情',
    toolMetaSeparator: ' · ',
    systemPrompt: '系统提示词',
    recalledContext: '来自其他对话的引用',
    injectedContext: '已添加的上下文',
    loadOlder: '加载更早的消息',
    loadOlderFailed: '无法加载更早的消息。请重试。',
    loadingConversation: '正在载入对话…',
    loadingOlder: '正在加载更早的消息…',
    emptyTitle: '要做点什么？',
    emptyBody: '可在下方输入框发送消息。',
    awaitingResponse: '正在等待 AI 回复…',
    generating: '正在生成回复…',
    stopped: 'AI 处理已停止',
    toLatest: '回到底部',
    pendingSending: '发送中…',

    // model.ts
    commandFailed: (command: string | undefined) => command ? `${command} 执行失败` : '指令执行失败',
    commandFailedNoReason: '没有记录详细原因。',
    commandSucceeded: (command: string | undefined) => command ? `已执行 ${command}` : '已执行指令',
    commandResultReceived: (command: string | undefined) => command ? `已收到 ${command} 的结果` : '已收到指令的结果',
    durationUnknown: '未知',
    durationMilliseconds: (value: string) => `${value} 毫秒`,
    durationSeconds: (value: string) => `${value} 秒`,
    durationMinutesSeconds: (minutes: string, seconds: string) => `${minutes} 分 ${seconds} 秒`,

    // ChatSheets.tsx, fork-operation.ts
    sheetsUnavailable: '无法打开对话面板。',
    forkFailed: '无法分支对话。',
  },
})

/** The Japanese messages; React-external helpers use this as their default. */
export type ChatMessages = Translation<typeof chatMessages.ja>
export const chatText = messagesOf(chatMessages, SOURCE_LOCALE)

/** Attachment texts (Attachments.tsx), including the byte/KB/MB sizes. */
export const attachmentMessages = defineMessages({
  ja: {
    defaultName: '添付画像',
    defaultFileName: '添付ファイル',
    bytes: (value: string) => `${value} バイト`,
    kilobytes: (value: string) => `${value} KB`,
    megabytes: (value: string) => `${value} MB`,
    close: '閉じる',
    previewLabel: '画像の表示',
    openFull: (name: string) => `${name}を全画面で表示`,
    expand: '画像を拡大',
    loadFailed: '画像を読み込めませんでした。',
    retry: '再読み込み',
    loading: '画像を読み込んでいます…',
  },
  en: {
    defaultName: 'Attached image',
    defaultFileName: 'Attached file',
    bytes: (value: string) => `${value} bytes`,
    kilobytes: (value: string) => `${value} KB`,
    megabytes: (value: string) => `${value} MB`,
    close: 'Close',
    previewLabel: 'Image preview',
    openFull: (name: string) => `View ${name} full screen`,
    expand: 'Enlarge image',
    loadFailed: 'Could not load the image.',
    retry: 'Retry',
    loading: 'Loading the image…',
  },
  zh: {
    defaultName: '附件图片',
    defaultFileName: '附件文件',
    bytes: (value: string) => `${value} 字节`,
    kilobytes: (value: string) => `${value} KB`,
    megabytes: (value: string) => `${value} MB`,
    close: '关闭',
    previewLabel: '图片预览',
    openFull: (name: string) => `全屏查看${name}`,
    expand: '放大图片',
    loadFailed: '无法加载图片。',
    retry: '重试',
    loading: '正在加载图片…',
  },
})

/** Tool detail sheet texts (ToolDetail.tsx) and the tool error report (tool-output.ts). */
export const toolDetailMessages = defineMessages({
  ja: {
    title: 'ツール呼び出しの詳細',
    reasoning: '考えた内容',
    file: 'ファイル',
    toolCall: 'ツール呼び出し',
    kind: (label: string) => `種類：${label}`,
    argumentsHeading: '引数',
    resultHeading: '結果',
    waitingResult: '結果を待っています…',
    emptyResult: '結果の本文はありません。',
    executionFailed: 'ツールの実行に失敗しました。',
    showMore: '続きを表示',
    durationHeading: '所要時間',
    durationUnknown: '所要時間は不明です',
    close: '閉じる',
    errorName: (name: string) => `エラー種別：${name}`,
    errorCode: (code: string) => `エラーコード：${code}`,
  },
  en: {
    title: 'Tool call details',
    reasoning: 'Thoughts',
    file: 'File',
    toolCall: 'Tool call',
    kind: (label: string) => `Kind: ${label}`,
    argumentsHeading: 'Arguments',
    resultHeading: 'Result',
    waitingResult: 'Waiting for the result…',
    emptyResult: 'There is no result body.',
    executionFailed: 'The tool failed to run.',
    showMore: 'Show more',
    durationHeading: 'Duration',
    durationUnknown: 'Duration unknown',
    close: 'Close',
    errorName: (name: string) => `Error type: ${name}`,
    errorCode: (code: string) => `Error code: ${code}`,
  },
  zh: {
    title: '工具调用详情',
    reasoning: '思考内容',
    file: '文件',
    toolCall: '工具调用',
    kind: (label: string) => `类型：${label}`,
    argumentsHeading: '参数',
    resultHeading: '结果',
    waitingResult: '正在等待结果…',
    emptyResult: '没有结果正文。',
    executionFailed: '工具执行失败。',
    showMore: '显示更多',
    durationHeading: '用时',
    durationUnknown: '用时未知',
    close: '关闭',
    errorName: (name: string) => `错误类型：${name}`,
    errorCode: (code: string) => `错误代码：${code}`,
  },
})

export type ToolDetailMessages = Translation<typeof toolDetailMessages.ja>
export const toolDetailText = messagesOf(toolDetailMessages, SOURCE_LOCALE)
