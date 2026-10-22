# 用語の対応表：共通の部品・会話・DSH のエラー

`web/src/app/messages.ts`・`web/src/dsh/messages.ts`・`web/src/features/conversation/messages.ts` の英語・中国語（簡体字）の訳で選んだ用語です（Issue #78）。共通の用語と書き方は [glossary.md](../glossary.md) にあります。DSH 0.2.1-rc.2 の標準画面の辞書と照らしました。DSH は起動していません。

| 日本語 | 英語 | 中国語（簡体字） | DSH 標準画面の辞書のキー | メモ |
|---|---|---|---|---|
| 今の画面に戻す | Return to the standard screen | 返回标准界面 | dsh-client-ui-appearance? なし | 設定画面（settings ジョブ）と同じ文言。M3E を閉じて DSH 標準の画面に戻す操作 |
| 一覧（タブ） | Sessions | 会话 | なし | 下端タブ。390px でアイコンの下に収まる語長にする |
| 検索（タブ） | Search | 搜索 | なし | 下端タブ |
| 対応待ち（タブ） | Inbox | 待处理 | なし | 承認・質問の待ち行列。inbox ジョブと同じ語 |
| 設定（タブ） | Settings | 设置 | なし | 下端タブ |
| 会話 | conversation | 对话 | dsh-client-ui-conversation | チャットの単位。セッション（session / 会话）とは書き分ける |
| 会話を切り替え | Switch conversation | 切换对话 | なし | 会話ピッカーの見出し |
| 子の会話 | child conversation | 子对话 | なし | サブエージェントの子セッション |
| 実行中 | Running | 运行中 | なし | 会話一覧の状態 |
| 開いている会話 | Open conversation | 当前对话 | なし | 会話一覧で今開いている行 |
| ワークスペース未登録 | Unregistered workspace | 未登记工作区 | dsh-client-ui-workspace | どのワークスペースにも属さない会話の見出し |
| トレース（タブ） | Trajectory | 轨迹 | dsh-client-ui-trajectory | 会話画面の 2 つ目のタブ |
| 前のタブ／次のタブ | Previous tab / Next tab | 上一个标签页／下一个标签页 | なし | タブのページ送りの読み上げ |
| 読むだけです | read-only | 只读 | なし | 書き込めない会話の注記 |
| 一覧を読み込んでいます… | Loading the list… | 正在加载列表… | なし | 読み込み中の状態 |
| 一致する会話がありません。 | No conversations match. | 没有匹配的对话。 | なし | 検索結果なし |
| 処理に失敗しました。もう一度お試しください。 | The operation failed. Try again. | 操作失败，请重试。 | dsh-client-ui-* error | Host の失敗の既定文 |
| 会話が見つかりません。 | The conversation was not found. | 找不到对话。 | なし | 会話が消えているとき |
| 親の会話が見つかりません。 | The parent conversation was not found. | 找不到父对话。 | なし | サブエージェントの親が引けないとき |
| 読み取りのみ | Read Only | 仅可查看 | dsh-client-ui-permission-presets | 権限プリセット。DSH 標準の訳語 |
| ワークスペース書込 | Workspace Write | 工作区内修改 | dsh-client-ui-permission-presets | 権限プリセット |
| フル アクセス | Full access | 完全权限 | dsh-client-ui-permission-presets | 権限プリセット |
| 自動レビュー（実験的） | Auto review (experimental) | 自动审查（实验性） | dsh-client-ui-permission-presets | 権限プリセット。日本語の名前にある「実験的」を訳にも入れた |
| シートのハンドル | Resize the sheet | 调整面板高度 | なし | ボトムシートのつまみの読み上げ |
| ワークスペース | workspace | 工作区 | dsh-client-ui-workspace | 作業フォルダのまとまり |
