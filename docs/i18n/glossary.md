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
| セッション | session | 会话 | `menu.archiveSession`（`dsh-client-ui-workspace`）ほか多数 | 一致。会話（conversation／对话）とは別の語。一覧（ホーム）とワークスペースのほかの語は [terms/home.md](terms/home.md) |
| ワークスペース | workspace | 工作区 | `workspace.add`、`rename.workspace.title`（`dsh-client-ui-workspace`） | 一致 |
| フォルダ | folder | 文件夹 | `browser.newFolder`、`browser.folderName`（`dsh-client-ui-directory-picker-browse`） | 一致。directory は訳さない |
| ピン留め／ピン留めを外す | Pin／Unpin | 置顶／取消置顶 | `menu.pinSession`、`menu.unpinSession`（`dsh-client-ui-workspace`） | 一致 |
| アーカイブ／アーカイブを戻す | Archive／Unarchive | 归档／取消归档 | `menu.archiveSession`、`menu.unarchiveSession`（`dsh-client-ui-workspace`） | 一致 |
| 名前を変える | Rename | 重命名 | `rename`（`dsh-client-ui-workspace`） | 一致 |
| 登録を解除 | Remove | 移除 | `delete.workspace`（`dsh-client-ui-workspace`。Delete workspace／删除工作区） | フォルダは消さないので Remove／移除 にした |
| 並べ替え | Reorder | 调整顺序 | なし | 名詞。ドラッグの説明も同じ語 |
| 操作を終了 | Done | 退出操作 | なし | 選択や並べ替えを終えて一覧に戻るボタン。英語は選択に限らない Done |
| メッセージ | message | 消息 | なし（`dsh-client-ui-chat` に「条消息」の用例が 3 か所） | 中国語は「消息」 |
| メッセージの操作 | Message actions | 消息操作 | なし | シートの題名。M3E の言い方 |
| テキストを選択 | Select text | 选择文本 | なし | M3E の新しい操作。「選択」は DSH の「选择」に合わせた |
| 分岐 | branch | 分支 | `message.branch` | 名詞。動詞は「分岐する／branch／分支」 |
| 一般 | General | 通用设置 | `general.nav`（`dsh-client-ui-settings-general`） | 設定の見出し |
| コーディングビューを表示 | Show coding view | 显示代码工作视图 | `developerTools.title`（`dsh-client-ui-settings-general`） | 一致 |
| トレース | trajectory | 轨迹 | `developerTools.description`（`dsh-client-ui-settings-general`） | DSH の英語は trajectory、中国語は 轨迹 |
| コードの差分 | code diffs | 代码差异 | 同上 | 一致 |
| 統計 | Statistics | 统计 | `stats.dialog.title`（`dsh-client-ui-chat`。Session statistics／会话统计） | セッションメニューの項目。セッションツールとトレースのほかの語は [terms/session-tools-trace.md](terms/session-tools-trace.md) |
| キャッシュヒット率 | Cache hit rate | 缓存命中率 | `stats.cacheHit`（`dsh-client-ui-chat`） | 一致 |
| トークン | token / tokens | token | `stats.dialog.usageTitle`（`dsh-client-ui-chat`。Token 用量） | 中国語は DSH と同じく訳さない |
| ジョブ | job | 任务 | `count.idle.other`（`dsh-client-ui-jobs`。background jobs／后台任务） | 種別の分からないジョブも Job／任务 と出す |
| ゴール | goal | 目标 | `token.goal`（`dsh-client-ui-commands`） | 一致 |
| 行き詰まり | Blocked | 受阻 | `phase.blocked`（`dsh-client-ui-goal`。Blocked Goal／受阻的目标） | ゴールの状態。DSH に合わせた |
| 子の会話 | child conversation | 子对话 | なし（`tree.aria` は Subagent sessions／子智能体会话） | サブエージェントの子セッション。ホームの行の補足では subagent／子智能体 と書く |
| ターン | turn | 轮 | `turn.label`（`dsh-client-ui-trajectory`） | 一致 |
| 記録（トレース） | record | 记录 | なし | トレースの 1 行 |
| 所要時間（トレース） | Duration | 时长 | `timing.duration`（`dsh-client-ui-trajectory`） | トレースは DSH のトレースの画面の 时长 に合わせた |
| 添付 | attachment | 附件 | `attachment.list`（`dsh-client-ui-trajectory`） | 一致 |
| PTC モード | PTC mode | PTC 模式 | `guidePtcIntro`（`dsh-client-ui-agent-preset`。中国語は「PTC 模式」） | 一致 |
| 最小モード | Minimal mode | 极简模式 | `guideMinimalIntro`（`dsh-client-ui-agent-preset`。中国語は「极简模式」） | 一致。DSH の中国語は 最小 ではなく 极简 |
| モデル | model | 模型 | `menu.model`（`dsh-client-ui-model-selection`） | 一致。モデル名と提供元の名前は訳さない。入力欄のほかの語は [terms/composer.md](terms/composer.md) |
| 権限 | permission | 权限 | `label.permission`（`dsh-client-ui-commands`）、`title`（`dsh-client-ui-permission-presets`） | 一致 |
| サブエージェント | subagent | 子智能体 | `message.stepProcess.subagents`（`dsh-client-ui-chat`） | 一致 |
| 既定 | Default | 默认 | なし | 権限や考える深さの既定値 |
| 考える深さ | Reasoning effort | 推理等级 | `menu.effort`（`dsh-client-ui-model-selection`） | 入力欄の言い方。設定では「推論の強さ」と書く |
| 順番待ち | Queue | 排队发送 | `settings.enter.queue`（`dsh-client-ui-conversation`） | 一致 |
| 割り込み | Steer | 插话发送 | `settings.enter.steer`（`dsh-client-ui-conversation`） | 実行中の会話に今のメッセージを差し込む送り方 |
| 計画モード | Plan mode | 计划模式 | `description.plan`（`dsh-client-ui-commands`） | 一致 |
| 画像 | image | 图片 | `image.label`（`dsh-client-ui-conversation`） | 一致 |
| 送信 | Send | 发送 | `input.send`（`dsh-client-ui-conversation`） | ボタンの短い言い方 |
| 実行を停止 | Stop the run | 停止运行 | `placeholder.parentOffline`（`dsh-client-ui-conversation`） | 実行中の会話を止めるボタン |
| 作業の詳細 | Work details | 工作步骤展示 | `settings.transcript.title`（`dsh-client-ui-chat`） | 一致 |
| 簡潔 | Compact | 简洁 | `settings.transcript.compact`、`settings.performance.compact` | 一致 |
| 標準 | Standard | 标准 | `settings.transcript.standard` | 一致 |
| 詳細 | Detailed | 详细 | `settings.transcript.detailed`、`settings.performance.detailed` | 一致 |
| 完全に展開 | Verbose | 完全展开 | `settings.transcript.verbose` | 英語は Verbose（「詳細」と別） |
| 折りたたむタイミング | Collapse timing | 工作步骤收起时机 | `settings.collapse.title`（英語は When to Collapse Work Details） | 標準の画面の題は「作業の詳細を折りたたむタイミング」に当たるが、フォームの題は 1 行で切れるため（幅 320px で日本語の全文は 198px、使える幅は 185px）、日本語と英語は短くした。中国語は DSH のままで収まる。何を折りたたむかは説明文に書いた |
| 回答の完了時 | On completion | 回答结束后 | `settings.collapse.completion` | 一致 |
| 次のメッセージの送信時 | On next message | 下次有新消息时 | `settings.collapse.nextInput` | 一致 |
| パフォーマンスと使用状況 | Performance & usage | 性能与用量 | `settings.performance.title` | 一致 |
| 設定 | Settings | 设置 | `title`（`dsh-client-ui-settings-general`） | 一致。設定のほかの語は [terms/settings.md](terms/settings.md) |
| モード | mode | 模式 | `guidePtcIntro` などの文中（`dsh-client-ui-agent-preset`） | エージェントの構成。設定の一覧の見出しは Modes／模式 |
| 提供元 | provider | 提供方 | `detail.field.provider`（`dsh-client-ui-conversation`） | 中国語は 提供商 ではなく DSH の 提供方 |
| API キー | API key | API 密钥 | なし | 中国語は 密钥 |
| 推論の強さ | Reasoning effort | 推理等级 | `menu.effort`（`dsh-client-ui-model-selection`） | 中国語は DSH に合わせた。DSH の英語は Effort |
| 未設定 | Not set | 未设置 | なし | 値がない項目 |
| 有効／無効 | Enabled／Disabled | 启用／禁用 | なし | 真偽値の選択肢 |
| 登録済み／未登録 | Registered／Not registered | 已注册／未注册 | なし | API キーの登録状況 |
| 既定値に戻す | Reset to default | 恢复默认值 | なし | 項目を既定に戻す操作 |
| 外観 | Appearance | 外观 | `appearance.title`（`dsh-client-ui-theme`） | 一致 |
| カスタムプロバイダー | custom provider | 自定义提供方 | なし | 設定で足した提供元。設定の提供元と API キー・モデルのほかの語は [terms/settings-providers.md](terms/settings-providers.md) |
| 登録状況 | registration status | 注册状态 | なし | API キーの登録状況 |
| 登録を消す | Remove registration | 移除注册 | なし | API キーの登録を外す操作。提供元とキーの結び付きを外す操作なので、中国語は 删除 ではなく 移除 |
| キーの参照先 | key reference | 密钥引用名称 | なし | 設定に書く環境変数の名前 |
| ベース URL | base URL | 接入地址 | なし | 中国語は設定の「接続先」と同じ 接入地址 |
| モデル一覧 | model list | 模型列表 | なし | 提供元から取得した選択肢の一覧 |
| 使わせてよいモデル | Allowed models | 可使用的模型 | なし | サブエージェントに許すモデル |
| 詳細（折りたたみ） | Details | 详情 | なし | モデルごとの折りたたみの見出し。表示の細かさの「詳細＝Detailed／详细」とは別の語 |
| 削除 | Delete | 删除 | なし | 一覧から項目を消す操作（「モデルを削除＝Delete model／删除模型」） |
| 言語 | Language | 语言 | `language.title`（`dsh-client-locale`） | 一致 |
| 端末の言語に合わせる | Match device language | 跟随设备语言 | なし | M3E の選択肢（依頼で決めた名前）。標準の画面は保存値がなければ、ブラウザの言語が英語か中国語のときだけそれに従い、ほかは英語になる。選択肢としては出さない。中国語の 跟随 は DSH の他の画面にある「跟随系统」（外観）に合わせた |
| English／中文 | English／中文 | English／中文 | `BUILT_IN_LOCALE_METADATA`（`dsh-client-locale`） | 言語名は各言語の自称で、訳さない |

## 書き方

- 引用符は、日本語は「」、英語と中国語は `“”` にそろえます。DSH の辞書では、中国語は `“”` と「」が、英語は `“”` と直引用符が混在しています。M3E は一番近い `dsh-client-ui-chat` の中国語（例：`点击“退出登录”`）に合わせて `“”` にしました。
- 中国語で「押す」は `点击` を使います（DSH にある語。`点按` は DSH のどこにもないので使いません）。
- 値や固有名詞（モデル名、ファイル名、ホストから届く文）は訳しません。
