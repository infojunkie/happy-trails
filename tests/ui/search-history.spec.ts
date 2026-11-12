import { test, expect } from '@playwright/test';
import { expectSummaryFor } from './helpers.js';

test('typing coalesces live history and Enter/blur commit the session', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.album-card').first()).toBeVisible();

  // Live searches update results and coalesce into one history entry.
  await page.locator('#search').fill('b');
  await expectSummaryFor(page, { q: 'b' });
  await page.locator('#search').fill('be');
  await expectSummaryFor(page, { q: 'be' });

  // Leaving the field commits the first session.
  await page.locator('h1').click();
  await page.locator('#search').fill('bea');
  await expectSummaryFor(page, { q: 'bea' });

  // Enter ends the second session without adding a duplicate entry.
  await page.locator('#search').press('Enter');

  await page.goBack();
  await expect(page.locator('#search')).toHaveValue('be');
  await expectSummaryFor(page, { q: 'be' });

  // Back again reaches the pre-edit state, not the intermediate "b".
  await page.goBack();
  await expect(page.locator('#search')).toHaveValue('');
  await expectSummaryFor(page);
});
