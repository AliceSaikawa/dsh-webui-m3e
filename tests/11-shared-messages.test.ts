import assert from 'node:assert/strict'
import test from 'node:test'
import { catalogProblems, untranslatedLocales } from '../web/src/i18n/catalog.ts'
import { permissionPresetMessages, remoteErrorMessages } from '../web/src/dsh/messages.ts'
import { presetDescription, presetDisplayName, type PermissionPresetTexts } from '../web/src/dsh/permission-presets.ts'
import { REMOTE_CODE_KEYS, RemoteCallError, remoteErrorMessage, type RemoteErrorTexts } from '../web/src/dsh/remote-result.ts'
import { markdownMessages, overlayMessages, shellMessages } from '../web/src/app/messages.ts'

/** The Japanese text of every Host failure code before the move into a dictionary (copied from the old table). */
const JAPANESE_BY_CODE: readonly (readonly [string, string])[] = [
  ['gateway/bad-request', '送信内容を確認して、もう一度お試しください。'],
  ['gateway/internal', 'サーバーでエラーが発生しました。しばらく待ってから、もう一度お試しください。'],
  ['session/not-found', '会話が見つかりません。'],
  ['session/title-invalid', '会話の題名を入力してください。'],
  ['session/agent-busy', '実行中の処理が終わってから、もう一度お試しください。'],
  ['session/model-unavailable', '選んだモデルを利用できません。モデルを選び直してください。'],
  ['session/provider-models-unavailable', 'この提供元で利用できるモデルがありません。提供元の設定を確認するか、モデルを選び直してください。'],
  ['session/projections-unavailable', '会話の状態を読み込めませんでした。会話を開き直してください。'],
  ['session/writer-held', 'この会話はほかの処理が操作中です。処理が終わってから、もう一度お試しください。'],
  ['session/fork-unavailable', 'この位置からは会話を分岐できません。'],
  ['session/queue-item-not-found', 'このメッセージはすでに順番待ちから外れています。'],
  ['session/steer-unavailable', 'このメッセージでは実行中の処理に割り込めません。'],
  ['session/attachment-invalid', '添付ファイルを送れません。内容やサイズを確認してください。'],
  ['workspace/invalid-path', 'このフォルダを利用できません。パスを確認してください。'],
  ['workspace/name-conflict', '同じ名前のワークスペースがあります。'],
  ['workspace/move-invalid', 'この場所には移動できません。'],
  ['session/provider-credentials-unavailable', 'API キーの登録状況を確認する機能を利用できません。DSH の構成を確認してください。'],
  ['workspace/session-active', '実行中の会話はアーカイブできません。実行を止めてから、もう一度お試しください。'],
  ['workspace-file/watch-unsupported', 'このファイルの更新通知は利用できません。読み直して確認してください。'],
  ['directory-picker/unavailable', 'フォルダの選択を利用できません。'],
  ['directory-picker/unreadable', 'このフォルダを読み取れません。'],
  ['directory-picker/exists', '同じ名前のフォルダがすでにあります。'],
  ['directory-picker/create-failed', 'フォルダを作れませんでした。'],
]
const failure = (code: string) => ({ code, message: 'host diagnostic', details: {} })

test('共通の部品の辞書のキーはそろい、訳は未着手（null）のまま', () => {
  for (const catalog of [shellMessages, overlayMessages, markdownMessages, remoteErrorMessages, permissionPresetMessages]) {
    assert.deepEqual(catalogProblems(catalog as never), [])
    assert.deepEqual(untranslatedLocales(catalog as never), ['en', 'zh'])
  }
})

test('Host の失敗コードごとの日本語の文言は、辞書へ移す前の表と同じ', () => {
  assert.equal(JAPANESE_BY_CODE.length, Object.keys(REMOTE_CODE_KEYS).length)
  for (const [code, text] of JAPANESE_BY_CODE) {
    assert.equal(remoteErrorMessage(failure(code)), text, code)
    assert.equal(remoteErrorMessage(failure(code), 'fallback must not win'), text, code)
    assert.equal(remoteErrorMessage({ rpcError: failure(code) }), text, code)
    assert.equal(new RemoteCallError(failure(code)).message, text, code)
  }
})

test('失敗コードの辞書のキーは、使われていないものも足りないものもない', () => {
  const generic = ['failed', 'cancelled', 'disconnected', 'timeout']
  const used = Object.values(REMOTE_CODE_KEYS) as string[]
  assert.equal(new Set(used).size, used.length)
  assert.deepEqual([...used, ...generic].sort(), Object.keys(remoteErrorMessages.ja).sort())
})

test('コードの系統ごとの文言と、既定の文言', () => {
  assert.equal(remoteErrorMessage(failure('session/aborted')), '操作を取り消しました。')
  assert.equal(remoteErrorMessage(failure('x/cancelled')), '操作を取り消しました。')
  assert.equal(remoteErrorMessage(failure('gateway/transport-closed')), '接続できません。接続を確認して、もう一度お試しください。')
  assert.equal(remoteErrorMessage(failure('foo/unavailable')), '接続できません。接続を確認して、もう一度お試しください。')
  assert.equal(remoteErrorMessage(failure('gateway/timeout')), '応答を待ちきれませんでした。もう一度お試しください。')
  assert.equal(remoteErrorMessage(failure('unknown/code')), '処理に失敗しました。もう一度お試しください。')
  assert.equal(remoteErrorMessage(failure('unknown/code'), '保存できませんでした。'), '保存できませんでした。')
  assert.equal(remoteErrorMessage(new Error('boom')), '処理に失敗しました。もう一度お試しください。')
  assert.equal(remoteErrorMessage(undefined, '独自の文言'), '独自の文言')
  assert.equal(remoteErrorMessage(Object.assign(new Error('x'), { name: 'AbortError' }), '独自の文言'), '操作を取り消しました。')
})

