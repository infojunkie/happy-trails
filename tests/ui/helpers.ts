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

export async function summaryTotal(page: Page): Promise<number> {
  const text = await page.locator('#result-summary').innerText();
  const match = /^([\d,]+)/.exec(text);
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
