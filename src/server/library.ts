import type {
  AlbumSummary,
  GenreFacet,
  SortKey,
  StatusResponse,
} from '../shared/types.js';
import { parseArtists } from './artists.js';
import { config } from './config.js';
import {
  loadAlbumRows,
  loadLibraryFingerprint,
  type AlbumRow,
} from './db.js';

/** Lowercase key used to compare genres and build filter URLs. */
export function genreKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Latin letters that NFKD does not decompose into ASCII. Without these,
 * searches such as "Soren" or "Michal" miss "Søren" and "Michał".
 */
const SPECIAL_LATIN: Readonly<Record<string, string>> = {
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ß: 'ss',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ı: 'i',
  ŋ: 'ng',
  ħ: 'h',
  ŧ: 't',
  ĸ: 'k',
  ĳ: 'ij',
  ƒ: 'f',
};

const SPECIAL_LATIN_RE = new RegExp(
  `[${Object.keys(SPECIAL_LATIN).join('')}]`,
  'g',
);

/** Case-, accent-, and ligature-insensitive folding for free-text search. */
function foldSearch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(
      SPECIAL_LATIN_RE,
      (character) => SPECIAL_LATIN[character] ?? character,
    );
}

export function albumKey(album: string, artist: string): string {
  return Buffer.from(JSON.stringify([album, artist]), 'utf8').toString('base64url');
}

export function decodeAlbumKey(key: string): { album: string; artist: string } | null {
  if (key.length === 0 || key.length > 4096) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(key, 'base64url').toString('utf8'));
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

interface IndexedAlbum {
  summary: AlbumSummary;
  /** Pre-folded "album artist" string used for free-text search. */
  search: string;
  genreKeys: string[];
  /** Raw album titles merged into this entry ("X", "X // Bonus Tracks", ...). */
  sourceAlbums: string[];
  /** Representative file path used to fetch the Synology cover. */
  coverPath: string | null;
}

export interface Snapshot {
  albums: IndexedAlbum[];
  byKey: Map<string, IndexedAlbum>;
  /** The same albums pre-sorted for each supported order. */
  sorted: Record<SortKey, IndexedAlbum[]>;
  genres: GenreFacet[];
  totalTracks: number;
  refreshedAt: Date;
  /** Monotonically increasing identifier for this snapshot. */
  version: number;
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

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

function compareTextDesc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? 1 : -1;
}

