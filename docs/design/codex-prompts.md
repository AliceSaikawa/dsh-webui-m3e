# Codex に渡すプロンプト

`docs/design/README.md` の「段階ごとの動かし方」に合わせたプロンプトです。上から順に使います。

- モデルと推論の強さは、Codex の起動時に指定してください。下のコマンドの書き方（`--model` と `model_reasoning_effort`）とモデル名の表記は、お使いの Codex に合わせて直してください。私は GPT-6 の Codex での正確な表記を確かめていません。
- worktree を作るコマンドは、リポジトリ（`~/dev/dsh-webui-m3e`）で実行します。

## 段階 1：共通の土台（GPT-6-Astra、effort xHigh）

準備：

```bash
git worktree add ../dsh-webui-m3e-00 -b feat/00-foundation main
```

```bash
cd ../dsh-webui-m3e-00 && pnpm install
```

```bash
codex --model gpt-6-astra -c model_reasoning_effort=xhigh
```

プロンプト：

```text
あなたは dsh-webui-m3e の「00 共通の土台」の担当です。
作業場所はこの worktree（ブランチ feat/00-foundation）です。main ブランチには触らないでください。

1. AGENTS.md、docs/design/README.md、docs/design/00-foundation.md を読んでください。
2. docs/design/00-foundation.md の「担当するファイル」だけを変更して、担当範囲を実装してください。この段階だけは package.json とロックファイルを変更してかまいません。
3. 確かめるのは ?mock の偽データだけです。DSH は起動しないでください。
4. 担当外の変更や、拒否された操作・禁じられた操作が必要になったら、別の経路で回避せずに止めて、docs/design/00-foundation.md の「実装メモ」に何が必要だったかを書いてください。
5. 「未確認のこと」は、今の画面のプラグイン（$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai/ の下。読むだけ）で確かめられる範囲で確かめ、結果を実装メモに書いてください。
6. 特に気をつけること：ほかの 10 本がこの土台の上で並行に作業します。仮の部品の引数と戻り値の形、画面と偽データを自動で集める仕組み、偽データの kit の関数は、設計書のとおりに作ってください。段階 2 では依存を足せないので、必要な依存はここで全部入れてください。
7. pnpm typecheck、pnpm test、pnpm build を通してください。
8. 自分のブランチにコミットしてください。メッセージは `<type>: <内容>` の形で、次のトレーラを付けてください。
   AI-Harness: Codex CLI
   AI-Model: GPT-6-Astra
   AI-Effort: xhigh
   AI-Duration: <実際にかかった時間>
   AI-Cost: <費用。分からなければ unknown>
   AI-Task: 00-foundation
9. 終わったら、次の 4 つを報告してください。
   - 実装したこと
   - 確かめたこと（3 つのコマンドの結果と、?mock で操作した画面）
   - 実装メモに書いた、未確認のことの結果と、自分で決めたこと
   - 担当外で必要になった変更（なければ「なし」）
```

終わったら、レビュー（下の「レビュー」）に通し、あなたが main にマージしてから段階 2a に進みます。

## 段階 2a：会話まわり（GPT-6-Luna、effort Max、5 本を並行）

段階 1 が main に入ってから始めます。

### 01 一覧とワークスペース

```bash
git worktree add ../dsh-webui-m3e-01 -b feat/01-home main
```

```bash
cd ../dsh-webui-m3e-01 && pnpm install
```

```bash
codex --model gpt-6-luna -c model_reasoning_effort=max
```

