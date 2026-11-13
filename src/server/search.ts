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

/** Any content inside curly braces, e.g. "Album {Blue Note}". */
const CURLY_SERIES = /\{([^{}]+)\}/g;

/**
 * A leading year followed by a label and the word "Edition" inside square
 * brackets, e.g. "[2016 Rock Candy Edition]" -> "Rock Candy".
 */
const YEAR_EDITION_SERIES = /\[\s*\d{4}\s+([^[\]]+?)\s+Edition\s*\]/gi;

/** Strip bracketed/braced/parenthesized text before plain-title matching. */
function stripEnclosures(album: string): string {
  let value = album
    .replace(/\{[^{}]*\}/g, ' ')
    .replace(/\[[^[\]]*\]/g, ' ');

  let previous: string;
  do {
    previous = value;
    value = value.replace(/\([^()]*\)/g, ' ');
  } while (value !== previous);

  return value;
}

/**
 * Normalize an album title for plain-title matching: remove enclosures, the
 * multi-CD `//` suffix, a year + Vol./Volume marker before a volume number
 * (`Mr Music Hits 1989 Vol. 4` -> `Mr Music Hits 4`), then truncate at a
 * standalone dash or a colon. `truncated` records that a dash/colon suffix was
 * removed, which allows one-word label series such as
 * "Putumayo - Acoustic Africa".
 */
