import { expect, type Page } from '@playwright/test';
import type { AlbumsResponse } from '../../src/shared/types.js';

type QueryValue = string | readonly string[];

export async function apiAlbums(
  page: Page,
  params: Record<string, QueryValue> = {},
): Promise<AlbumsResponse> {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) search.append(name, item);
    } else {
      search.set(name, String(value));
    }
  }
  search.set('limit', '1');
  const response = await page.request.get(`/api/albums?${search.toString()}`);
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as AlbumsResponse;
}

/** Facet panels start collapsed; expand one before using its controls. */
export async function expandFacet(
  page: Page,
  toggleSelector: string,
  panelSelector: string,
): Promise<void> {
  const panel = page.locator(panelSelector);
  if (!(await panel.isVisible())) {
    await page.locator(toggleSelector).click();
  }
  await expect(panel).toBeVisible();
}

/** Number of results matching the current query, from the summary. */
/** Choose a Sort by option from the custom sort menu. */
export async function selectSortField(
  page: Page,
  field: 'added' | 'released' | 'artist' | 'album',
): Promise<void> {
  await page.locator('#sort-button').click();
  await page
    .locator(`#sort-field-options .sort-option[data-key="${field}"]`)
    .click();
}

/** Choose an Order option from the custom sort menu. */
export async function selectSortOrder(
  page: Page,
  order: 'asc' | 'desc',
): Promise<void> {
  await page.locator('#sort-button').click();
  await page
    .locator(`#sort-order-options .sort-option[data-key="${order}"]`)
    .click();
}

export async function summaryTotal(page: Page): Promise<number> {
  const text = await page.locator('#result-summary').innerText();
  // "Showing 48 / 320 of 410,761 tracks" or "Showing 48 / 410,761 tracks":
  // the first number is the shown count, the second is the matching total.
  const match = /^Showing [\d,]+ \/ ([\d,]+)/.exec(text);
  // A transient "Loading…" summary should make expect.poll retry, not fail.
  return match?.[1] ? Number(match[1].replaceAll(',', '')) : Number.NaN;
}

export async function expectSummaryFor(
  page: Page,
  params: Record<string, QueryValue> = {},
): Promise<AlbumsResponse> {
  const api = await apiAlbums(page, params);
  await expect
    .poll(() => summaryTotal(page), { timeout: 15_000 })
    .toBe(api.total);
  return api;
}
