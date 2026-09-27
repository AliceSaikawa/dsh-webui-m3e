import { test, expect, visit, action } from './helpers'

test('06 対応待ちの全行がそろい、長い題名と補足が行内で省略される', async ({ page }) => {
  await visit(page, '/inbox', 'inbox')
  await expect(action(page, '画面の幅が狭い場合でも')).toBeVisible()
  await expect(page.locator('#inbox-completed-heading')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)

  const rows = await page.locator('.inbox-row').evaluateAll(elements => elements.map(element => {
    const icon = element.querySelector('[slot="leading"]')
    const title = element.querySelector('.inbox-title')
    const description = element.querySelector('.inbox-description')
    const bounds = (node: Element | null) => {
      if (!node) throw new Error('対応待ち行の要素が見つかりません')
      const rect = node.getBoundingClientRect()
      return { left: rect.left, right: rect.right }
    }
    if (!title || !description) throw new Error('対応待ち行の文言が見つかりません')
    return {
      titleText: title.textContent ?? '',
      descriptionText: description.textContent ?? '',
      row: bounds(element),
      icon: bounds(icon),
      title: bounds(title),
      description: bounds(description),
      titleOverflow: title.scrollWidth > title.clientWidth,
      descriptionOverflow: description.scrollWidth > description.clientWidth,
    }
  }))

  expect(rows.length).toBeGreaterThanOrEqual(5)
  for (const key of ['icon', 'title', 'description'] as const) {
    const xs = rows.map(row => row[key].left)
    expect(Math.max(...xs) - Math.min(...xs), `${key} の左端: ${JSON.stringify(rows)}`).toBeLessThanOrEqual(1)
  }
  for (const row of rows) {
    expect(row.title.right, `${row.titleText} の題名が行内にある`).toBeLessThanOrEqual(row.row.right - 1)
    expect(row.description.right, `${row.titleText} の補足が行内にある`).toBeLessThanOrEqual(row.row.right - 1)
  }
  const longTitle = rows.find(row => row.titleText.includes('長い題名'))
  const longDescription = rows.find(row => row.descriptionText.includes('画面の幅が狭い場合でも'))
  expect(longTitle).toBeDefined()
  expect(longDescription).toBeDefined()
  expect(longTitle!.titleOverflow, '長い題名が省略される').toBe(true)
  expect(longDescription!.descriptionOverflow, '長い補足が省略される').toBe(true)
})
