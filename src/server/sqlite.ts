import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type {
  AlbumSummary,
  GenreFacet,
  SortKey,
  TrackSummary,
} from '../shared/types.js';
import { regionKey } from '../shared/text.js';
import { parseArtists } from './artists.js';
import { config } from './config.js';
import type { AlbumRow, TrackIndexRow } from './db.js';
import { isRegionTag } from './regions.js';
import {
  albumKey,
  detectPlainSeries,
  embeddedSeries,
  foldSearch,
  genreKey,
  normalizeAlbumName,
  normalizeSeriesVolumes,
  searchTokens,
  type SeriesAlbum,
} from './search.js';
import {
  parseSearchQuery,
  SEARCH_FIELD_COLUMNS,
  type SearchNode,
  type SearchTermNode,
} from './searchQuery.js';

export interface AlbumsQuery {
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

export interface TracksQuery {
  q: string;
  sort: SortKey;
  offset: number;
  limit: number;
}

export interface TracksResult {
  total: number;
  tracks: TrackSummary[];
  libraryVersion: number;
}

/** Collation used by the legacy in-memory index for all user-visible sorts. */
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

const SCHEMA_SQL = `
  PRAGMA journal_mode = MEMORY;
  PRAGMA synchronous = OFF;
  PRAGMA temp_store = MEMORY;
  PRAGMA foreign_keys = ON;

  CREATE TABLE albums (
    id          INTEGER PRIMARY KEY,
    key         TEXT NOT NULL UNIQUE,
    album       TEXT NOT NULL,
    artist      TEXT NOT NULL,
    year        INTEGER,
    track_count INTEGER NOT NULL,
    duration    INTEGER NOT NULL,
    latest      TEXT,
    cover_path  TEXT,
    search_text TEXT NOT NULL,
    search_album TEXT NOT NULL,
    search_artist TEXT NOT NULL,
    search_source TEXT NOT NULL,
    search_composer TEXT NOT NULL,
    album_rank  INTEGER NOT NULL,
    artist_rank INTEGER NOT NULL,
    key_rank    INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE album_artists (
    album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    artist   TEXT NOT NULL,
    PRIMARY KEY (album_id, position)
  ) STRICT;

  CREATE TABLE album_sources (
    album_id     INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    position     INTEGER NOT NULL,
    source_album TEXT NOT NULL,
    cover_path   TEXT,
    PRIMARY KEY (album_id, position)
  ) STRICT;

  CREATE TABLE album_comments (
    album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    comment  TEXT NOT NULL,
    PRIMARY KEY (album_id, position)
  ) STRICT;

  CREATE TABLE series (
    key       TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    name_rank INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE album_series (
    album_id  INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    position  INTEGER NOT NULL,
    serie_key TEXT NOT NULL REFERENCES series(key),
    PRIMARY KEY (album_id, position)
  ) STRICT;

  CREATE TABLE genres (
    key       TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    name_rank INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE album_genres (
    album_id  INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    position  INTEGER NOT NULL,
    genre_key TEXT NOT NULL REFERENCES genres(key),
    PRIMARY KEY (album_id, position)
  ) STRICT;

  CREATE TABLE regions (
    key       TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    name_rank INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE album_regions (
    album_id   INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    position   INTEGER NOT NULL,
    region_key TEXT NOT NULL REFERENCES regions(key),
    PRIMARY KEY (album_id, position)
  ) STRICT;

  CREATE TABLE tracks (
    id              INTEGER PRIMARY KEY,
    album_id        INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    title           TEXT NOT NULL,
    artist          TEXT,
    source_album    TEXT NOT NULL,
    year            INTEGER,
    disc            INTEGER,
    track           INTEGER,
    duration        INTEGER,
    date            TEXT,
    genre_names     TEXT NOT NULL,
    region_names    TEXT NOT NULL,
    search_title    TEXT NOT NULL,
    search_artist   TEXT NOT NULL,
    search_source   TEXT NOT NULL,
    search_composer TEXT NOT NULL,
    artist_rank     INTEGER NOT NULL,
    album_rank      INTEGER NOT NULL
  ) STRICT;

  CREATE INDEX tracks_artist_order
    ON tracks(artist_rank, album_rank, disc, track, id);
  CREATE INDEX tracks_album_order
    ON tracks(album_rank, disc, track, id);
  CREATE INDEX tracks_date_order
    ON tracks(date DESC, album_rank, disc, track, id);
  CREATE INDEX tracks_year_order
    ON tracks(year DESC, album_rank, disc, track, id);
  CREATE INDEX tracks_by_album ON tracks(album_id);

  CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;

  CREATE INDEX albums_artist_order
    ON albums(artist_rank, album_rank, key_rank);
  CREATE INDEX albums_album_order
    ON albums(album_rank, artist_rank, key_rank);
  CREATE INDEX albums_year_order
    ON albums(year DESC, album_rank, artist_rank);
  CREATE INDEX albums_latest_order
    ON albums(latest DESC, album_rank, artist_rank);
  CREATE INDEX album_genres_by_genre
    ON album_genres(genre_key, album_id);
  CREATE INDEX album_regions_by_region
    ON album_regions(region_key, album_id);
  CREATE INDEX album_series_by_serie
    ON album_series(serie_key, album_id);
  -- Track search resolves album-level terms by album_id.
  CREATE INDEX album_genres_by_album
    ON album_genres(album_id, genre_key);
  CREATE INDEX album_regions_by_album
    ON album_regions(album_id, region_key);
  CREATE INDEX album_series_by_album
    ON album_series(album_id, serie_key);

  -- The trigram tokenizer gives FTS5 substring semantics, which is what the
  -- original index did with String.includes(). unicode61 would only match
  -- whole words or prefixes. Search text is already folded by foldSearch().
  CREATE VIRTUAL TABLE album_search USING fts5(
    search_text,
    search_album,
    search_artist,
    search_source,
    search_composer,
    content = 'albums',
    content_rowid = 'id',
    tokenize = 'trigram'
  );

  CREATE VIRTUAL TABLE track_search USING fts5(
    search_title,
    search_artist,
    search_source,
    search_composer,
    content = 'tracks',
    content_rowid = 'id',
    tokenize = 'trigram'
  );
`;

/**
 * Created after the bulk load so the initial insert does not pay the FTS
 * trigger cost; the index is populated with a single 'rebuild' command.
 */
const TRIGGER_SQL = `
  CREATE TRIGGER albums_ai AFTER INSERT ON albums BEGIN
    INSERT INTO album_search(
      rowid, search_text, search_album, search_artist,
      search_source, search_composer
    ) VALUES (
      new.id, new.search_text, new.search_album, new.search_artist,
      new.search_source, new.search_composer
    );
  END;

  CREATE TRIGGER albums_ad AFTER DELETE ON albums BEGIN
    INSERT INTO album_search(
      album_search, rowid, search_text, search_album, search_artist,
      search_source, search_composer
    ) VALUES (
      'delete', old.id, old.search_text, old.search_album, old.search_artist,
      old.search_source, old.search_composer
    );
  END;

  CREATE TRIGGER albums_au AFTER UPDATE OF
    search_text, search_album, search_artist,
    search_source, search_composer
  ON albums BEGIN
    INSERT INTO album_search(
      album_search, rowid, search_text, search_album, search_artist,
      search_source, search_composer
    ) VALUES (
      'delete', old.id, old.search_text, old.search_album, old.search_artist,
      old.search_source, old.search_composer
    );
    INSERT INTO album_search(
      rowid, search_text, search_album, search_artist,
      search_source, search_composer
    ) VALUES (
      new.id, new.search_text, new.search_album, new.search_artist,
      new.search_source, new.search_composer
    );
  END;

  CREATE TRIGGER tracks_ai AFTER INSERT ON tracks BEGIN
    INSERT INTO track_search(
      rowid, search_title, search_artist, search_source, search_composer
    ) VALUES (
      new.id, new.search_title, new.search_artist,
      new.search_source, new.search_composer
    );
  END;

  CREATE TRIGGER tracks_ad AFTER DELETE ON tracks BEGIN
    INSERT INTO track_search(
      track_search, rowid, search_title, search_artist,
      search_source, search_composer
    ) VALUES (
      'delete', old.id, old.search_title, old.search_artist,
      old.search_source, old.search_composer
    );
  END;

  CREATE TRIGGER tracks_au AFTER UPDATE OF
    search_title, search_artist, search_source, search_composer
  ON tracks BEGIN
    INSERT INTO track_search(
      track_search, rowid, search_title, search_artist,
      search_source, search_composer
    ) VALUES (
      'delete', old.id, old.search_title, old.search_artist,
      old.search_source, old.search_composer
    );
    INSERT INTO track_search(
      rowid, search_title, search_artist, search_source, search_composer
    ) VALUES (
      new.id, new.search_title, new.search_artist,
      new.search_source, new.search_composer
    );
  END;
`;

const ORDER_BY: Readonly<Record<SortKey, string>> = {
  artist: 'a.artist_rank ASC, a.album_rank ASC, a.key_rank ASC',
  album: 'a.album_rank ASC, a.artist_rank ASC, a.key_rank ASC',
  // SQLite sorts NULLs last for DESC, matching the old comparator. Keeping
  // the expression off the first sort term lets the (value DESC, rank…)
  // indexes satisfy deep OFFSET pagination without a full sort.
  year: 'a.year DESC, a.album_rank ASC, a.artist_rank ASC',
  recent: 'a.latest DESC, a.album_rank ASC, a.artist_rank ASC',
};

const TRACK_ORDER_BY: Readonly<Record<SortKey, string>> = {
  artist:
    't.artist_rank ASC, t.album_rank ASC, t.disc ASC NULLS LAST, t.track ASC NULLS LAST, t.id ASC',
  album:
    't.album_rank ASC, t.disc ASC NULLS LAST, t.track ASC NULLS LAST, t.id ASC',
  year: 't.year DESC, t.album_rank ASC, t.disc ASC NULLS LAST, t.track ASC NULLS LAST, t.id ASC',
  recent:
    't.date DESC, t.album_rank ASC, t.disc ASC NULLS LAST, t.track ASC NULLS LAST, t.id ASC',
};

/** Album fields shared by the listing and the single-album lookup. */
const ALBUM_SUMMARY_COLUMNS = `
  a.key, a.album, a.artist, a.year, a.track_count, a.duration,
  a.latest,
  (SELECT json_group_array(artist) FROM (
     SELECT aa.artist AS artist
       FROM album_artists aa
      WHERE aa.album_id = a.id
      ORDER BY aa.position
   )) AS artists,
  (SELECT json_group_array(name) FROM (
     SELECT g.name AS name
       FROM album_genres ag
       JOIN genres g ON g.key = ag.genre_key
      WHERE ag.album_id = a.id
      ORDER BY ag.position
   )) AS genres,
  (SELECT json_group_array(name) FROM (
     SELECT r.name AS name
       FROM album_regions ar
       JOIN regions r ON r.key = ar.region_key
      WHERE ar.album_id = a.id
      ORDER BY ar.position
   )) AS regions,
  (SELECT json_group_array(comment) FROM (
     SELECT ac.comment AS comment
       FROM album_comments ac
      WHERE ac.album_id = a.id
      ORDER BY ac.position
   )) AS comments
`;

interface AlbumAccumulator {
  key: string;
  album: string;
  artist: string;
  sourceAlbums: Set<string>;
  sourcePaths: Map<string, string>;
  trackArtists: Set<string>;
  composers: Set<string>;
  comments: Set<string>;
  genreKeys: Set<string>;
  regionKeys: Set<string>;
  year: number | null;
  trackCount: number;
  duration: number;
  latest: string | null;
  /** At least one track title prefixes the album title. */
  titleTrack: boolean;
}

interface DbAlbumRow {
  key: string;
  album: string;
  artist: string;
  year: number | null;
  track_count: number;
  duration: number;
  latest: string | null;
  artists: string;
  genres: string;
  regions: string;
  comments: string;
}

interface DbTrackRow {
  id: number;
  title: string;
  artist: string;
  album_artist: string;
  source_album: string;
  year: number | null;
  disc: number | null;
  track: number | null;
  duration: number | null;
  album_key: string;
  album: string;
  genre_names: string;
  region_names: string;
}

/** A facet value's folded display name, used for bare-term tag matching. */
interface SearchName {
  key: string;
  search: string;
}

function mapAlbumRow(row: DbAlbumRow): AlbumSummary {
  return {
    key: row.key,
    album: row.album,
    artist: row.artist,
    artists: parseStringArray(row.artists),
    year: row.year,
    trackCount: row.track_count,
    duration: row.duration,
    latest: row.latest,
    genres: parseStringArray(row.genres),
    regions: parseStringArray(row.regions),
    comments: parseStringArray(row.comments),
  };
}

function loadSearchNames(
  db: DatabaseSync,
  table: 'genres' | 'regions' | 'series',
): SearchName[] {
  const rows = db.prepare(`SELECT key, name FROM ${table}`).all();
  return rows.map((row) => ({
    key: String(row.key),
    search: foldSearch(String(row.name)),
  }));
}

/** Raw album title, with blank/null collapsed to the unknown-album placeholder. */
function sourceAlbumTitle(raw: string | null): string {
  return raw === null || raw.trim() === '' ? '(Unknown Album)' : raw;
}

/** Visible track artist: the track artist, falling back to the album artist. */
function effectiveTrackArtist(row: TrackIndexRow): string {
  const artist = row.artist?.trim() ?? '';
  return artist.length > 0 ? artist : row.album_artist;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Remove a file-backed index; `:memory:` databases have nothing to delete. */
function removeDatabaseFile(databasePath: string): void {
  if (databasePath === ':memory:') return;
  try {
    fs.rmSync(databasePath, { force: true });
  } catch (error) {
    console.warn(`[library] could not delete index file ${databasePath}:`, error);
  }
}

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

/**
 * Assign dense ranks in the same order as Intl.Collator. Values that compare
 * equal (for example "Live at X" and "Live At X" with sensitivity: base) get
 * the same rank, so SQL can use the next column as the tie-breaker just like
 * the old comparator did.
 */
function rankValues(values: Iterable<string>): Map<string, number> {
  const sorted = [...new Set(values)].sort((a, b) => collator.compare(a, b));
  const ranks = new Map<string, number>();
  let rank = -1;
  let previous: string | null = null;

  for (const value of sorted) {
    if (previous === null || collator.compare(previous, value) !== 0) {
      rank += 1;
    }
    ranks.set(value, rank);
    previous = value;
  }

  return ranks;
}

/** Collator order with a code-unit tie-break, so the output is deterministic. */
function compareComments(left: string, right: string): number {
  return (
    collator.compare(left, right) ||
    (left < right ? -1 : left > right ? 1 : 0)
  );
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}


/** JSON-quote a token as an FTS5 phrase, escaping embedded double quotes. */
function ftsPhrase(token: string): string {
  return `"${token.replaceAll('"', '""')}"`;
}

/**
 * NUL and other control characters cannot be bound into an FTS5 query safely.
 * No real metadata contains them, so treat such a token as matching nothing
 * rather than returning a 500.
 */
// eslint-disable-next-line no-control-regex -- control characters are the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

/** Pre-syntax behavior: every whitespace-separated token, all fields, ANDed. */
function legacySearchNode(input: string): SearchNode | null {
  let node: SearchNode | null = null;
  for (const token of searchTokens(input)) {
    const term: SearchNode = {
      kind: 'term',
      field: 'all',
      value: token,
      quoted: false,
    };
    node = node
      ? { kind: 'and', left: node, right: term }
      : term;
  }
  return node;
}

async function accumulateAlbums(
  rows: AlbumRow[],
): Promise<{
  accumulators: Map<string, AlbumAccumulator>;
  genreDisplayNames: Map<string, string>;
  regionDisplayNames: Map<string, string>;
}> {
  const accumulators = new Map<string, AlbumAccumulator>();
  const genreDisplayNames = new Map<string, string>();
  const regionDisplayNames = new Map<string, string>();

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row) continue;

    const rawAlbum = row.album;
    const album =
      rawAlbum === null || rawAlbum.trim() === ''
        ? '(Unknown Album)'
        : normalizeAlbumName(rawAlbum);
    const key = albumKey(album, row.artist);

    let acc = accumulators.get(key);
    if (!acc) {
      acc = {
        key,
        album,
        artist: row.artist,
        sourceAlbums: new Set(),
        sourcePaths: new Map(),
        trackArtists: new Set(),
        composers: new Set(),
        comments: new Set(),
        genreKeys: new Set(),
        regionKeys: new Set(),
        year: null,
        trackCount: 0,
        duration: 0,
        latest: null,
        titleTrack: false,
      };
      accumulators.set(key, acc);
    }

    if (row.title_track) acc.titleTrack = true;
    if (rawAlbum !== null) acc.sourceAlbums.add(rawAlbum);
    acc.sourcePaths.set(rawAlbum ?? album, row.cover_path);
    for (const trackArtist of row.track_artists ?? []) {
      const name = trackArtist.trim();
      if (name) acc.trackArtists.add(name);
    }
    for (const composer of row.composers ?? []) {
      const name = composer.trim();
      if (name) acc.composers.add(name);
    }
    for (const comment of row.comments ?? []) {
      const text = comment.trim();
      if (text) acc.comments.add(text);
    }
    acc.trackCount += row.track_count;
    acc.duration += row.duration;
    if (row.year !== null && (acc.year === null || row.year < acc.year)) {
      acc.year = row.year;
    }
    if (row.latest !== null && (acc.latest === null || row.latest > acc.latest)) {
      acc.latest = row.latest;
    }
    for (const tag of splitGenres(row.genres)) {
      if (isRegionTag(tag.name)) {
        const key = regionKey(tag.name);
        acc.regionKeys.add(key);
        if (!regionDisplayNames.has(key)) {
          regionDisplayNames.set(key, tag.name);
        }
      } else {
        acc.genreKeys.add(tag.key);
        if (!genreDisplayNames.has(tag.key)) {
          genreDisplayNames.set(tag.key, tag.name);
        }
      }
    }

    if (index % 4096 === 0) await yieldToEventLoop();
  }

