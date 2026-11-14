import { test, expect } from '@playwright/test';

test('album view switch toggles grid and Cover Flow and remembers the choice', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('#album-grid .album-card').first()).toBeVisible();

  const gridButton = page.locator('#view-switch button[data-view="grid"]');
  const flowButton = page.locator('#view-switch button[data-view="coverflow"]');
  await expect(gridButton).toHaveAttribute('aria-pressed', 'true');
  await expect(flowButton).toHaveAttribute('aria-pressed', 'false');

  await flowButton.click();
  await expect(page.locator('.cf-root')).toBeVisible();
  await expect(page.locator('#album-grid')).toBeHidden();
  await expect(flowButton).toHaveAttribute('aria-pressed', 'true');

  // localStorage keeps the mode across reloads.
  await page.reload();
  await expect(page.locator('.cf-root')).toBeVisible();
  await expect(page.locator('#album-grid')).toBeHidden();

  await page.locator('#view-switch button[data-view="grid"]').click();
  await expect(page.locator('#album-grid .album-card').first()).toBeVisible();
  await expect(page.locator('.cf-root')).toHaveCount(0);
  await expect(gridButton).toHaveAttribute('aria-pressed', 'true');
});

test('Cover Flow activates the selected album by click and keyboard', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#view-switch button[data-view="coverflow"]').click();
  await expect(page.locator('.cf-root')).toBeVisible();

  const firstTitle = await page
    .locator('.coverflow-caption-title')
    .textContent();
  await page.locator('.cf-selected .cf-cover').click();
  await expect(page.locator('#album-dialog')).toBeVisible();
  await expect(page.locator('#dialog-title')).toHaveText(firstTitle ?? '');
  await page.locator('#album-dialog .dialog-close').click();
  await expect(page.locator('#album-dialog')).toBeHidden();

  await page.locator('.cf-viewport').focus();
  await page.keyboard.press('ArrowRight');
  const secondTitle = await page
    .locator('.coverflow-caption-title')
    .textContent();
  await page.locator('.cf-viewport').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#album-dialog')).toBeVisible();
  await expect(page.locator('#dialog-title')).toHaveText(secondTitle ?? '');
});

test('Cover Flow caption title opens the album and artist links search', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#view-switch button[data-view="coverflow"]').click();
  await expect(page.locator('.coverflow-caption')).toBeVisible();

  const title = await page.locator('.coverflow-caption-title').textContent();
  await page.locator('.coverflow-caption-title').click();
  await expect(page.locator('#album-dialog')).toBeVisible();
  await expect(page.locator('#dialog-title')).toHaveText(title ?? '');
  await page.locator('#album-dialog .dialog-close').click();
  await expect(page.locator('#album-dialog')).toBeHidden();

  const artist = page.locator('.coverflow-caption-meta .artist-link').first();
  const artistName = await artist.textContent();
  await artist.click();
  await expect(page.locator('#search')).toHaveValue(artistName ?? '');
});

test('the album view switch is hidden in Tracks mode', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#view-switch')).toBeVisible();

  await page.locator('#mode-tracks').click();
  await expect(page.locator('#view-switch')).toBeHidden();

  await page.locator('#mode-albums').click();
  await expect(page.locator('#view-switch')).toBeVisible();
});
