import { defineMessages } from '../../i18n/catalog.ts'

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