```text
あなたは dsh-webui-m3e の「01 一覧とワークスペース」の担当です。
作業場所はこの worktree（ブランチ feat/01-home）です。main ブランチには触らないでください。

1. AGENTS.md、docs/design/README.md、docs/design/01-home.md を読んでください。
2. docs/design/01-home.md の「担当するファイル」だけを変更して、担当範囲を実装してください。
3. 確かめるのは ?mock の偽データだけです。DSH は起動しないでください。
4. 担当外の変更や、拒否された操作・禁じられた操作が必要になったら、別の経路で回避せずに止めて、docs/design/01-home.md の「実装メモ」に何が必要だったかを書いてください。
5. 「未確認のこと」は、今の画面のプラグイン（$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai/ の下。読むだけ）で確かめられる範囲で確かめ、結果を実装メモに書いてください。
6. 特に気をつけること：ドロワーは M3 のモーダルのナビゲーションドロワーで作る（Canvas の描き方に引きずられない）。directoryPicker が native を返すときの扱い。
7. pnpm typecheck、pnpm test、pnpm build を通してください。
8. 自分のブランチにコミットしてください。メッセージは `<type>: <内容>` の形で、次のトレーラを付けてください。
   AI-Harness: Codex CLI
   AI-Model: GPT-6-Luna
   AI-Effort: max
   AI-Duration: <実際にかかった時間>
   AI-Cost: <費用。分からなければ unknown>
   AI-Task: 01-home
9. 終わったら、次の 4 つを報告してください。
   - 実装したこと
   - 確かめたこと（3 つのコマンドの結果と、?mock で操作した画面）
   - 実装メモに書いた、未確認のことの結果と、自分で決めたこと
   - 担当外で必要になった変更（なければ「なし」）
```

### 02 チャットタブ

```bash
git worktree add ../dsh-webui-m3e-02 -b feat/02-chat main
```

```bash
cd ../dsh-webui-m3e-02 && pnpm install
```

```bash
codex --model gpt-6-luna -c model_reasoning_effort=max
```

```text
あなたは dsh-webui-m3e の「02 チャットタブ」の担当です。
作業場所はこの worktree（ブランチ feat/02-chat）です。main ブランチには触らないでください。

1. AGENTS.md、docs/design/README.md、docs/design/02-chat.md を読んでください。
2. docs/design/02-chat.md の「担当するファイル」だけを変更して、担当範囲を実装してください。
3. 確かめるのは ?mock の偽データだけです。DSH は起動しないでください。
4. 担当外の変更や、拒否された操作・禁じられた操作が必要になったら、別の経路で回避せずに止めて、docs/design/02-chat.md の「実装メモ」に何が必要だったかを書いてください。
5. 「未確認のこと」は、今の画面のプラグイン（$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai/ の下。読むだけ）で確かめられる範囲で確かめ、結果を実装メモに書いてください。
6. 特に気をつけること：records から表示の列を作る処理を純粋な関数に分けてテストする。生成中の複数ブロックの同時進行と、末尾の追いかけ。
7. pnpm typecheck、pnpm test、pnpm build を通してください。
8. 自分のブランチにコミットしてください。メッセージは `<type>: <内容>` の形で、次のトレーラを付けてください。
   AI-Harness: Codex CLI
   AI-Model: GPT-6-Luna
   AI-Effort: max
   AI-Duration: <実際にかかった時間>
   AI-Cost: <費用。分からなければ unknown>
   AI-Task: 02-chat
9. 終わったら、次の 4 つを報告してください。
   - 実装したこと
   - 確かめたこと（3 つのコマンドの結果と、?mock で操作した画面）
   - 実装メモに書いた、未確認のことの結果と、自分で決めたこと
   - 担当外で必要になった変更（なければ「なし」）
```

### 03 入力欄と新しいセッション

```bash
git worktree add ../dsh-webui-m3e-03 -b feat/03-composer main
```

```bash
cd ../dsh-webui-m3e-03 && pnpm install
```

```bash
codex --model gpt-6-luna -c model_reasoning_effort=max
```

```text
あなたは dsh-webui-m3e の「03 入力欄と新しいセッション」の担当です。
作業場所はこの worktree（ブランチ feat/03-composer）です。main ブランチには触らないでください。

1. AGENTS.md、docs/design/README.md、docs/design/03-composer.md を読んでください。
2. docs/design/03-composer.md の「担当するファイル」だけを変更して、担当範囲を実装してください。
3. 確かめるのは ?mock の偽データだけです。DSH は起動しないでください。
4. 担当外の変更や、拒否された操作・禁じられた操作が必要になったら、別の経路で回避せずに止めて、docs/design/03-composer.md の「実装メモ」に何が必要だったかを書いてください。
5. 「未確認のこと」は、今の画面のプラグイン（$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai/ の下。読むだけ）で確かめられる範囲で確かめ、結果を実装メモに書いてください。
6. 特に気をつけること：画像の送り方、モデルと権限の切り替え方は、今の画面のプラグインを読んで確かめてから実装する。新しいセッションは最初の送信で作る。
7. pnpm typecheck、pnpm test、pnpm build を通してください。
8. 自分のブランチにコミットしてください。メッセージは `<type>: <内容>` の形で、次のトレーラを付けてください。
   AI-Harness: Codex CLI
   AI-Model: GPT-6-Luna
   AI-Effort: max
   AI-Duration: <実際にかかった時間>
   AI-Cost: <費用。分からなければ unknown>
   AI-Task: 03-composer
9. 終わったら、次の 4 つを報告してください。
   - 実装したこと
   - 確かめたこと（3 つのコマンドの結果と、?mock で操作した画面）
   - 実装メモに書いた、未確認のことの結果と、自分で決めたこと
   - 担当外で必要になった変更（なければ「なし」）
```

