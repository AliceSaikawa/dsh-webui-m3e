# 用語の対応表：設定の提供元と API キー・モデル

`web/src/features/settings/messages.ts` の `providerMessages`・`modelMessages`・`customProviderMessages` の英語・中国語（簡体字）の訳で選んだ用語です（Issue #78）。共通の用語と書き方は [glossary.md](../glossary.md) にあります。DSH 0.2.1-rc.2 の標準画面の辞書と照らしました。DSH は起動していません。

| 日本語 | 英語 | 中国語（簡体字） | DSH 標準画面の辞書のキー | メモ |
|---|---|---|---|---|
| 提供元 | provider | 提供方 | なし | DSH の辞書は provider=提供方。既存の設定画面でも同じ語を使う |
| 提供元と登録状況 | Providers and API keys | 提供方与 API 密钥 | なし | 提供元タブの一覧の見出し |
| 登録状況 | registration status / key status | 注册状态 | なし | キーの登録状況。中国語は「注册状态」で統一 |
| API キー | API key | API 密钥 | `api key`（dsh-dictionary.tsv） | 値を訳さない |
| API キー：登録済み | API key: registered | API 密钥：已注册 | なし | 一覧の行の状態。中国語は全角コロン |
| API キー：未登録 | API key: not registered | API 密钥：未注册 | なし | 同上 |
| API キー：未設定 | API key: not set | API 密钥：未设置 | なし | 参照名だけ設定されている行 |
| キーは不要 | No key needed | 无需密钥 | なし | 端末の認証を使う提供元 |
| 登録状況を確認できません | Key status cannot be checked | 无法确认注册状态 | なし | 照会が拒否・不正応答のとき |
| （変更できません） | (cannot be changed) | （无法更改） | なし | 状態のあとに付ける読み取り専用の注記 |
| 登録を消す | Remove registration | 移除注册 | `remove`（dsh-dictionary.tsv） | API キーの登録を消す操作 |
| キーの参照先 | key reference | 密钥引用名称 | なし | 設定に書く環境変数の名前。参照名とも呼ぶ |
| カスタムプロバイダー | custom provider | 自定义提供方 | なし | 中国語は「自定义」+提供方 |
| プロバイダー ID | provider ID | 提供方 ID | なし | 英字と数字の識別子。値を訳さない |
| ベース URL | base URL | 接入地址 | なし | 中国語は Host の画面と同じ「接入地址」 |
| API プロトコル | API protocol | API 协议 | なし | 選択肢の値（openai-completions など）は訳さない |
| OpenAI チャット補完 | OpenAI chat completions | OpenAI 对话补全 | なし | プロトコル名の表示だけを訳す（値は `openai-completions`） |
| OpenAI 応答 | OpenAI responses | OpenAI 响应 | なし | 同上（値は `openai-responses`） |
| Anthropic メッセージ | Anthropic messages | Anthropic 消息 | なし | 同上（値は `anthropic-messages`） |
| モデル | model | 模型 | `model`（dsh-dictionary.tsv） | モデル名（deepseek-v4 など）は値なので訳さない |
| モデル一覧 | model list | 模型列表 | なし | 呼び出し先から取得した選択肢の一覧 |
| 一覧にないモデル | Model not in the list | 不在列表中的模型 | なし | 保存済みの値が一覧にないとき |
| 推論の強さ | reasoning effort | 推理等级 | `reasoning`（dsh-dictionary.tsv） | Host の reasoningEffort の表示名 |
| 既定（モデルに任せる） | Default (let the model decide) | 默认（由模型决定） | なし | 推論の強さを指定しない選択肢 |
| 既定値に戻す | Reset to default | 恢复默认值 | なし | 設定の上書きを消す操作 |
| すぐ反映されます | Applied immediately | 立即生效 | なし | 変更が即時に効く設定の注記 |
| 使わせてよいモデル | Allowed models | 可使用的模型 | なし | サブエージェントに許すモデルの一覧 |
| サブエージェント | subagent | 子智能体 | `subagent`（dsh-dictionary.tsv） | 既存の設定画面と同じ語 |
| 詳細 | Details | 详情 | なし | モデルごとの折りたたみ |
| コンテキスト長 | Context length | 上下文长度 | なし | モデルの設定値 |
| 最大出力トークン数 | Max output tokens | 最大输出 token 数 | なし | モデルの設定値。DSH の辞書は token をカタカナ・ラテン文字のまま書く（`Output token limit`＝已达到输出 token 上限） |
| 入力種別 | Input types | 输入类型 | なし | テキストと画像 |