  return { accumulators, genreDisplayNames, regionDisplayNames };
}

/**
 * A SQLite database containing the album and track index.
 *
 * The database is built off to the side and only published by Library after
 * it is complete, so requests continue to use the previous version while a
 * rebuild runs. It lives at the caller-provided path (normally a file under
 * INDEX_DB_DIR) or in memory when the path is `:memory:`.
 */
export class SqliteIndex {
  readonly albumCount: number;
  readonly trackCount: number;
  readonly version: number;
  readonly databaseBytes: number;
  readonly refreshedAt = new Date();

  /** Folded facet display names, used by bare-term matching in track mode. */
  private readonly genreSearchNames: SearchName[];
  private readonly regionSearchNames: SearchName[];
  private readonly seriesSearchNames: SearchName[];
  private closed = false;

  private constructor(
    private readonly db: DatabaseSync,
    private readonly databasePath: string,
    albumCount: number,
    trackCount: number,
    version: number,
    databaseBytes: number,
  ) {
    this.albumCount = albumCount;
    this.trackCount = trackCount;
    this.version = version;
    this.databaseBytes = databaseBytes;
    this.genreSearchNames = loadSearchNames(db, 'genres');
    this.regionSearchNames = loadSearchNames(db, 'regions');
    this.seriesSearchNames = loadSearchNames(db, 'series');
  }

