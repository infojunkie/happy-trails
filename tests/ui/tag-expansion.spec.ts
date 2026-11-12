import { test, expect } from '@playwright/test';

const ALBUM = 'World Sampler';
const ALBUM_QUERY = `album:"${ALBUM}"`;

test.beforeEach(async ({ page }) => {
  await page.goto(`/?q=${encodeURIComponent(ALBUM_QUERY)}`);
  await expect(
    page.locator('.album-card', { hasText: ALBUM }).first(),
  ).toBeVisible();
});

test('album card +N reveals every genre and region', async ({ page }) => {
  const card = page.locator('.album-card', { hasText: ALBUM }).first();
  const more = card.locator('.album-genres .chip-more');

  await expect(more).toHaveText('+11 more');
  await expect(
    card.locator('.album-genres .chip-extra', { hasText: 'USA' }),
  ).toBeHidden();
  await expect(more).toHaveAttribute('aria-expanded', 'false');

  await more.click();

  await expect(more).toHaveText('Show less');
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  await expect(
    card.locator('.album-genres .chip', { hasText: 'USA' }),
  ).toBeVisible();
  await expect(
    card.locator('.album-genres .chip', { hasText: 'Reggae' }),
  ).toBeVisible();

  await more.click();
  await expect(more).toHaveText('+11 more');
  await expect(
    card.locator('.album-genres .chip-extra', { hasText: 'USA' }),
  ).toBeHidden();
});

test('album dialog +N reveals regions hidden past the collapsed limit', async ({
  page,
}) => {
  const card = page.locator('.album-card', { hasText: ALBUM }).first();
  await card.locator('.album-title').click();

  const dialog = page.locator('#album-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#dialog-title')).toHaveText(ALBUM);

  const more = dialog.locator('.dialog-genres .chip-more');
  await expect(more).toHaveText('+4 more');
  await expect(
    dialog.locator('.dialog-genres .chip-extra', { hasText: 'USA' }),
  ).toBeHidden();

  await more.click();

  await expect(
    dialog.locator('.dialog-genres .chip', { hasText: 'USA' }),
  ).toBeVisible();
  await expect(
    dialog.locator('.dialog-genres .chip', { hasText: 'Japan' }),
  ).toBeVisible();
});

test('track row +N reveals the track’s remaining tags', async ({ page }) => {
  await page.goto(
    `/?view=tracks&q=${encodeURIComponent(ALBUM_QUERY)}`,
  );

  const row = page
    .locator('.track-result', { has: page.locator('.track-result-title') })
    .first();
  await expect(row.locator('.track-result-title')).toHaveText(
    'World Sampler Track 1',
  );

  const more = row.locator('.track-result-tags .chip-more');
  await expect(more).toHaveText('+12 more');
  await expect(
    row.locator('.track-result-tags .chip-extra', { hasText: 'USA' }),
  ).toBeHidden();

  await more.click();

  await expect(
    row.locator('.track-result-tags .chip', { hasText: 'USA' }),
  ).toBeVisible();
  await expect(
    row.locator('.track-result-tags .chip', { hasText: 'Reggae' }),
  ).toBeVisible();
});
