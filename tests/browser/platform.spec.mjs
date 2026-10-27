import { test, expect } from '@playwright/test';

test('cross-border workspace resolves identity, searches inventory and explains trade assumptions', async ({ page }) => {
  await page.goto('/#platform');
  await expect(page.getByRole('heading', { name: 'From salvage yard to cross-border sale' })).toBeVisible();
  await page.getByLabel('Search by part number, stock ID, make, model or donor vehicle').fill('DEMO-01');
  await page.getByRole('button', { name: 'Search inventory' }).click();
  await expect(page.getByText('DEMO-01', { exact: true }).first()).toBeVisible();

  await page.getByRole('tab', { name: 'Vehicle identity' }).click();
  await page.getByLabel('VIN, chassis, registration or part number').fill('87910-02A10');
  await page.getByRole('button', { name: 'Resolve identity' }).click();
  await expect(page.getByText('1 candidate returned', { exact: true })).toBeVisible();
  await expect(page.getByText('87910-02A10', { exact: true })).toBeVisible();
  await expect(page.getByText('Side-view mirror', { exact: true })).toBeVisible();

  await page.getByRole('tab', { name: 'Trade lane' }).click();
  await page.getByRole('button', { name: 'Build lane review' }).click();
  await expect(page.getByText('Estimated landed cost', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Operational readiness' })).toBeVisible();

  await page.getByRole('tab', { name: 'Bilingual copy' }).click();
  await page.getByRole('button', { name: 'Create reviewed translation' }).click();
  await expect(page.getByText('Human review required')).toBeVisible();
});
