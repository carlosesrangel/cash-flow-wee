import { test, expect } from '@playwright/test'
import { NAV_ITEMS } from '@/lib/nav'

function flattenHrefs(items: typeof NAV_ITEMS): string[] {
  const hrefs = items.flatMap((item) => [item.href, ...(item.children?.map((c) => c.href) ?? [])])
  // Dedupe: a parent item's own href can equal its first child's href
  // (e.g. "Fluxo de Caixa" -> /fluxo-de-caixa/diario), which would
  // otherwise register two Playwright tests with the same title.
  return [...new Set(hrefs)]
}

test.describe('authenticated navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('E-mail').fill('test@wee.com.br')
    await page.getByLabel('Senha').fill('senha12345')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page).toHaveURL(/\/visao-geral/)
  })

  for (const href of flattenHrefs(NAV_ITEMS)) {
    test(`route ${href} renders without error`, async ({ page }) => {
      const response = await page.goto(href)
      expect(response?.status()).toBeLessThan(400)
      await expect(page.locator('body')).not.toContainText('Application error')
    })
  }
})
