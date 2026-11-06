import { DatabaseSync } from 'node:sqlite';
import type {
  AlbumSummary,
  FilterMode,
  GenreFacet,
  SortKey,
} from '../shared/types.js';
import { regionKey } from '../shared/text.js';
import { parseArtists } from './artists.js';
import type { AlbumRow } from './db.js';
import { isRegionTag } from './regions.js';
import {
  albumKey,
  foldSearch,
  genreKey,
  normalizeAlbumName,
  searchTokens,
} from './search.js';

export interface AlbumsQuery {
  genres: string[];
  genreMode: FilterMode;
  regions: string[];
  regionMode: FilterMode;
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

  -- The trigram tokenizer gives FTS5 substring semantics, which is what the
  -- original index did with String.includes(). unicode61 would only match
  -- whole words or prefixes. Search text is already folded by foldSearch().
  CREATE VIRTUAL TABLE album_search USING fts5(
    search_text,
    content = 'albums',
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
    INSERT INTO album_search(rowid, search_text)
      VALUES (new.id, new.search_text);
  END;

  CREATE TRIGGER albums_ad AFTER DELETE ON albums BEGIN
    INSERT INTO album_search(album_search, rowid, search_text)
      VALUES ('delete', old.id, old.search_text);
  END;

  CREATE TRIGGER albums_au AFTER UPDATE OF search_text ON albums BEGIN
    INSERT INTO album_search(album_search, rowid, search_text)
      VALUES ('delete', old.id, old.search_text);
    INSERT INTO album_search(rowid, search_text)
      VALUES (new.id, new.search_text);
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

interface AlbumAccumulator {
  key: string;
  album: string;
  artist: string;
  sourceAlbums: Set<string>;
  sourcePaths: Map<string, string>;
  trackArtists: Set<string>;
  genreKeys: Set<string>;
  regionKeys: Set<string>;
  year: number | null;
  trackCount: number;
  duration: number;
  latest: string | null;
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
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
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
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

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
        genreKeys: new Set(),
        regionKeys: new Set(),
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
 * An in-memory SQLite database containing the album index.
 *
 * The database is built off to the side and only published by Library after
 * it is complete, so requests continue to use the previous version while a
 * rebuild runs.
 */
export class SqliteIndex {
  readonly albumCount: number;
  readonly trackCount: number;
  readonly version: number;
  readonly databaseBytes: number;
  readonly refreshedAt = new Date();

  private constructor(
    private readonly db: DatabaseSync,
    albumCount: number,
    trackCount: number,
    version: number,
    databaseBytes: number,
  ) {
    this.albumCount = albumCount;
    this.trackCount = trackCount;
    this.version = version;
    this.databaseBytes = databaseBytes;
  }

  static async build(rows: AlbumRow[], version: number): Promise<SqliteIndex> {
    const { accumulators, genreDisplayNames, regionDisplayNames } =
      await accumulateAlbums(rows);
    // Library does not need the raw rows after parsing. Releasing them here
    // keeps the peak heap closer to the size of the SQLite database.
    rows.length = 0;

    const albumNames: string[] = [];
    const artistNames: string[] = [];
    const keyValues: string[] = [];
    let totalTracks = 0;
    for (const acc of accumulators.values()) {
      albumNames.push(acc.album);
      artistNames.push(acc.artist);
      keyValues.push(acc.key);
      totalTracks += acc.trackCount;
    }
    const albumCount = accumulators.size;

    const albumRanks = rankValues(albumNames);
    const artistRanks = rankValues(artistNames);
    const keyRanks = rankValues(keyValues);
    const genreRanks = rankValues(genreDisplayNames.values());
    const regionRanks = rankValues(regionDisplayNames.values());
    albumNames.length = 0;
    artistNames.length = 0;
    keyValues.length = 0;

    const db = new DatabaseSync(':memory:');
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
      const insertAlbum = db.prepare(`
        INSERT INTO albums(
          key, album, artist, year, track_count, duration, latest, cover_path,
          search_text, album_rank, artist_rank, key_rank
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertAlbumArtist = db.prepare(
        'INSERT INTO album_artists(album_id, position, artist) VALUES (?, ?, ?)',
      );
      const insertAlbumSource = db.prepare(
        'INSERT INTO album_sources(album_id, position, source_album, cover_path) VALUES (?, ?, ?, ?)',
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
        // Include source titles and track artists so labels and guests match.
        const searchText = foldSearch(
          [
            acc.album,
            acc.artist,
            ...displayArtists,
            ...sourceAlbums,
            ...acc.trackArtists,
          ].join(' '),
        );
        const genreKeys = [...acc.genreKeys];
        const regionKeys = [...acc.regionKeys];

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
          albumRanks.get(acc.album) ?? 0,
          artistRanks.get(acc.artist) ?? 0,
          keyRanks.get(key) ?? 0,
        );
        const albumId = Number(result.lastInsertRowid);

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

      insertMeta.run('version', String(version));
      insertMeta.run('album_count', String(albumCount));
      insertMeta.run('track_count', String(totalTracks));
      insertMeta.run('region_count', String(regionDisplayNames.size));
      insertMeta.run('built_at', new Date().toISOString());
      insertMeta.run('schema_version', '2');

      db.exec(TRIGGER_SQL);
      db.exec(`INSERT INTO album_search(album_search) VALUES ('rebuild')`);
      db.exec('COMMIT');
      db.exec('PRAGMA user_version = 2');
      db.exec('PRAGMA optimize');

      const pageCount = Number(
        db.prepare('PRAGMA page_count').get()?.page_count ?? 0,
      );
      const pageSize = Number(
        db.prepare('PRAGMA page_size').get()?.page_size ?? 0,
      );

      return new SqliteIndex(
        db,
        albumCount,
        totalTracks,
        version,
        pageCount * pageSize,
      );
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // The transaction may not have started.
      }
      db.close();
      throw error;
    }
  }

  close(): void {
    this.db.close();
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

  queryAlbums(query: AlbumsQuery): AlbumsResult {
    const joins: string[] = [];
    const where: string[] = [];
    const params: Array<string | number> = [];

    const selected = [...new Set(query.genres.map(genreKey).filter(Boolean))];
    if (selected.length > 0) {
      const placeholders = selected.map(() => '?').join(', ');
      if (query.genreMode === 'all') {
        where.push(
          `(SELECT COUNT(DISTINCT ag.genre_key)
              FROM album_genres ag
             WHERE ag.album_id = a.id
               AND ag.genre_key IN (${placeholders})) = ?`,
        );
        params.push(...selected, selected.length);
      } else {
        where.push(
          `EXISTS (
             SELECT 1 FROM album_genres ag
              WHERE ag.album_id = a.id AND ag.genre_key IN (${placeholders})
           )`,
        );
        params.push(...selected);
      }
    }

    const selectedRegions = [
      ...new Set(query.regions.map(regionKey).filter(Boolean)),
    ];
    if (selectedRegions.length > 0) {
      const placeholders = selectedRegions.map(() => '?').join(', ');
      if (query.regionMode === 'all') {
        where.push(
          `(SELECT COUNT(DISTINCT ar.region_key)
              FROM album_regions ar
             WHERE ar.album_id = a.id
               AND ar.region_key IN (${placeholders})) = ?`,
        );
        params.push(...selectedRegions, selectedRegions.length);
      } else {
        where.push(
          `EXISTS (
             SELECT 1 FROM album_regions ar
              WHERE ar.album_id = a.id AND ar.region_key IN (${placeholders})
           )`,
        );
        params.push(...selectedRegions);
      }
    }

    const ftsPhrases: string[] = [];
    for (const token of searchTokens(query.q)) {
      if (CONTROL_CHARS.test(token)) {
        where.push('0');
      } else if ([...token].length >= 3) {
        ftsPhrases.push(ftsPhrase(token));
      } else {
        // Trigram indexes only phrases of three or more characters; shorter
        // tokens fall back to an exact substring scan of the folded text.
        where.push('instr(a.search_text, ?) > 0');
        params.push(token);
      }
    }
    if (ftsPhrases.length > 0) {
      // Join against the FTS table once and let the trigram index find
      // candidates. One MATCH query with adjacent phrases is an implicit AND,
      // which is exactly the old "every token is a substring" rule.
      joins.push('JOIN album_search ON album_search.rowid = a.id');
      where.push('album_search MATCH ?');
      params.push(ftsPhrases.join(' '));
    }

    const joinSql = joins.length > 0 ? joins.join(' ') : '';
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const countRow = this.db
      .prepare(
        `SELECT COUNT(*) AS total FROM albums a ${joinSql} ${whereSql}`,
      )
      .get(...params);
    const total = Number(countRow?.total ?? 0);

    const rows = this.db
      .prepare(
        `SELECT
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
            )) AS regions
         FROM albums a
         ${joinSql}
         ${whereSql}
         ORDER BY ${ORDER_BY[query.sort]}
         LIMIT ? OFFSET ?`,
      )
      .all(...params, query.limit, query.offset) as unknown as DbAlbumRow[];

    const albums: AlbumSummary[] = rows.map((row) => ({
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
    }));

    return { total, albums, libraryVersion: this.version };
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

  coverPathFor(album: string, artist: string): string | null {
    const row = this.db
      .prepare('SELECT cover_path FROM albums WHERE key = ?')
      .get(albumKey(album, artist));
    return typeof row?.cover_path === 'string' ? row.cover_path : null;
  }
}
