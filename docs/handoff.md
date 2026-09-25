# 引き継ぎ（2026-09-25）

次のセッションは、このファイル、[README.md](../README.md)、[docs/ui-spec.md](ui-spec.md) の順に読んでから始めてください。DSH の API は `~/AI/inbox/2026-09-17-dsh-webui-m3e-api-surface.md` にまとめてあります（DSH 0.1.5-rc.1 時点）。

## できていること

- **手順 1（通信だけの最小画面）**：`/m3e` で DSH に接続し、接続状態とセッション一覧を表示します。検証用の DSH で確認済みです。コミットは `7a4beb8` です。
- **手順 2（端末ごとの切り替え）**：Cookie `dsh-webui` で、今の画面と M3E の画面を切り替えます。今の画面の設定、M3E のボタン、`?ui=` の 3 通りで切り替えられることをブラウザで確認済みです。コミットは `905c772` です。
- **画面の設計**：一覧、会話（待機中・実行中）、「＋」のシート、ツール承認、トレース、記録の詳細の画面があります。
  - 仕様は `docs/ui-spec.md` にあります。
  - Canvas の最新版は `docs/canvas/merged.json` で、開くためのリンクは `merged.url` です。
  - ユーザーが最後に共有した版は `docs/canvas/user-latest.json` です。

## 決まったこと

- UI は React 19 で作ります。M3E の見た目は、M3E 部品集で出します。
- 切り替えは端末ごとです。全体の設定にはしません。
- 下のタブは「一覧・検索・対応待ち・設定」の順で、対応待ちのアイコンは手のひらです。
- 入力欄は角丸の枠 1 つにまとめます。Enter は改行です。実行中は「順番待ち」のスプリットボタンと停止ボタンを出します。
- 会話画面には「チャット / トレース」のタブを置きます。トレース中は入力欄を出しませんが、承認と質問のシートはその場で開きます。
- 一覧のアイコンはモデルのアイコンで、アイコンは同梱します。表示できなくても構いません。
- Canvas は構造の確認に使います。細かい見た目は、実装のときに実機で調整します。

## 次にやること

1. **M3E 部品集の選定（手順 3）**
   - 候補は `@m3e/web` + `@m3e/react`（第 1 候補）と `@language-lit/material3-expressive`（第 2 候補）です。比較表の要点は下にあります。
   - テスト用のページは `tmp/libtest`（プロジェクト内、git 管理外） にあります（`m3e.html` と `ll.html`）。`pnpm install && pnpm dev` を実行すると 127.0.0.1:5190 で開けます。
   - まだ Simulator で一度も動かしていません。iPhone 17 Pro Max（iOS 26.2）の Safari で開き、次の点を比べてください。
     - ボトムシートを指で払えるか
     - 背景がスクロールしないか
     - safe-area（画面の端の余白）が正しいか
     - キーボードの出し入れで崩れないか。画面左上の HUD に `visualViewport` の数値が出ます。
2. **本番 DSH の版の確認**：Arch への ssh は Claude Code の自動モードで拒否されるので、ユーザーに `ssh archlinux 'dsh --version'` の実行を頼んでください。同梱している `@deepseek-ai/cordis`（4.0.2）と `@deepseek-ai/dsh-client-store`（0.1.5-rc.2）は、本番と版を合わせる必要があります。
3. **一覧画面の実装**：部品集が決まったら、`docs/ui-spec.md` に沿って実装します。
4. **PWA の設定（手順 4）**：Service Worker の対象は `/m3e/` の下だけにします。画面本体はキャッシュしません。キャッシュすると、今の画面に戻せなくなるためです。

## 部品集の比較の要点（サブエージェントの調査、2026-09-25）

- **@m3e/web 2.8.2 + @m3e/react**
  - MIT ライセンスで、週のダウンロード数は約 1,300 です。
  - 必要な 15 種類の部品がすべて揃っています。ボトムシートは、途中で止まる位置の指定、払って隠す操作、つまみに対応しています。
  - 公式の React ラッパーがあります。
  - Material Symbols のフォントは別に読み込む必要があります。スナックバーは命令的な API で呼び出します。
  - JSX で使うときの注意：`for` 属性は `htmlFor` と書きます。`hideSubscript` は文字列で指定します。
- **@language-lit/material3-expressive 1.2.2**
  - React 用に作られた部品集で、Tailwind は不要です。BottomSheet、SegmentedListItem、NavigationBar があります。
  - 利用者が少なく（週のダウンロード数 50）、CSS は 52KB を一括で読み込みます。シード色からの配色生成はありません。
- 除外したもの：banegasn（ボトムシートがない）、react-material-expressive（保守が止まっている）、juicer-m3、m3x、bug-on（Tailwind が必須）。

## 環境のメモ

- **Mac の本物の DSH**：launchd の `com.user.deepseek-harness-web` から起動され、`127.0.0.1:3081` で動いています。ログイン URL は `~/AI/tmp/deepseek-harness-web/stdout.log` に出ます。トークンの扱いは自動モードで止められるので、開くのはユーザーに頼んでください。
- **検証用の DSH**：本番から切り離した空の `DSH_HOME` を使い、`dsh --profile web --no-open --port 3199` で起動します。前のセッションのものは、作業用フォルダと一緒に使えなくなります。作り直す手順は次のとおりです。
  1. `pnpm build && pnpm pack` を実行します。
  2. `DSH_HOME=tmp/dsh-home dsh plugin --profile web add file:<tgz>` でプラグインを入れます（`tmp/` は git 管理外です）。入れ直すときは version を上げてください。
  3. 最初に出る「Internal Testing Notice」は、情報を知らせるだけの画面です。API キーの画面は「Configure later」で飛ばせます。
- AI のコミットに付けるトレーラ（`AI-Harness` など）は、このセッションでは付けていません。システムの指示で、帰属表示を付けないよう求められたためです。
