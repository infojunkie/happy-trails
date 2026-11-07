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
  await expect(earth.locator('.album-artist .artist-link')).toHaveCount(1);
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

  await page.reload();
  await expect(page.locator('.album-card').first()).toBeVisible();
  await expect(page.locator('#session-button')).toHaveText('alice');
  await expect(page.locator('.album-play').first()).toBeVisible();

  await page.locator('#session-button').click();
  await expect(page.locator('#session-button')).toHaveText('Sign in');
  await expect(page.locator('.album-play')).toHaveCount(0);
});
