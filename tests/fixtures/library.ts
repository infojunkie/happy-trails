import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import type { Request } from 'express';
import type { AppDependencies } from '../../src/server/app.js';
import type { AlbumRow, TrackRow } from '../../src/server/db.js';
import type { DsmClient, CoverImage } from '../../src/server/dsm.js';
import { DsmError } from '../../src/server/dsm.js';
import { LoginRateLimiter } from '../../src/server/loginRateLimit.js';
import { SqliteIndex } from '../../src/server/sqlite.js';
import type { StatusResponse } from '../../src/shared/types.js';

export const fixtureRows: AlbumRow[] = [
  {
    album: 'Abbey Road',
    artist: 'The Beatles',
    year: 1969,
    track_count: 17,
    duration: 2800,
    latest: '2024-01-10T10:00:00',
    genres: 'Rock,Pop',
    track_artists: ['The Beatles'],
    composers: ['John Lennon, Paul McCartney', 'George Harrison'],
    cover_path: 'covers/abbey.jpg',
  },
  {
    album: 'Abbey Road // Bonus Tracks',
    artist: 'The Beatles',
    year: 1969,
    track_count: 3,
    duration: 540,
    latest: '2024-02-10T10:00:00',
    genres: 'Rock',
    track_artists: ['The Beatles'],
    composers: ['George Harrison'],
    cover_path: 'covers/abbey-bonus.jpg',
  },
  {
    album: 'Kind of Blue',
    artist: 'Miles Davis',
    year: 1959,
    track_count: 5,
    duration: 2700,
    latest: '2023-04-01T10:00:00',
    genres: 'Jazz,USA',
    track_artists: ['Miles Davis', 'John Coltrane'],
    composers: ['Miles Davis'],
    cover_path: 'covers/kind.jpg',
  },
  {
    album: 'Getz/Gilberto',
    artist: 'Stan Getz & João Gilberto',
    year: 1964,
    track_count: 8,
    duration: 2100,
    latest: '2024-05-01T10:00:00',
    genres: 'Jazz,Bossa Nova,Brazil',
    track_artists: ['Stan Getz', 'João Gilberto', 'Antonio Carlos Jobim'],
    composers: ['Antonio Carlos Jobim, Vinicius de Moraes'],
    cover_path: '',
  },
  {
    album: 'Songhai',
    artist: 'Ketama, Toumani Diabaté, Danny Thompson',
    year: 1988,
    track_count: 7,
    duration: 2500,
    latest: '2022-01-01T10:00:00',
    genres: 'Flamenco,Folk,Mali,Spain',
    track_artists: ['Ketama', 'Toumani Diabaté', 'Danny Thompson'],
    composers: ['Toumani Diabaté'],
    cover_path: '',
  },
  {
    album: 'Björk',
    artist: 'Björk',
    year: 1993,
    track_count: 11,
    duration: 2900,
    latest: '2021-01-01T10:00:00',
    genres: 'Pop,Electronic,Iceland',
    track_artists: ['Björk'],
    composers: ['Björk'],
    cover_path: '',
  },
  {
    album: 'Ask Me Now',
    artist: 'Michał Urbaniak',
    year: 2010,
    track_count: 9,
    duration: 3200,
    latest: '2020-01-01T10:00:00',
    genres: 'Jazz,Poland',
    track_artists: ['Michał Urbaniak'],
    composers: ['Thelonious Monk'],
    cover_path: '',
  },
  {
    album: 'Grace',
    artist: 'Søren Lee & Rick Margitza',
    year: 2015,
    track_count: 8,
    duration: 3000,
    latest: '2019-01-01T10:00:00',
    genres: 'Jazz,Denmark',
    track_artists: ['Søren Lee', 'Rick Margitza'],
    composers: ['Søren Lee'],
    cover_path: '',
  },
  {
    album: 'Live at Abbey Road',
    artist: 'Laurie Holloway Trio',
    year: 2015,
    track_count: 1,
    duration: 529,
    latest: '2024-12-19T23:29:30',
    genres: 'Jazz,England',
    track_artists: ['Laurie Holloway Trio'],
    composers: ['Laurie Holloway'],
    cover_path: '',
  },
  {
    album: 'Live At Abbey Road',
    artist: 'RJ Thompson',
    year: 2023,
    track_count: 1,
    duration: 356,
    latest: '2023-07-01T15:23:29',
    genres: 'Rock,England',
    track_artists: ['RJ Thompson'],
    composers: ['RJ Thompson'],
    cover_path: '',
  },
  {
    album: 'Corsica',
    artist: 'I Muvrini',
    year: 2000,
    track_count: 10,
    duration: 2800,
    latest: '2018-01-01T10:00:00',
    genres: 'Folk,Corsica,France',
    track_artists: ['I Muvrini'],
    composers: ['Traditional'],
    cover_path: '',
  },
  {
    album: 'Catalonia',
    artist: 'Sopa de Cabra',
    year: 2005,
    track_count: 12,
    duration: 3100,
    latest: '2017-01-01T10:00:00',
    genres: 'Rock,Catalonia,Spain',
    track_artists: ['Sopa de Cabra'],
    composers: ['Gerard Quintana'],
    cover_path: '',
  },
  {
    album: 'London Calling',
    artist: 'The Clash',
    year: 1979,
    track_count: 19,
    duration: 3900,
    latest: '2016-01-01T10:00:00',
    genres: 'Rock,Punk,England',
    track_artists: ['The Clash'],
    composers: ['Joe Strummer, Mick Jones'],
    cover_path: '',
  },
  {
    album: "That's the Way of the World",
    artist: 'Earth, Wind & Fire',
    year: 1975,
    track_count: 8,
    duration: 2400,
    latest: '2015-01-01T10:00:00',
    genres: 'Soul,Funk,USA',
    track_artists: ['Earth, Wind & Fire'],
    composers: ['Maurice White'],
    cover_path: '',
  },
];

