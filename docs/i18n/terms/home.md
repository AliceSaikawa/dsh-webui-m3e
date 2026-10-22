# 用語の対応表：一覧（ホーム）とワークスペース

`web/src/features/home/messages.ts` の英語・中国語（簡体字）の訳で選んだ用語です（Issue #78）。共通の用語と書き方は [glossary.md](../glossary.md) にあります。DSH 0.2.1-rc.2 の標準画面の辞書と照らしました。DSH は起動していません。

| 日本語 | 英語 | 中国語（簡体字） | DSH 標準画面の辞書のキー | メモ |
|---|---|---|---|---|
| セッション | session | 会话 | `menu.archiveSession`（`dsh-client-ui-workspace`）ほか多数 | 一致。会話（conversation／对话）とは別の語 |
| ワークスペース | workspace | 工作区 | `workspace.add`、`rename.workspace.title`（`dsh-client-ui-workspace`） | 一致 |
| ワークスペースの操作 | Workspace actions | 工作区操作 | なし | シートの題名。M3E の言い方 |
| 子の会話 | subagent | 子智能体 | `message.stepProcess.subagents`（`dsh-client-ui-chat`。中国語は 子智能体） | 行の補足は「subagent, read-only／子智能体，只读」。DSH の中国語は 子智能体 |
| ピン留め／ピン留めを外す | Pin／Unpin | 置顶／取消置顶 | `menu.pinSession`、`menu.unpinSession`（`dsh-client-ui-workspace`） | 一致（DSH は 置顶会话。M3E は操作の短い言い方） |
| アーカイブ／アーカイブを戻す | Archive／Unarchive | 归档／取消归档 | `menu.archiveSession`、`menu.unarchiveSession` | 一致 |
| 名前を変える／題名を変える | Rename | 重命名 | `rename`、`rename.workspace.title`、`rename.session.title` | DSH は「Rename」。シートの題名は workspace／session を付けた |
| 登録を解除 | Remove | 移除 | `delete.workspace`、`delete.desc`（`dsh-client-ui-workspace`） | DSH は "Delete workspace"／删除工作区。フォルダを消さないので M3E は Remove／移除 にした（DSH の説明文も「フォルダは残る」と書いている） |
| アーカイブ済みを隠す | Hide archived | 隐藏已归档 | `viewOptions.hideArchived`（`dsh-client-ui-workspace`） | 一致 |
| アーカイブ済みだけ表示 | Archived only | 仅显示已归档 | `viewOptions.onlyArchived`（中国語は 仅显示已归档） | 一致 |
| 手動の順 | Manual order | 手动顺序 | なし | M3E の言い方 |
| 最近の更新順 | Recently updated | 按最近更新 | なし | M3E の言い方 |
| 並べ替え | Reorder | 调整顺序 | なし | 名詞。ドラッグの説明も同じ語 |
| 選択してアーカイブ | Select and archive | 选择并归档 | なし | M3E の新しい操作 |
| フォルダ | folder | 文件夹 | `browser.newFolder`、`browser.folderName`（`dsh-client-ui-directory-picker-browse`） | 一致。directory は訳さない |
| フォルダ名 | Folder name | 文件夹名称 | `browser.folderName`（中国語は 文件夹名称） | 一致 |
| 新しいフォルダ | New folder | 新建文件夹 | `browser.newFolder` | 一致 |
| フォルダを選ぶ | Choose a folder | 选择文件夹 | `browser.title`（Select Workspace Directory／选择工作区目录） | 画面の題は M3E の短い言い方 |
| フォルダの階層 | Folder hierarchy | 文件夹层级 | なし | パンくずの aria-label |
| ここを追加 | Add this folder | 添加此文件夹 | `workspace.add`（`dsh-client-ui-workspace`。Add workspace／添加工作区） | 「ワークスペースを追加」との違いを出すため folder にした |
| 日時不明 | Date unknown | 时间未知 | なし | `formatDateTime` が `undefined` のとき |
| 作業フォルダなし | No working folder | 无工作文件夹 | なし | 行の補足。作業フォルダは cwd |
| 1,000 件を超えるフォルダは一部だけ表示します | More than 1,000 folders; only some are shown | 文件夹超过 1,000 个，仅显示一部分 | `browser.truncated`（`dsh-client-ui-directory-picker-browse`。英語 Too many folders to list…／中国語 文件夹过多，仅显示开头部分。） | 語は一致。日本語の「1,000 件」は変えない（正本） |
| 親の会話が見つかりません。／子の会話の情報を読み込めませんでした。 | The parent conversation was not found.／Could not load the subagent information. | 未找到父对话。／无法读取子智能体的信息。 | なし | 例外の文言。会話は conversation／对话（`openHomeSession`） |
