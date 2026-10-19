import { defineMessages } from '../../i18n/catalog.ts'

/**
 * Search screen texts (web/src/features/search). Japanese is the source;
 * English and Chinese are added by the translation PRs (docs/design/11-i18n.md).
 * Values that come from the Host (queries, titles, folders, dates) are not
 * translated, so they stay out of the dictionary.
 */
export const searchMessages = defineMessages({
  ja: {
    title: '検索',
    clearLabel: '検索語を消去',
    searchField: 'セッションを検索',
    busyLabel: '検索中',
    resultsFor: (query: string) => `「${query}」の検索結果`,
    recentSessions: '最近のセッション',
    searching: '検索しています…',
    composingHint: '入力を確定すると検索します',
    loadingSessions: 'セッションを読み込んでいます…',
    noResults: '見つかりませんでした',
    resultCount: (count: number) => `${count} 件見つかりました`,
    noRecentSessions: '最近のセッションはありません',
    failed: '検索できませんでした',
    retry: 'もう一度検索',
    results: '検索結果',
    untitled: '題名のないセッション',
    more: 'さらに結果があります。語を増やして絞り込んでください',
    noFolder: '作業フォルダ未設定',
    unknownUpdatedAt: '更新日時不明',
    sessionDetails: (folder: string, updated: string) => `${folder} ・ ${updated}`,
    queryTooLong: '検索語は500文字以内にしてください。絵文字などは2文字分として数えます。',
    queryInvalid: '検索語に使えない文字が含まれています。貼り付けた内容を見直してください。',
    badRequest: '検索語を受け付けられませんでした。文字数や貼り付けた内容を見直してください。',
    serviceUnavailable: '検索機能を利用できません。DSH の検索機能の設定や動作状態を確認してください。',
    serviceFailed: '検索サービスから結果を取得できませんでした。時間をおいて、もう一度お試しください。',
  },
  en: null, // Untranslated until the translation PR; the source language is shown.
  zh: null,
})
