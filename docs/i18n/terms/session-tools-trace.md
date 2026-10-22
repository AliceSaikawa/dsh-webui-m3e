# 用語の対応表：セッションツールとトレース

`web/src/features/session-tools/messages.ts` と `web/src/features/trace/messages.ts` の英語・中国語（簡体字）の訳で選んだ用語です（Issue #78）。共通の用語と書き方は [glossary.md](../glossary.md) にあります。DSH 0.2.1-rc.2 の標準画面の辞書と照らしました。DSH は起動していません。

| 日本語 | 英語 | 中国語（簡体字） | DSH 標準画面の辞書のキー | メモ |
|---|---|---|---|---|
| 統計 | Statistics | 统计 | `stats.dialog.title`（`dsh-client-ui-chat`。英語は Session statistics、中国語は 会话统计） | セッションメニューの項目。会話の統計は Conversation statistics／对话统计 |
| コンテキストの使用率 | Context usage | 上下文用量 | なし（`stats.dialog.usageTitle` は Token usage／Token 用量） | M3E の言い方 |
| キャッシュヒット率 | Cache hit rate | 缓存命中率 | `stats.cacheHit`（`dsh-client-ui-chat`。英語は Cache hit {percent}%、中国語は 缓存命中 {percent}%） | 率の文言を M3E で足した |
| トークン | token / tokens | token | `stats.dialog.usageTitle`（`dsh-client-ui-chat`。中国語は Token 用量） | 中国語は DSH と同じく token（訳さない） |
| ジョブ | job | 任务 | `count.idle.other`（`dsh-client-ui-jobs`。英語 background jobs、中国語 后台任务） | メニューの短い項目は Jobs／任务 |
| サブエージェント | subagent | 子智能体 | `count.total.other`（`dsh-client-ui-subagent`） | 一致 |
| ゴール | goal | 目标 | `token.goal`（`dsh-client-ui-commands`） | 一致 |
| 進行中（ゴール） | Ongoing | 进行中 | `phase.active`（`dsh-client-ui-goal`。英語 Ongoing Goal、中国語 进行中的目标） | 状態の語だけを辞書にした |
| 行き詰まり | Blocked | 受阻 | `phase.blocked`（`dsh-client-ui-goal`。英語 Blocked Goal、中国語 受阻的目标） | 一致 |
| ラウンド | round | 轮 | `source.goalRound`（`dsh-client-ui-trajectory`。英語 Round {round}） | 中国語は 轮（第 N / M 轮） |
| 作業フォルダ | Workspace | 工作区 | `crumb.root`（`dsh-client-ui-reference`） | ファイル画面のパンくずの先頭 |
| 読み取り専用 | Read-only | 只读 | なし（`dsh-client-ui-permission-presets` の Read Only は 仅可查看） | ファイル画面の注記。権限の名前とは別の語にした |
| フォルダ | folder | 文件夹 | `browser.folderName`（`dsh-client-ui-directory-picker-browse`。Folder name／文件夹名称） | 一致 |
| 記録（トレース） | record | 记录 | なし（`dsh-client-ui-trajectory` は trajectory の語を使う） | トレースの 1 行を M3E では記録と呼ぶ |
| ターン | turn | 轮 | `turn.label`（`dsh-client-ui-trajectory`。Turn {turn}／第 {turn} 轮） | 一致 |
| ツール呼び出し | tool call | 工具调用 | `details.toolCall`（`dsh-client-ui-trajectory`。Tool Call／工具调用） | 一致 |
| サブツール | subtool | 子工具 | `kind.subtool`（`dsh-client-ui-trajectory`。SUBTOOL／子工具） | 一致 |
| 思考 | Thinking | 思考 | `record.thinking`（`dsh-client-ui-trajectory`） | 一致 |
| 要約（圧縮） | summary | 摘要 | `tab.summary`（`dsh-client-ui-trajectory`。Summary／概述） | トレースの要約行は 摘要 にした。圧縮の説明は 压缩摘要 |
| 所要時間 | Duration | 时长 | `timing.duration`（`dsh-client-ui-trajectory`。Duration／时长） | 一致 |
| ミリ秒 | ms | 毫秒 | `unit.milliseconds`（`dsh-client-ui-trajectory`。{value} ms／{value} 毫秒） | 一致 |
| 秒 | s | 秒 | `unit.seconds`（`dsh-client-ui-trajectory`。{value} s／{value} 秒） | 一致 |
| 未計測 | Not measured | 未计时 | なし（`timing.notRecorded` は Not recorded／未记录） | 時間を測っていないこと |
| 失敗 | Failed | 失败 | `status.failed`（`dsh-client-ui-trajectory`。Failed／失败） | 一致 |
| 中断 | Interrupted | 已中断 | `status.interrupted`（`dsh-client-ui-workflow-run`。Interrupted／已中断） | 一致 |
| 実行見送り | Blocked | 已阻止 | なし | 実行前の確認で見送った終了理由 |
| 上限到達 | Limit reached | 已达上限 | なし（`message.maxTokens` は Output token limit reached／已达到输出 token 上限） | 出力トークンの上限に達した終了理由 |
| 添付 | attachment | 附件 | `attachment.list`（`dsh-client-ui-trajectory`。Attachments／附件） | 単数で使うときも 附件 |
| 記録を検索 | Search records | 搜索记录 | `toolbar.search`（`dsh-client-ui-trajectory`。Search trajectory／搜索轨迹） | M3E は記録の一覧を検索する |
| 表示／元の文字 | Rendered／Source | 渲染／源文本 | `tab.source`（`dsh-client-ui-trajectory`。Source／来源） | Markdown の表示方法の切替 |
| 大きさ不明 | Size unknown | 大小未知 | なし | ファイルの大きさが分からないとき |
| 子の会話 | child conversation | 子对话 | なし（`tree.aria` は Subagent sessions／子智能体会话） | M3E の日本語が「会話」なので、用語集の 会話＝conversation／对话 に合わせた |
| 会話（セッションの意） | conversation | 对话 | 用語集の「会話」 | セッションツールの日本語はセッションを「会話」と書くため、英語・中国語もその語にそろえた |
| セッション | session | 会话 | `rename.session.title`（`dsh-client-ui-workspace`。Rename session／重命名会话） | トレースの「親セッション」など、日本語がセッションと書く箇所に使う |
