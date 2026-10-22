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
  en: {
    notHost: 'Could not start. This page was not served by the DSH Host. To open the development screen, add ?mock to the URL.',
    incompatible: (version: string) => `Could not start. This version of DSH may not support the M3E screen. The M3E screen has been checked with DSH ${version}.`,
    failed: 'Could not start. Reload the page.',
    reload: 'Reload',
    classic: 'Return to the standard screen',
  },
  zh: {
    notHost: '启动失败。此页面不是由 DSH 主机提供的页面。开发用页面请在网址后添加 ?mock 打开。',
    incompatible: (version: string) => `启动失败。此版本的 DSH 可能不支持 M3E 页面。M3E 页面已在 DSH ${version} 上验证。`,
    failed: '启动失败，请刷新页面。',
    reload: '刷新',
    classic: '返回标准界面',
  },
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
    notFoundBarTitle: 'エラー',
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
  en: {
    renderTitle: 'This screen could not be displayed',
    renderMessage: 'Something unexpected went wrong. Reloading the page may bring it back.',
    notFoundBarTitle: 'Error',
    notFoundTitle: 'Screen not found',
    notFoundMessage: 'The URL may be old or incorrect.',
    openFailedTitle: 'Could not open the conversation',
    offlineTitle: 'You are offline',
    offlineMessage: 'You are not connected to the network. Check your connection, then reload the page.',
    reload: 'Reload',
    home: 'Back to sessions',
    back: 'Back',
    retryOpen: 'Open again',
  },
  zh: {
    renderTitle: '无法显示页面',
    renderMessage: '发生了意外问题，刷新后可能恢复正常。',
    notFoundBarTitle: '错误',
    notFoundTitle: '找不到页面',
    notFoundMessage: '链接可能已过期或输入有误。',
    openFailedTitle: '无法打开对话',
    offlineTitle: '当前离线',
    offlineMessage: '未连接到网络。请检查连接后刷新页面。',
    reload: '刷新',
    home: '返回会话列表',
    back: '返回',
    retryOpen: '重新打开',
  },
})

/**
 * Navigation chrome shared by every screen (web/src/app/shell/): the tab bar,
 * the back button and the connection banner.
 */
export const shellMessages = defineMessages({
  ja: {
    back: '戻る',
    homeTab: '一覧',
    searchTab: '検索',
    inboxTab: '対応待ち',
    settingsTab: '設定',
    mainNavigation: 'メインナビゲーション',
    inboxTabWithCount: (count: number) => `対応待ち ${count} 件`,
    reconnecting: '再接続中',
    staleWithoutTime: '保存済みのデータを表示しています',
    staleMinutes: (minutes: number) => `${minutes} 分前のデータを表示しています`,
    disconnected: 'DSH との接続が切れました',
    reconnect: '再接続',
    openFailed: '会話を開けませんでした。もう一度お試しください。',
  },
  en: {
    back: 'Back',
    homeTab: 'Sessions',
    searchTab: 'Search',
    inboxTab: 'Inbox',
    settingsTab: 'Settings',
    mainNavigation: 'Main navigation',
    inboxTabWithCount: (count: number) => count === 1 ? 'Inbox, 1 pending item' : `Inbox, ${count} pending items`,
    reconnecting: 'Reconnecting',
    staleWithoutTime: 'Showing saved data',
    staleMinutes: (minutes: number) => `Showing data from ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`,
    disconnected: 'Disconnected from DSH',
    reconnect: 'Reconnect',
    openFailed: 'Could not open the conversation. Try again.',
  },
  zh: {
    back: '返回',
    homeTab: '会话',
    searchTab: '搜索',
    inboxTab: '待处理',
    settingsTab: '设置',
    mainNavigation: '主导航',
    inboxTabWithCount: (count: number) => `待处理，${count} 项`,
    reconnecting: '正在重新连接',
    staleWithoutTime: '正在显示已保存的数据',
    staleMinutes: (minutes: number) => `正在显示 ${minutes} 分钟前的数据`,
    disconnected: '与 DSH 的连接已断开',
    reconnect: '重新连接',
    openFailed: '无法打开对话，请重试。',
  },
})

/** Sheets, dialogs, the snackbar and the text prompt (web/src/app/overlay/). */
export const overlayMessages = defineMessages({
  ja: {
    close: '閉じる',
    dialogLabel: '確認',
    sheetLabel: '操作',
    sheetHandle: 'シートの高さを変更',
    promptLabel: '名前',
    promptConfirm: 'OK',
    cancel: 'キャンセル',
    saveFailed: '保存できませんでした。もう一度お試しください。',
  },
  en: {
    close: 'Close',
    dialogLabel: 'Confirm',
    sheetLabel: 'Actions',
    sheetHandle: 'Resize the sheet',
    promptLabel: 'Name',
    promptConfirm: 'OK',
    cancel: 'Cancel',
    saveFailed: 'Could not save. Try again.',
  },
  zh: {
    close: '关闭',
    dialogLabel: '确认',
    sheetLabel: '操作列表',
    sheetHandle: '调整面板高度',
    promptLabel: '名称',
    promptConfirm: '确定',
    cancel: '取消',
    saveFailed: '无法保存，请重试。',
  },
})

/** Remote images are not rendered; the placeholder says what was there (web/src/app/Markdown.tsx). */
export const markdownMessages = defineMessages({
  ja: {
    image: '画像',
    imageNamed: (alt: string) => `画像：${alt}`,
  },
  en: {
    image: 'Image',
    imageNamed: (alt: string) => `Image: ${alt}`,
  },
  zh: {
    image: '图片',
    imageNamed: (alt: string) => `图片：${alt}`,
  },
})
