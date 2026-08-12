import { test, expect } from '@playwright/test'

test('unauthenticated user is redirected to /login', async ({ page }) => {
  await page.goto('/visao-geral')
  await expect(page).toHaveURL(/\/login/)
})

test('user can log in and reach /visao-geral', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('E-mail').fill('test@wee.com.br')
  await page.getByLabel('Senha').fill('senha12345')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/visao-geral/)
  await expect(page.getByRole('heading', { name: 'Visão Geral' })).toBeVisible()
})
