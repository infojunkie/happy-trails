import { test, expect } from '@playwright/test';

test('world map view loads lazily and persists', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#album-grid .album-card').first()).toBeVisible();
  await expect(page.locator('#album-map .leaflet-container')).toHaveCount(0);

  const mapButton = page.locator('#view-switch button[data-view="map"]');
  await mapButton.click();
  await expect(page.locator('#album-map')).toBeVisible();
  await expect(page.locator('#album-map.leaflet-container')).toBeVisible();
  await expect(page.locator('#album-grid')).toBeHidden();
  await expect(
    page
      .locator('#album-map .leaflet-overlay-pane path:not([d="M0 0"])')
      .first(),
  ).toBeVisible();
  await expect(mapButton).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await expect(page.locator('#album-map.leaflet-container')).toBeVisible();
  await expect(page.locator('#album-grid')).toBeHidden();

  await page.locator('#view-switch button[data-view="grid"]').click();
  await expect(page.locator('#album-grid .album-card').first()).toBeVisible();
  await expect(page.locator('#album-map')).toBeHidden();
});

test('map view keeps Load more and appends the next page', async ({ page }) => {
  await page.route('**/api/albums?*', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (Array.isArray(body.albums)) body.total = 50;
    await route.fulfill({ response, json: body });
  });

  await page.goto('/');
  await expect(page.locator('#album-grid .album-card').first()).toBeVisible();
  await expect(page.locator('#load-more')).toBeVisible();

  await page.locator('#view-switch button[data-view="map"]').click();
  await expect(page.locator('#album-map.leaflet-container')).toBeVisible();
  await expect(page.locator('.map-pin-group').first()).toBeVisible();
  await expect(page.locator('#load-more')).toBeVisible();

  await page.locator('#load-more').click();
  await expect(page.locator('#load-more')).toBeEnabled();
  await expect(page.locator('#load-more')).toBeVisible();
  await expect(page.locator('.map-pin-group').first()).toBeVisible();
});

test('map cover pins open the album dialog', async ({ page }) => {
  await page.goto('/');
  await page.locator('#view-switch button[data-view="map"]').click();
  await expect(page.locator('.map-pin-group').first()).toBeVisible();

  const group = page.locator('.map-pin-group[aria-label$="1 album"]').first();
  const pin = group.locator('.map-pin-cover');
  const label = await pin.getAttribute('aria-label');
  const title = label?.match(/^Open (.*) by /)?.[1];
  expect(title).toBeTruthy();

  await pin.click();
  await expect(page.locator('#album-dialog')).toBeVisible();
  await expect(page.locator('#dialog-title')).toHaveText(title ?? '');
});

test('pin activation from full-screen opens the dialog and exits full-screen', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#view-switch button[data-view="map"]').click();
  await expect(page.locator('.map-pin-group').first()).toBeVisible();

  await page.locator('.map-toolbar-button', { hasText: 'Full screen' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const map = document.getElementById('album-map-view');
        return (
          document.fullscreenElement?.id === 'album-map-view' ||
          map?.classList.contains('is-expanded') === true
        );
      }),
    )
    .toBe(true);

  await page
    .locator('.map-pin-group[aria-label$="1 album"] .map-pin-cover')
    .first()
    .click();
  await expect(page.locator('#album-dialog')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.fullscreenElement === null))
    .toBe(true);
});

