# 用語の対応表：設定

`web/src/features/settings/messages.ts` の設定の画面・項目・外観・モードの辞書 の英語・中国語（簡体字）の訳で選んだ用語です（Issue #78）。共通の用語と書き方は [glossary.md](../glossary.md) にあります。DSH 0.2.1-rc.2 の標準画面の辞書と照らしました。DSH は起動していません。

| 日本語 | 英語 | 中国語（簡体字） | DSH 標準画面の辞書のキー | メモ |
|---|---|---|---|---|
| モード | mode | 模式 | `guidePtcIntro` などの文中（`dsh-client-ui-agent-preset`） | エージェントの構成。設定の一覧の見出しは複数形 Modes／模式 |
| 組み込み | Built-in | 内置 | なし | この DSH にもとから入っているモード |
| カスタム | Custom | 自定义 | なし | この DSH で追加されたモード |
| 標準モード | Standard mode | 标准模式 | なし | 組み込みモードの名前。`settings.transcript.standard` の 標準 に合わせた |
| PTC モード | PTC mode | PTC 模式 | `guidePtcIntro`（`dsh-client-ui-agent-preset`） | 一致 |
| 最小モード | Minimal mode | 极简模式 | `guideMinimalIntro`（`dsh-client-ui-agent-preset`） | 中国語は 最小 ではなく 极简（既存の用語表と同じ） |
| Creator モード | Creator mode | 创造模式 | なし | 固有名詞 Creator は訳さない |
| サブエージェント | subagent | 子智能体 | なし | DSH の画面に用例がないため、M3E の言い方にそろえた |
| 設定を見る | View configuration | 查看配置 | なし | モードの設定を読むだけの画面への入口 |
| 権限 | Permission | 权限 | `title`（`dsh-client-ui-permission-presets`） | 一致 |
| 提供元 | provider | 提供方 | `menu.model` の周辺（`dsh-client-ui-conversation` の `detail.field.provider`） | 中国語は 提供商 ではなく 提供方（DSH の用例） |
| API キー | API key | API 密钥 | なし | DSH の設定画面の項目名。中国語は 密钥 |
| 既定のモデル | Default model | 默认模型 | なし | 新しい会話に使うモデル |
| 推論の強さ | Reasoning effort | 推理等级 | `menu.effort`（`dsh-client-ui-model-selection`） | 中国語は DSH の 推理等级 に合わせた |
| 接続先 | Endpoint | 接入地址 | なし | 提供元の base URL |
| 待機時間 | Timeout | 超时 | なし | 秒数の項目 |
| 出力の上限 | Output limit | 输出上限 | なし | バイト数の項目 |
| 応答の多様性 | Response variety | 回复多样性 | なし | temperature。DSH の画面には温度の項目がない |
| 動作モード | Mode | 运行模式 | なし | エージェントの動作の設定項目。モード（agent preset）と紛れないよう中国語は 运行模式 |
| 未設定 | Not set | 未设置 | なし | 値がない項目 |
| 有効／無効 | Enabled／Disabled | 启用／禁用 | なし | 真偽値の選択肢 |
| 登録済み／未登録 | Registered／Not registered | 已注册／未注册 | なし | API キーの登録状況 |
| 設定 | Settings | 设置 | `title`、`general.nav`（`dsh-client-ui-settings-general`） | 一致 |
| この端末 | This device | 此设备 | なし | 設定の「この端末」の節 |
| 今の画面に戻す | Return to the standard screen | 返回标准界面 | なし | M3E を閉じて DSH 標準の画面に戻す操作。設定の一覧と外観のシート、起動失敗の画面で同じ文にする |
| DSH の標準の画面 | the standard DSH screen | DSH 的标准界面 | なし | M3E に対して、DSH がもとから持つ画面。中国語は 标准界面 |
| プラグイン | Plugin | 插件 | `source.plugin`（`dsh-client-ui-trajectory`） | 一致 |
| この画面の版 | Version of this screen | 此界面的版本 | なし | M3E の版 |
| 外観 | Appearance | 外观 | `appearance.title`（`dsh-client-ui-theme`） | 一致 |
| 端末の設定に合わせる | Match device settings | 跟随系统 | `appearance.system`（`dsh-client-ui-theme`） | DSH の英語は System、中国語は 跟随系统。M3E の日本語は何に合わせるかを書いた |
| ライト／ダーク | Light／Dark | 浅色／深色 | `appearance.light`、`appearance.dark`（`dsh-client-ui-theme`） | 一致 |
| 画面の色 | Screen color | 界面颜色 | なし | M3E の配色の選択 |
| 紫（既定） | Purple (default) | 紫色（默认） | なし | 既定の色には (default)／（默认）を付ける。他の色は 青 Blue 蓝色、青緑 Teal 青绿色、緑 Green 绿色、橙 Orange 橙色、赤 Red 红色 |
| 既定値に戻す | Reset to default | 恢复默认值 | なし | 項目を既定に戻す操作 |
| 保存しました | Saved | 已保存 | なし | 保存の通知。M3E の言い方 |
| 保存しています… | Saving… | 正在保存… | なし | 保存中の状態 |
| 設定を読み込めませんでした。 | Could not load the settings. | 无法加载设置。 | なし | 設定の読み込みの失敗 |
| 設定を保存できませんでした。 | Could not save the settings. | 无法保存设置。 | なし | 設定の保存の失敗 |
