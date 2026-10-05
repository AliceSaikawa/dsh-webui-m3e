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

DSH が動いている端末で実行します。

```bash
dsh plugin --profile web add dsh-webui-m3e
```

`web` は例です。実際に Web 画面を動かしているプロファイルを指定してください。間違った名前でも新しいプロファイルが作られるため、追加成功だけでは接続先が正しいとは限りません。

対応版は **DSH 0.2.0-rc.2 のみ**です。通常の npm インストール版 DSH CLI は **PATH 上の pnpm** を使います。DSH 自身には Node の下限宣言がありませんが、CLI が使う commander 15 は Node `>=22.12.0`、pnpm 11.17.0 は `>=22.13` を要求します。DSH と使用する pnpm の両方の要件を満たす Node を用意してください。動作確認環境は macOS 27.2、Node.js 26.7.0、pnpm 11.17.0 で、依存側の下限宣言を M3E の動作保証の下限とはしていません。

M3E には追加で導入する実行時の依存パッケージはありません。M3E のソース取得・ビルド・開発依存の導入は不要です。

追加後、いつもの標準画面（`http://<host>/?ui=classic`）でログインしてから、`http://<host>/m3e/` を開きます。更新・旧版への復帰では Host のコードを切り替えるため、必ずそのプロファイルの Host を再起動してください。

Desktop 版には [上流で同梱 pnpm を使う経路の説明](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md#bundled-command-runtime)があります。Desktop はこの版・この環境では確かめていません。通常 CLI の確認結果と区別してください。

## できること

- **会話**：AI とのやり取り、ツールの実行結果、考えた内容を、スマートフォンの幅で読めます。記録を時間の順に並べた「トレース」にも切り替えられます。
- **返事**：ツールの承認、AI からの質問、プランの確認に、どの画面にいても下からのシートで答えられます。
- **対応待ち**：返事が必要な会話と、終わった会話をまとめて見られます。
- **入力**：画像の添付、ファイルやコマンドの候補、モデルや権限の切り替えができます。
- **そのほか**：会話の検索、DSH の設定と API キーの登録、ホーム画面に追加して使う Web アプリ

今の DSH の画面はそのまま残ります。端末ごとに、どちらの画面を使うかを選べます。

## 必要なもの

- DeepSeek Harness **0.2.0-rc.2**
  - 0.1.5 系への対応は外しました。確認結果、既知の差、未検証の経路は [docs/dsh-compatibility.md](docs/dsh-compatibility.md) にあります。
- DSH と pnpm の要件を満たす Node.js、および PATH 上の pnpm（通常 CLI）。版の前提は上の Quick Start を参照してください。

## 更新・版の確認・削除

入っている版は JSON の `dependencies.dsh-webui-m3e.version` で確認します。通常の一覧では `file:` の参照しか表示されない場合があります。

```bash
dsh plugin --profile web list dsh-webui-m3e --depth 0 --json
```

更新は、対応する公開済みの版を指定して同じ名前で追加し直します。次は 0.0.8 への移行例です。ローカル tgz 版を使っている人も、同じプロファイルでこのコマンドを実行し、Host を再起動して上の一覧を確認してください。利用者による版番号の手編集は不要です。

```bash
dsh plugin --profile web add dsh-webui-m3e@0.0.8
```

将来の新版から戻す場合も、確認済みの互換版を指定して追加し直し、再起動します。0.0.8 に戻す場合は同じコマンドです。以前配布した 0.0.7 と DSH 0.2.0-rc.2 の組合せは復帰先にしないでください。手元に保管した互換版の tgz に戻す形は次のとおりです。

```bash
dsh plugin --profile web add file:/path/to/dsh-webui-m3e-<version>.tgz
```

削除する前に `http://<host>/?ui=classic` を開きます。削除後は `/m3e/` が 404 になるので、同じ標準画面を使います。

```bash
dsh plugin --profile web remove dsh-webui-m3e
```

取得時に 404 ならパッケージ名と公開された版、pnpm が見つからない場合は PATH、画面に現れない場合はプロファイルと Host の再起動を確認してください。失敗時には CLI が診断ログの場所も表示します。

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
- 開発の方法と仕組み、検証の記録は [docs/development.md](docs/development.md) にあります。

## ライセンス

MIT です。[LICENSE](LICENSE) を見てください。
