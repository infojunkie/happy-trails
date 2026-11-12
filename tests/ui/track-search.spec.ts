import { test, expect } from '@playwright/test';
import { expandFacet } from './helpers.js';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.album-card').first()).toBeVisible();
});

test('Tracks mode switches results and records the URL', async ({ page }) => {
  await expect(page.locator('#mode-albums')).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.locator('#mode-tracks').click();

  await expect(page).toHaveURL(/[?&]view=tracks/);
  await expect(page.locator('#mode-tracks')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('#track-list')).toBeVisible();
  await expect(page.locator('#album-grid')).toBeHidden();
  await expect(page.locator('#load-more')).toHaveText('Load more tracks');

  const row = page.locator('.track-result', { has: page.locator('.track-result-title') }).first();
  await expect(row.locator('.track-result-title')).toBeVisible();
  await expect(row.locator('.cover')).toBeVisible();
  await expect(row.locator('.track-result-artist')).toBeVisible();
  await expect(row.locator('.track-result-album')).toBeVisible();
  await expect(row.locator('.track-result-duration')).toBeVisible();
  await expect(page.locator('#result-summary')).toHaveText(/[\d,]+ tracks/);
});

test('track search filters rows and genre filters stay album-level', async ({
  page,
}) => {
  await page.goto('/?view=tracks');
  await expect(
    page.locator('.track-result .track-result-title').first(),
  ).toBeVisible();

  await page.locator('#search').fill('track:"so what"');
  await page.locator('#search').press('Enter');

  await expect(page.locator('.track-result')).toHaveCount(1);
  const row = page.locator('.track-result').first();
  await expect(row.locator('.track-result-title')).toHaveText('So What');
  await expect(row.locator('.track-result-artist')).toContainText('Miles Davis');
  await expect(row.locator('.track-result-album')).toHaveText('Kind of Blue');

  // The sidebar still counts albums, and says so in track mode.
  await expandFacet(page, '#genre-toggle', '#genre-panel');
  await expect(page.locator('#genre-list .facet-count').first()).toHaveAttribute(
    'title',
    'Count of matching albums',
  );

  await page.locator('#genre-list input[value="jazz"]').check();
  await expect(page).toHaveURL(/view=tracks/);
  await expect(page).toHaveURL(/genre%3A%22Jazz%22/);
  await expect(
    page.locator('.track-result .track-result-title').first(),
  ).toBeVisible();
});

test('opening a track row shows the album dialog without a track filter', async ({
  page,
}) => {
  await page.goto('/?view=tracks');
  await expect(
    page.locator('.track-result .track-result-title').first(),
  ).toBeVisible();

  await page.locator('#search').fill('track:"so what"');
  await page.locator('#search').press('Enter');
  await expect(page.locator('.track-result')).toHaveCount(1);

  await page.locator('.track-result-title').click();

  await expect(page.locator('#album-dialog')).toBeVisible();
  await expect(page.locator('#dialog-title')).toHaveText('Kind of Blue');
  await expect(
    page.locator('#album-dialog .track-title', { hasText: 'Freddie Freeloader' }),
  ).toBeVisible();
  // The dialog opened from a track result and must not inherit the track
  // query (its `all` field does not search track titles).
  await expect(page.locator('#album-dialog .dialog-track-summary')).toHaveCount(0);
  await expect(page).toHaveURL(/view=tracks/);
});

test('Back and Forward restore the search mode', async ({ page }) => {
  await page.locator('#mode-tracks').click();
  await expect(page).toHaveURL(/view=tracks/);
  await expect(
    page.locator('.track-result .track-result-title').first(),
  ).toBeVisible();

  await page.locator('#mode-albums').click();
  await expect(page).not.toHaveURL(/view=tracks/);
  await expect(page.locator('.album-card').first()).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/view=tracks/);
  await expect(page.locator('#mode-tracks')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(
    page.locator('.track-result .track-result-title').first(),
  ).toBeVisible();

  await page.goForward();
  await expect(page).not.toHaveURL(/view=tracks/);
  await expect(page.locator('#mode-albums')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('track mode empty state is mode-specific', async ({ page }) => {
  await page.goto('/?view=tracks&q=track%3A%22no-such-track%22');

  await expect(page.locator('#empty-state')).toBeVisible();
  await expect(page.locator('#empty-title')).toHaveText('No tracks found');
  await expect(page.locator('#album-grid')).toBeHidden();
});

test('track: in album mode finds the album containing the track', async ({
  page,
}) => {
  await page.goto('/?q=track%3A%22freddie%20freeloader%22');

  await expect(page.locator('.album-card')).toHaveCount(1);
  await expect(page.locator('.album-card .album-title')).toHaveText(
    'Kind of Blue',
  );
  await expect(page.locator('#album-grid')).toBeVisible();
  await expect(page.locator('#track-list')).toBeHidden();
});
