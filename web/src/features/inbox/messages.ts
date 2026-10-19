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
  en: null,
  zh: null,
})
