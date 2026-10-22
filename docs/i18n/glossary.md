# 用語の対応表

画面の文言を英語・中国語（簡体字）に訳すときの用語をそろえる表です（Issue #78、[docs/design/11-i18n.md](../design/11-i18n.md)）。DSH 標準画面の辞書（`@deepseek-ai/dsh-client-locale` と各 `dsh-client-ui-*` の英語・中国語の辞書）にある語は、それに合わせます。DSH にない語は「DSH のキー」の欄に「なし」と書き、訳した理由をメモに残します。訳を足す PR では、この表に新しい用語を足します。

DSH 0.2.1-rc.2 のパッケージを読んで確かめました。DSH は起動していません。

| 日本語 | 英語 | 中国語（簡体字） | DSH 標準画面の辞書のキー | メモ |
|---|---|---|---|---|
| コピー | Copy | 复制 | `copy`（`dsh-client-locale`） | 一致 |
| コピーしました。 | Copied. | 复制成功。 | `copied`（`dsh-client-locale`） | 共通のキー `copied` に合わせた。個別の画面（`dsh-client-ui-workspace` など）には 已复制 もある。文末の句点は M3E の文の書き方に合わせて足した |
| 閉じる | Close | 关闭 | `close`（`dsh-client-locale`） | 一致 |
| 今の画面に戻す | Return to the standard screen | 返回标准界面 | なし | M3E を閉じて DSH の標準の画面に戻す操作。設定の行と起動失敗の画面で使う。共通の部品・会話・DSH のエラーのほかの語は [terms/shell.md](terms/shell.md) |
| 標準の画面 | the standard screen | 标准界面 | なし | DSH の標準の Web 画面 |
| 一覧（タブ） | Sessions | 会话 | なし | 下端のタブ。中身はセッションの一覧なので session の語にした |
| 実行中 | Running | 运行中 | なし | 会話やジョブの状態 |
| Host | Host | 主机 | `presented.hostError`（`dsh-client-ui-deliverables`） | DSH の Host。英語は訳さず Host |
| 読み取りのみ | Read Only | 仅可查看 | `preset.readOnly`（`dsh-client-ui-permission-presets`） | 権限プリセットの名前。一致 |
| ワークスペース書込 | Workspace Write | 工作区内修改 | `preset.workspaceWrite`（同上） | 一致 |
| フル アクセス | Full access | 完全权限 | `preset.fullAccess`（同上） | 一致 |
| 自動レビュー（実験的） | Auto review (experimental) | 自动审查（实验性） | `auto.label`（同上。Auto review／自动审查） | 日本語の名前にある「実験的」を訳にも入れた |
| ここから分岐 | Branch from here | 从这里分支 | `message.branch`（`dsh-client-ui-chat`。英語は "Branch into a new conversation"、中国語は 在新对话中分支） | 語（branch／分支）は一致。DSH は長い説明の文、M3E はボタンの短い言い方にした。ワークスペースの画面には fork／分叉会话（`menu.fork`）もあるが、チャットの `message.branch` に合わせた |
| 会話 | conversation | 对话 | `message.branch` の文中（`dsh-client-ui-chat`。英語 conversation、中国語 在新对话中分支） | DSH の中国語には 会话（session に当たる語として多数）と 对话 の両方がある。チャットの画面は 对话 なので、チャットの文言は 对话 にそろえた |
| メッセージ | message | 消息 | なし（`dsh-client-ui-chat` に「条消息」の用例が 3 か所） | 中国語は「消息」 |
| メッセージの操作 | Message actions | 消息操作 | なし | シートの題名。M3E の言い方 |
| テキストを選択 | Select text | 选择文本 | なし | M3E の新しい操作。「選択」は DSH の「选择」に合わせた |
| 分岐 | branch | 分支 | `message.branch` | 名詞。動詞は「分岐する／branch／分支」 |
| 一般 | General | 通用设置 | `general.nav`（`dsh-client-ui-settings-general`） | 設定の見出し |
| コーディングビューを表示 | Show coding view | 显示代码工作视图 | `developerTools.title`（`dsh-client-ui-settings-general`） | 一致 |
| トレース | trajectory | 轨迹 | `developerTools.description`（`dsh-client-ui-settings-general`） | DSH の英語は trajectory、中国語は 轨迹 |
| コードの差分 | code diffs | 代码差异 | 同上 | 一致 |
| PTC モード | PTC mode | PTC 模式 | `guidePtcIntro`（`dsh-client-ui-agent-preset`。中国語は「PTC 模式」） | 一致 |
| 最小モード | Minimal mode | 极简模式 | `guideMinimalIntro`（`dsh-client-ui-agent-preset`。中国語は「极简模式」） | 一致。DSH の中国語は 最小 ではなく 极简 |
| 作業の詳細 | Work details | 工作步骤展示 | `settings.transcript.title`（`dsh-client-ui-chat`） | 一致 |
| 簡潔 | Compact | 简洁 | `settings.transcript.compact`、`settings.performance.compact` | 一致 |
| 標準 | Standard | 标准 | `settings.transcript.standard` | 一致 |
| 詳細 | Detailed | 详细 | `settings.transcript.detailed`、`settings.performance.detailed` | 一致 |
| 完全に展開 | Verbose | 完全展开 | `settings.transcript.verbose` | 英語は Verbose（「詳細」と別） |
| 折りたたむタイミング | Collapse timing | 工作步骤收起时机 | `settings.collapse.title`（英語は When to Collapse Work Details） | 標準の画面の題は「作業の詳細を折りたたむタイミング」に当たるが、フォームの題は 1 行で切れるため（幅 320px で日本語の全文は 198px、使える幅は 185px）、日本語と英語は短くした。中国語は DSH のままで収まる。何を折りたたむかは説明文に書いた |
| 回答の完了時 | On completion | 回答结束后 | `settings.collapse.completion` | 一致 |
| 次のメッセージの送信時 | On next message | 下次有新消息时 | `settings.collapse.nextInput` | 一致 |
| パフォーマンスと使用状況 | Performance & usage | 性能与用量 | `settings.performance.title` | 一致 |
| 言語 | Language | 语言 | `language.title`（`dsh-client-locale`） | 一致 |
| 端末の言語に合わせる | Match device language | 跟随设备语言 | なし | M3E の選択肢（依頼で決めた名前）。標準の画面は保存値がなければ、ブラウザの言語が英語か中国語のときだけそれに従い、ほかは英語になる。選択肢としては出さない。中国語の 跟随 は DSH の他の画面にある「跟随系统」（外観）に合わせた |
| English／中文 | English／中文 | English／中文 | `BUILT_IN_LOCALE_METADATA`（`dsh-client-locale`） | 言語名は各言語の自称で、訳さない |

## 書き方

- 引用符は、日本語は「」、英語と中国語は `“”` にそろえます。DSH の辞書では、中国語は `“”` と「」が、英語は `“”` と直引用符が混在しています。M3E は一番近い `dsh-client-ui-chat` の中国語（例：`点击“退出登录”`）に合わせて `“”` にしました。
- 中国語で「押す」は `点击` を使います（DSH にある語。`点按` は DSH のどこにもないので使いません）。
- 値や固有名詞（モデル名、ファイル名、ホストから届く文）は訳しません。
