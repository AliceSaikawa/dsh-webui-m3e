import { defineMessages } from '../../i18n/catalog.ts'

/**
 * Inbox (対応待ち) screen texts. Japanese is the source; English and Chinese are
 * added by the translation PRs (docs/design/11-i18n.md). Messages that take
 * values are one function per whole sentence, units included.
 */
export const inboxMessages = defineMessages({
  ja: {
    title: '対応待ち',
    pendingHeading: '返事が必要',
    completedHeading: '終わったもの',
    opening: '会話を開いています',
    empty: '対応待ちはありません',
    openFailed: '会話を開けませんでした。もう一度お試しください。',
    rowLabel: (title: string, workspaceName: string, description: string) => `${title}、${workspaceName}、${description}`,
    // The workspace name is wrapped in <small>, so the two values cannot become
    // one whole-line message; the separator between them is a message instead.
    rowSeparator: ' ・ ',

    loadingInbox: '対応待ちを読み込んでいます',
    loadingWorkspaces: 'ワークスペースを読み込んでいます',
    workspaceErrorKnown: 'ワークスペース一覧を取得できませんでした。所属は前回取得した情報です。',
    workspaceErrorUnknown: 'ワークスペース一覧を取得できませんでした。所属を確認できません。',

    approvalDescription: (toolName: string) => `ツールの承認：${toolName} を実行しようとしています`,
    questionFallback: '質問の内容を確認してください',
    planReviewDescription: 'プランの確認：承認するまで作業を始めません',
    questionDescription: (question: string) => `質問：${question}`,

    timeUnknown: '時刻不明',
    timeNow: 'たった今',
    minutesAgo: (minutes: number) => `${minutes} 分前`,
    hoursAgo: (hours: number) => `${hours} 時間前`,
    daysAgo: (days: number) => `${days} 日前`,

    untitledWorkspace: '名前のないワークスペース',
    workspaceUnverified: (name: string) => `${name}（更新未確認）`,
    workspaceUnknown: 'ワークスペースを確認できません',
    workspaceRefreshing: (name: string) => `${name}（更新中）`,
    workspaceLoading: 'ワークスペースを読み込み中',
    workspaceUnregistered: 'ワークスペース未登録',
    sessionLoading: 'セッションを読み込み中',
    sessionUnknown: 'セッション情報を取得できません',
    untitledSession: '題名のないセッション',
    completedDescription: (time: string) => `完了 ・ ${time}`,

    sessionMissing: '会話が見つかりません。',
    parentMissing: '親の会話が見つかりません。',
    childChanged: '子の会話の情報が変わりました。もう一度お試しください。',
    childUnavailable: '子の会話の情報を読み込めませんでした。',
  },
  en: {
    title: 'Needs attention',
    pendingHeading: 'Needs a reply',
    completedHeading: 'Finished',
    opening: 'Opening the conversation',
    empty: 'Nothing needs attention',
    openFailed: 'Could not open the conversation. Try again.',
    rowLabel: (title: string, workspaceName: string, description: string) => `${title}, ${workspaceName}, ${description}`,
    rowSeparator: ' · ',

    loadingInbox: 'Loading what needs attention',
    loadingWorkspaces: 'Loading workspaces',
    workspaceErrorKnown: 'Could not fetch the workspace list. Memberships come from the last fetch.',
    workspaceErrorUnknown: 'Could not fetch the workspace list. Memberships are unknown.',

    approvalDescription: (toolName: string) => `Tool approval: about to run ${toolName}`,
    questionFallback: 'Check what the question asks',
    planReviewDescription: 'Plan review: work does not start until you approve',
    questionDescription: (question: string) => `Question: ${question}`,

    timeUnknown: 'Time unknown',
    timeNow: 'Just now',
    minutesAgo: (minutes: number) => (minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`),
    hoursAgo: (hours: number) => (hours === 1 ? '1 hour ago' : `${hours} hours ago`),
    daysAgo: (days: number) => (days === 1 ? '1 day ago' : `${days} days ago`),

    untitledWorkspace: 'Untitled workspace',
    workspaceUnverified: (name: string) => `${name} (update unverified)`,
    workspaceUnknown: 'Workspace unknown',
    workspaceRefreshing: (name: string) => `${name} (refreshing)`,
    workspaceLoading: 'Loading workspace',
    workspaceUnregistered: 'Workspace not registered',
    sessionLoading: 'Loading session',
    sessionUnknown: 'Session information unavailable',
    untitledSession: 'Untitled session',
    completedDescription: (time: string) => `Done · ${time}`,

    sessionMissing: 'Conversation not found.',
    parentMissing: 'Parent conversation not found.',
    childChanged: 'The child conversation changed. Try again.',
    childUnavailable: 'Could not load the child conversation.',
  },
  zh: {
    title: '待处理',
    pendingHeading: '需要回复',
    completedHeading: '已完成',
    opening: '正在打开对话',
    empty: '没有待处理的事项',
    openFailed: '无法打开对话。请重试。',
    rowLabel: (title: string, workspaceName: string, description: string) => `${title}，${workspaceName}，${description}`,
    rowSeparator: ' · ',

    loadingInbox: '正在加载待处理事项',
    loadingWorkspaces: '正在加载工作区',
    workspaceErrorKnown: '无法获取工作区列表。所属关系来自上次获取的信息。',
    workspaceErrorUnknown: '无法获取工作区列表。无法确认所属关系。',

    approvalDescription: (toolName: string) => `工具审批：即将运行 ${toolName}`,
    questionFallback: '请查看问题内容',
    planReviewDescription: '计划待审：你同意前不会开始工作',
    questionDescription: (question: string) => `问题：${question}`,

    timeUnknown: '时间未知',
    timeNow: '刚刚',
    minutesAgo: (minutes: number) => `${minutes} 分钟前`,
    hoursAgo: (hours: number) => `${hours} 小时前`,
    daysAgo: (days: number) => `${days} 天前`,

    untitledWorkspace: '未命名工作区',
    workspaceUnverified: (name: string) => `${name}（更新未确认）`,
    workspaceUnknown: '无法确认工作区',
    workspaceRefreshing: (name: string) => `${name}（刷新中）`,
    workspaceLoading: '正在加载工作区',
    workspaceUnregistered: '工作区未注册',
    sessionLoading: '正在加载会话',
    sessionUnknown: '无法获取会话信息',
    untitledSession: '未命名会话',
    completedDescription: (time: string) => `已完成 · ${time}`,

    sessionMissing: '未找到对话。',
    parentMissing: '未找到父对话。',
    childChanged: '子对话的信息已变化。请重试。',
    childUnavailable: '无法加载子对话的信息。',
  },
})