function track(
  id: number,
  title: string,
  overrides: Partial<TrackRow> = {},
): TrackRow {
  return {
    id,
    title,
    artist: 'The Beatles',
    album_artist: 'The Beatles',
    composer: null,
    source_album: 'Abbey Road',
    genre: 'Rock,Pop',
    year: 1969,
    track: id,
    disc: 1,
    duration: 200,
    bitrate: 320000,
    frequency: 44100,
    ...overrides,
  };
}

export const fixtureTracks = new Map<string, TrackRow[]>([
  [
    'Abbey Road\u0000The Beatles',
    [
      track(1, 'Come Together', {
        composer: 'John Lennon, Paul McCartney',
      }),
      track(2, 'Something', {
        composer: 'George Harrison',
      }),
      track(3, 'While My Guitar Gently Weeps', {
        artist: 'The Beatles feat. Eric Clapton',
        composer: 'George Harrison',
      }),
      track(4, "Maxwell's Silver Hammer", {
        composer: 'The Beatles',
      }),
      track(5, 'Come Together (Take 1)', {
        composer: 'John Lennon, Paul McCartney',
        source_album: 'Abbey Road // Bonus Tracks',
        track: 1,
        disc: 1,
        duration: 300,
      }),
    ],
  ],
  [
    'Kind of Blue\u0000Miles Davis',
    [
      track(10, 'So What', {
        artist: 'Miles Davis',
        album_artist: 'Miles Davis',
        source_album: 'Kind of Blue',
        genre: 'Jazz',
        year: 1959,
        track: 1,
        disc: 1,
        composer: 'Miles Davis',
      }),
      track(11, 'Freddie Freeloader', {
        artist: 'Miles Davis',
        album_artist: 'Miles Davis',
        source_album: 'Kind of Blue',
        genre: 'Jazz',
        year: 1959,
        track: 2,
        disc: 1,
        composer: 'Miles Davis',
      }),
    ],
  ],
  [
    'Getz/Gilberto\u0000Stan Getz & João Gilberto',
    [
      track(20, 'The Girl from Ipanema', {
        artist: 'Stan Getz & João Gilberto',
        album_artist: 'Stan Getz & João Gilberto',
        source_album: 'Getz/Gilberto',
        genre: 'Jazz,Bossa Nova',
        year: 1964,
        track: 1,
        disc: 1,
        composer: 'Antonio Carlos Jobim, Vinicius de Moraes',
      }),
    ],
  ],
  [
    'Songhai\u0000Ketama, Toumani Diabaté, Danny Thompson',
    [
      track(30, 'Songhai', {
        artist: 'Ketama, Toumani Diabaté, Danny Thompson',
        album_artist: 'Ketama, Toumani Diabaté, Danny Thompson',
        source_album: 'Songhai',
        genre: 'Flamenco,Folk',
        year: 1988,
        track: 1,
        disc: 1,
        composer: 'Toumani Diabaté',
      }),
    ],
  ],
]);

export interface FixtureOptions {
  authEnabled?: boolean;
  loginError?: Error | null;
  playbackUrl?: string | null;
  playbackError?: Error | null;
  coverImages?: Map<string, CoverImage>;
  /** Representative track paths whose album folder contains Artwork.pdf. */
  artworkFiles?: Map<string, Buffer>;
  ready?: boolean;
  extraRows?: AlbumRow[];
  /** Origins allowed to select an origin-based playback redirect target. */
  allowedFrontendOrigins?: string[];
  /** Override the login rate limiter (defaults to very generous limits). */
  loginRateLimiter?: AppDependencies['loginRateLimiter'];
  /** Express "trust proxy" value; false by default in fixtures. */
  trustProxy?: boolean | number | string;
}

export interface FixtureContext {
  index: SqliteIndex;
  dependencies: AppDependencies;
  playbackCalls: Array<{ album: string; artist: string }>;
  playbackQueries: Array<string | null>;
  trackPlaybackCalls: number[];
  playbackOrigins: Array<string | null>;
  coverCalls: string[];
  artworkCalls: string[];
  artworkRangeCalls: Array<string | undefined>;
  close(): void;
}

function parseCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

