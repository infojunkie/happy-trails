import { test, expect } from '@playwright/test';
import { openSearch } from './helpers.js';

test('desktop field opens an overlaid search dialog with the current query', async ({
  page,
}) => {
  await page.goto('/?q=beatles');
  await expect(page.locator('.album-card').first()).toBeVisible();

  // The desktop trigger shows the applied query; the mobile icon is hidden.
  await expect(page.locator('#search-trigger')).toBeVisible();
  await expect(page.locator('#search-trigger')).toHaveValue('beatles');
  await expect(page.locator('#search-trigger-button')).toBeHidden();

  const input = await openSearch(page);
  await expect(page.locator('#search-dialog')).toBeVisible();
  await expect(input).toHaveValue('beatles');
  await expect(input).toBeFocused();
  expect(
    await input.evaluate((element) => {
      const field = element as HTMLInputElement;
      return [field.selectionStart, field.selectionEnd];
    }),
  ).toEqual([0, 'beatles'.length]);

  const geometry = await page.evaluate(() => {
    const rect = (selector: string) =>
      document.querySelector(selector)!.getBoundingClientRect();
    const brand = rect('.brand');
    const field = rect('.search-field');
    const header = rect('.site-header');
    const dialog = rect('#search-dialog-panel');
    return {
      brandRight: brand.right,
      dialogBottom: dialog.bottom,
      dialogLeft: dialog.left,
      dialogRight: dialog.right,
      dialogTop: dialog.top,
      fieldRight: field.right,
      headerBottom: header.bottom,
      headerTop: header.top,
    };
  });

  // The panel spans from the brand's right edge to the field's right edge
  // and overlays the header row, growing downward for the footer.
  expect(geometry.dialogLeft).toBeCloseTo(geometry.brandRight + 12, 0);
  expect(geometry.dialogRight).toBeCloseTo(geometry.fieldRight, 0);
  expect(geometry.dialogTop).toBeCloseTo(geometry.headerTop + 6, 0);
  expect(geometry.dialogTop).toBeLessThan(geometry.headerBottom);
  expect(geometry.dialogBottom).toBeGreaterThan(geometry.headerTop);

  const summary = page.locator('.search-operator-summary');
  for (const field of [
    'album:',
    'artist:',
    'track:',
    'genre:',
    'region:',
    'serie:',
    'source:',
    'composer:',
    'all:',
  ]) {
    await expect(summary).toContainText(field);
  }
  for (const operator of ['AND', 'OR', '"…"', '( )']) {
    await expect(summary).toContainText(operator);
  }
});

test('keyboard focus and the slash shortcut open the search dialog', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.album-card').first()).toBeVisible();

  await page.locator('#search-trigger').focus();
  await expect(page.locator('#search-dialog')).toBeVisible();
  await expect(page.locator('#search')).toBeFocused();

  // Escape restores focus to the header trigger without reopening it.
  await page.keyboard.press('Escape');
  await expect(page.locator('#search-dialog')).toBeHidden();
  await expect(page.locator('#search-trigger')).toBeFocused();

  // The focused trigger reopens with Enter or slash.
  await page.keyboard.press('Enter');
  await expect(page.locator('#search-dialog')).toBeVisible();
  await expect(page.locator('#search')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#search-dialog')).toBeHidden();
  await page.keyboard.press('/');
  await expect(page.locator('#search-dialog')).toBeVisible();
  await expect(page.locator('#search')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#search-dialog')).toBeHidden();

  // From elsewhere, the global slash shortcut still opens it.
  await page.locator('h1').click();
  await page.keyboard.press('/');
  await expect(page.locator('#search-dialog')).toBeVisible();
  await expect(page.locator('#search')).toBeFocused();
});

test('typing in the focused header field opens the dialog with the edit', async ({
  page,
}) => {
  await page.goto('/?q=beatles');
  await expect(page.locator('.album-card').first()).toBeVisible();
  await expect(page.locator('#search-trigger')).toHaveValue('beatles');

  // Focus opens the dialog; Escape returns focus to the header field.
  await page.locator('#search-trigger').focus();
  await expect(page.locator('#search-dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#search-dialog')).toBeHidden();
  await expect(page.locator('#search-trigger')).toBeFocused();

  // Typing at the end reopens the dialog with the character inserted.
  await page.locator('#search-trigger').press('End');
  await page.keyboard.type('m');
  await expect(page.locator('#search-dialog')).toBeVisible();
  const input = page.locator('#search');
  await expect(input).toHaveValue('beatlesm');
  await expect(input).toBeFocused();
  expect(
    await input.evaluate((element) =>
      (element as HTMLInputElement).selectionStart,
    ),
  ).toBe('beatlesm'.length);

  // Later characters land in the dialog's input.
  await page.keyboard.type('iles');
  await expect(input).toHaveValue('beatlesmiles');

  // Submitting applies the drafted query.
  await page.keyboard.press('Enter');
  await expect(page.locator('#search-dialog')).toBeHidden();
  await expect(page.locator('#search-trigger')).toHaveValue('beatlesmiles');

  // Focus returns to the header after submit; typing reopens with the edit.
  await expect(page.locator('#search-trigger')).toBeFocused();
  await page.locator('#search-trigger').press('End');
  await page.keyboard.type('!');
  await expect(page.locator('#search-dialog')).toBeVisible();
  await expect(page.locator('#search')).toHaveValue('beatlesmiles!');
});

test('the open dialog follows a breakpoint change', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.album-card').first()).toBeVisible();

  await page.locator('#search-trigger').click();
  await expect(page.locator('#search-dialog')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  const box = await page.locator('#search-dialog-panel').boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  expect(box.x).toBeCloseTo(0, 0);
  expect(box.width).toBeCloseTo(390, 0);
  expect(box.y).toBeCloseTo(0, 0);
});

test.describe('mobile search', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('shows only the icon and opens a full-width sheet', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.album-card').first()).toBeVisible();

    await expect(page.locator('#search-trigger')).toBeHidden();
    await expect(page.locator('#search-trigger-button')).toBeVisible();

    const input = await openSearch(page);
    const geometry = await page.evaluate(() => {
      const dialog = document
        .querySelector('#search-dialog-panel')!
        .getBoundingClientRect();
      return {
        left: dialog.left,
        right: dialog.right,
        top: dialog.top,
        viewportWidth: window.innerWidth,
      };
    });
    expect(geometry.left).toBeCloseTo(0, 0);
    expect(geometry.right).toBeCloseTo(geometry.viewportWidth, 0);
    expect(geometry.top).toBeCloseTo(0, 0);

    await input.fill('beatles');
    await input.press('Enter');
    await expect(page.locator('#search-dialog')).toBeHidden();
    await expect(page.locator('#search-trigger-button')).toHaveClass(
      /has-query/,
    );
    await expect(page.locator('#search-active-dot')).toBeVisible();
    await expect(page).toHaveURL(/[?&]q=beatles/);
  });
});
