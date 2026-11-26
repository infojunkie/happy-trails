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
  /** Series/label names this album belongs to, in index order. */
  series: string[];
  /** Distinct non-empty comments from the album's tracks, deduplicated. */
  comments: string[];
}

/** A PDF booklet found in the album folder. */
export interface AlbumPdf {
  /** Original filename, including its .pdf extension. */
  name: string;
  /** Display label: the filename with its final extension removed. */
  label: string;
}

export interface AlbumPdfsResponse {
  pdfs: AlbumPdf[];
}

/** A genre, region, or series and the number of albums/tracks carrying it. */
export interface GenreFacet {
  /** Normalised, lowercase key used in URLs and filter parameters. */
  key: string;
  name: string;
  /** Visible albums carrying the tag (excludes no-album/loose collections). */
  albumCount: number;
  /**
   * Tracks carrying the tag. For genres and regions this counts each track's
   * own tags; for series it counts the tracks of albums in that series. It
   * includes tracks whose album is hidden from the Albums view, matching what
   * the same filter returns in Tracks mode.
   */
  trackCount: number;
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

/** One row in the global track search results. */
export interface TrackSummary {
  /** `music.id`; the id `/play/track/:id` accepts. */
  id: number;
  title: string;
  /** Visible artist: track artist, falling back to the album artist. */
  artist: string;
  /** Individual artists parsed from `artist`. */
  artists: string[];
  albumArtist: string;
  /** Opaque album key for the cover and the album dialog. */
  albumKey: string;
  /** Merged album title. */
  album: string;
  /** Raw album title, including a " // <disc label>" suffix. */
  sourceAlbum: string;
  year: number | null;
  track: number | null;
  disc: number | null;
  duration: number | null;
  /** False when the browser cannot play this track's format natively. */
  playable: boolean;
  /** Display names of the album's genres, deduplicated. */
  genres: string[];
  /** Country/region tags from the album, deduplicated. */
  regions: string[];
}

export interface TrackSearchResponse {
  total: number;
  offset: number;
  limit: number;
  tracks: TrackSummary[];
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
  /** Genre tags from this track's own genre column. */
  genres: string[];
  /** Country/region tags from this track's own genre column. */
  regions: string[];
  year: number | null;
  track: number | null;
  disc: number | null;
  duration: number | null;
  bitrate: number | null;
  frequency: number | null;
  /** False when the browser cannot play this track's format natively. */
  playable: boolean;
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
  /**
   * Results per page: the default `limit` for album/track/playback queries
   * and the visible Play all queue window. Effective value of `PAGE_SIZE`
   * clamped by `MAX_PAGE_SIZE`.
   */
  pageSize: number;
  /**
   * Number of recent search queries the browser keeps in localStorage.
   * 0 disables search history. Effective value of `SEARCH_HISTORY_LIMIT`,
   * capped at 200.
   */
  searchHistoryLimit: number;
  error: string | null;
  /** True when a Synology DSM URL is configured, so users can sign in to play. */
  playbackEnabled: boolean;
  /** True when the native HTML5 player can stream through this server. */
  nativePlaybackEnabled: boolean;
  /** True when the Audio Station handoff is available as a fallback. */
  audioStationFallbackEnabled: boolean;
  /**
   * True when the player may hold a screen wake lock while it is playing. The
   * browser may still deny or release the lock (visible pages only).
   */
  screenWakeLockEnabled: boolean;
}

export interface SessionResponse {
  authenticated: boolean;
  account: string | null;
}

export interface AboutPerson {
  name: string;
  /** http(s) URL, or null when the package entry has none. */
  url: string | null;
}

export interface AboutResponse {
  name: string;
  version: string;
  description: string;
  author: AboutPerson | null;
  contributors: AboutPerson[];
  issuesUrl: string | null;
  homepageUrl: string | null;
}

/**
 * Sort field; the UI labels these Added on, Released on, Artist name, Album
 * name, and Random. Random ignores the order and uses a seed.
 */
export const SORT_KEYS = ['added', 'released', 'artist', 'album', 'random'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

/** Sort direction for the non-random sort fields. */
export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

/** Largest accepted random seed; keeps the value in an unsigned 32-bit range. */
export const MAX_RANDOM_SEED = 0xffff_ffff;

/** Scope of a Play all source: per-track matches or all tracks of matching albums. */
export type PlaybackTrackMode = 'albums' | 'tracks';

export function isSortKey(value: unknown): value is SortKey {
  return typeof value === 'string' && (SORT_KEYS as readonly string[]).includes(value);
}

export function isSortOrder(value: unknown): value is SortOrder {
  return (
    typeof value === 'string' &&
    (SORT_ORDERS as readonly string[]).includes(value)
  );
}

export const FILTER_MODES = ['any', 'all'] as const;
export type FilterMode = (typeof FILTER_MODES)[number];

export function isFilterMode(value: unknown): value is FilterMode {
  return (
    typeof value === 'string' &&
    (FILTER_MODES as readonly string[]).includes(value)
  );
}
