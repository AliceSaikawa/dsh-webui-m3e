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
 * The on-device measurement panel (?diag, web/src/app/diagnostics-panel.ts).
 * Values themselves stay as CSS/DOM names so they can be compared with the
 * browser's documentation.
 */
export const diagnosticsMessages = defineMessages({
  ja: {
    title: 'M3E 計測',
    screen: '画面',
    orientation: '向き',
    displayMode: '表示',
    keyboard: 'キーボード推定',
    appArea: 'アプリの枠',
    top: '上',
    height: '高さ',
    bottomBar: '下端の部品の下端',
    visualBottom: 'visual の下端',
    focus: 'フォーカス',
    none: 'なし',
    frames: '描画',
    worstFrame: '最大の間隔',
    events: '最近の出来事',
    move: '上下に移す',
    collapse: '縮める',
    expand: '広げる',
    copy: '写す',
    copied: '写しました',
    copyFailed: '写せません',
    close: '計測を終える',
  },
  en: null,
  zh: null,
})