test('Object.prototype のキーと同じコードは、固有の文言ではなく既定の文言になる', () => {
  for (const code of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.equal(remoteErrorMessage(failure(code)), '処理に失敗しました。もう一度お試しください。', code)
  }
})

test('remoteErrorMessage は渡した辞書の文言で組み立てる', () => {
  const text: RemoteErrorTexts = { ...remoteErrorMessages.ja, failed: 'FAILED', cancelled: 'CANCELLED', disconnected: 'OFFLINE', timeout: 'SLOW', sessionNotFound: 'NO SESSION' }
  assert.equal(remoteErrorMessage(failure('session/not-found'), undefined, text), 'NO SESSION')
  assert.equal(remoteErrorMessage(failure('abort'), undefined, text), 'CANCELLED')
  assert.equal(remoteErrorMessage(failure('transport'), undefined, text), 'OFFLINE')
  assert.equal(remoteErrorMessage(failure('timeout'), undefined, text), 'SLOW')
  assert.equal(remoteErrorMessage(failure('other'), undefined, text), 'FAILED')
  assert.equal(remoteErrorMessage(failure('other'), 'own', text), 'own')
  assert.equal(remoteErrorMessage(new Error('x'), undefined, text), 'FAILED')
  assert.equal(remoteErrorMessage(Object.assign(new Error('x'), { name: 'AbortError' }), undefined, text), 'CANCELLED')
})

test('権限プリセットの名前と説明は、辞書へ移す前と同じ日本語で、渡した辞書に従う', () => {
  const ja = permissionPresetMessages.ja
  assert.equal(ja.readOnly, '読み取りのみ')
  assert.equal(ja.workspaceWrite, 'ワークスペース書込')
  assert.equal(ja.dangerFullAccess, 'フル アクセス')
  assert.equal(ja.autoReview, '自動レビュー（実験的）')
  assert.equal(ja.custom, 'カスタム')
  assert.equal(ja.autoReviewDescription, 'サンドボックスなしで動きます。ツールを呼び出すたびに、同じモデルが実験的に確認します。')
  const text: PermissionPresetTexts = { ...ja, readOnly: 'RO', workspaceWrite: 'WW', dangerFullAccess: 'FULL', autoReview: 'AUTO', custom: 'CUSTOM',
    workspaceWriteDescription: 'WW-D', dangerFullAccessDescription: 'FULL-D', autoReviewDescription: 'AUTO-D' }
  assert.equal(presetDisplayName('read-only', 'Read Only', text), 'RO')
  assert.equal(presetDisplayName('workspace-write', 'workspace-write', text), 'WW')
  assert.equal(presetDisplayName('danger-full-access', '', text), 'FULL')
  assert.equal(presetDisplayName('auto', 'whatever', text), 'AUTO')
  assert.equal(presetDisplayName('custom', 'whatever', text), 'CUSTOM')
  assert.equal(presetDisplayName('workspace-write', '仕事用', text), '仕事用')
  assert.equal(presetDescription('auto', undefined, text), 'AUTO-D')
  assert.equal(presetDescription('workspace-write', 'Write inside the workspace and permitted temporary directories; wider retries require approval.', text), 'WW-D')
  assert.equal(presetDescription('danger-full-access', 'Full file access without approval prompts.', text), 'FULL-D')
  assert.equal(presetDescription('danger-full-access', 'custom copy', text), 'custom copy')
})

test('Object.prototype のキーと同じプリセットは、組み込みとして扱わない', () => {
  for (const value of ['constructor', 'toString', '__proto__']) {
    assert.equal(presetDisplayName(value, ''), value)
    assert.equal(presetDisplayName(value, 'Host name'), 'Host name')
    assert.equal(presetDescription(value, 'Host copy'), 'Host copy')
    assert.equal(presetDescription(value, undefined), undefined)
  }
})

test('画面の骨格・重ね表示・画像の代わりの文言は、移す前と同じ日本語', () => {
  const shell = shellMessages.ja
  assert.deepEqual([shell.back, shell.homeTab, shell.searchTab, shell.inboxTab, shell.settingsTab, shell.mainNavigation],
    ['戻る', '一覧', '検索', '対応待ち', '設定', 'メインナビゲーション'])
  assert.equal(shell.inboxTabWithCount(3), '対応待ち 3 件')
  assert.equal(shell.staleMinutes(0), '0 分前のデータを表示しています')
  assert.equal(shell.staleMinutes(12), '12 分前のデータを表示しています')
  assert.deepEqual([shell.reconnecting, shell.staleWithoutTime, shell.disconnected, shell.reconnect, shell.openFailed],
    ['再接続中', '保存済みのデータを表示しています', 'DSH との接続が切れました', '再接続', '会話を開けませんでした。もう一度お試しください。'])
  const overlay = overlayMessages.ja
  assert.deepEqual([overlay.close, overlay.dialogLabel, overlay.sheetLabel, overlay.sheetHandle, overlay.promptLabel, overlay.promptConfirm, overlay.cancel, overlay.saveFailed],
    ['閉じる', '確認', '操作', 'シートの高さを変更', '名前', 'OK', 'キャンセル', '保存できませんでした。もう一度お試しください。'])
  assert.equal(markdownMessages.ja.image, '画像')
  assert.equal(markdownMessages.ja.imageNamed('図 1'), '画像：図 1')
})
