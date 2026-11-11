import { test, expect } from '@playwright/test';
import type { AlbumsResponse } from '../../src/shared/types.js';
import { expectSummaryFor } from './helpers.js';

async function expectFirstApiAlbum(
  page: import('@playwright/test').Page,
  result: AlbumsResponse,
): Promise<void> {
  if (result.total === 0) {
    await expect(page.locator('#empty-state')).toBeVisible();
    return;
  }
  const title = result.albums[0]?.album;
  if (title) {
    await expect(
      page.locator('.album-card', { hasText: title }).first(),
    ).toBeVisible();
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.album-card').first()).toBeVisible();
});

test('header and initial library controls are present', async ({ page }) => {
  await expect(page.locator('h1')).toHaveText('Happy Trails');
  await expect(page.locator('#library-stats')).toHaveText(
    /^[\d,]+ albums · [\d,]+ tracks$/,
  );
  await expect(page.locator('#search')).toBeVisible();
  await expect(page.locator('#search-help-button')).toBeVisible();
  await expect(page.locator('#sort')).toBeVisible();
  await expect(page.locator('#refresh-button')).toBeDisabled();
  await expect(page.locator('#session-button')).toHaveText('Sign in');
  await expect(page.locator('#genre-list input[value="jazz"]')).toBeVisible();
  await expect(page.locator('#region-list input[value="brazil"]')).toBeVisible();
  await expect(
    page.locator('.album-card .cover-initials').first(),
  ).toBeVisible();
  await expect(page.locator('#genre-search')).toBeVisible();
  await expect(page.locator('#region-search')).toBeVisible();
  await expect(page.locator('#genre-toggle')).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(page.locator('#genre-panel')).toBeVisible();
  await expect(page.locator('#region-toggle')).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(page.locator('#region-panel')).toBeVisible();
  await expectSummaryFor(page);
});

test.describe('mobile facet disclosures', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('filters are collapsed by default and toggle independently', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('.album-card').first()).toBeVisible();

    await expect(page.locator('#genre-toggle')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(page.locator('#genre-panel')).toBeHidden();
    await expect(page.locator('#region-toggle')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(page.locator('#region-panel')).toBeHidden();

    await page.locator('#genre-toggle').click();
    await expect(page.locator('#genre-toggle')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(page.locator('#genre-panel')).toBeVisible();
    await expect(page.locator('#region-panel')).toBeHidden();

    await page.locator('#region-toggle').click();
    await expect(page.locator('#region-toggle')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(page.locator('#region-panel')).toBeVisible();

    await page.locator('#genre-toggle').click();
    await expect(page.locator('#genre-panel')).toBeHidden();
    await expect(page.locator('#region-panel')).toBeVisible();
  });

  test('crossing the desktop breakpoint resets the disclosure state', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.locator('.album-card').first()).toBeVisible();
    await expect(page.locator('#genre-panel')).toBeHidden();

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator('#genre-toggle')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(page.locator('#genre-panel')).toBeVisible();
    await expect(page.locator('#region-panel')).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('#genre-toggle')).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    await expect(page.locator('#genre-panel')).toBeHidden();
  });
});

test('genre facets filter, combine, support any/all, and clear', async ({
  page,
}) => {
  await page.locator('#genre-search').fill('Jaz');
  await page.locator('#genre-list input[value="jazz"]').check();
  const jazz = await expectSummaryFor(page, { genre: 'Jazz' });
  expect(jazz.total).toBeGreaterThan(0);
  await expectFirstApiAlbum(page, jazz);
  await expect(page.locator('[data-remove-genre="jazz"]')).toBeVisible();

  await page.locator('#genre-search').fill('');
  await page.locator('#genre-list input[value="folk"]').check();
  const any = await expectSummaryFor(page, {
    genre: ['Jazz', 'Folk'],
    genreMode: 'any',
  });
  await expectFirstApiAlbum(page, any);

  await page.locator('input[name="genre-mode"][value="all"]').check();
  const all = await expectSummaryFor(page, {
    genre: ['Jazz', 'Folk'],
    genreMode: 'all',
  });
  await expectFirstApiAlbum(page, all);

  await page.locator('input[name="genre-mode"][value="any"]').check();
  await expectSummaryFor(page, {
    genre: ['Jazz', 'Folk'],
    genreMode: 'any',
  });

  await page.locator('#clear-genres').click();
  await expectSummaryFor(page);
  await expect(page.locator('[data-remove-genre]')).toHaveCount(0);
});

