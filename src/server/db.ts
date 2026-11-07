import pg from 'pg';
import { config, musicTable, trackTable } from './config.js';

const { Pool } = pg;

export const pool = new Pool({
  ...(config.databaseUrl ? { connectionString: config.databaseUrl } : {}),
  application_name: 'happy-trails',
  max: 5,
  statement_timeout: config.statementTimeoutMs,
  query_timeout: config.statementTimeoutMs + 5_000,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (error) => {
  console.error('[db] idle client error:', error);
});

/**
 * Effective album artist: prefer album_artist, fall back to track artist.
 * Must be kept in sync with the expression used in `loadTracks`.
 */
const ALBUM_ARTIST = `COALESCE(NULLIF(m.album_artist, ''), NULLIF(m.artist, ''), 'Unknown Artist')`;

export interface AlbumRow {
  /** Raw album title; may include a " // <disc label>" suffix. */
  album: string | null;
  artist: string;
  year: number | null;
  track_count: number;
  duration: number;
  latest: string | null;
  genres: string | null;
  /** Distinct track-level artists, folded into the search text. */
  track_artists: string[] | null;
  /** Distinct composer tag values from the tracks. */
  composers: string[] | null;
  /** Representative file path, used to resolve an AudioStation cover id. */
  cover_path: string;
}

export interface TrackRow {
  id: number;
  title: string;
  artist: string | null;
  album_artist: string;
  composer: string | null;
  source_album: string | null;
  genre: string | null;
  year: number | null;
  track: number | null;
  disc: number | null;
  duration: number | null;
  bitrate: number | null;
  frequency: number | null;
}

const ALBUM_QUERY = `
  SELECT
    m.album AS album,
    ${ALBUM_ARTIST} AS artist,
    MIN(m.year) FILTER (WHERE m.year BETWEEN 1 AND 9999)::int AS year,
    COUNT(*)::int AS track_count,
    COALESCE(SUM(m.duration), 0)::int AS duration,
    to_char(MAX(m.date), 'YYYY-MM-DD"T"HH24:MI:SS') AS latest,
    STRING_AGG(DISTINCT m.genre, ',') AS genres,
    ARRAY_AGG(DISTINCT m.artist)
      FILTER (WHERE m.artist IS NOT NULL AND m.artist <> '') AS track_artists,
    ARRAY_AGG(DISTINCT m.composer)
      FILTER (WHERE m.composer IS NOT NULL AND m.composer <> '') AS composers,
    MIN(m.path) AS cover_path
  FROM ${musicTable} m
  WHERE m.fs_online IS NOT FALSE
  GROUP BY 1, 2
`;

const TRACK_QUERY = `
  SELECT
    m.id,
    m.title,
    m.artist,
    ${ALBUM_ARTIST} AS album_artist,
    m.composer,
    m.album AS source_album,
    m.genre,
    m.year,
    m.track,
    m.disc,
    m.duration,
    m.bitrate,
    m.frequency
  FROM ${musicTable} m
  WHERE (m.album = ANY($1::text[]) OR (m.album IS NULL AND $2 = '(Unknown Album)'))
    AND ${ALBUM_ARTIST} = $3
    AND m.fs_online IS NOT FALSE
  ORDER BY m.disc NULLS LAST, m.track NULLS LAST, lower(m.title), m.id
`;

const TRACK_ID_QUERY = `
  SELECT t.id
  FROM ${trackTable} t
  WHERE t.path = $1 AND t.is_virtual = false
  LIMIT 1
`;

const PLAYBACK_IDS_QUERY = `
  SELECT t.id
  FROM ${musicTable} m
  JOIN ${trackTable} t ON t.path = m.path
  WHERE m.album = ANY($1::text[])
    AND ${ALBUM_ARTIST} = $2
    AND m.fs_online IS NOT FALSE
    AND t.is_virtual = false
  ORDER BY
    array_position($1::text[], m.album),
    m.disc NULLS LAST,
    m.track NULLS LAST,
    lower(m.title),
    m.id
`;

const FINGERPRINT_QUERY = `
  SELECT
    COUNT(*)::int AS tracks,
    COALESCE(to_char(MAX(m.date), 'YYYY-MM-DD"T"HH24:MI:SS'), '') AS max_date,
    COALESCE(to_char(MAX(m.mdate), 'YYYY-MM-DD"T"HH24:MI:SS'), '') AS max_mdate,
    COALESCE(SUM(m.filesize), 0)::text AS total_size,
    COALESCE(MAX(m.id), 0)::int AS max_id
  FROM ${musicTable} m
  WHERE m.fs_online IS NOT FALSE
`;

interface FingerprintRow {
  tracks: number;
  max_date: string;
  max_mdate: string;
  total_size: string;
  max_id: number;
}

/** One row per raw album title; this is the source of the in-memory index. */
export async function loadAlbumRows(): Promise<AlbumRow[]> {
  const result = await pool.query<AlbumRow>(ALBUM_QUERY);
  return result.rows;
}

/**
 * Cheap aggregate used to decide whether the in-memory snapshot is stale.
 * Counts and ids catch inserts/deletes; dates/size catch most updates.
 */
export async function loadLibraryFingerprint(): Promise<string> {
  const result = await pool.query<FingerprintRow>(FINGERPRINT_QUERY);
  const row = result.rows[0];
  if (!row) return '0|||0|0';
  return [
    row.tracks,
    row.max_date,
    row.max_mdate,
    row.total_size,
    row.max_id,
  ].join('|');
}

/**
 * AudioStation song id for a file path. `music.id` and `track.id` are separate
 * sequences, so the cover API's `music_<id>` value must come from `track`.
 */
export async function loadCoverTrackId(filePath: string): Promise<number | null> {
  const result = await pool.query<{ id: number }>(TRACK_ID_QUERY, [filePath]);
  return result.rows[0]?.id ?? null;
}

/**
 * AudioStation song ids for an album, ordered by source title, then disc and
 * track. The ids feed the web player's `updateplaylist` call.
 */
export async function loadPlaybackTrackIds(
  sourceAlbums: string[],
  artist: string,
): Promise<number[]> {
  if (sourceAlbums.length === 0) return [];
  const result = await pool.query<{ id: number }>(PLAYBACK_IDS_QUERY, [
    sourceAlbums,
    artist,
  ]);
  const seen = new Set<number>();
  const ids: number[] = [];
  for (const row of result.rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    ids.push(row.id);
  }
  return ids;
}

/**
 * All playable tracks belonging to a (possibly merged) album, ordered by disc
 * and track number. `sourceAlbums` are the raw titles the album was built from,
 * e.g. both "X" and "X // Bonus Tracks".
 */
export async function loadTracks(
  sourceAlbums: string[],
  album: string,
  artist: string,
): Promise<TrackRow[]> {
  const result = await pool.query<TrackRow>(TRACK_QUERY, [
    sourceAlbums,
    album,
    artist,
  ]);
  return result.rows;
}
