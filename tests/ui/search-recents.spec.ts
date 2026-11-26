import { test, expect } from '@playwright/test';
import { SEARCH_HISTORY_KEY } from '../../src/client/searchHistory.js';
import {
  expandFacet,
  expectSummaryFor,
  openSearch,
  submitSearch,
} from './helpers.js';

async function overrideStatus(
  page: import('@playwright/test').Page,
  patch: Record<string, unknown>,
): Promise<void> {
  await page.route('**/api/status', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    await route.fulfill({ json: { ...body, ...patch } });
  });
}

test('up and down recall recent searches and restore the draft', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.album-card').first()).toBeVisible();

  await submitSearch(page, 'beatles');
  await submitSearch(page, 'miles');

  const input = await openSearch(page);
  await expect(page.locator('#search-history-hint')).toBeVisible();
  await input.fill('draft');

  await page.keyboard.press('ArrowUp');
  await expect(input).toHaveValue('miles');
  await page.keyboard.press('ArrowUp');
  await expect(input).toHaveValue('beatles');
  // The oldest entry stays put.
  await page.keyboard.press('ArrowUp');
  await expect(input).toHaveValue('beatles');

  await page.keyboard.press('ArrowDown');
  await expect(input).toHaveValue('miles');
  await page.keyboard.press('ArrowDown');
  await expect(input).toHaveValue('draft');
  await page.keyboard.press('ArrowDown');
  await expect(input).toHaveValue('draft');
});

test('recent searches persist, deduplicate by case, and survive reloads', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.album-card').first()).toBeVisible();

  await submitSearch(page, 'Beatles');
  await submitSearch(page, 'miles');
  await submitSearch(page, 'beatles');

  const stored = await page.evaluate((key) => {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
  }, SEARCH_HISTORY_KEY);
  expect(stored).toEqual(['beatles', 'miles']);

  await page.reload();
  await expect(page.locator('.album-card').first()).toBeVisible();
  const input = await openSearch(page);
  // The applied query is the newest saved search, so Up skips to the previous.
  await page.keyboard.press('ArrowUp');
  await expect(input).toHaveValue('miles');
  await page.keyboard.press('ArrowUp');
  await expect(input).toHaveValue('miles');
  await page.keyboard.press('ArrowDown');
  await expect(input).toHaveValue('beatles');
});

test('up skips the current query when it is also the newest saved search', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.album-card').first()).toBeVisible();

  await submitSearch(page, 'artist:beatles');
  await submitSearch(page, 'composer:beatles not(artist:beatles)');

  const input = await openSearch(page);
  await expect(input).toHaveValue('composer:beatles not(artist:beatles)');

  await page.keyboard.press('ArrowUp');
  await expect(input).toHaveValue('artist:beatles');

  await page.keyboard.press('ArrowDown');
  await expect(input).toHaveValue('composer:beatles not(artist:beatles)');
});

test('link searches are remembered but facet selections are not', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.album-card').first()).toBeVisible();

  await submitSearch(page, 'beatles');

  await page
    .locator('.album-card .artist-link', { hasText: 'The Beatles' })
    .first()
    .click();
  await expectSummaryFor(page, { q: 'The Beatles' });

  await expandFacet(page, '#genre-toggle', '#genre-panel');
  await page.locator('#genre-list input[value="jazz"]').check();
  await expectSummaryFor(page, { q: 'genre:"Jazz"' });

  const input = await openSearch(page);
  await page.keyboard.press('ArrowUp');
  await expect(input).toHaveValue('The Beatles');
  await page.keyboard.press('ArrowUp');
  await expect(input).toHaveValue('beatles');
});

test('the server-configured limit caps the stored history', async ({ page }) => {
  await overrideStatus(page, { searchHistoryLimit: 2 });
  await page.goto('/');
  await expect(page.locator('.album-card').first()).toBeVisible();

  await submitSearch(page, 'one');
  await submitSearch(page, 'two');
  await submitSearch(page, 'three');

  const stored = await page.evaluate((key) => {
    return JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
  }, SEARCH_HISTORY_KEY);
  expect(stored).toEqual(['three', 'two']);

  const input = await openSearch(page);
  // The newest entry duplicates the draft; Up starts at the previous one.
  await page.keyboard.press('ArrowUp');
  await expect(input).toHaveValue('two');
  await page.keyboard.press('ArrowUp');
  await expect(input).toHaveValue('two');
  await page.keyboard.press('ArrowDown');
  await expect(input).toHaveValue('three');
});

test('searchHistoryLimit 0 disables history', async ({ page }) => {
  await overrideStatus(page, { searchHistoryLimit: 0 });
  await page.goto('/');
  await expect(page.locator('.album-card').first()).toBeVisible();

  await submitSearch(page, 'beatles');

  const input = await openSearch(page);
  await expect(page.locator('#search-history-hint')).toBeHidden();
  await input.fill('draft');
  await page.keyboard.press('ArrowUp');
  await expect(input).toHaveValue('draft');
  expect(
    await page.evaluate((key) => localStorage.getItem(key), SEARCH_HISTORY_KEY),
  ).toBeNull();
});
