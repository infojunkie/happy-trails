/**
 * Text normalization and opaque album keys shared by the index builder and the
 * query layer. Keeping these in one module guarantees that values folded at
 * insert time and values folded for a query use exactly the same rules.
 */

import { foldSearch } from '../shared/text.js';

export { foldSearch } from '../shared/text.js';

/** Whitespace-delimited, folded search tokens; the unit FTS5 matches. */
export function searchTokens(value: string): string[] {
  return foldSearch(value)
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
