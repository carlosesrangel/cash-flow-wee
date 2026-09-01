import { test, expect } from '@playwright/test'

const email = process.env.E2E_USER_EMAIL
const password = process.env.E2E_USER_PASSWORD
const hasCredentials = Boolean(email && password)

test('unauthenticated user is redirected to /login', async ({ page }) => {
  await page.goto('/visao-geral')
  await expect(page).toHaveURL(/\/login/)
})

test('user can log in and reach /visao-geral', async ({ page }) => {
  test.skip(!hasCredentials, 'E2E_USER_EMAIL/E2E_USER_PASSWORD not provided')
  await page.goto('/login')
  await page.getByLabel('E-mail').fill(email!)
  await page.getByLabel('Senha').fill(password!)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL(/\/visao-geral/)
  await expect(page.getByRole('heading', { name: 'Visão Geral' })).toBeVisible()
})
