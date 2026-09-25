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
- 画面の文言は日本語だけにします。外部の CDN、トラッカー、外部のフォントは使いません。
- 完了の前に `pnpm typecheck`、`pnpm test`、`pnpm build` を通します。
- `git push --force` と `git reset --hard` は使いません。

## コマンド

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm build
pnpm dev
```

`pnpm dev` のあと、`http://localhost:5173/m3e/?mock` で DSH なしの偽データの画面を開けます（段階 1 で作ります）。