export async function createFixtureContext(
  options: FixtureOptions = {},
): Promise<FixtureContext> {
  const rows = [...fixtureRows, ...(options.extraRows ?? [])].map((row) => ({
    ...row,
    track_artists: row.track_artists ? [...row.track_artists] : row.track_artists,
    composers: row.composers ? [...row.composers] : row.composers,
  }));
  const index = await SqliteIndex.build(rows, 1);
  const status: StatusResponse = {
    ready: options.ready ?? true,
    albumCount: index.albumCount,
    trackCount: index.trackCount,
    libraryVersion: 1,
    lastRefreshed: '2026-01-01T00:00:00.000Z',
    lastCheckedAt: '2026-01-01T00:00:00.000Z',
    refreshing: false,
    checkIntervalMs: 60_000,
    error: options.ready === false ? 'Fixture library is unavailable' : null,
    playbackEnabled: options.authEnabled ?? true,
  };

  const sessions = new Map<
    string,
    { client: DsmClient; account: string; expiresAt: number }
  >();
  const authEnabled = options.authEnabled ?? true;
  const sessionCookie = 'mw_session';
  const userSessions: AppDependencies['userSessions'] = {
    enabled: authEnabled,
    cookieName: sessionCookie,
    async login(username: string, _password: string) {
      if (options.loginError) throw options.loginError;
      const sessionId = crypto.randomUUID();
      sessions.set(sessionId, {
        client: {} as DsmClient,
        account: username,
        expiresAt: Date.now() + 60_000,
      });
      return { sessionId, account: username };
    },
    get(req: Request) {
      const id = parseCookie(req, sessionCookie);
      return id ? (sessions.get(id) ?? null) : null;
    },
    destroy(req: Request) {
      const id = parseCookie(req, sessionCookie);
      if (id) sessions.delete(id);
    },
    cookieOptions(_req: Request) {
      return {
        httpOnly: true,
        sameSite: 'lax' as const,
        secure: false,
        path: '/',
        maxAge: 60_000,
      };
    },
    clearCookieOptions(_req: Request) {
      return {
        httpOnly: true,
        sameSite: 'lax' as const,
        secure: false,
        path: '/',
      };
    },
  };

  const playbackCalls: Array<{ album: string; artist: string }> = [];
  const playbackQueries: Array<string | null> = [];
  const trackPlaybackCalls: number[] = [];
  const playbackOrigins: Array<string | null> = [];
  const coverCalls: string[] = [];
  const artworkCalls: string[] = [];
  const artworkRangeCalls: Array<string | undefined> = [];
  const playbackUrl =
    options.playbackUrl === undefined
      ? 'https://audio.example/?launchApp=SYNO.SDS.AudioStation.Application'
      : options.playbackUrl;

  const dependencies: AppDependencies = {
    library: {
      status: () => status,
      genres: () => index.genres(),
      regions: () => index.regions(),
      queryAlbums: (query) => index.queryAlbums(query),
      sourceAlbumsFor: (album, artist) =>
        index.sourceAlbumsFor(album, artist),
      coverPathFor: (album, artist) => index.coverPathFor(album, artist),
    },
    loadTracks: async (sourceAlbums, album, artist) => {
      void sourceAlbums;
      return fixtureTracks.get(`${album}\u0000${artist}`) ?? [];
    },
    covers: {
      getCover: async (filePath) => {
        coverCalls.push(filePath);
        return options.coverImages?.get(filePath) ?? null;
      },
    },
    artwork: {
      hasArtwork: async (filePath) => {
        artworkCalls.push(filePath);
        return options.artworkFiles?.has(filePath) ?? false;
      },
      openArtwork: async (filePath, range) => {
        artworkRangeCalls.push(range);
        const body = options.artworkFiles?.get(filePath);
        if (!body) return null;
        return {
          stream: Readable.from(body),
          status: 200,
          headers: {
            'content-type': 'application/pdf',
            'content-length': String(body.length),
          },
        };
      },
    },
    userSessions,
    playback: {
      enabled: playbackUrl !== null,
      audioStationUrlFor: (origin) => {
        playbackOrigins.push(origin);
        return playbackUrl;
      },
      playAlbum: async (_client, album, artist, query = null) => {
        if (options.playbackError) throw options.playbackError;
        playbackCalls.push({ album, artist });
        playbackQueries.push(query);
        return 1;
      },
      playTrack: async (_client, musicId) => {
        if (options.playbackError) throw options.playbackError;
        trackPlaybackCalls.push(musicId);
        return 1;
      },
    },
    config: {
      defaultPageSize: 48,
      maxPageSize: 200,
      dsmUrl: authEnabled ? 'https://dsm.example' : null,
      dsmFrontendAllowedOrigins: options.allowedFrontendOrigins ?? [],
      trustProxy: options.trustProxy ?? false,
    },
    loginRateLimiter:
      options.loginRateLimiter ??
      new LoginRateLimiter({
        ipMax: 1_000,
        accountMax: 1_000,
        windowMs: 60_000,
      }),
  };

  return {
    index,
    dependencies,
    playbackCalls,
    playbackQueries,
    trackPlaybackCalls,
    playbackOrigins,
    coverCalls,
    artworkCalls,
    artworkRangeCalls,
    close: () => index.close(),
  };
}

export { DsmError };