  static async build(
    rows: AlbumRow[],
    trackRows: TrackIndexRow[],
    version: number,
    databasePath = ':memory:',
  ): Promise<SqliteIndex> {
    const { accumulators, genreDisplayNames, regionDisplayNames } =
      await accumulateAlbums(rows);
    // Library does not need the raw rows after parsing. Releasing them here
    // keeps the peak heap closer to the size of the SQLite database.
    rows.length = 0;

    const albumNames: string[] = [];
    const artistNames: string[] = [];
    const keyValues: string[] = [];
    let albumTrackTotal = 0;
    for (const acc of accumulators.values()) {
      albumNames.push(acc.album);
      artistNames.push(acc.artist);
      keyValues.push(acc.key);
      albumTrackTotal += acc.trackCount;
    }
    const albumCount = accumulators.size;

    // Track sorts use the visible artist (track artist, falling back to the
    // album artist), so rank that value separately from the album artists.
    const trackArtistNames = trackRows.map((row) => effectiveTrackArtist(row));

    const albumRanks = rankValues(albumNames);
    const artistRanks = rankValues(artistNames);
    const keyRanks = rankValues(keyValues);
    const genreRanks = rankValues(genreDisplayNames.values());
    const regionRanks = rankValues(regionDisplayNames.values());
    const trackArtistRanks = rankValues(trackArtistNames);
    albumNames.length = 0;
    artistNames.length = 0;
    keyValues.length = 0;
    trackArtistNames.length = 0;

    const db = new DatabaseSync(databasePath);
    try {
      db.exec(SCHEMA_SQL);
      db.exec('BEGIN');

      const insertMeta = db.prepare(
        'INSERT INTO meta(key, value) VALUES (?, ?)',
      );
      const insertGenre = db.prepare(
        'INSERT INTO genres(key, name, name_rank) VALUES (?, ?, ?)',
      );
      const insertRegion = db.prepare(
        'INSERT INTO regions(key, name, name_rank) VALUES (?, ?, ?)',
      );
      const insertSerie = db.prepare(
        'INSERT INTO series(key, name, name_rank) VALUES (?, ?, ?)',
      );
      const insertAlbum = db.prepare(`
        INSERT INTO albums(
          key, album, artist, year, track_count, duration, latest, cover_path,
          search_text, search_album, search_artist, search_source,
          search_composer, album_rank, artist_rank, key_rank
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertTrack = db.prepare(`
        INSERT INTO tracks(
          id, album_id, title, artist, source_album,
          year, disc, track, duration, date,
          genre_names, region_names,
          search_title, search_artist, search_source, search_composer,
          artist_rank, album_rank
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertAlbumArtist = db.prepare(
        'INSERT INTO album_artists(album_id, position, artist) VALUES (?, ?, ?)',
      );
      const insertAlbumSource = db.prepare(
        'INSERT INTO album_sources(album_id, position, source_album, cover_path) VALUES (?, ?, ?, ?)',
      );
      const insertAlbumComment = db.prepare(
        'INSERT INTO album_comments(album_id, position, comment) VALUES (?, ?, ?)',
      );
      const insertAlbumSerie = db.prepare(
        'INSERT INTO album_series(album_id, position, serie_key) VALUES (?, ?, ?)',
      );
      const insertAlbumGenre = db.prepare(
        'INSERT INTO album_genres(album_id, position, genre_key) VALUES (?, ?, ?)',
      );
      const insertAlbumRegion = db.prepare(
        'INSERT INTO album_regions(album_id, position, region_key) VALUES (?, ?, ?)',
      );

      for (const [key, name] of genreDisplayNames) {
        insertGenre.run(key, name, genreRanks.get(name) ?? 0);
      }
      for (const [key, name] of regionDisplayNames) {
        insertRegion.run(key, name, regionRanks.get(name) ?? 0);
      }

      const embeddedByKey = new Map<string, string[]>();
      const seriesAlbums: SeriesAlbum[] = [];
      for (const [key, acc] of accumulators) {
        const embedded = embeddedSeries(acc.album, config.seriesExceptions);
        embeddedByKey.set(key, embedded);
        // An explicit {...}/[...] series is authoritative; do not feed the
        // title to the less reliable plain-title detector.
        if (embedded.length > 0) continue;
        seriesAlbums.push({
          key,
          album: acc.album,
          artist: acc.artist,
          trackCount: acc.trackCount,
          titleTrack: acc.titleTrack,
        });
      }
      const embeddedValues = new Set<string>();
      for (const values of embeddedByKey.values()) {
        for (const value of values) embeddedValues.add(value);
      }
      const normalizedEmbedded = normalizeSeriesVolumes(embeddedValues);
      for (const [key, values] of embeddedByKey) {
        embeddedByKey.set(
          key,
          [
            ...new Set(
              values.map((value) => normalizedEmbedded.get(value) ?? value),
            ),
          ],
        );
      }

      const plainSeries = detectPlainSeries(
        seriesAlbums,
        config.seriesExceptions,
      );

      const seriesByKey = new Map<string, string[]>();
      const seriesDisplayNames = new Map<string, string>();
      for (const key of accumulators.keys()) {
        const values = embeddedByKey.get(key) ?? [];
        const detectedSerie =
          values.length === 0 ? plainSeries.get(key) : undefined;
        if (detectedSerie) values.push(detectedSerie);
        if (values.length === 0) continue;
        seriesByKey.set(key, values);
        for (const value of values) {
          const serieKey = foldSearch(value);
          if (!seriesDisplayNames.has(serieKey)) {
            seriesDisplayNames.set(serieKey, value);
          }
        }
      }
      const seriesRanks = rankValues(seriesDisplayNames.values());
      for (const [key, name] of seriesDisplayNames) {
        insertSerie.run(key, name, seriesRanks.get(name) ?? 0);
      }

      // Track rows need the album ids and album ranks assigned during the
      // album insert. The map is small (one entry per album).
      const albumMetaByKey = new Map<string, { id: number; rank: number }>();

      let inserted = 0;
      for (const [key, acc] of accumulators) {
        const artists = parseArtists(acc.artist);
        const displayArtists = artists.length > 0 ? artists : [acc.artist];
        // Natural order keeps "CD2" before "CD10" in the dialog.
        const sourceAlbums = [...acc.sourceAlbums].sort((a, b) =>
          collator.compare(a, b),
        );
        // Prefer the unsuffixed source's cover, then the first title naturally.
        const coverPath =
          acc.sourcePaths.get(acc.album) ??
          (sourceAlbums[0] ? acc.sourcePaths.get(sourceAlbums[0]) : undefined) ??
          null;
        const trackArtists = [...acc.trackArtists];
        const composers = [...acc.composers];
        const comments = [...acc.comments].sort(compareComments);
        const series = seriesByKey.get(key) ?? [];
        const genreKeys = [...acc.genreKeys];
        const regionKeys = [...acc.regionKeys];
        const genreNames = genreKeys.map(
          (genre) => genreDisplayNames.get(genre) ?? genre,
        );
        const regionNames = regionKeys.map(
          (region) => regionDisplayNames.get(region) ?? region,
        );
        // Include tags, source titles, track artists, composers, and series.
        const searchText = foldSearch(
          [
            acc.album,
            acc.artist,
            ...displayArtists,
            ...sourceAlbums,
            ...trackArtists,
            ...composers,
            ...series,
            ...genreNames,
            ...regionNames,
          ].join(' '),
        );
        const searchAlbum = foldSearch(
          [acc.album, ...sourceAlbums].join(' '),
        );
        const searchArtist = foldSearch(
          [acc.artist, ...displayArtists, ...trackArtists].join(' '),
        );
        const searchSource = foldSearch(sourceAlbums.join(' '));
        const searchComposer = foldSearch(composers.join(' '));
        const albumRank = albumRanks.get(acc.album) ?? 0;

        const result = insertAlbum.run(
          acc.key,
          acc.album,
          acc.artist,
          acc.year,
          acc.trackCount,
          acc.duration,
          acc.latest,
          coverPath,
          searchText,
          searchAlbum,
          searchArtist,
          searchSource,
          searchComposer,
          albumRank,
          artistRanks.get(acc.artist) ?? 0,
          keyRanks.get(key) ?? 0,
        );
        const albumId = Number(result.lastInsertRowid);
        albumMetaByKey.set(key, { id: albumId, rank: albumRank });

        for (let position = 0; position < displayArtists.length; position += 1) {
          insertAlbumArtist.run(
            albumId,
            position,
            displayArtists[position] ?? '',
          );
        }
        for (let position = 0; position < sourceAlbums.length; position += 1) {
          const sourceAlbum = sourceAlbums[position] ?? '';
          insertAlbumSource.run(
            albumId,
            position,
            sourceAlbum,
            acc.sourcePaths.get(sourceAlbum) ?? null,
          );
        }
        for (let position = 0; position < comments.length; position += 1) {
          insertAlbumComment.run(albumId, position, comments[position] ?? '');
        }
        for (let position = 0; position < series.length; position += 1) {
          insertAlbumSerie.run(
            albumId,
            position,
            foldSearch(series[position] ?? ''),
          );
        }
        for (let position = 0; position < genreKeys.length; position += 1) {
          insertAlbumGenre.run(albumId, position, genreKeys[position] ?? '');
        }
        for (let position = 0; position < regionKeys.length; position += 1) {
          insertAlbumRegion.run(albumId, position, regionKeys[position] ?? '');
        }

        // Drop each accumulator as soon as it has been written so the heap
        // does not hold the whole parsed library alongside the database.
        accumulators.delete(key);
        if (inserted % 512 === 0) await yieldToEventLoop();
        inserted += 1;
      }

      let indexedTracks = 0;
      let unmappedTracks = 0;
      for (let index = 0; index < trackRows.length; index += 1) {
        const row = trackRows[index];
        if (!row) continue;

        const sourceAlbum = sourceAlbumTitle(row.source_album);
        const albumTitle =
          sourceAlbum === '(Unknown Album)'
            ? '(Unknown Album)'
            : normalizeAlbumName(sourceAlbum);
        const albumMeta = albumMetaByKey.get(
          albumKey(albumTitle, row.album_artist),
        );
        if (!albumMeta) {
          unmappedTracks += 1;
          continue;
        }

        const visibleArtist = effectiveTrackArtist(row);
        const searchArtist = foldSearch(
          [row.artist?.trim() ?? '', row.album_artist.trim()]
            .filter(Boolean)
            .join(' '),
        );

        // Per-track tags are stored for the row pills. Filtering and facet
        // counts remain album-level (see docs/sqlite-index.md).
        const trackGenreKeys = new Set<string>();
        const trackRegionKeys = new Set<string>();
        for (const tag of splitGenres(row.genre)) {
          if (isRegionTag(tag.name)) trackRegionKeys.add(regionKey(tag.name));
          else trackGenreKeys.add(tag.key);
        }
        const genreNames = [...trackGenreKeys].map(
          (key) => genreDisplayNames.get(key) ?? key,
        );
        const regionNames = [...trackRegionKeys].map(
          (key) => regionDisplayNames.get(key) ?? key,
        );

        insertTrack.run(
          row.id,
          albumMeta.id,
          row.title,
          row.artist,
          sourceAlbum,
          row.year,
          row.disc,
          row.track,
          row.duration,
          row.date,
          JSON.stringify(genreNames),
          JSON.stringify(regionNames),
          foldSearch(row.title),
          searchArtist,
          foldSearch(sourceAlbum),
          foldSearch(row.composer?.trim() ?? ''),
          trackArtistRanks.get(visibleArtist) ?? 0,
          albumMeta.rank,
        );
        indexedTracks += 1;
        if (index % 4096 === 0) await yieldToEventLoop();
      }
      trackRows.length = 0;

      if (unmappedTracks > 0) {
        console.warn(
          `[library] ${unmappedTracks} track rows did not map to an album`,
        );
      }
      if (indexedTracks !== albumTrackTotal) {
        console.warn(
          `[library] indexed ${indexedTracks} tracks but albums report ${albumTrackTotal}`,
        );
      }

      insertMeta.run('version', String(version));
      insertMeta.run('album_count', String(albumCount));
      insertMeta.run('track_count', String(indexedTracks));
      insertMeta.run('region_count', String(regionDisplayNames.size));
      insertMeta.run('built_at', new Date().toISOString());
      insertMeta.run('schema_version', '10');

      db.exec(TRIGGER_SQL);
      db.exec(`INSERT INTO album_search(album_search) VALUES ('rebuild')`);
      db.exec(`INSERT INTO track_search(track_search) VALUES ('rebuild')`);
      db.exec('COMMIT');
      db.exec('PRAGMA user_version = 10');
      db.exec('PRAGMA optimize');

      const pageCount = Number(
        db.prepare('PRAGMA page_count').get()?.page_count ?? 0,
      );
      const pageSize = Number(
        db.prepare('PRAGMA page_size').get()?.page_size ?? 0,
      );
      const databaseBytes =
        databasePath === ':memory:'
          ? pageCount * pageSize
          : fs.statSync(databasePath).size;

      return new SqliteIndex(
        db,
        databasePath,
        albumCount,
        indexedTracks,
        version,
        databaseBytes,
      );
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // The transaction may not have started.
      }
      db.close();
      removeDatabaseFile(databasePath);
      throw error;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
    removeDatabaseFile(this.databasePath);
  }

  genres(): GenreFacet[] {
    const rows = this.db
      .prepare(
        `SELECT g.key AS key, g.name AS name,
                COUNT(DISTINCT ag.album_id) AS album_count
           FROM genres g
           JOIN album_genres ag ON ag.genre_key = g.key
          GROUP BY g.key, g.name, g.name_rank
          ORDER BY album_count DESC, g.name_rank ASC`,
      )
      .all();

    return rows.map((row) => ({
      key: String(row.key),
      name: String(row.name),
      albumCount: Number(row.album_count),
    }));
  }

  regions(): GenreFacet[] {
    const rows = this.db
      .prepare(
        `SELECT r.key AS key, r.name AS name,
                COUNT(DISTINCT ar.album_id) AS album_count
           FROM regions r
           JOIN album_regions ar ON ar.region_key = r.key
          GROUP BY r.key, r.name, r.name_rank
          ORDER BY album_count DESC, r.name_rank ASC`,
      )
      .all();

    return rows.map((row) => ({
      key: String(row.key),
      name: String(row.name),
      albumCount: Number(row.album_count),
    }));
  }

  series(): GenreFacet[] {
    const rows = this.db
      .prepare(
        `SELECT s.key AS key, s.name AS name,
                COUNT(DISTINCT ase.album_id) AS album_count
           FROM series s
           JOIN album_series ase ON ase.serie_key = s.key
          GROUP BY s.key, s.name, s.name_rank
          ORDER BY album_count DESC, s.name_rank ASC`,
      )
      .all();

    return rows.map((row) => ({
      key: String(row.key),
      name: String(row.name),
      albumCount: Number(row.album_count),
    }));
  }

  queryAlbums(query: AlbumsQuery): AlbumsResult {
    const where: string[] = [];
    const params: Array<string | number> = [];

    const trimmedQuery = query.q.trim();
    let searchAst = trimmedQuery ? parseSearchQuery(query.q) : null;
    if (!searchAst && trimmedQuery) {
      // Preserve the pre-syntax behavior for incomplete or malformed input.
      searchAst = legacySearchNode(trimmedQuery);
    }

    const ctes: string[] = [];
    const cteParams: string[] = [];

    const termSql = (term: SearchTermNode): string => {
      // Genre/region are categorical: match the tag table exactly rather than
      // using the substring FTS columns, so facet counts and query totals agree.
      if (term.field === 'genre' || term.field === 'region') {
        const key =
          term.field === 'genre'
            ? genreKey(term.value)
            : regionKey(term.value);
        if (!key || CONTROL_CHARS.test(key)) return '0';

        const table =
          term.field === 'genre' ? 'album_genres' : 'album_regions';
        const column =
          term.field === 'genre' ? 'genre_key' : 'region_key';
        params.push(key);
        return `EXISTS (
          SELECT 1 FROM ${table} tag
           WHERE tag.album_id = a.id AND tag.${column} = ?
        )`;
      }

      if (term.field === 'serie') {
        const key = foldSearch(term.value).replace(/\s+/g, ' ').trim();
        if (!key || CONTROL_CHARS.test(key)) return '0';
        params.push(key);
        return `EXISTS (
          SELECT 1 FROM album_series ase
           WHERE ase.album_id = a.id AND ase.serie_key = ?
        )`;
      }

      // `track:` matches albums that contain a matching track title. The
      // track index is separate, so this uses its own FTS materialization.
      if (term.field === 'track') {
        const phrase = foldSearch(term.value).trim();
        if (!phrase || CONTROL_CHARS.test(phrase)) return '0';
        if ([...phrase].length >= 3) {
          const name = `track_term_${ctes.length}`;
          ctes.push(
            `${name} AS MATERIALIZED (
               SELECT rowid FROM track_search
                WHERE track_search MATCH ?
             )`,
          );
          cteParams.push(`search_title : ${ftsPhrase(phrase)}`);
          return `EXISTS (
            SELECT 1 FROM tracks tr
              JOIN ${name} ON ${name}.rowid = tr.id
             WHERE tr.album_id = a.id
          )`;
        }
        params.push(phrase);
        return `EXISTS (
          SELECT 1 FROM tracks tr
           WHERE tr.album_id = a.id AND instr(tr.search_title, ?) > 0
        )`;
      }

      const phrase = foldSearch(term.value).trim();
      if (!phrase || CONTROL_CHARS.test(phrase)) return '0';

      const column = SEARCH_FIELD_COLUMNS[term.field];
      if (!column) return '0';
      if ([...phrase].length >= 3) {
        const name = `search_term_${ctes.length}`;
        ctes.push(
          `${name} AS MATERIALIZED (
             SELECT rowid FROM album_search
              WHERE album_search MATCH ?
           )`,
        );
        cteParams.push(`${column} : ${ftsPhrase(phrase)}`);
        return `EXISTS (SELECT 1 FROM ${name} WHERE ${name}.rowid = a.id)`;
      }

      // Trigram indexes only phrases of three or more characters; shorter
      // phrases fall back to an exact substring scan of the folded column.
      params.push(phrase);
      return `instr(a.${column}, ?) > 0`;
    };

    const nodeSql = (node: SearchNode): string => {
      switch (node.kind) {
        case 'term':
          return termSql(node);
        case 'and':
          return `(${nodeSql(node.left)} AND ${nodeSql(node.right)})`;
        case 'or':
          return `(${nodeSql(node.left)} OR ${nodeSql(node.right)})`;
      }
    };

    if (searchAst) where.push(nodeSql(searchAst));

    const withSql = ctes.length > 0 ? `WITH ${ctes.join(', ')} ` : '';
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const boundParams: Array<string | number> = [...cteParams, ...params];

    const countRow = this.db
      .prepare(
        `${withSql}SELECT COUNT(*) AS total FROM albums a ${whereSql}`,
      )
      .get(...boundParams);
    const total = Number(countRow?.total ?? 0);

    const rows = this.db
      .prepare(
        `${withSql}SELECT ${ALBUM_SUMMARY_COLUMNS}
         FROM albums a
         ${whereSql}
         ORDER BY ${ORDER_BY[query.sort]}
         LIMIT ? OFFSET ?`,
      )
      .all(...boundParams, query.limit, query.offset) as unknown as DbAlbumRow[];

    const albums: AlbumSummary[] = rows.map(mapAlbumRow);

    return { total, albums, libraryVersion: this.version };
  }

  /** Album summary for one opaque key, used by the track-list dialog. */
  albumForKey(key: string): AlbumSummary | null {
    if (key.length === 0 || key.length > 4096) return null;
    const row = this.db
      .prepare(`SELECT ${ALBUM_SUMMARY_COLUMNS} FROM albums a WHERE a.key = ?`)
      .get(key) as unknown as DbAlbumRow | undefined;
    return row ? mapAlbumRow(row) : null;
  }

  queryTracks(query: TracksQuery): TracksResult {
    const where: string[] = [];
    const params: Array<string | number> = [];

    const trimmedQuery = query.q.trim();
    let searchAst = trimmedQuery ? parseSearchQuery(query.q) : null;
    if (!searchAst && trimmedQuery) {
      // Preserve the pre-syntax behavior for incomplete or malformed input.
      searchAst = legacySearchNode(trimmedQuery);
    }

    const ctes: string[] = [];
    const cteParams: string[] = [];

    /**
     * Match a phrase against one or more `track_search` columns. Trigram
     * indexes only phrases of three or more characters; shorter phrases fall
     * back to `instr()` scans.
     */
    const ftsTerm = (columns: readonly string[], phrase: string): string => {
      if ([...phrase].length >= 3) {
        const name = `track_term_${ctes.length}`;
        const columnFilter =
          columns.length === 1
            ? (columns[0] ?? '')
            : `{${columns.join(' ')}}`;
        ctes.push(
          `${name} AS MATERIALIZED (
             SELECT rowid FROM track_search
              WHERE track_search MATCH ?
           )`,
        );
        cteParams.push(`${columnFilter} : ${ftsPhrase(phrase)}`);
        return `EXISTS (SELECT 1 FROM ${name} WHERE ${name}.rowid = t.id)`;
      }

      params.push(...columns.map(() => phrase));
      return `(${columns
        .map((column) => `instr(t.${column}, ?) > 0`)
        .join(' OR ')})`;
    };

    /** Match the album title and raw source titles via the album index. */
    const albumTitleTerm = (phrase: string): string => {
      if ([...phrase].length >= 3) {
        const name = `album_term_${ctes.length}`;
        ctes.push(
          `${name} AS MATERIALIZED (
             SELECT rowid FROM album_search
              WHERE album_search MATCH ?
           )`,
        );
        cteParams.push(`search_album : ${ftsPhrase(phrase)}`);
        return `t.album_id IN (SELECT rowid FROM ${name})`;
      }
      params.push(phrase);
      return `EXISTS (
        SELECT 1 FROM albums al
         WHERE al.id = t.album_id AND instr(al.search_album, ?) > 0
      )`;
    };

    /**
     * Match a bare term against the track fields, the album title, and
     * album-level genre/region/series names. The branches are materialized as
     * one UNION so a broad term such as "jazz" is not evaluated with a
     * correlated subquery for every track.
     */
    const allTerm = (phrase: string): string => {
      const branches: string[] = [];

      if ([...phrase].length >= 3) {
        branches.push(
          `SELECT rowid AS id FROM track_search
            WHERE track_search MATCH ?`,
        );
        cteParams.push(
          `{search_title search_artist search_source search_composer} : ${ftsPhrase(phrase)}`,
        );
      } else {
        branches.push(
          `SELECT id FROM tracks
            WHERE instr(search_title, ?) > 0
               OR instr(search_artist, ?) > 0
               OR instr(search_source, ?) > 0
               OR instr(search_composer, ?) > 0`,
        );
        cteParams.push(phrase, phrase, phrase, phrase);
      }

      if ([...phrase].length >= 3) {
        branches.push(
          `SELECT t.id FROM tracks t
            WHERE t.album_id IN (
              SELECT rowid FROM album_search
               WHERE album_search MATCH ?
            )`,
        );
        cteParams.push(`search_album : ${ftsPhrase(phrase)}`);
      } else {
        branches.push(
          `SELECT t.id FROM tracks t
            WHERE t.album_id IN (
              SELECT a.id FROM albums a
               WHERE instr(a.search_album, ?) > 0
            )`,
        );
        cteParams.push(phrase);
      }

      const addKeys = (
        names: readonly SearchName[],
        table: 'album_genres' | 'album_regions' | 'album_series',
        column: 'genre_key' | 'region_key' | 'serie_key',
      ): void => {
        const keys = names
          .filter((item) => item.search.includes(phrase))
          .map((item) => item.key);
        if (keys.length === 0) return;
        const placeholders = keys.map(() => '?').join(', ');
        branches.push(
          `SELECT t.id FROM tracks t
             JOIN ${table} tag ON tag.album_id = t.album_id
            WHERE tag.${column} IN (${placeholders})`,
        );
        cteParams.push(...keys);
      };

      addKeys(this.genreSearchNames, 'album_genres', 'genre_key');
      addKeys(this.regionSearchNames, 'album_regions', 'region_key');
      addKeys(this.seriesSearchNames, 'album_series', 'serie_key');

      if (branches.length === 0) return '0';

      const name = `all_term_${ctes.length}`;
      ctes.push(`${name} AS MATERIALIZED (${branches.join(' UNION ')})`);
      return `EXISTS (SELECT 1 FROM ${name} WHERE ${name}.id = t.id)`;
    };

    const termSql = (term: SearchTermNode): string => {
      // Genre/region/series are categorical and album-level: match the album
      // mapping tables exactly, so the sidebar's album counts agree with the
      // track filters.
      if (term.field === 'genre' || term.field === 'region') {
        const key =
          term.field === 'genre'
            ? genreKey(term.value)
            : regionKey(term.value);
        if (!key || CONTROL_CHARS.test(key)) return '0';

        const table =
          term.field === 'genre' ? 'album_genres' : 'album_regions';
        const column =
          term.field === 'genre' ? 'genre_key' : 'region_key';
        params.push(key);
        return `EXISTS (
          SELECT 1 FROM ${table} tag
           WHERE tag.album_id = t.album_id AND tag.${column} = ?
        )`;
      }

      if (term.field === 'serie') {
        const key = foldSearch(term.value).replace(/\s+/g, ' ').trim();
        if (!key || CONTROL_CHARS.test(key)) return '0';
        params.push(key);
        return `EXISTS (
          SELECT 1 FROM album_series ase
           WHERE ase.album_id = t.album_id AND ase.serie_key = ?
        )`;
      }

      const phrase = foldSearch(term.value).trim();
      if (!phrase || CONTROL_CHARS.test(phrase)) return '0';

      switch (term.field) {
        case 'track':
          return ftsTerm(['search_title'], phrase);
        case 'album':
          return albumTitleTerm(phrase);
        case 'artist':
          return ftsTerm(['search_artist'], phrase);
        case 'source':
          return ftsTerm(['search_source'], phrase);
        case 'composer':
          return ftsTerm(['search_composer'], phrase);
        case 'all':
          // Bare terms match the track's own metadata, the album title, and
          // album-level tags/series. They deliberately do not match the whole
          // album search text, which would make every track of an album match
          // a guest artist or composer credited on a different track.
          return allTerm(phrase);
        default:
          return '0';
      }
    };

    const nodeSql = (node: SearchNode): string => {
      switch (node.kind) {
        case 'term':
          return termSql(node);
        case 'and':
          return `(${nodeSql(node.left)} AND ${nodeSql(node.right)})`;
        case 'or':
          return `(${nodeSql(node.left)} OR ${nodeSql(node.right)})`;
      }
    };

    if (searchAst) where.push(nodeSql(searchAst));

    const withSql = ctes.length > 0 ? `WITH ${ctes.join(', ')} ` : '';
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const boundParams: Array<string | number> = [...cteParams, ...params];

    const countRow = this.db
      .prepare(
        `${withSql}SELECT COUNT(*) AS total FROM tracks t ${whereSql}`,
      )
      .get(...boundParams);
    const total = Number(countRow?.total ?? 0);

    const rows = this.db
      .prepare(
        `${withSql}SELECT
           t.id, t.title,
           COALESCE(NULLIF(trim(t.artist), ''), al.artist) AS artist,
           al.artist AS album_artist,
           t.source_album, t.year, t.track, t.disc, t.duration,
           t.genre_names, t.region_names,
           al.key AS album_key, al.album AS album
         FROM tracks t
         JOIN albums al ON al.id = t.album_id
         ${whereSql}
         ORDER BY ${TRACK_ORDER_BY[query.sort]}
         LIMIT ? OFFSET ?`,
      )
      .all(...boundParams, query.limit, query.offset) as unknown as DbTrackRow[];

    const tracks: TrackSummary[] = rows.map((row) => ({
      id: row.id,
      title: row.title,
      artist: row.artist,
      artists: parseArtists(row.artist),
      albumArtist: row.album_artist,
      albumKey: row.album_key,
      album: row.album,
      sourceAlbum: row.source_album,
      year: row.year,
      track: row.track,
      disc: row.disc,
      duration: row.duration,
      genres: parseStringArray(row.genre_names),
      regions: parseStringArray(row.region_names),
    }));

    return { total, tracks, libraryVersion: this.version };
  }

  sourceAlbumsFor(album: string, artist: string): string[] {
    const row = this.db
      .prepare('SELECT id FROM albums WHERE key = ?')
      .get(albumKey(album, artist));
    if (!row) return [album];
    const albumId = Number(row.id);

    const sources = this.db
      .prepare(
        `SELECT source_album
           FROM album_sources
          WHERE album_id = ?
          ORDER BY position`,
      )
      .all(albumId);
    return sources.map((source) => String(source.source_album));
  }

  /** Delimited series keys for an album, used by the track matcher. */
  serieKeysFor(album: string, artist: string): string {
    const albumRow = this.db
      .prepare('SELECT id FROM albums WHERE key = ?')
      .get(albumKey(album, artist));
    if (!albumRow) return '';

    const rows = this.db
      .prepare(
        `SELECT serie_key
           FROM album_series
          WHERE album_id = ?
          ORDER BY position`,
      )
      .all(Number(albumRow.id));
    const keys = rows
      .map((row) => String(row.serie_key))
      .filter(Boolean);
    return keys.length > 0 ? `\u0000${keys.join('\u0000')}\u0000` : '';
  }

  coverPathFor(album: string, artist: string): string | null {
    const row = this.db
      .prepare('SELECT cover_path FROM albums WHERE key = ?')
      .get(albumKey(album, artist));
    return typeof row?.cover_path === 'string' ? row.cover_path : null;
  }
}