### 04 トレースタブ

```bash
git worktree add ../dsh-webui-m3e-04 -b feat/04-trace main
```

```bash
cd ../dsh-webui-m3e-04 && pnpm install
```

```bash
codex --model gpt-6-luna -c model_reasoning_effort=max
```

```text
あなたは dsh-webui-m3e の「04 トレースタブ」の担当です。
作業場所はこの worktree（ブランチ feat/04-trace）です。main ブランチには触らないでください。

1. AGENTS.md、docs/design/README.md、docs/design/04-trace.md を読んでください。
2. docs/design/04-trace.md の「担当するファイル」だけを変更して、担当範囲を実装してください。
3. 確かめるのは ?mock の偽データだけです。DSH は起動しないでください。
4. 担当外の変更や、拒否された操作・禁じられた操作が必要になったら、別の経路で回避せずに止めて、docs/design/04-trace.md の「実装メモ」に何が必要だったかを書いてください。
5. 「未確認のこと」は、今の画面のプラグイン（$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai/ の下。読むだけ）で確かめられる範囲で確かめ、結果を実装メモに書いてください。
6. 特に気をつけること：記録の種類の見分け方と所要時間の出し方は dsh-client-ui-trajectory に合わせる。下の検索バーでの絞り込み。
7. pnpm typecheck、pnpm test、pnpm build を通してください。
8. 自分のブランチにコミットしてください。メッセージは `<type>: <内容>` の形で、次のトレーラを付けてください。
   AI-Harness: Codex CLI
   AI-Model: GPT-6-Luna
   AI-Effort: max
   AI-Duration: <実際にかかった時間>
   AI-Cost: <費用。分からなければ unknown>
   AI-Task: 04-trace
9. 終わったら、次の 4 つを報告してください。
   - 実装したこと
   - 確かめたこと（3 つのコマンドの結果と、?mock で操作した画面）
   - 実装メモに書いた、未確認のことの結果と、自分で決めたこと
   - 担当外で必要になった変更（なければ「なし」）
```

### 05 承認・質問・プランの確認

```bash
git worktree add ../dsh-webui-m3e-05 -b feat/05-interactions main
```

```bash
cd ../dsh-webui-m3e-05 && pnpm install
```

```bash
codex --model gpt-6-luna -c model_reasoning_effort=max
```

```text
あなたは dsh-webui-m3e の「05 承認・質問・プランの確認」の担当です。
作業場所はこの worktree（ブランチ feat/05-interactions）です。main ブランチには触らないでください。

1. AGENTS.md、docs/design/README.md、docs/design/05-interactions.md を読んでください。
2. docs/design/05-interactions.md の「担当するファイル」だけを変更して、担当範囲を実装してください。
3. 確かめるのは ?mock の偽データだけです。DSH は起動しないでください。
4. 担当外の変更や、拒否された操作・禁じられた操作が必要になったら、別の経路で回避せずに止めて、docs/design/05-interactions.md の「実装メモ」に何が必要だったかを書いてください。
5. 「未確認のこと」は、今の画面のプラグイン（$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai/ の下。読むだけ）で確かめられる範囲で確かめ、結果を実装メモに書いてください。
6. 特に気をつけること：返事が必要なシートは払っても閉じない。「あとで」は 00 の defer を使う。承認のシートに引数は出せない。
7. pnpm typecheck、pnpm test、pnpm build を通してください。
8. 自分のブランチにコミットしてください。メッセージは `<type>: <内容>` の形で、次のトレーラを付けてください。
   AI-Harness: Codex CLI
   AI-Model: GPT-6-Luna
   AI-Effort: max
   AI-Duration: <実際にかかった時間>
   AI-Cost: <費用。分からなければ unknown>
   AI-Task: 05-interactions
9. 終わったら、次の 4 つを報告してください。
   - 実装したこと
   - 確かめたこと（3 つのコマンドの結果と、?mock で操作した画面）
   - 実装メモに書いた、未確認のことの結果と、自分で決めたこと
   - 担当外で必要になった変更（なければ「なし」）
```

