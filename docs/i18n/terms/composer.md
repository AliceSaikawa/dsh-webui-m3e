# 用語の対応表：入力欄

`web/src/features/composer/messages.ts` の英語・中国語（簡体字）の訳で選んだ用語です（Issue #78）。共通の用語と書き方は [glossary.md](../glossary.md) にあります。DSH 0.2.1-rc.2 の標準画面の辞書と照らしました。DSH は起動していません。

| 日本語 | 英語 | 中国語（簡体字） | DSH 標準画面の辞書のキー | メモ |
|---|---|---|---|---|
| セッション | session | 会话 | `placeholder.unavailable`（`dsh-client-ui-conversation`。英語 Session unavailable、中国語 会话不可用）、`stats.dialog.title`（`dsh-client-ui-chat`。中国語 会话统计） | 一致。会話（conversation／对话）とは別の語として使い分ける。M3E の「新しいセッション」は DSH のセッションの単位 |
| ワークスペース | workspace | 工作区 | `workspace.defaultName`（`dsh-client-locale`。中国語 默认工作区）、`hero.chooseWorkspace`（`dsh-client-ui-conversation`。中国語 选择工作区） | 一致 |
| 権限 | permission | 权限 | `label.permission`（`dsh-client-ui-commands`）、`title`（`dsh-client-ui-permission-presets`） | 一致。権限のプリセット名（読み取り専用など）は `presetDisplayName` が返すホストの値を訳さない |
| 既定 | Default | 默认 | なし（`dsh-client-locale` の `workspace.defaultName` は 默认工作区） | 権限と考える深さの既定値。DSH の単独のキーは見つからないため、`workspace.defaultName` の 默认 に合わせた。英語は `menu.effort` の周辺にも単独の Default はないが、`settings.links.newTab` の Default Browser と同じ語 |
| モデル | model | 模型 | `menu.model`（`dsh-client-ui-model-selection`。英語 Model、中国語 模型） | 一致。モデル名と提供元の名前は訳さない |
| 考える深さ | Reasoning effort | 推理等级 | `menu.effort`（`dsh-client-ui-model-selection`。英語 Effort、中国語 推理等级）、`trigger.ariaEffort`（英語 reasoning effort、中国語 推理等级） | 日本語は M3E の言い方（「推論の深さ」ではなく「考える深さ」）。英語と中国語は標準の画面の `reasoning effort`／`推理等级` に合わせた。選択肢（オフ・なし・最小・低・中・高・とても高い・最大）は M3E の値で、DSH の辞書に同じ並びはない |
| 順番待ち | Queue | 排队发送 | `settings.enter.queue`（`dsh-client-ui-conversation`。英語 Queue、中国語 排队发送）、`queue.count`（中国語 排队消息） | 状態の名詞は「順番待ち」、送り方の選択肢は DSH と同じく英語 Queue／中国語 排队发送。件数は `queue.count` の 排队消息 に合わせた |
| 割り込み | Steer | 插话发送 | `settings.enter.steer`（`dsh-client-ui-conversation`。英語 Steer、中国語 插话发送）、`queue.steer`（中国語 插话发送） | 実行中の会話に今のメッセージを差し込む送り方。状態は「割り込み待ち」／Steering／插话中 |
| 計画モード | Plan mode | 计划模式 | `description.plan`（`dsh-client-ui-commands`。英語 Enter or leave plan mode、中国語 进入或退出计划模式） | 一致 |
| コマンド | Commands | 指令 | `command.title`（`dsh-client-ui-chat`。英語 Command、中国語 指令）、`section.commands`（`dsh-client-ui-commands`。英語 Commands、中国語 指令） | 一致。スラッシュで始まる入力。M3E は「コマンド」だが、中国語は DSH の 指令 に合わせた |
| 入力の補助 | Composer options | 输入辅助 | なし | M3E のシートの題名。DSH の入力欄の説明は `input.commands`（英語 Add files or run commands、中国語 添加文件或调用指令）だが、M3E は画像・ファイル・コマンド・計画モードをまとめたシートなので短い独自の名前にした |
| 画像 | image | 图片 | `image.label`（`dsh-client-ui-conversation`。英語 Image、中国語 图片）、`image.remove`（中国語 移除图片） | 一致。`image.remove` の中国語は「移除图片 {name}」で、M3E の「〈名前〉を外す」も 移除 を使う |
| 添付画像 | Attached image | 附件图片 | なし | 画像の代替テキスト。DSH の `attachment.pending` は 待发送附件 |
| ファイルの候補 | File suggestions | 文件候选 | なし（`file.uploadFailed` などに 文件 の用例） | `@` で出す候補。DSH に入力欄の候補の名前はない |
| コマンドの候補 | Command suggestions | 指令候选 | なし | `/` で出す候補。コマンドと同じく 指令 |
| キャッシュ切れ | Cache expired | 缓存已过期 | `stats.cacheHit`（`dsh-client-ui-chat`。中国語 缓存命中） | DSH に「切れ」の文言はない。キャッシュの語は `stats.*` に合わせ、M3E で状態を表す文にした |
| 送信結果が不明 | Send result unknown | 发送结果未知 | なし | 送ったかどうか確かめられない状態。DSH の `message.turnError`（This turn failed／本轮运行失败）とは別 |
| ワークスペースへの登録 | Register with the workspace | 注册到工作区 | なし | 会話を作ったあとにワークスペースへ結び付ける処理。DSH の辞書に動詞の用例がないため、ワークスペース（工作区）と登録（注册）を組み合わせた |
| サブエージェント | subagent | 子智能体 | `message.stepProcess.subagents`（`dsh-client-ui-chat`。英語 Coordinating subagents、中国語 正在协调子智能体） | 一致 |
| 送信 | Send | 发送 | `input.send`（`dsh-client-ui-conversation`。英語 Send message、中国語 发送消息） | ボタンの短い言い方。中国語は `input.send` の 发送 |
| 実行を停止 | Stop the run | 停止运行 | `placeholder.parentOffline`（`dsh-client-ui-conversation`。英語 stop the run、中国語 停止当前运行） | DSH の入力欄のボタンは `input.stop` の Stop generating／停止生成 だが、M3E は生成だけでなく実行全体を止めるため、`placeholder.parentOffline` の stop the run に合わせた |
| もう一度送る | Send again | 重新发送 | なし（`dsh-client-locale` の `retry` は Retry／重试） | 送信のやり直し。DSH の Retry は操作全般のやり直しなので、送信に限定した M3E の言い方にした |
| もう一度読み込む | Reload | 重新加载 | `action.reload`（`dsh-client-ui-model-selection`） | 一致 |
