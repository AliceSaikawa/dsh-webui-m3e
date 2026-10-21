# AGENTS.md

DeepSeek Harness（DSH）のスマートフォン向け Web 画面を、Material 3 Expressive で作り直すプラグインです。

## 最初に読むもの

1. `docs/design/README.md`：設計書の全体像、並行作業の決まり、確かめ方、コミットの書き方
2. 自分の担当の設計書（`docs/design/<番号>-<名前>.md`）
3. 担当の設計書が指す `docs/ui-spec.md` の節

作業の経緯と環境のことは `docs/handoff.md` にあります。

## 守ること

- 担当の設計書の「担当するファイル」に書いたものだけを変更します。範囲外の変更が必要になったら、変えずに設計書の「実装メモ」に書いて報告します。
- 段階 1（`docs/design/00-foundation.md`）の担当以外は、`package.json` とロックファイルを変更しません。
- 画面の文言は日本語を正本にし、英語と中国語（簡体字）の訳を当てます。言語は DSH の言語設定（なければブラウザ）に従います。文言の辞書と書式は `docs/design/11-i18n.md` の決まりに従います。
- README の正本は英語の `README.md` です。日本語は `README.ja.md`、中国語（簡体字）は `README.zh-CN.md` に置き、3 つの内容をそろえます。
- 外部の CDN、トラッカー、外部のフォントは使いません。
- 完了の前に `pnpm typecheck`、`pnpm test`、`pnpm build` を通します。
- 段階 1 と 2 では DSH を起動しません。確かめるのは `?mock` の偽データだけです。
- 拒否された操作や禁じられた操作を、別のコマンドや別のツールで回避しません。止めて、設計書の「実装メモ」に書いて報告します。
- worktree、ブランチ、push、マージの手順は [docs/git-workflow.md](docs/git-workflow.md) に従います。コミットと PR の形、CHANGELOG の更新は、下の「コミットとプルリクエスト」に従います。
- `--force-with-lease` を付けない `git push --force` と、`git reset --hard` は使いません。`--force-with-lease` は自分のブランチには許可なしで使え、人と共有しているブランチでは許可を取ります（詳しくは docs/git-workflow.md の §1）。

## コマンド

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm dev
```

`pnpm dev` のあと、`http://localhost:5173/m3e/?mock` で DSH なしの偽データの画面を開けます（段階 1 で作ります）。

## コミットとプルリクエスト

main へは squash merge だけです。PR のタイトルが、main のコミット件名になります。マージすると `type: subject (#N)` です。この形に合わせるのは PR のタイトルです。ブランチの中のコミットは、これより緩くてかまいません。

件名は Conventional Commits です。type は `feat`、`fix`、`docs`、`refactor`、`test`、`chore` です。scope は省略できます。壊す変更は type の直後に `!` を付けます。例は `feat!:` と `feat(settings)!:` です。

件名は英語の 1 行です。type のあとは小文字で始めます。scope があるときは、scope のあとを小文字で始めます。末尾にピリオドを付けません。72 字以内です。この 72 字は PR のタイトルの長さです。マージで付く ` (#N)` は数に入れません。件名には、使う人から見て何が変わるかを書きます。

本文は、使う人から見て何が変わるかを先に書きます。短い段落を 1 つか 2 つ書きます。各段落は、平叙文で 2 文か 3 文です。関数、画面、設定の実名を使います。長い理由、検証の手順、試験の件数は書きません。それらは PR の本文に置きます。考えをつなぐためにスラッシュやダッシュを使いません。

squash の本文は、ブランチの各コミットを `* subject` の行で並べます。各行のあとに、1 文か 2 文で、使う人から見た変化を書きます。

```text
docs: add a changelog (#12)

* docs: add a changelog

The changelog lists changes a person using the product can see. A release pull request moves Unreleased entries under that version.
```

`AI-Harness` と `AI-Model` は付けません。この試しの規則は止めました。`AI-Agent` も付けません。ツールが自動で付ける `Co-authored-by` は、最後の行として残してかまいません。過去のコミットに付いているトレーラは書き換えません。

PR の本文は、レビューする人が 1 分で読める短い説明です。検証の結果と試験の件数はここに書きます。Issue を直すときは `Fixes #N` と書きます。

使う人に見える変更は、`CHANGELOG.md` の `Unreleased` に項目を足します。リリースの PR は、その項目をその版の見出しの下へ移します。
