import { test, expect } from '@playwright/test';
import fs from 'node:fs';

const output = '.local-data/screenshots';
fs.mkdirSync(output, { recursive: true });

test('real photo library and genuine local CNN mask/heatmap views stay offline', async ({ page }) => {
  const external = [], errors = [];
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:3101') && !request.url().startsWith('data:') && !request.url().startsWith('blob:')) external.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#vision');
  await expect(page.getByRole('heading', { name: 'Inspect the image. Locate the damage.' })).toBeVisible();
  await expect(page.locator('.vision-thumbnails button')).toHaveCount(59);
  await page.getByRole('button', { name: 'Run damage inspection', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Model-derived visual result' })).toBeVisible({ timeout: 60000 });
  await expect(page.locator('.detected-regions')).toContainText('dent');
  await expect(page.locator('.detected-regions')).toContainText('lamp broken');
  await expect(page.locator('.inspection-image')).toHaveAttribute('src', /\/api\/vision\/results\/.+\/overlay$/);
  await expect(page.locator('.inspection-image')).toHaveJSProperty('complete', true);
  await page.screenshot({ path: `${output}/vision-damage-masks.png`, fullPage: true });
  await page.getByRole('button', { name: 'Heatmap', exact: true }).click();
  await expect(page.locator('.inspection-image')).toHaveAttribute('src', /\/heatmap$/);
  await expect(page.getByText('Lower → higher mask activation × detection score')).toBeVisible();
  await page.screenshot({ path: `${output}/vision-heatmap.png`, fullPage: true });
  await page.locator('.vision-thumbnails button').filter({ hasText: 'Real mirror crop 1' }).first().click();
  await page.getByRole('button', { name: 'Run damage inspection', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Model-derived visual result' })).toBeVisible({ timeout: 60000 });
  await expect(page.locator('.vision-notice')).toContainText('does NOT establish damage-free');
  await page.getByRole('button', { name: 'Open reference record' }).click();
  await expect(page.locator('.stock-meta')).toContainText('REFERENCE-MIRROR-01');
  await expect(page.locator('.inventory-fields')).toContainText('Not confirmed');
  await expect(page.locator('.evidence-image')).toBeVisible();
  expect(external).toEqual([]); expect(errors).toEqual([]);
});

test('stock-photo findings require seller review and update the listing disclosure', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/#part/DEMO-01');
  await expect(page.getByRole('heading', { name: 'Documented assembly', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Attach source', exact: true }).click();
  await page.locator('.attach-source input[type=checkbox]').check();
  await page.locator('.attach-source input[type=file]').setInputFiles({ name: 'vision-test-photo.png', mimeType: 'image/png', buffer: fs.readFileSync('datasets/vision/previews/kia_picanto_2.png') });
  await page.getByRole('button', { name: 'Attach image', exact: true }).click();
  await expect(page.getByLabel('Inspect a source')).toContainText('vision-test-photo.png');
  await page.getByRole('button', { name: 'Inspect damage regions', exact: true }).click();
  await expect(page.locator('.stock-vision .inspection-result')).toBeVisible({ timeout: 60000 });
  await expect(page.locator('.workspace-status .badge')).toContainText('Information missing');
  await expect(page.locator('.visual-review-form')).toBeVisible();
  const reviewControls = page.locator('.visual-review-form select');
  const count = await reviewControls.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const label = await reviewControls.nth(i).locator('..').innerText();
    await reviewControls.nth(i).selectOption(label.includes('dent') ? 'confirmed' : 'rejected');
  }
  await page.locator('.visual-review-form textarea').fill('Test photo manually inspected: visible dents confirmed; other model predictions rejected for this test.');
  await page.getByRole('button', { name: 'Save region review', exact: true }).click();
  await expect(page.locator('.visual-review-form')).toHaveCount(0);
  await expect(page.locator('.workspace-status .badge')).toContainText('Ready for seller review');
  await page.getByRole('tab', { name: 'Listing draft', exact: true }).click();
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue(/Seller confirms visible dent/);
  await expect(page.getByLabel('Description', { exact: true })).not.toHaveValue(/No visible defect reported/);
  await page.screenshot({ path: `${output}/vision-seller-reviewed.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#vision');
  await expect(page.locator('.vision-thumbnails button')).toHaveCount(59);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `${output}/vision-mobile.png`, fullPage: true });
  expect(errors).toEqual([]);
});
