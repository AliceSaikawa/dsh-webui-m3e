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

/**
 * The "一般" section at the top of the settings tab: preferences the stock
 * screen keeps under Settings → General. Terms follow the stock dictionaries
 * (`dsh-client-ui-settings-general`); see docs/i18n/glossary.md.
 */
export const generalMessages = defineMessages({
  ja: {
    title: '一般',
    codingViewTitle: 'コーディングビューを表示',
    codingViewDescription: 'オフにすると、PTC モードと最小モードを選べなくなります。標準の画面では、トレースやコードの差分の表示も切り替わります。',
    transcriptViewTitle: '作業の詳細',
    transcriptViewDescription: 'ツール呼び出しをどこまで詳しく表示するかを選びます。標準の画面の表示に使われます。',
    transcriptCompact: '簡潔',
    transcriptStandard: '標準',
    transcriptDetailed: '詳細',
    transcriptVerbose: '完全に展開',
    collapseTimingTitle: '折りたたむタイミング',
    collapseTimingDescription: '作業の詳細を自動で折りたたむタイミングを選びます。標準の画面の表示に使われます。',
    collapseCompletion: '回答の完了時',
    collapseNextInput: '次のメッセージの送信時',
    performanceUsageTitle: 'パフォーマンスと使用状況',
    performanceUsageDescription: 'パフォーマンスと使用状況の情報をどこまで詳しく表示するかを選びます。標準の画面の表示に使われます。',
    performanceCompact: '簡潔',
    performanceDetailed: '詳細',
    languageTitle: '言語',
    languageDescription: 'DSH の言語設定で、標準の画面と共通です。「端末の言語に合わせる」を選ぶと、標準の画面は端末の言語が English か中文のときだけそれに合わせ、ほかの言語（日本語を含む）では English になります。M3E の画面は今のところ日本語で表示します。',
    languageDevice: '端末の言語に合わせる',
  },
  en: {
    title: 'General',
    codingViewTitle: 'Show coding view',
    codingViewDescription: 'When off, PTC mode and Minimal mode are hidden. The standard screen also hides the trajectory and code diffs.',
    transcriptViewTitle: 'Work details',
    transcriptViewDescription: 'Choose how much detail to show for tool calls. The standard screen uses this setting.',
    transcriptCompact: 'Compact',
    transcriptStandard: 'Standard',
    transcriptDetailed: 'Detailed',
    transcriptVerbose: 'Verbose',
    collapseTimingTitle: 'Collapse timing',
    collapseTimingDescription: 'Choose when to automatically collapse work details. The standard screen uses this setting.',
    collapseCompletion: 'On completion',
    collapseNextInput: 'On next message',
    performanceUsageTitle: 'Performance & usage',
    performanceUsageDescription: 'Choose how much performance and usage information to show. The standard screen uses this setting.',
    performanceCompact: 'Compact',
    performanceDetailed: 'Detailed',
    languageTitle: 'Language',
    languageDescription: 'The DSH language setting, shared with the standard screen. With "Match device language", the standard screen follows the device only for English or Chinese and uses English for any other language, Japanese included. This screen is shown in Japanese for now.',
    languageDevice: 'Match device language',
  },
  zh: {
    title: '通用设置',
    codingViewTitle: '显示代码工作视图',
    codingViewDescription: '关闭后，将隐藏 PTC 模式和极简模式。标准界面也会隐藏轨迹和代码差异。',
    transcriptViewTitle: '工作步骤展示',
    transcriptViewDescription: '选择希望看到多少工具调用细节。标准界面使用此设置。',
    transcriptCompact: '简洁',
    transcriptStandard: '标准',
    transcriptDetailed: '详细',
    transcriptVerbose: '完全展开',
    collapseTimingTitle: '工作步骤收起时机',
    collapseTimingDescription: '选择何时自动收起工作步骤。标准界面使用此设置。',
    collapseCompletion: '回答结束后',
    collapseNextInput: '下次有新消息时',
    performanceUsageTitle: '性能与用量',
    performanceUsageDescription: '选择性能与用量信息展示的详细程度。标准界面使用此设置。',
    performanceCompact: '简洁',
    performanceDetailed: '详细',
    languageTitle: '语言',
    languageDescription: 'DSH 的语言设置，与标准界面共用。选择“跟随设备语言”时，标准界面仅在设备语言为英文或中文时跟随，其他语言（包括日语）则使用英文。此界面目前仅以日语显示。',
    languageDevice: '跟随设备语言',
  },
})

export type GeneralTexts = typeof generalMessages.ja
