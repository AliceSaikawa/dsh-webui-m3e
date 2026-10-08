import { test, expect, button, openM3e } from './fixtures.ts'
import { dshVersion } from './dsh-host.ts'
import { MARK } from './fake-llm.ts'

test(`DSH ${dshVersion}: 合成バックグラウンドジョブを一覧から停止し購読で停止済みになる`, async ({ page, integration }) => {
  await openM3e(page, integration.host)
  await button(page, 'ワークスペースを追加').click()
  await button(page, 'ここを追加').click()
  await button(page, '新しいセッション').click()
  await page.getByLabel('メッセージ入力欄').fill(`${MARK.job} 合成ジョブの停止確認`)
  await button(page, '送信').click()
  await expect(page).toHaveURL(/#\/s\/[^/]+$/)
  // Depending on the isolated profile's approval policy, approve this test-only sleep.
  const approved = button(page, '許可（1 回）')
  const response = page.getByText('ツールの結果を受け取りました。', { exact: true })
  await expect(approved.or(response)).toBeVisible()
  if (await approved.isVisible()) await approved.click()
  await expect(response).toBeVisible()
  const sessionId = decodeURIComponent(new URL(page.url()).hash.slice('#/s/'.length))
  await page.goto(`${integration.host.origin}/m3e/#/s/${encodeURIComponent(sessionId)}/jobs`)
  const stop = page.getByRole('button', { name: /を停止$/ })
  await expect(stop).toHaveCount(1)
  await stop.click()
  await expect(page.getByRole('list', { name: 'ジョブの一覧' })).toContainText('停止済み')
  await expect(stop).toHaveCount(0)
  await expect(page.getByRole('alert')).toHaveCount(0)
})
