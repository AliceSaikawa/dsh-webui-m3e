# 用語の対応表：対応待ち・検索・質問と承認・プラグイン

`web/src/features/inbox`・`search`・`interactions`・`plugins` の `messages.ts` の英語・中国語（簡体字）の訳で選んだ用語です（Issue #78）。共通の用語と書き方は [glossary.md](../glossary.md) にあります。DSH 0.2.1-rc.2 の標準画面の辞書と照らしました。DSH は起動していません。

| 日本語 | 英語 | 中国語（簡体字） | DSH 標準画面の辞書のキー | メモ |
|---|---|---|---|---|
| 対応待ち | Needs attention | 待处理 | なし | 画面の題名。DSH の `dsh-client-ui-workspace` には 待审批／待回答（`status.compact.*`）があるが、承認と質問の両方を含む画面なので M3E の言い方にした |
| 返事が必要 | Needs a reply | 需要回复 | なし | 対応待ちの見出し |
| 終わったもの | Finished | 已完成 | なし | 対応待ちの見出し |
| ワークスペース | workspace | 工作区 | `crumb.root`（`dsh-client-ui-reference`、Workspace／工作区） | 一致。`groupBy.workspace` は英語が WorkSpace と綴りが違うので `crumb.root` に合わせた |
| セッション | session | 会话 | なし | DSH の中国語は 会话。`docs/i18n/glossary.md` の 会話＝对话 とは別。検索と対応待ちのセッションは 会话 |
| 件（検索結果の数） | results（1 result） | 条结果 | なし | 英語は `count === 1 ? '1 result found' : count + ' results found'`。中国語は数に関係なく 条 |
| 検索 | Search | 搜索 | `search`（`dsh-client-locale`、Search／搜索） | 一致 |
| 検索語 | search terms | 搜索词 | なし | 500 文字の上限と使えない文字の説明で使う |
| 最近のセッション | Recent sessions | 最近的会话 | `orderBy.updated`（`dsh-client-ui-workspace`、Last updated／最近更新） | 「最近」だけ DSH に合わせた |
| 見つかりませんでした | No results found | 未找到结果 | `web.noResults`（`dsh-client-ui-conversation`、No results found／未找到结果） | 一致 |
| 更新日時不明 | Updated time unknown | 更新时间未知 | なし | `formatDateTime` が `undefined` のときの文言 |
| 作業フォルダ未設定 | No working folder set | 未设置工作文件夹 | なし | セッションの `cwd` がないとき |
| ツールの承認 | Tool approval | 工具审批 | `status.compact.approval`（`dsh-client-ui-workspace`、Approval／待审批）、`detail.aria`（`dsh-client-ui-approval`、Approval details／审批详情） | 名詞は 审批 にそろえた |
| プランの確認 | Plan review | 计划待审 | `plan.header`（`dsh-client-ui-user-questions`、Plan review／计划待审） | 一致 |
| AI からの質問 | Question from the AI | AI 的提问 | なし | DSH の `dsh-client-ui-user-questions` は「问题」だが、M3E は質問シートの題名を短くするため 提问 にした。本文の 質問 は 问题 |
| 拒否 | Refuse | 拒绝 | `plan.decline`（`dsh-client-ui-user-questions`、Refuse／拒绝） | 承認の拒否ボタン。`dsh-client-ui-cordis` の Deny ではなく `plan.decline` に合わせた |
| 許可（1 回） | Allow once | 允许（一次） | `action.approveOnce`（`dsh-client-ui-cordis`、Allow this version only／仅允许此版本） | 語（Allow／允许）は一致。M3E は 1 回だけの許可なので短くした |
| トレースで見る | View in trajectory | 在轨迹中查看 | `developerTools.description`（`dsh-client-ui-settings-general`、trajectory／轨迹） | トレースは 11 の用語表どおり trajectory／轨迹 |
| その他（自由に書く） | Other (write your own) | 其他（自行填写） | `custom.placeholder`（`dsh-client-ui-user-questions`、Type your answer／输入你的答案） | 似た用途の語 |
| 返事待ちの承認があります | An approval is waiting for your reply | 有审批等待你回复 | `wait.held`（`dsh-client-ui-user-questions`、Waiting until you answer／会一直等你回答） | 入力欄の上のバッジ |
| プラグイン | plugin | 插件 | `panel.title`（`dsh-client-ui-cordis`、Cordis plugins／Cordis 插件）、`source.plugin`（`dsh-client-ui-trajectory`、Plugin／插件） | 一致 |
| 無効 | Disabled | 已禁用 | なし | 状態の見出しとラベル。`dsh-client-ui-schedule` の `status.active`（Enabled／已开启）は「有効」側の語 |
| 有効 | Enabled | 已启用 | `status.active`（`dsh-client-ui-schedule`、Enabled／已开启） | 語（Enabled／已启用）は一致 |
| 稼働中 | Active | 运行中 | `detail.goal.active`（`dsh-client-ui-conversation`、Active／进行中） | DSH は 进行中 だが、プラグインの状態は 运行中 が自然なので M3E の言い方にした |
| 読み込み中 | Loading | 加载中 | `loading`（`dsh-client-locale`、Loading…／加载中…） | 一致 |
| 待機中 | Waiting | 等待中 | なし | プラグインの `pending` |
| 停止中 | Stopping | 正在停止 | `input.stop`（`dsh-client-ui-conversation`、Stop generating／停止生成） | プラグインの `unloading`。中国語は 停止中 だと日本語と同形なので 正在停止 にした |
| 未起動 | Not started | 未启动 | なし | プラグインの起動前 |
| バンドル | bundle | 捆绑包 | なし | プラグインのバンドル。DSH に該当語なし |
| プロファイル | profile | profile | `reasonStopProfile`（`dsh-client-ui-plugin-manager`） | DSH の中国語も profile のまま。配置 は設定の意味になるので使わない |
| インストール先 | where to install | 安装位置 | なし | `ambiguous-install` の文。日本語の「インストール先」の意味で訳した |
| 同梱 | Bundled | 随附安装 | なし | `installed`（インストール済み／已安装）と対にする |
| 版 | Version | 版本 | `panel.version`（`dsh-client-ui-cordis`、Version／版本） | 一致 |
| 読み直す | Reload | 重新加载 | `action.reload`（`dsh-client-ui-model-selection`、Reload／重新加载） | 一致。`retry` の「もう一度読み込む」は Load again／重新加载 と同じ中国語になるが、日本語が違うので別キーのまま |
| この Host では管理できません | This Host cannot manage plugins | 此 Host 无法管理 | なし | `Host` は値なので訳さない（`docs/i18n/glossary.md` の決まり） |
| 承認の情報が古くなっています | The approval information is out of date | 审批信息已过期 | `action.approve`（`dsh-client-ui-cordis`、Allow／允许） | 承認は 审批 |