function seriesBaseTitle(album: string): {
  base: string;
  truncated: boolean;
} {
  const normalized = normalizeAlbumName(stripEnclosures(album))
    .replace(/\s+\d{4}\s+(?:vol\.?|volume)\s+/gi, ' ')
    .replace(/\s+(?:vol\.?|volume)\s+(?=\d+\s*$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const base = normalized
    .replace(/\s+[-–—]\s+.*$/, '')
    .replace(/:.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { base, truncated: base !== normalized };
}

/** Case/accent/apostrophe-insensitive key for series exception matching. */
function seriesExceptionKey(value: string): string {
  return foldSearch(value)
    .replace(/['’`´]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function exceptionKeySet(exceptions: readonly string[]): Set<string> {
  return new Set(exceptions.map(seriesExceptionKey));
}

function isExceptedSeries(
  value: string,
  exceptionKeys: ReadonlySet<string>,
): boolean {
  return exceptionKeys.has(seriesExceptionKey(value));
}

/** A label stem followed by a numeric volume, e.g. "World Network 38". */
const SERIES_VOLUME = /^(.*\S)\s+(\d+)$/;

/**
 * Fold numeric volume suffixes into their stem when the stem recurs with
 * several different numbers, so "Network Medien / World Network 1" and
 * "... 38" both become "Network Medien / World Network". A lone label such as
 * "Club Top 13" or "2 em 1" is left untouched because its stem has only one
 * numeric suffix.
 */
export function normalizeSeriesVolumes(
  values: Iterable<string>,
): Map<string, string> {
  const list = [...values];
  const suffixes = new Map<string, Set<string>>();
  const stemKey = (stem: string): string =>
    foldSearch(stem).replace(/\s+/g, ' ').trim();

  for (const value of list) {
    const match = SERIES_VOLUME.exec(value);
    if (!match) continue;
    const key = stemKey(match[1] ?? '');
    const suffix = match[2] ?? '';
    let seen = suffixes.get(key);
    if (!seen) {
      seen = new Set();
      suffixes.set(key, seen);
    }
    seen.add(suffix);
  }

  const volumeStems = new Set(
    [...suffixes]
      .filter(([, seen]) => seen.size > 1)
      .map(([key]) => key),
  );

  const normalized = new Map<string, string>();
  for (const value of list) {
    const match = SERIES_VOLUME.exec(value);
    if (match && volumeStems.has(stemKey(match[1] ?? ''))) {
      normalized.set(value, (match[1] ?? '').trim());
    } else {
      normalized.set(value, value);
    }
  }
  return normalized;
}

/**
 * Series/label names embedded in an album title (bracketed/braced values), in
 * title order, trimmed, whitespace-collapsed, deduplicated, and filtered by the
 * configured exceptions.
 */
export function embeddedSeries(
  album: string,
  exceptions: readonly string[] = [],
): string[] {
  const exceptionKeys = exceptionKeySet(exceptions);
  const matches: Array<{ index: number; value: string }> = [];

  for (const match of album.matchAll(CURLY_SERIES)) {
    const value = (match[1] ?? '').trim().replace(/\s+/g, ' ');
    if (value) matches.push({ index: match.index ?? 0, value });
  }
  for (const match of album.matchAll(YEAR_EDITION_SERIES)) {
    const value = (match[1] ?? '').trim().replace(/\s+/g, ' ');
    if (value) matches.push({ index: match.index ?? 0, value });
  }

  matches.sort((left, right) => left.index - right.index);

  const seen = new Set<string>();
  const series: string[] = [];
  for (const { value } of matches) {
    if (seen.has(value) || isExceptedSeries(value, exceptionKeys)) continue;
    seen.add(value);
    series.push(value);
  }
  return series;
}

/** One album as considered by the library-wide plain-title series detector. */
export interface SeriesAlbum {
  key: string;
  /** Normalized merged album title. */
  album: string;
  artist: string;
  trackCount: number;
  /** True when a track title is a prefix of the album title. */
  titleTrack: boolean;
}

const PLAIN_SERIES_MIN_ALBUMS = 5;
const PLAIN_SERIES_MAX_PREFIX_WORDS = 6;
const PLAIN_SERIES_MIN_AVERAGE_TRACKS = 2;

/**
 * Words that make a repeated prefix too generic to be a series when *every*
 * meaningful word is one of them ("Greatest Hits", "The Best Of …", "Live",
 * "Vol. 2", …). A prefix such as "Mr Music Hits" is kept because "Mr" and
 * "Music" are not generic.
 */
const GENERIC_SERIES_WORDS = new Set([
  'greatest',
  'best',
  'hits',
  'collection',
  'anthology',
  'classic',
  'classics',
  'essential',
  'complete',
  'ultimate',
  'gold',
  'platinum',
  'single',
  'singles',
  'rarity',
  'rarities',
  'live',
  'definitive',
  'cover',
  'covers',
  'love',
  'songs',
  'volume',
  'vol',
  'very',
  'ao',
  'vivo',
]);

const IGNORED_SERIES_WORDS = new Set([
  'the',
  'a',
  'an',
  'of',
  'and',
  'to',
  'in',
  'on',
  'at',
  'for',
  'with',
  'from',
]);

function isGenericSeriesPrefix(prefix: string): boolean {
  const words = prefix
    .split(/\s+/)
    .map((word) =>
      word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase(),
    )
    .filter((word) => word && !IGNORED_SERIES_WORDS.has(word));
  if (words.length === 0) return true;
  return words.every(
    (word) => /^\d+$/.test(word) || GENERIC_SERIES_WORDS.has(word),
  );
}

interface PrefixStat {
  albums: Set<string>;
  exact: SeriesAlbum[];
  artistSuffix: number;
  numberSuffix: number;
  display: Map<string, number>;
}

function mostCommonDisplay(display: Map<string, number>): string {
  let best = '';
  let bestCount = -1;
  for (const [value, count] of display) {
    if (count > bestCount || (count === bestCount && value < best)) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Detect series expressed by the album title itself rather than by a
 * bracketed/braced label. After enclosures, `//` suffixes, and ` - ` / `:`
 * suffixes are removed, a prefix is a series when it recurs across at least
 * five albums and one of these holds:
 *
 * - the whole title repeats (e.g. "Sem Limite"), excluding albums named after
 *   one of their tracks and one-track extracts;
 * - the title continues with the album artist ("A Arte de <artist>");
 * - the title continues with a 1–3 digit volume number
 *   ("The Wire Tapper 42").
 *
 * A one-word label prefix followed by ` - ` or `:` in the source title is also
 * eligible ("Putumayo - Acoustic Africa" -> "Putumayo"). Exact titles that are
 * also artist names ("The Beatles") are treated as self-titled/tribute albums,
 * not series. The shortest qualifying prefix wins, variable artist/volume text
 * is not part of the detected value, and configured exceptions are skipped.
 * Returns album key -> series name.
 */
export function detectPlainSeries(
  albums: readonly SeriesAlbum[],
  exceptions: readonly string[] = [],
): Map<string, string> {
  const exceptionKeys = exceptionKeySet(exceptions);
  const artistNames = new Set(
    albums.map((album) => foldSearch(album.artist).trim()),
  );
  const bases = new Map<string, string>();
  const stats = new Map<string, PrefixStat>();

  for (const album of albums) {
    const { base, truncated } = seriesBaseTitle(album.album);
    if (!base) continue;
    bases.set(album.key, base);
    const words = base.split(/\s+/);

    // One-word label series such as "Putumayo - <album>".
    const minPrefix = truncated && words.length === 1 ? 1 : 2;
    if (words.length < minPrefix) continue;

    const foldedTitle = foldSearch(base);
    const foldedArtist = foldSearch(album.artist);

    for (
      let length = minPrefix;
      length <= Math.min(PLAIN_SERIES_MAX_PREFIX_WORDS, words.length);
      length += 1
    ) {
      const prefix = words.slice(0, length).join(' ');
      const foldedPrefix = foldSearch(prefix);

      let stat = stats.get(foldedPrefix);
      if (!stat) {
        stat = {
          albums: new Set(),
          exact: [],
          artistSuffix: 0,
          numberSuffix: 0,
          display: new Map(),
        };
        stats.set(foldedPrefix, stat);
      }
      stat.albums.add(album.key);
      stat.display.set(prefix, (stat.display.get(prefix) ?? 0) + 1);

      const remainder =
        foldedTitle === foldedPrefix
          ? ''
          : foldedTitle.startsWith(`${foldedPrefix} `)
            ? foldedTitle.slice(foldedPrefix.length + 1)
            : null;

      if (remainder === '') {
        stat.exact.push(album);
      } else if (remainder === foldedArtist) {
        stat.artistSuffix += 1;
      } else if (remainder !== null && /^\d{1,3}$/.test(remainder)) {
        stat.numberSuffix += 1;
      }
    }
  }

  const qualifying = new Map<string, string>();
  for (const [prefix, stat] of stats) {
    if (stat.albums.size < PLAIN_SERIES_MIN_ALBUMS) continue;
    if (isGenericSeriesPrefix(prefix)) continue;

    const exact = stat.exact.filter((album) => !album.titleTrack);
    const exactOk =
      exact.length >= PLAIN_SERIES_MIN_ALBUMS &&
      exact.reduce((sum, album) => sum + album.trackCount, 0) /
        exact.length >=
        PLAIN_SERIES_MIN_AVERAGE_TRACKS;
    const variableOk =
      stat.artistSuffix >= PLAIN_SERIES_MIN_ALBUMS ||
      stat.numberSuffix >= PLAIN_SERIES_MIN_ALBUMS;
    const display = mostCommonDisplay(stat.display);
    // A repeated exact title that is also an artist name is usually a
    // self-titled or tribute album (e.g. "The Beatles"), not a series.
    const exactAllowed =
      exactOk && !artistNames.has(foldSearch(display).trim());

    if (
      (exactAllowed || variableOk) &&
      !isExceptedSeries(display, exceptionKeys)
    ) {
      qualifying.set(prefix, display);
    }
  }

  const detected = new Map<string, string>();
  for (const album of albums) {
    const base = bases.get(album.key);
    if (!base) continue;
    const words = base.split(/\s+/);
    const minLength = words.length === 1 ? 1 : 2;

    for (
      let length = minLength;
      length <= Math.min(PLAIN_SERIES_MAX_PREFIX_WORDS, words.length);
      length += 1
    ) {
      const serie = qualifying.get(
        foldSearch(words.slice(0, length).join(' ')),
      );
      if (serie) {
        detected.set(album.key, serie);
        break;
      }
    }
  }
  return detected;
}
