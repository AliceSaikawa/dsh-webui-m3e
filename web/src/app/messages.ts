import { defineMessages } from '../i18n/catalog.ts'

/**
 * Start-up failure texts (web/src/main.tsx). They are shown before DSH
 * connects, so their language comes from the browser alone. English and
 * Chinese are added by the translation PRs (docs/design/11-i18n.md).
 */
export const bootMessages = defineMessages({
  ja: {
    notHost: '起動に失敗しました。このページは DSH の Host が描いたページではありません。開発用の画面は ?mock を付けて開いてください。',
    incompatible: (version: string) => `起動に失敗しました。この DSH の版に M3E の画面が対応していない可能性があります。M3E の画面は DSH ${version} で確かめています。`,
    failed: '起動に失敗しました。ページを読み直してください。',
    reload: '読み直す',
    classic: '今の画面に戻す',
  },
  en: null,
  zh: null,
})

/**
 * Shared error screens (web/src/app/ErrorState.tsx). The title says what
 * happened and the message suggests the next action, without exposing the
 * raw error, a path or a key.
 */
export const errorMessages = defineMessages({
  ja: {
    renderTitle: '画面を表示できませんでした',
    renderMessage: '思いがけない問題が起きました。読み直すと元に戻ることがあります。',
    notFoundTitle: '画面が見つかりません',
    notFoundMessage: 'URL が古いか、間違っている可能性があります。',
    openFailedTitle: '会話を開けませんでした',
    offlineTitle: 'オフラインです',
    offlineMessage: 'ネットワークにつながっていません。接続を確かめてから読み直してください。',
    reload: '読み直す',
    home: '一覧に戻る',
    back: '戻る',
    retryOpen: 'もう一度開く',
  },
  en: null,
  zh: null,
})
