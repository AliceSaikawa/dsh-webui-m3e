import { test, expect, visit } from './helpers'

const displayReason = 'Allow this operation with danger-full-access permissions: verify the approval sheet in a test'

test('122 承認シートは内部の reason ではなく displayReason の英語を出す', async ({ page }) => {
  await visit(page, '/s/approval-sheet', 'approval')
  const dialog = page.getByRole('dialog', { name: 'ツールの承認', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.interaction-detail')).toHaveText(displayReason)
  await expect(dialog).not.toContainText('escalate sandbox')
})