## 段階 2b：残り（GPT-6-Luna、effort Max、5 本を並行）

2a の 5 本をレビューしてマージし、土台に問題があれば直して main に入れてから始めます。

### 06 対応待ちタブ

```bash
git worktree add ../dsh-webui-m3e-06 -b feat/06-inbox main
```

```bash
cd ../dsh-webui-m3e-06 && pnpm install
```

```bash
codex --model gpt-6-luna -c model_reasoning_effort=max
```

```text
あなたは dsh-webui-m3e の「06 対応待ちタブ」の担当です。
作業場所はこの worktree（ブランチ feat/06-inbox）です。main ブランチには触らないでください。

1. AGENTS.md、docs/design/README.md、docs/design/06-inbox.md を読んでください。
2. docs/design/06-inbox.md の「担当するファイル」だけを変更して、担当範囲を実装してください。
3. 確かめるのは ?mock の偽データだけです。DSH は起動しないでください。
4. 担当外の変更や、拒否された操作・禁じられた操作が必要になったら、別の経路で回避せずに止めて、docs/design/06-inbox.md の「実装メモ」に何が必要だったかを書いてください。
5. 「未確認のこと」は、今の画面のプラグイン（$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai/ の下。読むだけ）で確かめられる範囲で確かめ、結果を実装メモに書いてください。
6. 特に気をつけること：05 の完成を待たず、00 の仮の presentInteraction を呼ぶ形で作る。偽データは自分で emit する。
7. pnpm typecheck、pnpm test、pnpm build を通してください。
8. 自分のブランチにコミットしてください。メッセージは `<type>: <内容>` の形で、次のトレーラを付けてください。
   AI-Harness: Codex CLI
   AI-Model: GPT-6-Luna
   AI-Effort: max
   AI-Duration: <実際にかかった時間>
   AI-Cost: <費用。分からなければ unknown>
   AI-Task: 06-inbox
9. 終わったら、次の 4 つを報告してください。
   - 実装したこと
   - 確かめたこと（3 つのコマンドの結果と、?mock で操作した画面）
   - 実装メモに書いた、未確認のことの結果と、自分で決めたこと
   - 担当外で必要になった変更（なければ「なし」）
```

### 07 検索タブ

```bash
git worktree add ../dsh-webui-m3e-07 -b feat/07-search main
```

```bash
cd ../dsh-webui-m3e-07 && pnpm install
```

```bash
codex --model gpt-6-luna -c model_reasoning_effort=max
```

```text
あなたは dsh-webui-m3e の「07 検索タブ」の担当です。
作業場所はこの worktree（ブランチ feat/07-search）です。main ブランチには触らないでください。

1. AGENTS.md、docs/design/README.md、docs/design/07-search.md を読んでください。
2. docs/design/07-search.md の「担当するファイル」だけを変更して、担当範囲を実装してください。
3. 確かめるのは ?mock の偽データだけです。DSH は起動しないでください。
4. 担当外の変更や、拒否された操作・禁じられた操作が必要になったら、別の経路で回避せずに止めて、docs/design/07-search.md の「実装メモ」に何が必要だったかを書いてください。
5. 「未確認のこと」は、今の画面のプラグイン（$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai/ の下。読むだけ）で確かめられる範囲で確かめ、結果を実装メモに書いてください。
6. 特に気をつけること：入力の間引きと前の検索の中断。SessionSearchResultItem の中身と「さらに読み込む」の方法を確かめる。
7. pnpm typecheck、pnpm test、pnpm build を通してください。
8. 自分のブランチにコミットしてください。メッセージは `<type>: <内容>` の形で、次のトレーラを付けてください。
   AI-Harness: Codex CLI
   AI-Model: GPT-6-Luna
   AI-Effort: max
   AI-Duration: <実際にかかった時間>
   AI-Cost: <費用。分からなければ unknown>
   AI-Task: 07-search
9. 終わったら、次の 4 つを報告してください。
   - 実装したこと
   - 確かめたこと（3 つのコマンドの結果と、?mock で操作した画面）
   - 実装メモに書いた、未確認のことの結果と、自分で決めたこと
   - 担当外で必要になった変更（なければ「なし」）
```

