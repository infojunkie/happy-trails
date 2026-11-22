import { test, expect } from '@playwright/test';
import type { StatusResponse } from '../../src/shared/types.js';

test('results page size follows the server status', async ({ page }) => {
  await page.route('**/api/status', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as StatusResponse;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...body, pageSize: 24 }),
    });
  });

  await page.goto('/?view=tracks');
  await expect(page.locator('.track-result')).toHaveCount(24);
  await expect(page.locator('#result-summary')).toHaveText(/^Showing 24 \//);

  // Load more advances by the configured page size too.
  await page.locator('#load-more').click();
  await expect(page.locator('.track-result')).toHaveCount(48);
  await expect(page.locator('#result-summary')).toHaveText(/^Showing 48 \//);
});

test('error banner lives in the sticky header and stays visible while scrolling', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.album-card').first()).toBeVisible();

  await page.evaluate(() => {
    const filler = document.createElement('div');
    filler.style.height = '3000px';
    filler.setAttribute('aria-hidden', 'true');
    document.body.append(filler);
  });

  await page.route('**/api/albums**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/albums') {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Simulated library failure' }),
      });
      return;
    }
    await route.continue();
  });

  await page.locator('#search').fill('beat');
  await page.locator('#search').press('Enter');
  const banner = page.locator('#error-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveText(/Simulated library failure/);
  await expect(banner).toHaveAttribute('role', 'alert');
  await expect(
    page.locator('.site-header #error-banner'),
  ).toHaveCount(1);

  await page.evaluate(() => window.scrollTo(0, 1200));
  await expect(banner).toBeVisible();
  const bannerBox = await banner.boundingBox();
  const headerBox = await page.locator('.site-header').boundingBox();
  expect(bannerBox).not.toBeNull();
  expect(headerBox).not.toBeNull();
  if (!bannerBox || !headerBox) throw new Error('missing layout box');
  expect(bannerBox.y).toBeGreaterThanOrEqual(0);
  expect(bannerBox.y + bannerBox.height).toBeLessThanOrEqual(
    headerBox.y + headerBox.height + 1,
  );

  await page.locator('#dismiss-error').click();
  await expect(banner).toBeHidden();
});

test('search help closes with Escape and backdrop click', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.album-card').first()).toBeVisible();

  await page.locator('#search-help-button').click();
  await expect(page.locator('#search-help-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#search-help-dialog')).toBeHidden();

  await page.locator('#search-help-button').click();
  await expect(page.locator('#search-help-dialog')).toBeVisible();
  await page.mouse.click(8, 8);
  await expect(page.locator('#search-help-dialog')).toBeHidden();
});
