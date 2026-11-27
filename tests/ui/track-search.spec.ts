import { test, expect } from '@playwright/test';
import { expandFacet, submitSearch } from './helpers.js';

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

  // The summary separates the loaded rows from the library total, and Load
  // more updates the shown count.
  const tracksResponse = await page.request.get('/api/tracks?limit=1');
  expect(tracksResponse.ok()).toBeTruthy();
  const { total: trackTotal } = (await tracksResponse.json()) as {
    total: number;
  };
  const firstPage = Math.min(48, trackTotal);
  const secondPage = Math.min(firstPage + 48, trackTotal);
  await expect(page.locator('#result-summary')).toHaveText(
    `Showing ${firstPage.toLocaleString()} / ${trackTotal.toLocaleString()} tracks`,
  );
  if (firstPage < trackTotal) {
    await page.locator('#load-more').click();
    await expect(page.locator('#result-summary')).toHaveText(
      `Showing ${secondPage.toLocaleString()} / ${trackTotal.toLocaleString()} tracks`,
    );
  }
});

test('track search filters rows and facet counts switch to tracks', async ({
  page,
}) => {
  await page.goto('/?view=tracks');
  await expect(
    page.locator('.track-result .track-result-title').first(),
  ).toBeVisible();

  await submitSearch(page, 'track:"so what"');

  await expect(page.locator('.track-result')).toHaveCount(1);
  const statusResponse = await page.request.get('/api/status');
  expect(statusResponse.ok()).toBeTruthy();
  const { trackCount } = (await statusResponse.json()) as {
    trackCount: number;
  };
  await expect(page.locator('#result-summary')).toHaveText(
    `Showing 1 / 1 of ${trackCount.toLocaleString()} tracks`,
  );
  const row = page.locator('.track-result').first();
  await expect(row.locator('.track-result-title')).toHaveText('So What');
  await expect(row.locator('.track-result-artist')).toContainText('Miles Davis');
  await expect(row.locator('.track-result-album')).toHaveText('Kind of Blue');

  // Tracks mode shows track counts and says so in the facet tooltip.
  await expandFacet(page, '#genre-toggle', '#genre-panel');
  await expect(page.locator('#genre-list .facet-count').first()).toHaveAttribute(
    'title',
    'Count of matching tracks',
  );

  await page.locator('#genre-list input[value="jazz"]').check();
  await expect(page).toHaveURL(/view=tracks/);
  await expect(page).toHaveURL(/genre%3A%22Jazz%22/);
  await expect(
    page.locator('.track-result .track-result-title').first(),
  ).toBeVisible();
});

test('track-mode region filters use the track tags', async ({ page }) => {
  await page.goto('/?view=tracks');
  await expect(
    page.locator('.track-result .track-result-title').first(),
  ).toBeVisible();

  await submitSearch(
    page,
    'region:Iceland album:"Putumayo - Family Gathering"',
  );

  await expect(page.locator('.track-result')).toHaveCount(1);
  await expect(page.locator('.track-result-title')).toHaveText(
    'Icelandic Track',
  );
});

test('opening a track row shows the album dialog without a track filter', async ({
  page,
}) => {
  await page.goto('/?view=tracks');
  await expect(
    page.locator('.track-result .track-result-title').first(),
  ).toBeVisible();

  await submitSearch(page, 'track:"so what"');
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

test.describe('mobile track rows', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('duration and play actions are right-aligned and share the play icon', async ({
    page,
  }) => {
    await page.goto('/?view=tracks');
    await expect(
      page.locator('.track-result .track-result-title').first(),
    ).toBeVisible();

    await page.locator('#session-button').click();
    await page.locator('#login-username').fill('alice');
    await page.locator('#login-password').fill('secret');
    await page.locator('#login-submit').click();
    await expect(page.locator('#session-button')).toHaveText('alice');
    await expect(page.locator('.track-result .track-play').first()).toBeVisible();

    const rows = await page.$$eval('.track-result', (elements) =>
      elements.slice(0, 8).map((row) => {
        const actions = row.querySelector('.track-result-actions');
        const play = row.querySelector('.track-play');
        const icon = row.querySelector('.track-play .play-icon');
        if (!actions || !play || !icon) return null;

        const rowBox = row.getBoundingClientRect();
        const paddingRight = Number.parseFloat(
          getComputedStyle(row).paddingRight,
        );
        const actionsBox = actions.getBoundingClientRect();
        const playBox = play.getBoundingClientRect();
        const iconBox = icon.getBoundingClientRect();
        return {
          actionsRight: actionsBox.right,
          expectedRight: rowBox.right - paddingRight,
          playRight: playBox.right,
          iconOffsetX:
            iconBox.left +
            iconBox.width / 2 -
            (playBox.left + playBox.width / 2),
          iconOffsetY:
            iconBox.top +
            iconBox.height / 2 -
            (playBox.top + playBox.height / 2),
        };
      }),
    );

    const present = rows.filter((row) => row !== null);
    expect(present.length).toBeGreaterThan(1);
    const rights = present.map((row) => row.actionsRight);
    expect(Math.max(...rights) - Math.min(...rights)).toBeLessThanOrEqual(1);

    for (const row of present) {
      expect(Math.abs(row.actionsRight - row.expectedRight)).toBeLessThanOrEqual(
        1,
      );
      expect(Math.abs(row.playRight - row.expectedRight)).toBeLessThanOrEqual(1);
      // Shared play icon: the optical nudge is horizontal only.
      expect(row.iconOffsetX).toBeGreaterThan(0.5);
      expect(Math.abs(row.iconOffsetY)).toBeLessThanOrEqual(0.5);
    }

    const playCount = await page.locator('.track-result .track-play').count();
    await expect(page.locator('.track-result .play-icon')).toHaveCount(
      playCount,
    );
  });
});

test('track folder series show on track rows and filter in Tracks mode', async ({
  page,
}) => {
  await page.goto(
    `/?view=tracks&q=${encodeURIComponent('album:"World Sampler"')}`,
  );
  const row = page.locator('.track-result').first();
  await expect(row.locator('.track-result-title')).toHaveText(
    'World Sampler Track 1',
  );
  const serieChip = row.locator('.track-result-tags .chip-serie');
  await expect(serieChip).toHaveText('Covers Collection');

  await serieChip.click();
  await expect(page.locator('#search')).toHaveValue(
    'serie:"Covers Collection"',
  );
  await expect(page.locator('.track-result-title').first()).toHaveText(
    'World Sampler Track 1',
  );

  // The Series facet lists the track-only series in Tracks mode only.
  await expandFacet(page, '#serie-toggle', '#serie-panel');
  const facetRow = page.locator('#serie-list .facet-row', {
    hasText: 'Covers Collection',
  });
  await expect(facetRow).toBeVisible();

  // A selected track-only series stays visible so it can be cleared; once
  // deselected it disappears from Albums mode because it has no albums.
  await page.locator('#clear-serie').click();
  await page.locator('#mode-albums').click();
  await expect(facetRow).toHaveCount(0);
});
