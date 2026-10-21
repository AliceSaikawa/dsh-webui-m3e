# Changelog

使う人に見える変更を、版ごとにまとめます。形式は [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) です。版番号は [Semantic Versioning](https://semver.org/spec/v2.0.0.html) です。

各版の項目は、その版の GitHub Release の本文から移しました。Release が無い版の項目は書いていません。`package.json` の履歴には 0.0.1 から 0.0.7 までがあります。これらの GitHub Release は無いので、ここには節を置いていません。

入れ方、試験の件数、tgz のハッシュは Release に残しています。ここには移していません。

Release の見出しは、次の見出しに移しました。

- New Features は Added です。
- Bug Fixes は Fixed です。
- Improvements と Updated DSH Support は Changed です。
- Maintenance は Changed です。

0.0.8 の Release には上の見出しがありません。「この版の内容」の 3 項目を、文のまま置いています。

0.0.9-rc.1 は、その後のプレリリースの祖先ではありません。rc.2 の Release は、実機確認用の 3 コミットが rc.2 に含まれないと書いています。その文もここに残しています。

## [Unreleased]

## [0.0.9-rc.4] - 2026-10-21

対応する DSH は **0.2.1-rc.2** だけです。0.2.0-rc.2 では起動しません。0.2.0-rc.2 を使い続ける場合は [v0.0.8](https://github.com/AliceSaikawa/dsh-webui-m3e/releases/tag/v0.0.8) を使ってください。

### Added

- **settings:** 設定に「一般」を足し、「コーディングビューを表示」を標準の画面と同じ `ui-settings` の `enabled` に保存する。オフにすると PTC と最小を選べなくなり、標準の画面ではトレースやコードの差分の表示も切り替わる ([#164](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/164))
- **settings:** 「一般」に「作業の詳細」「折りたたむタイミング」「パフォーマンスと使用状況」を足し、標準の画面の `ui-chat` に保存する。M3E の会話画面はまだこの値を読まず、標準の画面の表示に使われる。以前の `normal` と `expanded` は「詳細」として読む ([#165](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/165))
- **settings:** 「言語」をツールのページから「一般」へ移す。「端末の言語に合わせる」は保存した値を消し、標準の画面は English か中文の端末だけそれに合わせ、それ以外は English になる。M3E の画面は日本語のままである ([#166](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/166))

## [0.0.9-rc.3] - 2026-10-21

対応する DSH は **0.2.1-rc.2** だけです。0.2.0-rc.2 では起動しません。0.2.0-rc.2 を使い続ける場合は [v0.0.8](https://github.com/AliceSaikawa/dsh-webui-m3e/releases/tag/v0.0.8) を使ってください。

### Added

- **chat:** メッセージの操作のシートに「テキストを選択」を足し、本文の一部だけを選んでコピーできるようにする ([#157](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/157))
- **composer:** 入力欄の権限のボタンに、今の権限（読み取りのみ・ワークスペース書込・フル アクセス・自動レビュー）のアイコンを出す ([#149](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/149))
- **session-tools:** 会話の入力欄の上にゴールのストリップを出し、目標と状態の確認、一時停止／再開、目標の編集（Host が対応しているときだけ）をできるようにする。`/goal` の実行は右寄せの吹き出しで残す ([#139](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/139))
- **session-tools:** 統計のシートに、会話全体のキャッシュヒット率を出す ([#148](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/148))
- **settings:** コード作業（Coding Tools）がオフのとき、「モード」のページで PTC と最小を隠し、隠したモードが新しい会話の既定なら標準に戻す ([#150](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/150))

### Changed

- **docs:** README.md を英語の正本にし、日本語は README.ja.md に移す。3 言語の README の一致を試験で検査する ([#158](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/158))
- **docs:** README に、ホーム画面に追加した Web アプリは未確認であることを書き、実機確認の書き方をそろえる ([#152](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/152))
- **docs:** squash マージのメッセージの書き方と AI-Agent トレーラを `docs/git-workflow.md` に記す ([#146](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/146))
- **i18n:** 共通の画面の骨組み・オーバーレイ・Host の失敗理由の文言を辞書に移す ([#159](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/159))
- **i18n:** 用語の対応表（`docs/i18n/glossary.md`）を足し、「テキストを選択」のシートの試験を広げる ([#161](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/161))
- **session-tools:** 停止中（disarmed）のゴールのストリップと、ストリップとゴール画面の表示が食い違わないことを試験する ([#160](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/160))

### Fixed

- **composer:** 新しい会話の下書きで選んだ権限が候補から消えたとき、その権限を送らず既定に戻して知らせる ([#151](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/151))

## [0.0.9-rc.2] - 2026-10-20

対応する DSH は **0.2.1-rc.2** だけです。0.2.0-rc.2 では起動しません。0.2.0-rc.2 を使い続ける場合は [v0.0.8](https://github.com/AliceSaikawa/dsh-webui-m3e/releases/tag/v0.0.8) を使ってください。

main から作ったプレリリースです。v0.0.9-rc.1 にあった Android 実機確認用の 3 コミット（`?diag` の計測表示、Firefox（Gecko）のフォーカス修正、Gecko での e2e）は main に入っていないため、この版には含まれません（[#98](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/98)）。それ以外の rc.1 の変更はすべて含まれます。

### Added

- **app:** 描画の失敗・存在しない画面・開けない会話・起動時のオフラインを、共通のエラー画面で案内する ([#114](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/114)), closes [#93](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/93)
- **composer:** cache-sentinel が入力を止めたセッションで、入力欄の上に警告と「次の 1 回を許可」のボタンを出す ([#111](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/111)), closes [#97](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/97)
- **home:** セッションを一覧の上にピン留めする ([#112](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/112)), closes [#99](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/99)
- **home:** アーカイブ済みのセッションを必要なときだけ表示し、元に戻せるようにする ([#113](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/113)), closes [#100](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/100)
- **home:** 一覧の並べ方を「手動」と「最近の更新順」から選ぶ ([#117](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/117)), refs [#101](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/101)
- **settings:** 端末ごとに画面の基準の色を選ぶ ([#110](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/110)), closes [#102](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/102)
- **settings:** 読み取り専用のプラグインの一覧を追加する ([#116](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/116)), refs [#96](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/96)
- **settings:** 「モード」のページで、エージェントのプリセットを一覧し、新しい会話の既定を選ぶ（Creator モードは未対応） ([#138](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/138)), refs [#123](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/123)

### Changed

- **dsh:** 対応する DSH を 0.2.1-rc.2 に上げる（0.2.0-rc.2 への対応は外す） ([#129](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/129)), closes [#128](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/128)
- **composer:** 入力欄の下の行で、権限をアイコンに、モデル名を送信ボタンの左に出す ([#109](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/109)), closes [#106](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/106)
- **ui-choice:** `/m3e/` を表示したあと URL から `/m3e/` を消したタブでは、`/` を標準の画面のまま開く ([#107](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/107)), closes [#104](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/104)
- **ui-choice:** マウスやトラックパッドが主な入力の端末では、`/` から `/m3e/` へ自動で移動しない ([#108](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/108)), closes [#105](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/105)
- **docs:** 3 言語の README を main と配布済みの 0.0.8 に合わせる ([#115](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/115)), refs [#95](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/95)
- **docs:** ブランチ・コミット・PR・マージの決まりを `docs/git-workflow.md` にまとめる ([#130](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/130))
- **i18n:** 対応待ち・検索・質問と承認・セッションのツール・トレースの文言を辞書に移す ([#118](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/118), [#119](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/119), [#121](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/121), [#134](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/134), [#135](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/135)), refs [#78](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/78)

### Fixed

- **composer:** ワークスペース登録を再試行する前に編集した下書きを守る ([#137](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/137)), closes [#125](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/125)
- **host:** Cookie なしで `/m3e/` を読み込んだとき、英語の 401 の代わりに理由とアドレスバーからの開き直しを案内する ([#124](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/124)), refs [#91](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/91)
- **interactions:** 承認のシートで、内部の理由ではなく displayReason を表示する ([#132](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/132)), closes [#122](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/122)
- **permission:** 組込みの権限プリセットを日本語の名前で表示し、同じプリセットを選び直したときは送らない ([#120](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/120)), refs [#103](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/103)
- **settings:** 交差したスキーマの親が持つ password の扱いを、項目の展開で落とさない ([#133](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/133)), closes [#127](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/127)
- **settings:** 自動保存の前に画面を離れても入力を保存し、失敗したら知らせる ([#136](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/136)), closes [#126](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/126)

## [0.0.9-rc.1] - 2026-10-17

Android（realme GT 7 Pro・Iceraven）での実機確認用のプレリリース（[#98](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/98)）。対応する DSH は 0.2.0-rc.2。

### Added

- **diag:** 実機の確認用に `?diag` で計測値（viewport・safe-area・キーボード・fps など）を画面に重ねて表示する, refs [#98](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/98)
- **i18n:** 画面の多言語化の土台を作る（言語の決定・型付き辞書・書式・lang 属性） ([#90](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/90))
- **settings:** カスタムプロバイダーの追加・編集画面を作る ([#23](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/23)), refs [#16](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/16)

### Changed

- **ci:** PR 検証の CI を追加し、skip を失敗にする ([#55](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/55))
- **ci:** draft 解除での二重実行をやめ、check-pack を npm 11 以降に対応させる ([#74](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/74))
- **deps:** 開発依存の source-map-js を 1.2.2 へ更新する ([#82](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/82)), closes [#81](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/81)
- **e2e:** e2e を型検査の対象にし、既存の spec の型エラーを直す ([#75](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/75))
- **e2e:** 偽データの e2e を Firefox（Gecko）でも実行できるようにする, refs [#98](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/98)
- **e2e:** 偽データの e2e が mock のソースを書き換えずに ctx を受け取れるようにする ([#88](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/88))
- **test:** 表示の golden 比較をタイムゾーンに依存させない ([#76](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/76))

### Fixed

- **a11y:** シートのフォーカスを戻し、回答の送信を読み上げる ([#62](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/62)), closes [#44](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/44)
- **boot:** 起動に失敗したとき、読み直すボタンを出す ([#63](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/63)), closes [#47](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/47)
- **chat:** 返事の確定時の重複とブロック順の入れ替わりを防ぐ ([#53](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/53)), closes [#48](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/48)
- **chat:** call ID が再利用されてもツールの結果を取り違えない ([#52](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/52)), closes [#32](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/32)
- **composer:** モデルの変更を順番に処理し、編集中の下書きを保つ ([#61](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/61)), closes [#41](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/41)
- **composer:** 入力欄の操作先を保ち、高さが低い画面でも操作に届くようにする ([#69](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/69)), closes [#29](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/29) [#31](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/31)
- **composer:** ワークスペース登録の再試行中に、会話画面で書いた下書きを上書きしない ([#86](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/86)), closes [#79](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/79)
- **composer:** Firefox（Gecko）でシートを閉じた後と再送の後に入力へフォーカスを戻す, refs [#98](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/98)
- **files:** 変更の通知のあと、ファイルの最新の版を確かめる ([#60](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/60)), closes [#38](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/38)
- **home:** パンくずのタップ領域を使える大きさに保つ ([#67](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/67)), closes [#34](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/34)
- **inbox:** 対応待ちから離れた後も要求シートを開けるようにする ([#50](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/50)), closes [#39](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/39)
- **interactions:** 送信に失敗した質問が取り消されたらシートを閉じる ([#57](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/57)), closes [#40](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/40)
- **interactions:** 対応待ちの登録が失敗しても呼び出し元の store を破棄しない ([#83](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/83))
- **jobs:** 購読の失敗を表示し、実行中のジョブを止められるようにする ([#64](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/64)), closes [#36](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/36) [#37](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/37)
- **layout:** 横向きの画面で、すべての画面が safe-area を守る ([#70](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/70)), closes [#25](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/25)
- **layout:** スナックバーを下のナビゲーションと safe-area の上に出す ([#68](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/68)), closes [#24](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/24)
- **layout:** 全画面のシートを viewport の高さに保つ ([#72](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/72)), closes [#28](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/28)
- **layout:** 会話のメニューを開く前に測り、画面からはみ出さないようにする ([#71](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/71)), closes [#30](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/30)
- **navigation:** 実際に表示できた会話だけを既読にする ([#59](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/59)), closes [#42](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/42) [#43](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/43)
- **pack:** 配布物の検査で、ディレクトリとリンクの項目も確かめる ([#56](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/56)), closes [#35](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/35)
- **reasoning:** 推論の「指定なし」が下位の設定を継承してしまう問題を直す ([#51](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/51)), closes [#45](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/45)
- **scroll:** 履歴の読み込み中も読書位置を保つ ([#58](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/58)), closes [#49](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/49)
- **settings:** API キーのシートを閉じたときや切断時に、入力したキーを破棄する ([#65](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/65)), closes [#27](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/27)
- **settings:** リセットや切断のあとも保存前の入力を保つ ([#66](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/66)), closes [#46](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/46)
- **settings:** 壊れたデータの大きさを制限し、設定の再読み込みをまとめる ([#73](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/73)), closes [#33](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/33)
- **settings:** 保存と再読み込みが重なっても、ほかの名前空間の更新を取りこぼさない ([#84](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/84)), closes [#80](https://github.com/AliceSaikawa/dsh-webui-m3e/issues/80)
- **settings:** カスタムプロバイダーのフォームで、入力したキーを HTML の value 属性へ複製しない ([#85](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/85))
- **settings:** 設定スキーマの上限で名前空間ごと消さず、超えた部分だけを省略する ([#89](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/89))
- **trace:** 打ち切りを理由ごとの印で示し、一部だけ検索したことを表示する ([#87](https://github.com/AliceSaikawa/dsh-webui-m3e/pull/87))

## [0.0.8] - 2026-10-05

DeepSeek Harness（DSH）0.2.0-rc.2 に対応した、最初の配布版です。

- DSH 0.2.0-rc.2 への移行（0.1.5 系への対応は外しました）
- 期限つきの質問への回答に対応
- 配布物の検査と、本番のビルドに偽データが入らないことの検査を追加

[Unreleased]: https://github.com/AliceSaikawa/dsh-webui-m3e/compare/v0.0.9-rc.4...HEAD
[0.0.9-rc.4]: https://github.com/AliceSaikawa/dsh-webui-m3e/compare/v0.0.9-rc.3...v0.0.9-rc.4
[0.0.9-rc.3]: https://github.com/AliceSaikawa/dsh-webui-m3e/compare/v0.0.9-rc.2...v0.0.9-rc.3
[0.0.9-rc.2]: https://github.com/AliceSaikawa/dsh-webui-m3e/compare/v0.0.9-rc.1...v0.0.9-rc.2
[0.0.9-rc.1]: https://github.com/AliceSaikawa/dsh-webui-m3e/compare/v0.0.8...v0.0.9-rc.1
[0.0.8]: https://github.com/AliceSaikawa/dsh-webui-m3e/releases/tag/v0.0.8
