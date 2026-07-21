import { test, expect } from '@playwright/test'

/**
 * Placeholder smoke: AppShell mounts and shell navigation is reachable.
 * Feature E2E (empty states, import wizard, profile charts) lands with G-6 / C-7.
 */
test('app shell loads', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('body')).toBeVisible()
})