### 08 設定タブ

```bash
git worktree add ../dsh-webui-m3e-08 -b feat/08-settings main
```

```bash
cd ../dsh-webui-m3e-08 && pnpm install
```

```bash
codex --model gpt-6-luna -c model_reasoning_effort=max
```

```text
あなたは dsh-webui-m3e の「08 設定タブ」の担当です。
作業場所はこの worktree（ブランチ feat/08-settings）です。main ブランチには触らないでください。

1. AGENTS.md、docs/design/README.md、docs/design/08-settings.md を読んでください。
2. docs/design/08-settings.md の「担当するファイル」だけを変更して、担当範囲を実装してください。
3. 確かめるのは ?mock の偽データだけです。DSH は起動しないでください。
4. 担当外の変更や、拒否された操作・禁じられた操作が必要になったら、別の経路で回避せずに止めて、docs/design/08-settings.md の「実装メモ」に何が必要だったかを書いてください。
5. 「未確認のこと」は、今の画面のプラグイン（$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai/ の下。読むだけ）で確かめられる範囲で確かめ、結果を実装メモに書いてください。
6. 特に気をつけること：スキーマから画面を作る部分を純粋な関数に分けてテストする。認証情報の値は二度と表示しない。
7. pnpm typecheck、pnpm test、pnpm build を通してください。
8. 自分のブランチにコミットしてください。メッセージは `<type>: <内容>` の形で、次のトレーラを付けてください。
   AI-Harness: Codex CLI
   AI-Model: GPT-6-Luna
   AI-Effort: max
   AI-Duration: <実際にかかった時間>
   AI-Cost: <費用。分からなければ unknown>
   AI-Task: 08-settings
9. 終わったら、次の 4 つを報告してください。
   - 実装したこと
   - 確かめたこと（3 つのコマンドの結果と、?mock で操作した画面）
   - 実装メモに書いた、未確認のことの結果と、自分で決めたこと
   - 担当外で必要になった変更（なければ「なし」）
```

### 09 会話の ⋮ メニューと補助の画面

```bash
git worktree add ../dsh-webui-m3e-09 -b feat/09-session-tools main
```

```bash
cd ../dsh-webui-m3e-09 && pnpm install
```

```bash
codex --model gpt-6-luna -c model_reasoning_effort=max
```

```text
あなたは dsh-webui-m3e の「09 会話の ⋮ メニューと補助の画面」の担当です。
作業場所はこの worktree（ブランチ feat/09-session-tools）です。main ブランチには触らないでください。

1. AGENTS.md、docs/design/README.md、docs/design/09-session-tools.md を読んでください。
2. docs/design/09-session-tools.md の「担当するファイル」だけを変更して、担当範囲を実装してください。
3. 確かめるのは ?mock の偽データだけです。DSH は起動しないでください。
4. 担当外の変更や、拒否された操作・禁じられた操作が必要になったら、別の経路で回避せずに止めて、docs/design/09-session-tools.md の「実装メモ」に何が必要だったかを書いてください。
5. 「未確認のこと」は、今の画面のプラグイン（$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai/ の下。読むだけ）で確かめられる範囲で確かめ、結果を実装メモに書いてください。
6. 特に気をつけること：ジョブを止める窓口とゴールの操作のメソッド名を確かめる。見つからなければ作らずに実装メモへ。
7. pnpm typecheck、pnpm test、pnpm build を通してください。
8. 自分のブランチにコミットしてください。メッセージは `<type>: <内容>` の形で、次のトレーラを付けてください。
   AI-Harness: Codex CLI
   AI-Model: GPT-6-Luna
   AI-Effort: max
   AI-Duration: <実際にかかった時間>
   AI-Cost: <費用。分からなければ unknown>
   AI-Task: 09-session-tools
9. 終わったら、次の 4 つを報告してください。
   - 実装したこと
   - 確かめたこと（3 つのコマンドの結果と、?mock で操作した画面）
   - 実装メモに書いた、未確認のことの結果と、自分で決めたこと
   - 担当外で必要になった変更（なければ「なし」）
```

