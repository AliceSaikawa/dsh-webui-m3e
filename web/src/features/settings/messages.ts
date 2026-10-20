import { defineMessages } from '../../i18n/catalog.ts'

/**
 * Texts for the read-only mode roster (Issue #123). Japanese is the source;
 * English and Chinese are added by the translation PRs (docs/design/11-i18n.md).
 * Japanese copy for the shipped presets is M3E's own because the stock client
 * carries only English and Chinese for them.
 */
export const agentPresetMessages = defineMessages({
  ja: {
    title: 'モード',
    intro: '会話を始めるときのエージェントの構成を選びます。組み込みのモードと、この DSH で追加されたモードがあります。',
    builtInGroup: '組み込み',
    customGroup: 'カスタム',
    setDefault: '新しい会話の既定にする',
    inUse: '新しい会話の既定',
    brokenBadge: '読み込めません',
    view: '設定を見る',
    close: '閉じる',
    noDescription: '説明はありません。',
    empty: '選べるモードがありません。',
    missingDefault: '既定のモードが見つかりません',
    loading: 'モードの一覧を読み込んでいます…',
    unavailable: 'この DSH ではモードの一覧を取得できません。',
    loadFailed: 'モードの一覧を読み込めませんでした。',
    retry: 'もう一度読み込む',
    refresh: '読み直す',
    summaryLoading: '読み込み中…',
    summaryUnavailable: 'この DSH では利用できません',
    summaryError: 'モードを確認できません',
    readonly: 'この DSH では既定のモードを変更できません。設定の内容は確認できます。',
    saveFailed: '新しい会話の既定を変更できませんでした。',
    saving: '変更しています…',
    standardUnavailable: 'コード作業がオフのため既定のモードを標準モードに戻す必要がありますが、標準モードを使えません。既定は変更していません。',
    configTitle: (name: string) => `${name} の設定`,
    configLoading: '設定を読み込んでいます…',
    configFailed: '設定を読み込めませんでした。',
    standardName: '標準モード',
    standardDescription: 'コード、ファイル、資料を扱います。検索、編集、ターミナルなどのツールを必要に応じて使う、ほとんどの作業に向いたモードです。',
    ptcName: 'PTC モード',
    ptcDescription: '標準モードの機能をすべて含みます。ツールをまとめて呼び出し、結果を絞り込み・整理・重複の除去・集計・要約する作業に向いています。',
    minimalName: '最小モード',
    minimalDescription: 'ターミナルのツールだけを使って作業します。基本的な性能を確かめたり比べたりするのに使えます。',
    cordisName: 'Creator モード',
    cordisDescription: '会話を通じて DSH をカスタマイズします。機能や画面を追加するプラグインを書いたり、ツールとプロンプトを組み合わせて独自のモードを作ったりできます。',
  },
  en: null,
  zh: null,
})

export type AgentPresetTexts = typeof agentPresetMessages.ja
