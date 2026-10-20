# 用語の対応表

画面の文言を英語・中国語（簡体字）に訳すときの用語をそろえる表です（Issue #78、[docs/design/11-i18n.md](../design/11-i18n.md)）。DSH 標準画面の辞書（`@deepseek-ai/dsh-client-locale` と各 `dsh-client-ui-*` の英語・中国語の辞書）にある語は、それに合わせます。DSH にない語は「DSH のキー」の欄に「なし」と書き、訳した理由をメモに残します。訳を足す PR では、この表に新しい用語を足します。

DSH 0.2.1-rc.2 のパッケージを読んで確かめました。DSH は起動していません。

| 日本語 | 英語 | 中国語（簡体字） | DSH 標準画面の辞書のキー | メモ |
|---|---|---|---|---|
| コピー | Copy | 复制 | `copy`（`dsh-client-locale`） | 一致 |
| コピーしました。 | Copied. | 复制成功。 | `copied`（`dsh-client-locale`） | 共通のキー `copied` に合わせた。個別の画面（`dsh-client-ui-workspace` など）には 已复制 もある。文末の句点は M3E の文の書き方に合わせて足した |
| 閉じる | Close | 关闭 | `close`（`dsh-client-locale`） | 一致 |
| ここから分岐 | Branch from here | 从这里分支 | `message.branch`（`dsh-client-ui-chat`。英語は "Branch into a new conversation"、中国語は 在新对话中分支） | 語（branch／分支）は一致。DSH は長い説明の文、M3E はボタンの短い言い方にした。ワークスペースの画面には fork／分叉会话（`menu.fork`）もあるが、チャットの `message.branch` に合わせた |
| 会話 | conversation | 对话 | `message.branch` の文中（`dsh-client-ui-chat`。英語 conversation、中国語 在新对话中分支） | DSH の中国語には 会话（session に当たる語として多数）と 对话 の両方がある。チャットの画面は 对话 なので、チャットの文言は 对话 にそろえた |
| メッセージ | message | 消息 | なし（`dsh-client-ui-chat` に「条消息」の用例が 3 か所） | 中国語は「消息」 |
| メッセージの操作 | Message actions | 消息操作 | なし | シートの題名。M3E の言い方 |
| テキストを選択 | Select text | 选择文本 | なし | M3E の新しい操作。「選択」は DSH の「选择」に合わせた |
| 分岐 | branch | 分支 | `message.branch` | 名詞。動詞は「分岐する／branch／分支」 |

## 書き方

- 引用符は、日本語は「」、英語と中国語は `“”` にそろえます。DSH の辞書では、中国語は `“”` と「」が、英語は `“”` と直引用符が混在しています。M3E は一番近い `dsh-client-ui-chat` の中国語（例：`点击“退出登录”`）に合わせて `“”` にしました。
- 中国語で「押す」は `点击` を使います（DSH にある語。`点按` は DSH のどこにもないので使いません）。
- 値や固有名詞（モデル名、ファイル名、ホストから届く文）は訳しません。
