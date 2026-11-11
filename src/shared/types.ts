/**
 * Types and small constants shared between the Node API and the browser client.
 * This file is compiled for both targets, so keep it dependency-free.
 */

/** One album, as returned by the album listing endpoint. */
export interface AlbumSummary {
  /** Opaque URL-safe identifier for the (album, artist) pair. */
  key: string;
  album: string;
  /** Original effective album-artist string. */
  artist: string;
  /** Individual artists parsed from `artist`. */
  artists: string[];
  year: number | null;
  trackCount: number;
  /** Total playing time in seconds. */
  duration: number;
  /** Wall-clock upload date (`YYYY-MM-DDTHH:MM:SS`) of the newest track. */
  latest: string | null;
  /** Display names of the album's genres, deduplicated. */
  genres: string[];
  /** Country/region tags from the genre column, deduplicated. */
  regions: string[];
  /** Distinct non-empty comments from the album's tracks, deduplicated. */
  comments: string[];
}

/** A genre and the number of albums carrying it. */
export interface GenreFacet {
  /** Normalised, lowercase key used in URLs and filter parameters. */
  key: string;
  name: string;
  albumCount: number;
}

export interface GenresResponse {
  totalAlbums: number;
  genres: GenreFacet[];
  regions: GenreFacet[];
  series: GenreFacet[];
  libraryVersion: number;
}

export interface AlbumsResponse {
  total: number;
  offset: number;
  limit: number;
  albums: AlbumSummary[];
  libraryVersion: number;
}

export interface Track {
  id: number;
  title: string;
  artist: string | null;
  /** Individual artists parsed from `artist`. */
  artists: string[];
  albumArtist: string;
  /** Composer tag from the file metadata, if present. */
  composer: string | null;
  /** Individual composer names parsed from `composer`. */
  composers: string[];
  /** Whether this track matches the active track-list search query. */
  matches: boolean;
  /** Raw album title this track came from, including a " // <disc label>" suffix. */
  sourceAlbum: string;
  genre: string | null;
  year: number | null;
  track: number | null;
  disc: number | null;
  duration: number | null;
  bitrate: number | null;
  frequency: number | null;
}

export interface TracksResponse {
  album: string;
  artist: string;
  /** Raw titles merged into this album, in display order. */
  sourceAlbums: string[];
  tracks: Track[];
}

export interface StatusResponse {
  ready: boolean;
  albumCount: number;
  trackCount: number;
  /** Monotonically increasing identifier for the current snapshot. */
  libraryVersion: number;
  lastRefreshed: string | null;
  lastCheckedAt: string | null;
  /** True while a change-triggered rebuild is running. */
  refreshing: boolean;
  checkIntervalMs: number;
  error: string | null;
  /** True when a Synology DSM URL is configured, so users can sign in to play. */
  playbackEnabled: boolean;
}

export interface SessionResponse {
  authenticated: boolean;
  account: string | null;
}

export const SORT_KEYS = ['recent', 'artist', 'album', 'year'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export function isSortKey(value: unknown): value is SortKey {
  return typeof value === 'string' && (SORT_KEYS as readonly string[]).includes(value);
}

export const FILTER_MODES = ['any', 'all'] as const;
export type FilterMode = (typeof FILTER_MODES)[number];

export function isFilterMode(value: unknown): value is FilterMode {
  return (
    typeof value === 'string' &&
    (FILTER_MODES as readonly string[]).includes(value)
  );
}