function compareYearDesc(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

function compareAlbums(a: IndexedAlbum, b: IndexedAlbum, sort: SortKey): number {
  switch (sort) {
    case 'artist':
      return (
        collator.compare(a.summary.artist, b.summary.artist) ||
        collator.compare(a.summary.album, b.summary.album) ||
        collator.compare(a.summary.key, b.summary.key)
      );
    case 'album':
      return (
        collator.compare(a.summary.album, b.summary.album) ||
        collator.compare(a.summary.artist, b.summary.artist) ||
        collator.compare(a.summary.key, b.summary.key)
      );
    case 'year':
      return (
        compareYearDesc(a.summary.year, b.summary.year) ||
        collator.compare(a.summary.album, b.summary.album) ||
        collator.compare(a.summary.artist, b.summary.artist)
      );
    case 'recent':
    default:
      return (
        compareTextDesc(a.summary.latest, b.summary.latest) ||
        collator.compare(a.summary.album, b.summary.album) ||
        collator.compare(a.summary.artist, b.summary.artist)
      );
  }
}

/** Split a comma-separated genre column into deduplicated {key, name} pairs. */
function splitGenres(raw: string | null): Array<{ key: string; name: string }> {
  if (!raw) return [];
  const byKey = new Map<string, string>();
  for (const part of raw.split(',')) {
    const name = part.trim().replace(/\s+/g, ' ');
    if (!name) continue;
    const key = genreKey(name);
    if (!byKey.has(key)) byKey.set(key, name);
  }
  return [...byKey].map(([key, name]) => ({ key, name }));
}

interface AlbumAccumulator {
  album: string;
  artist: string;
  sourceAlbums: Set<string>;
  sourcePaths: Map<string, string>;
  trackArtists: Set<string>;
  genreKeys: Set<string>;
  year: number | null;
  trackCount: number;
  duration: number;
  latest: string | null;
}

export function buildSnapshot(rows: AlbumRow[], version: number): Snapshot {
  const accumulators = new Map<string, AlbumAccumulator>();
  const genreDisplayNames = new Map<string, string>();

  for (const row of rows) {
    const rawAlbum = row.album;
    const album =
      rawAlbum === null || rawAlbum.trim() === ''
        ? '(Unknown Album)'
        : normalizeAlbumName(rawAlbum);
    const key = albumKey(album, row.artist);

    let acc = accumulators.get(key);
    if (!acc) {
      acc = {
        album,
        artist: row.artist,
        sourceAlbums: new Set(),
        sourcePaths: new Map(),
        trackArtists: new Set(),
        genreKeys: new Set(),
        year: null,
        trackCount: 0,
        duration: 0,
        latest: null,
      };
      accumulators.set(key, acc);
    }

    if (rawAlbum !== null) acc.sourceAlbums.add(rawAlbum);
    acc.sourcePaths.set(rawAlbum ?? album, row.cover_path);
    for (const trackArtist of row.track_artists ?? []) {
      const name = trackArtist.trim();
      if (name) acc.trackArtists.add(name);
    }
    acc.trackCount += row.track_count;
    acc.duration += row.duration;
    if (row.year !== null && (acc.year === null || row.year < acc.year)) {
      acc.year = row.year;
    }
    if (row.latest !== null && (acc.latest === null || row.latest > acc.latest)) {
      acc.latest = row.latest;
    }
    for (const genre of splitGenres(row.genres)) {
      acc.genreKeys.add(genre.key);
      if (!genreDisplayNames.has(genre.key)) {
        genreDisplayNames.set(genre.key, genre.name);
      }
    }
  }

  // Count each merged album once per genre, not once per raw CD title.
  const genreAlbumCounts = new Map<string, number>();
  for (const acc of accumulators.values()) {
    for (const key of acc.genreKeys) {
      genreAlbumCounts.set(key, (genreAlbumCounts.get(key) ?? 0) + 1);
    }
  }

  let totalTracks = 0;
  const albums: IndexedAlbum[] = [];
  for (const acc of accumulators.values()) {
    totalTracks += acc.trackCount;
    const genreKeys = [...acc.genreKeys];
    // Natural order keeps "CD2" before "CD10" in the dialog.
    const sourceAlbums = [...acc.sourceAlbums].sort((a, b) =>
      collator.compare(a, b),
    );
    const artists = parseArtists(acc.artist);
    const summary: AlbumSummary = {
      key: albumKey(acc.album, acc.artist),
      album: acc.album,
      artist: acc.artist,
      artists: artists.length > 0 ? artists : [acc.artist],
      year: acc.year,
      trackCount: acc.trackCount,
      duration: acc.duration,
      latest: acc.latest,
      // Use one canonical spelling per genre everywhere.
      genres: genreKeys.map((key) => genreDisplayNames.get(key) ?? key),
    };
    // Prefer the unsuffixed source's cover, then the first title naturally.
    const coverPath =
      acc.sourcePaths.get(acc.album) ??
      (sourceAlbums[0] ? acc.sourcePaths.get(sourceAlbums[0]) : undefined) ??
      null;

    albums.push({
      summary,
      // Include source titles and track artists so labels and guests match.
      search: foldSearch(
        [
          summary.album,
          summary.artist,
          ...summary.artists,
          ...sourceAlbums,
          ...acc.trackArtists,
        ].join(' '),
      ),
      genreKeys,
      sourceAlbums,
      coverPath,
    });
  }

  const genres: GenreFacet[] = [...genreAlbumCounts].map(([key, albumCount]) => ({
    key,
    name: genreDisplayNames.get(key) ?? key,
    albumCount,
  }));
  genres.sort(
    (a, b) => b.albumCount - a.albumCount || collator.compare(a.name, b.name),
  );

  return {
    albums,
    byKey: new Map(albums.map((entry) => [entry.summary.key, entry])),
    sorted: {
      recent: [...albums].sort((a, b) => compareAlbums(a, b, 'recent')),
      artist: [...albums].sort((a, b) => compareAlbums(a, b, 'artist')),
      album: [...albums].sort((a, b) => compareAlbums(a, b, 'album')),
      year: [...albums].sort((a, b) => compareAlbums(a, b, 'year')),
    },
    genres,
    totalTracks,
    refreshedAt: new Date(),
    version,
  };
}

export interface AlbumsQuery {
  genres: string[];
  q: string;
  sort: SortKey;
  offset: number;
  limit: number;
}

export interface AlbumsResult {
  total: number;
  albums: AlbumSummary[];
  libraryVersion: number;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Holds an aggregated album view in memory.
 *
 * The raw table has hundreds of thousands of rows and parsing genre lists in
 * SQL is expensive, so the album index is rebuilt periodically instead of
 * being recomputed on every request. Track lists are still read from the
 * database on demand.
 */
export class Library {
  private snapshot: Snapshot | null = null;
  private fingerprint: string | null = null;
  private version = 0;
  private lastError: string | null = null;
  private lastCheckedAt: Date | null = null;
  private rebuilding = false;
  private timer: NodeJS.Timeout | null = null;

  async start(): Promise<void> {
    await this.rebuild();
    this.lastCheckedAt = new Date();
    this.schedule(this.snapshot ? config.checkIntervalMs : 15_000);
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  getSnapshot(): Snapshot | null {
    return this.snapshot;
  }

  status(): StatusResponse {
    const snapshot = this.snapshot;
    return {
      ready: snapshot !== null,
      albumCount: snapshot?.albums.length ?? 0,
      trackCount: snapshot?.totalTracks ?? 0,
      libraryVersion: this.version,
      lastRefreshed: snapshot?.refreshedAt.toISOString() ?? null,
      lastCheckedAt: this.lastCheckedAt?.toISOString() ?? null,
      refreshing: this.rebuilding,
      checkIntervalMs: config.checkIntervalMs,
      error: this.lastError,
      playbackEnabled: config.dsmUrl !== null,
    };
  }

  /** Raw album titles that were merged into this album, for track lookup. */
  sourceAlbumsFor(album: string, artist: string): string[] {
    const entry = this.snapshot?.byKey.get(albumKey(album, artist));
    return entry ? entry.sourceAlbums : [album];
  }

  /** Representative file path for the album cover, or null if unknown. */
  coverPathFor(album: string, artist: string): string | null {
    const entry = this.snapshot?.byKey.get(albumKey(album, artist));
    return entry?.coverPath ?? null;
  }

  queryAlbums(query: AlbumsQuery): AlbumsResult {
    const snapshot = this.snapshot;
    if (!snapshot) throw new Error('Library is not ready');

    const selected = new Set(query.genres.map(genreKey).filter(Boolean));
    const tokens = foldSearch(query.q).split(/\s+/).filter(Boolean);

    const filtered = snapshot.sorted[query.sort].filter((entry) => {
      if (
        selected.size > 0 &&
        !entry.genreKeys.some((key) => selected.has(key))
      ) {
        return false;
      }
      return tokens.every((token) => entry.search.includes(token));
    });

    const albums = filtered
      .slice(query.offset, query.offset + query.limit)
      .map((entry) => entry.summary);

    return { total: filtered.length, albums, libraryVersion: snapshot.version };
  }

  private async rebuild(): Promise<void> {
    if (this.rebuilding) return;
    this.rebuilding = true;
    const started = Date.now();

    try {
      const fingerprint = await loadLibraryFingerprint();
      const rows = await loadAlbumRows();
      const version = this.version + 1;
      const snapshot = buildSnapshot(rows, version);
      this.snapshot = snapshot;
      this.fingerprint = fingerprint;
      this.version = version;
      this.lastError = null;
      console.log(
        `[library] version ${version}: indexed ${snapshot.albums.length} albums ` +
          `and ${snapshot.totalTracks} tracks in ${Date.now() - started} ms`,
      );
    } catch (error) {
      this.lastError = describeError(error);
      console.error('[library] rebuild failed:', error);
    } finally {
      this.rebuilding = false;
      this.lastCheckedAt = new Date();
    }
  }

  private async checkForChanges(): Promise<void> {
    if (this.rebuilding) return;
    this.lastCheckedAt = new Date();

    try {
      const current = await loadLibraryFingerprint();
      if (this.snapshot && current === this.fingerprint) {
        this.lastError = null;
        return;
      }

      console.log('[library] change detected; rebuilding snapshot');
      await this.rebuild();
    } catch (error) {
      this.lastError = describeError(error);
      console.error('[library] change check failed:', error);
      this.lastCheckedAt = new Date();
    }
  }

  private schedule(delay: number): void {
    this.stop();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.checkForChanges().finally(() => {
        this.schedule(this.snapshot ? config.checkIntervalMs : 15_000);
      });
    }, delay);
    this.timer.unref();
  }
}

export const library = new Library();