test('region facets filter, search, support any/all, and clear', async ({
  page,
}) => {
  await page.locator('#region-search').fill('Port');
  await page.locator('#region-list input[value="portugal"]').check();
  const portugal = await expectSummaryFor(page, { region: 'Portugal' });
  expect(portugal.total).toBeGreaterThan(0);
  await expectFirstApiAlbum(page, portugal);
  await expect(page.locator('[data-remove-region="portugal"]')).toBeVisible();

  await page.locator('#clear-regions').click();
  await expectSummaryFor(page);
  await page.locator('#region-search').fill('');

  await page.locator('#region-list input[value="spain"]').check();
  await page.locator('#region-list input[value="catalonia"]').check();
  const any = await expectSummaryFor(page, {
    region: ['Spain', 'Catalonia'],
    regionMode: 'any',
  });
  await expectFirstApiAlbum(page, any);

  await page.locator('input[name="region-mode"][value="all"]').check();
  const all = await expectSummaryFor(page, {
    region: ['Spain', 'Catalonia'],
    regionMode: 'all',
  });
  await expectFirstApiAlbum(page, all);

  await page.locator('input[name="region-mode"][value="any"]').check();
  await expectSummaryFor(page, {
    region: ['Spain', 'Catalonia'],
    regionMode: 'any',
  });

  await page.locator('#clear-regions').click();
  await expectSummaryFor(page);
});

test('fielded, quoted, and boolean search expressions work', async ({
  page,
}) => {
  await page.locator('#search').fill('composer:jobim');
  await page.locator('#search').press('Enter');
  const composer = await expectSummaryFor(page, { q: 'composer:jobim' });
  expect(composer.total).toBeGreaterThan(0);
  await expect(
    page.locator('.album-card', { hasText: 'Getz/Gilberto' }),
  ).toBeVisible();

  await page.locator('#search').fill('album:"abbey road"');
  await page.locator('#search').press('Enter');
  const phrase = await expectSummaryFor(page, {
    q: 'album:"abbey road"',
  });
  await expectFirstApiAlbum(page, phrase);

  await page.locator('#search').fill('album:road OR artist:beatles');
  await page.locator('#search').press('Enter');
  const boolean = await expectSummaryFor(page, {
    q: 'album:road OR artist:beatles',
  });
  await expectFirstApiAlbum(page, boolean);

  await page.locator('#search').fill('foo:bar');
  await page.locator('#search').press('Enter');
  await expectSummaryFor(page, { q: 'foo:bar' });
  await expect(page.locator('#empty-state')).toBeVisible();
  await page.locator('#empty-clear').click();
  await expectSummaryFor(page);
});

test('search help popup lists fields and runs examples', async ({ page }) => {
  await page.locator('#search-help-button').click();
  await expect(page.locator('#search-help-dialog')).toBeVisible();
  await expect(page.locator('#search-help-title')).toHaveText('Search syntax');
  await expect(page.locator('.search-help-fields')).toContainText('composer:');
  await expect(page.locator('.search-help-fields')).toContainText('serie:');
  await expect(page.locator('.syntax-example')).toHaveCount(6);

  await page
    .locator('[data-search-example=\'album:"abbey road"\']')
    .click();
  await expect(page.locator('#search-help-dialog')).toBeHidden();
  await expect(page.locator('#search')).toHaveValue('album:"abbey road"');
  const example = await expectSummaryFor(page, {
    q: 'album:"abbey road"',
  });
  await expectFirstApiAlbum(page, example);
});

test('Back and Forward restore search and sort states', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.album-card').first()).toBeVisible();
  await expectSummaryFor(page);

  await page.locator('#search').fill('beatles');
  await page.locator('#search').press('Enter');
  await expectSummaryFor(page, { q: 'beatles' });
  await expect(page).toHaveURL(/[?&]q=beatles/);

  await page.locator('#search').fill('miles');
  await page.locator('#search').press('Enter');
  await expectSummaryFor(page, { q: 'miles' });

  await page.goBack();
  await expect(page.locator('#search')).toHaveValue('beatles');
  await expectSummaryFor(page, { q: 'beatles' });

  await page.goBack();
  await expect(page.locator('#search')).toHaveValue('');
  await expectSummaryFor(page);

  await page.goForward();
  await expect(page.locator('#search')).toHaveValue('beatles');
  await expectSummaryFor(page, { q: 'beatles' });

  await page.locator('#sort').selectOption('album');
  await expectSummaryFor(page, { q: 'beatles', sort: 'album' });
  await expect(page).toHaveURL(/sort=album/);

  await page.goBack();
  await expect(page.locator('#sort')).toHaveValue('recent');
  await expectSummaryFor(page, { q: 'beatles' });
});

test('sort and URL state survive navigation', async ({ page }) => {
  await page.goto('/?q=artist%3Abeatles&sort=album');
  await expect(page.locator('.album-card').first()).toBeVisible();
  await expect(page.locator('#search')).toHaveValue('artist:beatles');
  await expect(page.locator('#sort')).toHaveValue('album');
  const sorted = await expectSummaryFor(page, {
    q: 'artist:beatles',
    sort: 'album',
  });
  await expectFirstApiAlbum(page, sorted);

  await page.locator('#sort').selectOption('recent');
  await expectSummaryFor(page, { q: 'artist:beatles', sort: 'recent' });
  await expect(page).toHaveURL(/q=artist%3Abeatles/);
});
