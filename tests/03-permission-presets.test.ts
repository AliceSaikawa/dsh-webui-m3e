import assert from 'node:assert/strict'
import test from 'node:test'
import { presetDescription, presetDisplayName } from '../web/src/dsh/permission-presets.ts'

test('組み込みのプリセットはキーのままの名前なら日本語の表示名にする', () => {
  assert.equal(presetDisplayName('read-only', 'read-only'), '読み取りのみ')
  assert.equal(presetDisplayName('workspace-write', 'workspace-write'), 'ワークスペース書込')
  assert.equal(presetDisplayName('danger-full-access', 'danger-full-access'), 'フル アクセス')
})

test('標準の英語の名前も日本語の表示名に置き換える', () => {
  assert.equal(presetDisplayName('read-only', 'Read Only'), '読み取りのみ')
  assert.equal(presetDisplayName('workspace-write', 'Workspace Write'), 'ワークスペース書込')
  assert.equal(presetDisplayName('danger-full-access', 'Full access'), 'フル アクセス')
  assert.equal(presetDisplayName('danger-full-access', 'FULL ACCESS'), 'フル アクセス')
})

test('ホストが付けた名前はそのまま出し、名前が空ならキーを使う', () => {
  assert.equal(presetDisplayName('workspace-write', 'ワークスペース書込'), 'ワークスペース書込')
  assert.equal(presetDisplayName('workspace-write', '仕事用の権限'), '仕事用の権限')
  assert.equal(presetDisplayName('read-only', ''), '読み取りのみ')
  assert.equal(presetDisplayName('deployment-specific', ''), 'deployment-specific')
})

test('auto と custom はいつも決まった日本語の表示名にする', () => {
  assert.equal(presetDisplayName('auto', ''), '自動レビュー（実験的）')
  assert.equal(presetDisplayName('auto', 'Auto review'), '自動レビュー（実験的）')
  assert.equal(presetDisplayName('auto', '自動'), '自動レビュー（実験的）')
  assert.equal(presetDisplayName('custom', ''), 'カスタム')
  assert.equal(presetDisplayName('custom', 'Custom'), 'カスタム')
})

test('組み込みの説明は標準の英語のときだけ日本語にする', () => {
  assert.equal(presetDescription('workspace-write', 'Write inside the workspace and permitted temporary directories; wider retries require approval.'),
    '作業フォルダと許可された一時フォルダの中に書き込めます。範囲を広げるときは確認します。')
  assert.equal(presetDescription('danger-full-access', 'Full file access without approval prompts.'), '確認なしで、すべてのファイルにアクセスできます。')
  assert.equal(presetDescription('read-only', 'Read files only.'), 'ファイルの読み取りだけを許可します。書き込みやコマンドの実行は確認します。')
})

test('日本語の説明とホスト固有の説明はそのままにする', () => {
  assert.equal(presetDescription('danger-full-access', 'サンドボックスを使いません。'), 'サンドボックスを使いません。')
  assert.equal(presetDescription('workspace-write', '仕事用の説明です。'), '仕事用の説明です。')
  assert.equal(presetDescription('deployment-specific', 'Deployment-specific text.'), 'Deployment-specific text.')
})

test('auto の説明と、説明が無いときの扱いを揃える', () => {
  assert.equal(presetDescription('auto', 'Run without a sandbox.'), 'サンドボックスなしで動きます。ツールを呼び出すたびに、同じモデルが実験的に確認します。')
  assert.equal(presetDescription('auto', undefined), 'サンドボックスなしで動きます。ツールを呼び出すたびに、同じモデルが実験的に確認します。')
  assert.equal(presetDescription('workspace-write', undefined), undefined)
  assert.equal(presetDescription('deployment-specific', undefined), undefined)
})
