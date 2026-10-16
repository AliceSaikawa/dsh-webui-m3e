import { defineMessages, type Translation } from '../../i18n/catalog.ts'

/**
 * Tool approval, AI questions and plan review (web/src/features/interactions).
 * Japanese is the source; English and Chinese are added by the translation PRs
 * (docs/design/11-i18n.md). Values that come from the Host (tool names, question
 * data, `intent.approve`) stay as they are and are inserted as values.
 */
export const interactionMessages = defineMessages({
  ja: {
    approvalTitle: 'ツールの承認',
    planTitle: 'プランの確認',
    questionTitle: 'AI からの質問',
    approvalCancelled: '承認の要求は取り消されました',
    questionCancelled: '質問の要求は取り消されました',
    sendFailed: '回答を送れませんでした。もう一度お試しください。',
    toolRun: (toolName: string) => `${toolName} を実行しようとしています`,
    viewTrace: 'トレースで見る',
    reject: '拒否',
    allowOnce: '許可（1 回）',
    sending: '回答を送信しています…',
    later: 'あとで',
    planBody: 'プランの本文',
    editPlanLabel: '直してほしいこと',
    unreadableQuestion: '質問の内容を読み取れませんでした。あとで開き直してください。',
    previousQuestion: '前の質問',
    backToPlan: 'プランに戻る',
    requestRevision: '修正をお願いする',
    next: '次へ',
    requestChanges: '直してほしい',
    answer: '回答する',
    otherOptionLabel: 'その他（自由に書く）',
    customAnswerHint: '自由入力の内容を回答します。',
    pendingApproval: '返事待ちの承認があります',
    pendingPlan: '返事待ちのプランがあります',
    pendingQuestion: '返事待ちの質問があります',
    progress: (current: number, total: number) => `質問 ${current} / ${total}`,
    missingPlanChoice: 'プランの承認の選択肢がありません。',
  },
  en: null, // 訳を足す PR まで null（日本語を表示）
  zh: null,
})

/** The feature's message shape, for helpers that take the texts as a value. */
export type InteractionText = Translation<typeof interactionMessages.ja>