test('overflowing locations fan covers and list them in a popup', async ({
  page,
}) => {
  await page.route('**/api/albums?*', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (Array.isArray(body.albums) && body.albums.length > 0) {
      const base = body.albums[0];
      body.albums = Array.from({ length: 10 }, (_, index) => ({
        ...base,
        key: `test-${index}`,
        album: `Test Album ${index + 1}`,
        artist: 'Test Artist',
        artists: ['Test Artist'],
        regions: ['Brazil'],
        genres: ['Test'],
      }));
      body.total = 10;
    }
    await route.fulfill({ response, json: body });
  });

  await page.goto('/');
  await expect(page.locator('#album-grid .album-card').first()).toBeVisible();
  await page.locator('#view-switch button[data-view="map"]').click();
  await expect(page.locator('.map-pin-group').first()).toBeVisible();

  await expect(page.locator('.map-pin-more').first()).toHaveText('+5');
  await page.locator('.map-pin-more').first().click();
  await expect(page.locator('.map-pin-popup')).toBeVisible();
  await expect(page.locator('.map-pin-list-item')).toHaveCount(10);
  await expect(page.locator('.map-pin-list-title')).toContainText(
    'Brazil · 10 albums',
  );
});

test('map full-screen control enters and leaves full-screen', async ({ page }) => {
  await page.goto('/');
  await page.locator('#view-switch button[data-view="map"]').click();
  await expect(page.locator('#album-map.leaflet-container')).toBeVisible();

  await page.locator('.map-toolbar-button', { hasText: 'Full screen' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const map = document.getElementById('album-map-view');
        return (
          document.fullscreenElement?.id === 'album-map-view' ||
          map?.classList.contains('is-expanded') === true
        );
      }),
    )
    .toBe(true);

  await page.locator('.map-toolbar-button', { hasText: 'Exit full screen' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const map = document.getElementById('album-map');
        return (
          document.fullscreenElement === null &&
          map?.classList.contains('is-expanded') !== true
        );
      }),
    )
    .toBe(true);
});

test('unplaced albums are listed, collapsible, and open the dialog', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#view-switch button[data-view="map"]').click();
  await expect(page.locator('.map-pin-group').first()).toBeVisible();
  await expect(page.locator('#album-unplaced-section')).toBeVisible();
  await expect(page.locator('#album-unplaced-count')).not.toHaveText('0');

  const item = page.locator('.album-unplaced-item').first();
  const label = await item.getAttribute('aria-label');
  const title = label?.match(/^Open (.*) by /)?.[1];
  expect(title).toBeTruthy();
  await item.click();
  await expect(page.locator('#album-dialog')).toBeVisible();
  await expect(page.locator('#dialog-title')).toHaveText(title ?? '');
  await page.locator('#album-dialog .dialog-close').click();

  await page.locator('#album-unplaced-toggle').click();
  await expect(page.locator('#album-unplaced-toggle')).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(page.locator('#album-unplaced-list')).toBeHidden();
  await page.locator('#album-unplaced-toggle').click();
  await expect(page.locator('#album-unplaced-list')).toBeVisible();

  await page.locator('#view-switch button[data-view="grid"]').click();
  await expect(page.locator('#album-unplaced-section')).toBeHidden();
});

test('map view explains when no albums have a region', async ({ page }) => {
  await page.goto(
    `/?q=${encodeURIComponent('album:"abbey road" artist:beatles')}`,
  );
  await page.locator('#view-switch button[data-view="map"]').click();
  await expect(page.locator('#album-map-view')).toBeVisible();
  await expect(page.locator('.map-pin-group')).toHaveCount(0);
  await expect(page.locator('#album-map-empty')).toBeVisible();
  await expect(page.locator('#album-unplaced-section')).toBeVisible();
  await expect(page.locator('#album-unplaced-count')).not.toHaveText('0');
});

test('map view falls back to the empty state when nothing matches', async ({
  page,
}) => {
  await page.goto(`/?q=${encodeURIComponent('album:zzzz-no-match')}`);
  await page.locator('#view-switch button[data-view="map"]').click();
  await expect(page.locator('#album-map-view')).toBeVisible();
  await expect(page.locator('#empty-state')).toBeVisible();
  await expect(page.locator('#album-unplaced-section')).toBeHidden();
  await expect(page.locator('#album-map-empty')).toBeHidden();
  await expect(page.locator('#load-more')).toBeHidden();
});

