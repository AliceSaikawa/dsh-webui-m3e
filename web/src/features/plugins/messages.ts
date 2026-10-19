import { defineMessages } from '../../i18n/catalog.ts'

/**
 * Texts for the read-only plugin list (web/src/features/plugins). Japanese is
 * the source; English and Chinese are added by the translation PRs
 * (docs/design/11-i18n.md). Values from the Host are never translated.
 */
export const pluginMessages = defineMessages({
  ja: {
    title: 'プラグイン',
    loading: 'プラグインの一覧を読み込んでいます…',
    unavailable: 'この Host ではプラグインの一覧を取得できません。',
    loadFailed: '一覧を読み込めませんでした。',
    retry: 'もう一度読み込む',
    refresh: '読み直す',
    listLabel: 'プラグイン一覧',
    reloadNote: 'コマンドや設定ファイルでの変更は、自動では反映されません。読み直してください。',
    failedSection: '読み込みに失敗したプラグイン',
    activeSection: '稼働中',
    disabledSection: '無効',
    otherSection: 'その他',
    bundlesSection: 'バンドル',
    failedReasonNote: '失敗の理由は DSH から取得できません。標準の画面かログで確認してください。',
    metaErrorNote: '表示用の情報に問題があります',
    versionLabel: '版',
    installedLabel: 'インストール済み',
    bundledLabel: '同梱',
    enabledLabel: '有効',
    disabledLabel: '無効',
    phaseActive: '稼働中',
    phaseLoading: '読み込み中',
    phasePending: '待機中',
    phaseUnloading: '停止中',
    phaseFailed: '読み込みに失敗',
    phaseDisabled: '無効',
    phaseNotStarted: '未起動',
    incompatiblePackages: (name: string, version: string, peers: string) => `${name}@${version} は ${peers} を必要とします`,
    errorManagementRequired: 'この Host では管理できません',
    errorUnaddressable: 'この Host では管理できません',
    errorUnknownPlugin: '見つからないプラグインです',
    errorInvalidSpec: 'プラグインの指定が正しくありません',
    errorAmbiguousInstall: 'インストール先を特定できません',
    errorNotBundle: 'バンドルではありません',
    errorNotRemovable: 'このバンドルは外せません',
    errorStopProfile: '停止中のプロファイルでは操作できません',
    errorBundleInUse: '使用中のバンドルです',
    errorStaleApproval: '承認の情報が古くなっています',
    errorIncompatibleVersion: 'この DSH の版に対応していません',
    errorOperationError: '操作に失敗しました',
  },
  en: null,
  zh: null,
})

/** The Japanese source shape; the model reads its labels through this type. */
export type PluginTexts = typeof pluginMessages.ja
