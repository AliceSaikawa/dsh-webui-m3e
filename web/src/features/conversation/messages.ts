import { defineMessages } from '../../i18n/catalog.ts'

/**
 * Conversation screen and conversation picker texts
 * (web/src/features/conversation). Japanese is the source; English and Chinese
 * keep the same keys and the same parameters. A message that inserts values is
 * one function per whole sentence, so each language can order the values.
 * Terms follow the DSH standard dictionary and docs/i18n/glossary.md:
 * conversation / 对话, workspace / 工作区, trajectory / 轨迹.
 */
export const conversationMessages = defineMessages({
  ja: {
    // Conversation screen (ConversationScreen.tsx)
    back: '戻る',
    title: '会話',
    previousTab: '前のタブ',
    nextTab: '次のタブ',
    chatTab: 'チャット',
    traceTab: 'トレース',
    readOnlySubagent: 'このサブエージェントの会話は読むだけです。',
    readOnlyUnknownChild: '子の会話の情報を確認できないため、読むだけです。',

    // Conversation picker (ConversationPicker.tsx)
    pickerTitle: '会話を切り替え',
    close: '閉じる',
    searchClear: '会話名の検索を消去',
    searchPlaceholder: '会話名で検索',
    opening: '会話を開いています…',
    loadingList: '一覧を読み込んでいます…',
    limitNotice: (total: number, limit: number) => `${total} 件中、先頭 ${limit} 件を表示しています。会話名で絞り込めます。`,
    noMatch: '一致する会話がありません。',
    noChoices: '切り替えられる会話がありません。',
    listLabel: '切り替える会話',
    openFailed: '会話を開けませんでした。もう一度お試しください。',
    choiceGone: 'この会話は一覧からなくなりました。選び直してください。',
    choiceChanged: '会話の状態が変わりました。一覧から選び直してください。',
    // The workspace title is data; the labels after it are one sentence here.
    rowDescription: (workspaceTitle: string, child: boolean, running: boolean, current: boolean) =>
      `${workspaceTitle}${child ? ' ・ 子の会話' : ''}${running ? ' ・ 実行中' : ''}${current ? ' ・ 開いている会話' : ''}`,

    // Conversation choices (conversation-choices.ts)
    unregisteredWorkspace: 'ワークスペース未登録',
  },
  en: {
    back: 'Back',
    title: 'Conversation',
    previousTab: 'Previous tab',
    nextTab: 'Next tab',
    chatTab: 'Chat',
    traceTab: 'Trajectory',
    readOnlySubagent: 'This subagent conversation is read-only.',
    readOnlyUnknownChild: 'Read-only because the child conversation cannot be checked.',

    pickerTitle: 'Switch conversation',
    close: 'Close',
    searchClear: 'Clear the conversation name search',
    searchPlaceholder: 'Search by conversation name',
    opening: 'Opening the conversation…',
    loadingList: 'Loading the list…',
    limitNotice: (total: number, limit: number) => `Showing the first ${limit} of ${total} conversations. Search by conversation name to narrow the list.`,
    noMatch: 'No conversations match.',
    noChoices: 'There are no other conversations to switch to.',
    listLabel: 'Conversations to switch to',
    openFailed: 'Could not open the conversation. Try again.',
    choiceGone: 'This conversation is no longer in the list. Choose another one.',
    choiceChanged: 'The conversation changed. Choose it again from the list.',
    rowDescription: (workspaceTitle: string, child: boolean, running: boolean, current: boolean) =>
      `${workspaceTitle}${child ? ' · Child conversation' : ''}${running ? ' · Running' : ''}${current ? ' · Open conversation' : ''}`,

    unregisteredWorkspace: 'Unregistered workspace',
  },
  zh: {
    back: '返回',
    title: '对话',
    previousTab: '上一个标签页',
    nextTab: '下一个标签页',
    chatTab: '对话',
    traceTab: '轨迹',
    readOnlySubagent: '此子智能体的对话为只读。',
    readOnlyUnknownChild: '无法确认子对话的信息，因此为只读。',

    pickerTitle: '切换对话',
    close: '关闭',
    searchClear: '清除对话名称搜索',
    searchPlaceholder: '搜索对话名称',
    opening: '正在打开对话…',
    loadingList: '正在加载列表…',
    limitNotice: (total: number, limit: number) => `共 ${total} 个对话，正在显示前 ${limit} 个。可按对话名筛选。`,
    noMatch: '没有匹配的对话。',
    noChoices: '没有可切换的对话。',
    listLabel: '可切换的对话',
    openFailed: '无法打开对话，请重试。',
    choiceGone: '此对话已不在列表中，请重新选择。',
    choiceChanged: '对话状态已变化，请从列表中重新选择。',
    rowDescription: (workspaceTitle: string, child: boolean, running: boolean, current: boolean) =>
      `${workspaceTitle}${child ? ' · 子对话' : ''}${running ? ' · 运行中' : ''}${current ? ' · 当前对话' : ''}`,

    unregisteredWorkspace: '未登记工作区',
  },
})
