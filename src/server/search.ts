/**
 * Text normalization and opaque album keys shared by the index builder and the
 * query layer. Keeping these in one module guarantees that values folded at
 * insert time and values folded for a query use exactly the same rules.
 */

import { foldAlnum, foldSearch } from '../shared/text.js';

export { foldAlnum, foldSearch } from '../shared/text.js';

/** Whitespace-delimited, folded search tokens; the unit FTS5 matches. */
export function searchTokens(value: string): string[] {
  return foldAlnum(value)
    .split(/\s+/)
    .filter(Boolean);
}

/** Lowercase key used to compare genres and build filter URLs. */
export function genreKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function albumKey(album: string, artist: string): string {
  return Buffer.from(JSON.stringify([album, artist]), 'utf8').toString(
    'base64url',
  );
}

export function decodeAlbumKey(
  key: string,
): { album: string; artist: string } | null {
  if (key.length === 0 || key.length > 4096) return null;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(key, 'base64url').toString('utf8'),
    );
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const album: unknown = parsed[0];
    const artist: unknown = parsed[1];
    if (typeof album !== 'string' || typeof artist !== 'string') return null;
    if (album.length > 1024 || artist.length > 1024) return null;
    return { album, artist };
  } catch {
    return null;
  }
}

/**
 * Collapse multi-CD album titles such as "Album // Bonus Tracks" to "Album".
 * The separator must be preceded by whitespace, so stylised titles that use
 * "//" inline (e.g. "...jazz//techno//triphop") are left untouched.
 */
export function normalizeAlbumName(album: string): string {
  const base = album.replace(/\s+\/\/.*$/, '').trim();
  return base.length > 0 ? base : album;
}

/** One `SERIES_ALLOWLIST` entry: a display name and its title substring. */
export interface SeriesAllowlistEntry {
  name: string;
  match: string;
}

/** Any content inside curly braces, e.g. "Album {Blue Note}". */
const CURLY_SERIES = /\{([^{}]+)\}/g;

/** Case/accent/apostrophe-insensitive key for series-name comparisons. */
function seriesNameKey(value: string): string {
  return foldSearch(value)
    .replace(/['’`´]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueSeries(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const series: string[] = [];
  for (const value of values) {
    const name = value.trim().replace(/\s+/g, ' ');
    if (!name) continue;
    const key = seriesNameKey(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    series.push(name);
  }
  return series;
}

/**
 * Series names inside `{...}` groups, in title order. Every group is split on
 * "/" (spaces are optional) and each token is a distinct series; no other
 * tokenizing is applied. Multiple groups each contribute their tokens.
 */
export function bracedSeries(album: string): string[] {
  const names: string[] = [];
  for (const match of album.matchAll(CURLY_SERIES)) {
    const value = (match[1] ?? '').trim();
    if (!value) continue;
    for (const part of value.split('/')) {
      const name = part.trim().replace(/\s+/g, ' ');
      if (name) names.push(name);
    }
  }
  return uniqueSeries(names);
}

/**
 * Final per-album series list.
 *
 * - Albums with `{...}` tokens use only those tokens; the allowlist is not
 *   consulted for them.
 * - Otherwise, the first `SERIES_ALLOWLIST` entry (configured order) whose
 *   folded match substring occurs anywhere in the album title contributes its
 *   display name. Different entries may map to the same name; the index keys
 *   series by that name, so those albums aggregate into one series.
 * - Finally, if any `SERIES_DENYLIST` entry occurs anywhere in the album
 *   title, the album is removed from all series.
 */
export function detectSeries(
  album: string,
  allowlist: readonly (string | SeriesAllowlistEntry)[] = [],
  denylist: readonly string[] = [],
): string[] {
  const albumKey = seriesNameKey(album);
  let series = bracedSeries(album);

  if (series.length === 0) {
    for (const rawEntry of allowlist) {
      const entry =
        typeof rawEntry === 'string'
          ? { name: rawEntry, match: rawEntry }
          : rawEntry;
      const key = seriesNameKey(entry.match);
      if (key && albumKey.includes(key)) {
        const name = entry.name.replace(/\s+/g, ' ').trim();
        if (name) series = [name];
        break;
      }
    }
  }

  if (series.length === 0) return [];

  const denied = denylist.some((entry) => {
    const key = seriesNameKey(entry);
    return key.length > 0 && albumKey.includes(key);
  });
  return denied ? [] : series;
}
