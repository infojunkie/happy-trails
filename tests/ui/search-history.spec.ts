import { test, expect } from '@playwright/test';
import { expectSummaryFor, openSearch, submitSearch } from './helpers.js';

test('typing is inert until Enter commits one history entry', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.album-card').first()).toBeVisible();

  // A draft never refreshes results, the URL, or the header trigger.
  const input = await openSearch(page);
  await input.fill('b');
  await input.fill('be');
  await expectSummaryFor(page);
  expect(new URL(page.url()).searchParams.get('q')).toBeNull();
  await expect(page.locator('#search-trigger')).toHaveValue('');

  // Enter applies the query and closes the dialog.
  await input.press('Enter');
  await expect(page.locator('#search-dialog')).toBeHidden();
  await expectSummaryFor(page, { q: 'be' });
  expect(new URL(page.url()).searchParams.get('q')).toBe('be');
  await expect(page.locator('#search-trigger')).toHaveValue('be');
  await expect(page.locator('#search')).toHaveValue('be');

  // Reopening pre-fills the applied query.
  const reopened = await openSearch(page);
  await expect(reopened).toHaveValue('be');
  await reopened.fill('beat');
  await reopened.press('Enter');
  await expectSummaryFor(page, { q: 'beat' });

  // Each submit is its own history entry.
  await page.goBack();
  await expect(page.locator('#search-trigger')).toHaveValue('be');
  await expectSummaryFor(page, { q: 'be' });

  await page.goBack();
  await expect(page.locator('#search-trigger')).toHaveValue('');
  await expectSummaryFor(page);
});

test('Escape, the close button, and the backdrop discard the draft', async ({
  page,
}) => {
  await page.goto('/?q=beatles');
  await expectSummaryFor(page, { q: 'beatles' });
  await expect(page.locator('#search-trigger')).toHaveValue('beatles');

  for (const dismissal of ['escape', 'button', 'backdrop'] as const) {
    const input = await openSearch(page);
    await input.fill(`draft-${dismissal}`);
    if (dismissal === 'escape') {
      await page.keyboard.press('Escape');
    } else if (dismissal === 'button') {
      await page.locator('#search-dialog-close').click();
    } else {
      await page.mouse.click(4, 4);
    }

    await expect(page.locator('#search-dialog')).toBeHidden();
    await expect(page.locator('#search-trigger')).toHaveValue('beatles');
    await expect(page.locator('#search')).toHaveValue('beatles');
    await expectSummaryFor(page, { q: 'beatles' });
  }
});

test('empty submit clears the applied query', async ({ page }) => {
  await page.goto('/?q=beatles');
  await expectSummaryFor(page, { q: 'beatles' });

  await submitSearch(page, '');
  await expectSummaryFor(page);
  await expect(page.locator('#search-trigger')).toHaveValue('');
  await expect(page).not.toHaveURL(/[?&]q=/);
});
