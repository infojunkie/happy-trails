import { test, expect } from '@playwright/test';
import { expectSummaryFor } from './helpers.js';

async function openAlbum(page: import('@playwright/test').Page, title: string) {
  await page.locator('.album-title', { hasText: new RegExp(`^${title}$`) }).click();
  await expect(page.locator('#album-dialog')).toBeVisible();
}

test('album cards preserve original artist punctuation and link the parts', async ({
  page,
}) => {
  await page.goto(`/?q=${encodeURIComponent('artist:toumani')}`);
  const card = page.locator('.album-card', { hasText: 'Songhai' }).first();
  await expect(card).toBeVisible();
  const artist = card.locator('.album-artist');
  await expect(artist).toHaveText('Ketama, Toumani Diabaté, Danny Thompson');
  await expect(artist.locator('.artist-link')).toHaveText([
    'Ketama',
    'Toumani Diabaté',
    'Danny Thompson',
  ]);
  await artist.locator('.artist-link', { hasText: 'Toumani Diabaté' }).click();
  await expect(page.locator('#search')).toHaveValue('Toumani Diabaté');
  await expectSummaryFor(page, { q: 'Toumani Diabaté' });

  await page.goto(`/?q=${encodeURIComponent('artist:earth')}`);
  const earth = page.locator('.album-card', { hasText: 'Earth, Wind & Fire' }).first();
  await expect(earth).toBeVisible();
  await expect(earth.locator('.album-artist')).toHaveText('Earth, Wind & Fire');
  await expect(earth.locator('.album-artist .artist-link')).toHaveText([
    'Earth',
    'Wind',
    'Fire',
  ]);
});

test('album chips activate the corresponding filters', async ({ page }) => {
  await page.goto(`/?q=${encodeURIComponent('artist:getz')}`);
  const card = page.locator('.album-card', { hasText: 'Getz/Gilberto' }).first();
  await expect(card).toBeVisible();
  await expect(card.locator('.chip-region')).toHaveText(['Brazil']);
  await card.locator('.chip-region', { hasText: 'Brazil' }).click();
  await expect(page).toHaveURL(/region=Brazil/);
  await expectSummaryFor(page, { q: 'artist:getz', region: 'Brazil' });

  await page.goto(`/?q=${encodeURIComponent('artist:getz')}`);
  const genreCard = page.locator('.album-card', { hasText: 'Getz/Gilberto' }).first();
  await expect(genreCard).toBeVisible();
  await genreCard.locator('.chip-small', { hasText: 'Jazz' }).click();
  await expect(page).toHaveURL(/genre=Jazz/);
  await expectSummaryFor(page, { q: 'artist:getz', genre: 'Jazz' });
});

test('album dialog shows merged tracks, composer lines, and artist punctuation', async ({
  page,
}) => {
  await page.goto(`/?q=${encodeURIComponent('album:"abbey road"')}`);
  await expect(page.locator('.album-card').first()).toBeVisible();
  await openAlbum(page, 'Abbey Road');

  await expect(page.locator('.dialog-title')).toHaveText('Abbey Road');
  await expect(page.locator('.dialog-artist')).toHaveText('The Beatles');
  await expect(page.locator('.dialog-genres .chip')).toHaveText(['Rock', 'Pop']);
  await expect(page.locator('.source-heading')).toContainText(['Main album', 'Bonus Tracks']);
  await expect(page.locator('#album-dialog .track-play')).toHaveCount(0);
  await expect(
    page.locator('#album-dialog .track-filter-option'),
  ).toHaveCount(0);
  await expect(
    page.locator('#album-dialog .dialog-track-summary'),
  ).toHaveCount(0);

  const comeTogether = page
    .locator('.track-row', { hasText: 'Come Together' })
    .first();
  await expect(comeTogether.locator('.track-composer')).toHaveText(
    'Composer John Lennon, Paul McCartney',
  );
  await expect(comeTogether.locator('.composer-link')).toHaveText([
    'John Lennon',
    'Paul McCartney',
  ]);

  const guitar = page.locator('.track-row', {
    hasText: 'While My Guitar Gently Weeps',
  });
  await expect(guitar.locator('.track-sub')).toHaveCount(2);
  await expect(guitar.locator('.track-sub').first()).toHaveText(
    'The Beatles feat. Eric Clapton',
  );
  await expect(guitar.locator('.artist-link')).toHaveText([
    'The Beatles',
    'Eric Clapton',
  ]);
  await expect(guitar.locator('.track-composer')).toHaveText(
    'Composer George Harrison',
  );

  const maxwell = page.locator('.track-row', {
    hasText: "Maxwell's Silver Hammer",
  });
  await expect(maxwell.locator('.track-composer')).toHaveCount(0);

  await comeTogether.locator('.composer-link', { hasText: 'John Lennon' }).click();
  await expect(page.locator('#album-dialog')).toBeHidden();
  await expect(page.locator('#search')).toHaveValue('John Lennon');
  await expectSummaryFor(page, { q: 'John Lennon' });
});

