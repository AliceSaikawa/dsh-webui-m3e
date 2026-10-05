# dsh-webui-m3e

日本語 | [English](README.en.md) | [简体中文](README.zh-CN.md)

DeepSeek Harness（DSH）を、スマートフォンで使いやすい Material 3 Expressive の画面で操作するためのプラグインです。

<p>
  <img src="docs/images/home.png" alt="セッションの一覧" width="200">
  <img src="docs/images/chat.png" alt="会話のチャット" width="200">
  <img src="docs/images/approval.png" alt="ツールの承認" width="200">
  <img src="docs/images/inbox.png" alt="対応待ち" width="200">
</p>

> [!NOTE]
> 個人のプロジェクトで、DeepSeek の公式のものではありません。開発中であり、不具合がある可能性があります。ご利用には十分ご注意ください。

## Quick Start

**0.0.8 は公開準備中です。公開されるまでは、次の名前による追加は npm の 404 で失敗します。** 公開後、DSH が動いている端末で実行します。

```bash
dsh plugin --profile web add dsh-webui-m3e
```

`web` は例です。実際に Web 画面を動かしているプロファイルを指定してください。間違った名前でも新しいプロファイルが作られるため、追加成功だけでは接続先が正しいとは限りません。

対応版は **DSH 0.2.0-rc.2 のみ**、実行環境は Node.js 22 以上です。通常の npm インストール版 DSH CLI は **PATH 上の pnpm** を使います（確認環境：macOS 27.2、Node.js 26.7.0、pnpm 11.17.0）。M3E のソース取得・ビルド・開発依存の導入は不要です。

追加後は、そのプロファイルの Host を再起動してください。いつもの標準画面（`http://<host>/?ui=classic`）でログインしてから、`http://<host>/m3e/` を開きます。再起動せずに反映される範囲は未検証なので、再起動を含む手順にしています。

Desktop 版には [上流で同梱 pnpm を使う経路の説明](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md#bundled-command-runtime)があります。Desktop はこの版・この環境では確かめていません。通常 CLI の確認結果と区別してください。

## できること

- **会話**：AI とのやり取り、ツールの実行結果、考えた内容を、スマートフォンの幅で読めます。記録を時間の順に並べた「トレース」にも切り替えられます。
- **返事**：ツールの承認、AI からの質問、プランの確認に、どの画面にいても下からのシートで答えられます。
- **対応待ち**：返事が必要な会話と、終わった会話をまとめて見られます。
- **入力**：画像の添付、ファイルやコマンドの候補、モデルや権限の切り替えができます。
- **そのほか**：会話の検索、DSH の設定と API キーの登録、ホーム画面に追加して使う Web アプリ

今の DSH の画面はそのまま残ります。端末ごとに、どちらの画面を使うかを選べます。

## 必要なもの

- DeepSeek Harness **0.2.0-rc.2**（起動・送信・停止・承認・質問・再接続などを、実物の DSH と偽の LLM で確かめています）
  - 0.1.5 系への対応は外しました。確認結果、既知の差、未検証の経路は [docs/dsh-compatibility.md](docs/dsh-compatibility.md) にあります。
- Node.js 22 以上と PATH 上の pnpm（通常 CLI）。M3E 自体のビルドは不要です。

## 更新・版の確認・削除

入っている版は JSON の `dependencies.dsh-webui-m3e.version` で確認します。通常の一覧では `file:` の参照しか表示されない場合があります。

```bash
dsh plugin --profile web list dsh-webui-m3e --depth 0 --json
```

更新は、対応する公開済みの版を指定して同じ名前で追加し直します。次は初回公開版への移行例です（公開後に実行）。今のローカル tgz 版を使っている人も、同じプロファイルでこのコマンドを実行し、Host を再起動して上の一覧を確認してください。利用者による版番号の手編集は不要です。

```bash
dsh plugin --profile web add dsh-webui-m3e@0.0.8
```

将来の新版から戻す場合も、確認済みの互換版を指定して追加し直し、再起動します。0.0.8 に戻す場合は同じコマンドです。以前配布した 0.0.7 と DSH 0.2.0-rc.2 の組合せは復帰先にしないでください。手元に保管した互換版の tgz に戻す形は次のとおりです。

```bash
dsh plugin --profile web add file:/path/to/dsh-webui-m3e-<version>.tgz
```

削除する前に `http://<host>/?ui=classic` を開きます。削除後、Host を再起動して同じ標準画面へ戻ります。

```bash
dsh plugin --profile web remove dsh-webui-m3e
```

ローカル tgz の版の切替・削除は確認済みです。レジストリからの移行・更新・復帰と、操作前後の設定・ほかのプラグイン・会話の保持は、まだ検証が残っています。404 なら公開状況と版、pnpm が見つからない場合は PATH、画面に現れない場合はプロファイルと Host の再起動を確認してください。失敗時には CLI が診断ログの場所も表示します。

ソースからビルドする場合は [開発・配布の手順](docs/development.md#配布)を参照してください。

## 使い方

1. いつもの DSH の画面（`http://<host>/`）で、一度ログインします。
2. `http://<host>/m3e/` を開きます。
3. iPhone では、Safari の共有メニューから「ホーム画面に追加」すると、アプリのように開けます。

### 画面を切り替える

この端末でどちらの画面を使うかは、次のどれかで選べます。選んだ内容は端末ごとに保存されます。

- いつもの画面の「設定 → 一般 → この端末で M3E の画面を使う」
- この画面の「設定 → 今の画面に戻す」
- URL に `?ui=m3e` か `?ui=classic` を付けて開く

どちらかの画面がうまく開かないときは、`http://<host>/?ui=classic` を開くと、いつもの画面に戻れます。

## 注意

- 画面の文言は日本語だけです。
- DSH の内部のライブラリ（`@deepseek-ai/cordis`、`@deepseek-ai/dsh-client-store`）を同梱しているので、DSH の版によっては動かないことがあります。
- 画面の試験は主に偽のデータで行い、DSH とのつながりは、本番から切り離した実物の DSH と偽の LLM で確かめています。今回の移行では、本物の LLM と iPhone での確認は未実施です。開発の方法と仕組みは [docs/development.md](docs/development.md) にあります。

## ライセンス

MIT です。[LICENSE](LICENSE) を見てください。
