import { expect, test } from '@playwright/test'

test('県選択後の市区町村一覧に自治体コードを表示しない', async ({ page }) => {
  await page.goto('/map/webapp/region-picker.html')
  await expect(page.locator('#loading')).toBeHidden()

  await page.locator('.region-button[data-item-id="okayama"]').click()
  await expect(page.locator('#scope-label')).toContainText('岡山県')
  await expect(page.locator('#region-heading')).toHaveText('市区町村')

  const municipalityButtons = page.locator('#region-list .region-button.municipality')
  await expect(municipalityButtons.first()).toBeVisible()
  await expect(municipalityButtons.first().locator('.pref-code')).toHaveCount(0)

  const okayamaKita = page.locator('.region-button[data-item-id="okayama-kita"]')
  await expect(okayamaKita).toContainText('岡山市北区')
  await expect(okayamaKita).not.toContainText('33101')
})