### 10 ホーム画面に追加する Web アプリ

```bash
git worktree add ../dsh-webui-m3e-10 -b feat/10-pwa main
```

```bash
cd ../dsh-webui-m3e-10 && pnpm install
```

```bash
codex --model gpt-6-luna -c model_reasoning_effort=max
```

```text
あなたは dsh-webui-m3e の「10 ホーム画面に追加する Web アプリ」の担当です。
作業場所はこの worktree（ブランチ feat/10-pwa）です。main ブランチには触らないでください。

1. AGENTS.md、docs/design/README.md、docs/design/10-pwa.md を読んでください。
2. docs/design/10-pwa.md の「担当するファイル」だけを変更して、担当範囲を実装してください。
3. 確かめるのは ?mock の偽データだけです。DSH は起動しないでください。
4. 担当外の変更や、拒否された操作・禁じられた操作が必要になったら、別の経路で回避せずに止めて、docs/design/10-pwa.md の「実装メモ」に何が必要だったかを書いてください。
5. 「未確認のこと」は、今の画面のプラグイン（$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai/ の下。読むだけ）で確かめられる範囲で確かめ、結果を実装メモに書いてください。
6. 特に気をつけること：Service Worker は /m3e/ の下だけ。画面本体（index）は絶対にキャッシュしない。
7. pnpm typecheck、pnpm test、pnpm build を通してください。
8. 自分のブランチにコミットしてください。メッセージは `<type>: <内容>` の形で、次のトレーラを付けてください。
   AI-Harness: Codex CLI
   AI-Model: GPT-6-Luna
   AI-Effort: max
   AI-Duration: <実際にかかった時間>
   AI-Cost: <費用。分からなければ unknown>
   AI-Task: 10-pwa
9. 終わったら、次の 4 つを報告してください。
   - 実装したこと
   - 確かめたこと（3 つのコマンドの結果と、?mock で操作した画面）
   - 実装メモに書いた、未確認のことの結果と、自分で決めたこと
   - 担当外で必要になった変更（なければ「なし」）
```

## レビュー（GPT-6-Astra、effort Max）

各ブランチを main に入れる前に、1 本ずつ行います。段階 1 の土台も対象です。レビューは変更をしないので、どの worktree で動かしてもかまいません。

```bash
codex --model gpt-6-astra -c model_reasoning_effort=max
```

プロンプト（`<ブランチ>` と `<設計書>` を差し替える。例：`feat/03-composer` と `docs/design/03-composer.md`）：

```text
ブランチ <ブランチ> を、main に入れてよいかの観点でレビューしてください。ファイルは変更しないでください。

1. AGENTS.md、docs/design/README.md、<設計書> を読んでください。
2. `git diff main...<ブランチ>` と `git log main..<ブランチ>` で変更を確かめてください。
3. 次の点を確かめてください。
   - <設計書> の「担当するファイル」の外を変えていないか
   - package.json、ロックファイル、web/src/app/、web/src/dsh/ を変えていないか（段階 1 の feat/00-foundation を除く）
   - 段階 1 の仮の部品の引数と戻り値の形を変えていないか
   - 「完了条件」を満たしているか。「未確認のこと」の扱いが実装メモに書いてあるか
   - 正しく動かない箇所、画面が固まる箇所、DSH からの失敗を扱っていない箇所がないか
   - コミットのトレーラ（AI-Harness、AI-Model、AI-Effort、AI-Duration、AI-Cost、AI-Task）が揃っているか
4. そのブランチの worktree で pnpm typecheck、pnpm test、pnpm build を実行し、結果を書いてください。
5. 結論を「マージしてよい」「直してからマージ」「作り直しが必要」のどれかで出し、指摘は重い順に、ファイルと行、何が起きるか、直し方を添えて並べてください。
```

指摘を直すときは、そのブランチの worktree で、担当の Codex（GPT-6-Luna）に指摘をそのまま渡してください。
