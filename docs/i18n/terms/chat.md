# 用語の対応表：チャット

`web/src/features/chat/messages.ts` の `chatMessages`・`attachmentMessages`・`toolDetailMessages` の英語・中国語（簡体字）の訳で選んだ用語です（Issue #78）。共通の用語と書き方は [glossary.md](../glossary.md) にあります。DSH 0.2.1-rc.2 の標準画面の辞書と照らしました。DSH は起動していません。

| 日本語 | 英語 | 中国語（簡体字） | DSH 標準画面の辞書のキー | メモ |
|---|---|---|---|---|
| チャット | Chat | 对话 | `view.chat`（`dsh-client-ui-chat`） | タブと画面の名。一致 |
| 考えた内容 | Thoughts | 思考内容 | なし（`message.think` は 思考／Think） | 推論ブロックの見出し。DSH に同じ見出しがないので M3E の言い方にした |
| 実行中 | Running | 运行中 | `row.running`（`dsh-client-ui-chat`） | 一致 |
| 失敗 | Failed | 失败 | `row.failed`（`dsh-client-ui-chat`） | 一致 |
| 完了 | Completed | 已完成 | `message.turnProcess.worked`・`command.done` | 一致 |
| ツール | Tool | 工具 | なし（`message.toolAdded` の {name}） | ツール名が届かないときの代わりの名前 |
| ツール呼び出し | Tool call | 工具调用 | なし | 結果ブロックの種類の名 |
| ツール呼び出しの詳細 | Tool call details | 工具调用详情 | なし（`detail.aria` は Approval details／审批详情） | シートの題名 |
| 引数 | Arguments | 参数 | `row.commandArguments`（Command arguments／命令参数） | ツールの引数の見出し |
| 結果 | Result | 结果 | `detail.field.result`・`body.output` | 一致 |
| 所要時間 | Duration | 用时 | `stats.dialog.toolTime`（Tool time／工具调用用时） | ツールのシートの見出し |
| ミリ秒／秒／分 | ms／s／min | 毫秒／秒／分 | `duration.milliseconds`・`duration.secondUnit`・`duration.minuteUnit` | 単位は辞書に置き、数は `formatNumber(…, { useGrouping: false })` |
| バイト | bytes | 字节 | `row.imageSize`（{bytes} bytes／{bytes} 字节） | 添付の大きさ。KB・MB は訳さない |
| 添付画像 | Attached image | 附件图片 | `image.dialog`（Image preview／图片预览） | 名前のない画像の代わりの名前 |
| 添付ファイル | Attached file | 附件文件 | なし | 名前のないファイルの代わりの名前。表示するときの言語で選ぶ |
| 画像を拡大 | Enlarge image | 放大图片 | `image.open`（View full image／查看大图） | 押すと全画面になるボタン。DSH は「大図（大图）」なので 放大 に寄せた |
| 画像を読み込めませんでした。 | Could not load the image. | 无法加载图片。 | `image.failed`（Image preview unavailable／图片无法预览） | 失敗の文 |
| 再読み込み | Retry | 重试 | `retry`（`dsh-client-locale`） | 一致（DSH は Retry／重试） |
| 画像を読み込んでいます… | Loading the image… | 正在加载图片… | `image.loading`（Loading image…／加载图片…） | ほぼ一致 |
| システムプロンプト | System prompt | 系统提示词 | `message.systemPrompt`（`dsh-client-ui-chat`） | 一致 |
| 追加された文脈 | Added context | 已添加的上下文 | `message.contextInjection`（Context injection／上下文注入） | DSH は「注入」だが、M3E の日本語に合わせて 添加 にした |
| 別の会話から参照 | Referenced from another conversation | 来自其他对话的引用 | なし | M3E の想起（recall）の見出し |
| 前のメッセージを読み込む | Load earlier messages | 加载更早的消息 | `chat.loadOlder`（Load earlier／加载更早） | DSH は「earlier」だけ。M3E は対象を明示 |
| 会話を読み込んでいます… | Loading the conversation… | 正在载入对话… | `chat.loadingHistory`（Loading history…／载入历史…） | 中国語の 载入 は DSH に合わせた |
| 何をしますか | What would you like to do? | 要做点什么？ | なし | 空の画面の見出し |
| 最新へ | Go to latest | 回到底部 | `chat.toBottom`（Back to bottom／回到底部） | 日本語は M3E の言い方、中国語は DSH のまま |
| AI のメッセージ | AI message | AI 消息 | なし | 読み上げ用の名。短く保つ |
| 自分のメッセージ | Your message | 你的消息 | なし | 読み上げ用の名。短く保つ |
| 送信中のメッセージ | Sending message | 发送中的消息 | `queue.sending`（Sending…／发送中…） | 読み上げ用の名 |
| コマンド | Command | 指令 | `command.title`（Command／指令） | コマンド名が届かないときは、各言語の文の中でこの語を使う（英語 Command failed、中国語 指令执行失败） |
| コマンド入力 | Command input | 指令输入 | `input.send` の並び（`dsh-client-ui-conversation`） | 読み上げ用の名 |
| エラー種別 | Error type | 错误类型 | なし | ツールの失敗の見出し |
| エラーコード | Error code | 错误代码 | なし | ツールの失敗の見出し |
| 続きを表示 | Show more | 显示更多 | `expand`（Expand／展开） | 切った結果を開くボタン |