test('view mode changes are recorded in browser history', async ({ page }) => {
  await page.goto('/');
  await page.locator('#view-switch button[data-view="map"]').click();
  await expect(page).toHaveURL(/layout=map/);
  await expect(page.locator('#album-map.leaflet-container')).toBeVisible();

  await page.goBack();
  await expect(page).not.toHaveURL(/layout=map/);
  await expect(page.locator('#album-grid')).toBeVisible();
  await expect(page.locator('#album-map-view')).toBeHidden();

  await page.goForward();
  await expect(page).toHaveURL(/layout=map/);
  await expect(page.locator('#album-map.leaflet-container')).toBeVisible();
});

test('opening a map pin is recorded and Back returns to the map', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#view-switch button[data-view="map"]').click();
  await expect(page.locator('#album-map.leaflet-container')).toBeVisible();
  const before = page.url();

  await page
    .locator('.map-pin-group[aria-label$="1 album"] .map-pin-cover')
    .first()
    .click();
  await expect(page.locator('#album-dialog')).toBeVisible();
  expect(page.url()).toBe(before);

  await page.goBack();
  await expect(page.locator('#album-dialog')).toBeHidden();
  await expect(page.locator('#album-map.leaflet-container')).toBeVisible();
});

test('opening an unplaced album is recorded and Back returns to the map', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#view-switch button[data-view="map"]').click();
  await expect(page.locator('#album-unplaced-section')).toBeVisible();

  await page.locator('.album-unplaced-item').first().click();
  await expect(page.locator('#album-dialog')).toBeVisible();

  await page.goBack();
  await expect(page.locator('#album-dialog')).toBeHidden();
  await expect(page.locator('#album-unplaced-section')).toBeVisible();
});

test('map zoom does not add history entries', async ({ page }) => {
  await page.goto('/');
  await page.locator('#view-switch button[data-view="map"]').click();
  await expect(page.locator('#album-map.leaflet-container')).toBeVisible();

  const url = page.url();
  const length = await page.evaluate(() => history.length);
  await page.locator('#album-map .leaflet-control-zoom-in').click();
  await page.waitForTimeout(400);
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => history.length)).toBe(length);
});

test('map assets show a retry action after a failed load', async ({ page }) => {
  let failures = 1;
  await page.route('**/map/places.json', async (route) => {
    if (failures > 0) {
      failures -= 1;
      await route.fulfill({ status: 500, body: 'unavailable' });
      return;
    }
    await route.continue();
  });

  await page.goto('/');
  await page.locator('#view-switch button[data-view="map"]').click();
  await expect(page.locator('#album-map .map-status-error')).toBeVisible();
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('#album-map.leaflet-container')).toBeVisible();
  await expect(page.locator('.map-pin-group').first()).toBeVisible();
});

test('map pins are keyboard-activatable', async ({ page }) => {
  await page.goto('/');
  await page.locator('#view-switch button[data-view="map"]').click();
  const pin = page
    .locator('.map-pin-group[aria-label$="1 album"] .map-pin-cover')
    .first();
  await expect(pin).toBeVisible();
  await pin.focus();
  await expect(pin).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#album-dialog')).toBeVisible();
});

test('mobile map uses compact pins', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('#view-switch button[data-view="map"]').click();
  await expect(page.locator('.map-pin-group').first()).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('#album-map')
        .evaluate((el) =>
          getComputedStyle(el).getPropertyValue('--pin-cover-size').trim(),
        ),
    )
    .toBe('36px');
});

test('the fitted map leaves room for northern-most pins', async ({ page }) => {
  await page.goto('/');
  await page.locator('#view-switch button[data-view="map"]').click();
  const iceland = page.locator('.map-pin-group[aria-label^="Iceland"]');
  await expect(iceland).toBeVisible();

  const mapBox = await page.locator('#album-map').boundingBox();
  const pinBox = await iceland.locator('.map-pin-cover').first().boundingBox();
  expect(mapBox).not.toBeNull();
  expect(pinBox).not.toBeNull();
  expect(pinBox!.y).toBeGreaterThanOrEqual(mapBox!.y + 4);
});