test('album dialog genre and region chips activate filters', async ({ page }) => {
  await page.goto(`/?q=${encodeURIComponent('album:"abbey road"')}`);
  await expect(page.locator('.album-card').first()).toBeVisible();
  await openAlbum(page, 'Abbey Road');
  await page.locator('.dialog-genres .chip', { hasText: 'Rock' }).click();
  await expect(page.locator('#album-dialog')).toBeHidden();
  await expect(page).toHaveURL(/genre=Rock/);
  await expectSummaryFor(page, {
    q: 'album:"abbey road"',
    genre: 'Rock',
  });

  await page.goto(`/?q=${encodeURIComponent('artist:getz')}`);
  await expect(page.locator('.album-card').first()).toBeVisible();
  await openAlbum(page, 'Getz/Gilberto');
  await page.locator('.dialog-genres .chip-region', { hasText: 'Brazil' }).click();
  await expect(page.locator('#album-dialog')).toBeHidden();
  await expect(page).toHaveURL(/region=Brazil/);
  await expectSummaryFor(page, { q: 'artist:getz', region: 'Brazil' });
});

test('album dialog shows Artwork only when the folder has Artwork.pdf', async ({
  page,
}) => {
  await page.goto(`/?q=${encodeURIComponent('album:"abbey road"')}`);
  await expect(page.locator('.album-card').first()).toBeVisible();
  await openAlbum(page, 'Abbey Road');

  const artwork = page.locator('#album-dialog .dialog-artwork');
  await expect(artwork).toBeVisible();
  await expect(artwork).toContainText('Artwork');
  await expect(artwork).toHaveAttribute(
    'href',
    /^\/api\/albums\/[^/]+\/artwork$/,
  );
  await expect(artwork).toHaveAttribute('target', '_blank');
  await expect(artwork).toHaveAttribute('rel', 'noopener');

  await page.locator('#album-dialog .dialog-close').click();
  await expect
    .poll(() => page.evaluate(() => window.history.state?.album ?? null))
    .toBeNull();
  await page.goto(`/?q=${encodeURIComponent('album:"kind of blue"')}`);
  await expect(page.locator('.album-card').first()).toBeVisible();
  await openAlbum(page, 'Kind of Blue');
  await expect(
    page.locator('#album-dialog .dialog-artwork'),
  ).toHaveCount(0);
});

test('Back closes an album dialog and Forward reopens it', async ({ page }) => {
  await page.goto('/');
  await page.locator('#search').fill('album:"abbey road"');
  await page.locator('#search').press('Enter');
  await expectSummaryFor(page, { q: 'album:"abbey road"' });

  await openAlbum(page, 'Abbey Road');
  await expect(page.locator('#album-dialog')).toBeVisible();

  await page.goBack();
  await expect(page.locator('#album-dialog')).toBeHidden();
  await expect(page.locator('#search')).toHaveValue('album:"abbey road"');

  await page.goForward();
  await expect(page.locator('#album-dialog')).toBeVisible();
  await expect(page.locator('.dialog-title')).toHaveText('Abbey Road');

  // Closing by button consumes the modal entry rather than leaving a stale one.
  await page.locator('#album-dialog .dialog-close').click();
  await expect(page.locator('#album-dialog')).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => window.history.state?.album ?? null))
    .toBeNull();

  await page.goBack();
  await expect(page.locator('#search')).toHaveValue('');
  await expectSummaryFor(page);
});

test('Back from a dialog search reopens the album dialog', async ({ page }) => {
  await page.goto(`/?q=${encodeURIComponent('album:"abbey road"')}`);
  await expect(page.locator('.album-card').first()).toBeVisible();
  await openAlbum(page, 'Abbey Road');

  await page
    .locator('#album-dialog .composer-link', { hasText: 'John Lennon' })
    .first()
    .click();
  await expect(page.locator('#album-dialog')).toBeHidden();
  await expect(page.locator('#search')).toHaveValue('John Lennon');
  await expectSummaryFor(page, { q: 'John Lennon' });

  await page.goBack();
  await expect(page.locator('#album-dialog')).toBeVisible();
  await expect(page.locator('.dialog-title')).toHaveText('Abbey Road');
  await expect(page.locator('#search')).toHaveValue('album:"abbey road"');
});

test('track filter defaults to matching tracks and updates album Play', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#session-button').click();
  await page.locator('#login-username').fill('alice');
  await page.locator('#login-password').fill('secret');
  await page.locator('#login-submit').click();
  await expect(page.locator('#session-button')).toHaveText('alice');

  await page.goto(
    `/?q=${encodeURIComponent('composer:"George Harrison"')}`,
  );
  await expect(page.locator('.album-card').first()).toBeVisible();
  await openAlbum(page, 'Abbey Road');

  await expect(
    page.locator('.track-filter-option', { hasText: 'Matching tracks' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(
    page.locator('.track-filter-option', { hasText: 'Show all' }),
  ).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.dialog-track-summary')).toHaveText(
    'Showing 2 of 5 tracks matching this search',
  );
  await expect(page.locator('#album-dialog .track-row')).toHaveCount(2);
  await expect(
    page.locator('#album-dialog .track-title'),
  ).toHaveText(['Something', 'While My Guitar Gently Weeps']);
  await expect(page.locator('#album-dialog .dialog-play')).toHaveAttribute(
    'href',
    /q=composer%3A%22George%20Harrison%22/,
  );

  await page
    .locator('.track-filter-option', { hasText: 'Show all' })
    .click();
  await expect(
    page.locator('.track-filter-option', { hasText: 'Show all' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.dialog-track-summary')).toHaveText(
    'Showing all 5 tracks (2 match)',
  );
  await expect(page.locator('#album-dialog .track-row')).toHaveCount(5);
  await expect(
    page.locator('#album-dialog .dialog-play'),
  ).not.toHaveAttribute('href', /q=/);

  await page
    .locator('.track-filter-option', { hasText: 'Matching tracks' })
    .click();
  await expect(page.locator('#album-dialog .track-row')).toHaveCount(2);
  await expect(page.locator('#album-dialog .dialog-play')).toHaveAttribute(
    'href',
    /q=composer%3A%22George%20Harrison%22/,
  );
});

test('sign-in reveals Play links and sign-out removes them', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.album-card').first()).toBeVisible();
  await expect(page.locator('#session-button')).toHaveText('Sign in');
  await expect(page.locator('.album-play')).toHaveCount(0);

  await page.locator('#session-button').click();
  await expect(page.locator('#login-dialog')).toBeVisible();
  await page.locator('#login-username').fill('alice');
  await page.locator('#login-password').fill('secret');
  await page.locator('#login-submit').click();
  await expect(page.locator('#login-dialog')).toBeHidden();
  await expect(page.locator('#session-button')).toHaveText('alice');
  await expect(page.locator('.album-play').first()).toBeVisible();
  const href = await page.locator('.album-play').first().getAttribute('href');
  expect(href).toMatch(/^\/play\//);
  await expect(page.locator('.album-play').first()).toHaveAttribute(
    'target',
    '_blank',
  );

  await page
    .locator('.album-title', { hasText: /^Abbey Road$/ })
    .first()
    .click();
  await expect(page.locator('#album-dialog')).toBeVisible();
  const trackPlay = page.locator('#album-dialog .track-play').first();
  await expect(trackPlay).toBeVisible();
  await expect(trackPlay).toHaveAttribute('href', /^\/play\/track\/\d+$/);
  await expect(trackPlay).toHaveAttribute('target', '_blank');
  await page.locator('#album-dialog .dialog-close').click();
  await expect
    .poll(() => page.evaluate(() => window.history.state?.album ?? null))
    .toBeNull();

  await page.reload();
  await expect(page.locator('.album-card').first()).toBeVisible();
  await expect(page.locator('#session-button')).toHaveText('alice');
  await expect(page.locator('.album-play').first()).toBeVisible();

  await page.locator('#session-button').click();
  await expect(page.locator('#session-button')).toHaveText('Sign in');
  await expect(page.locator('.album-play')).toHaveCount(0);
});
