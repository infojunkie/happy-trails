import express, {
  type ErrorRequestHandler,
  type Request,
  type Response,
} from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isSortKey,
  type AlbumsResponse,
  type GenresResponse,
  type SessionResponse,
  type TracksResponse,
} from '../shared/types.js';
import { artwork } from './artwork.js';
import { parseArtists, parseComposers } from './artists.js';
import { createTrackMatcher } from './trackSearch.js';
import { config } from './config.js';
import { covers } from './covers.js';
import { loadTracks } from './db.js';
import { DsmError } from './dsm.js';
import { library } from './library.js';
import {
  loginRateLimiter,
  type LoginRateLimiter,
} from './loginRateLimit.js';
import { decodeAlbumKey } from './search.js';
import { playback } from './playback.js';
import { userSessions } from './userSessions.js';

const MAX_SEARCH_LENGTH = 200;
const MAX_OFFSET = 1_000_000;

const currentDir = path.dirname(fileURLToPath(import.meta.url));
/** Works both for src/server/*.ts (tsx) and dist/server/*.js (built). */
const publicDir = path.resolve(currentDir, '../../public');

export interface AppDependencies {
  library: Pick<
    typeof library,
    | 'status'
    | 'genres'
    | 'regions'
    | 'series'
    | 'queryAlbums'
    | 'sourceAlbumsFor'
    | 'coverPathFor'
    | 'serieKeysFor'
  >;
  loadTracks: typeof loadTracks;
  covers: Pick<typeof covers, 'getCover'>;
  artwork: Pick<typeof artwork, 'hasArtwork' | 'openArtwork'>;
  userSessions: Pick<
    typeof userSessions,
    | 'enabled'
    | 'cookieName'
    | 'get'
    | 'login'
    | 'destroy'
    | 'cookieOptions'
    | 'clearCookieOptions'
  >;
  playback: Pick<
    typeof playback,
    'enabled' | 'audioStationUrlFor' | 'playAlbum' | 'playTrack'
  >;
  config: Pick<
    typeof config,
    | 'defaultPageSize'
    | 'maxPageSize'
    | 'dsmUrl'
    | 'dsmFrontendAllowedOrigins'
    | 'trustProxy'
  >;
  loginRateLimiter: Pick<LoginRateLimiter, 'check' | 'record'>;
}

const defaultDependencies: AppDependencies = {
  library,
  loadTracks,
  covers,
  artwork,
  userSessions,
  playback,
  config,
  loginRateLimiter,
};

/** Host header values are plain host[:port]; reject anything else early. */
function normalizeHost(value: string | null | undefined): string | null {
  const host = (value ?? '').trim().toLowerCase();
  if (!host || !/^[a-z0-9._\-[\]:]+$/.test(host)) return null;
  return host.endsWith('.') ? host.slice(0, -1) : host;
}

/**
 * The origin used for a ":port" DSM_FRONTEND_URL. It comes from the Host the
 * browser used (or X-Forwarded-Host when a reverse proxy rewrites Host), and
 * must exactly match a configured DSM_FRONTEND_ALLOWED_ORIGINS entry. Origin
 * and Referer are deliberately ignored: they are attacker-controlled on a
 * cross-site navigation. The matched entry supplies the scheme.
 */
function requestOrigin(
  req: Request,
  allowedOrigins: readonly string[],
): string | null {
  const candidates = [
    normalizeHost(req.get('host')),
    normalizeHost(req.get('x-forwarded-host')?.split(',')[0]),
  ];

  for (const host of candidates) {
    if (!host) continue;
    for (const allowed of allowedOrigins) {
      try {
        const url = new URL(allowed);
        const candidate = new URL(`${url.protocol}//${host}`);
        // URL normalises case, default ports, and IPv6 brackets.
        if (candidate.host === url.host) return url.origin;
      } catch {
        // Ignore malformed headers; the allowlist itself is validated above.
      }
    }
  }
  return null;
}

function stringParam(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.find((item): item is string => typeof item === 'string');
  }
  return undefined;
}

function integerParam(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = stringParam(value);
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function unavailable(res: Response, dependencies: AppDependencies): void {
  const status = dependencies.library.status();
  res.status(503).json({
    error: status.error ?? 'The library index is still being built',
  });
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

function loginErrorMessage(error: unknown): {
  status: number;
  message: string;
} {
  if (error instanceof DsmError) {
    switch (error.code) {
      case 400:
        return { status: 401, message: 'Incorrect username or password.' };
      case 401:
        return { status: 401, message: 'This DSM account is disabled.' };
      case 402:
        return {
          status: 401,
          message: 'This DSM account is not allowed to sign in.',
        };
      case 403:
      case 404:
        return {
          status: 401,
          message:
            'This DSM account requires two-factor authentication, which is not supported here.',
        };
      default:
        return {
          status: 502,
          message: `Synology sign-in failed${error.code === undefined ? '' : ` (code ${error.code})`}.`,
        };
    }
  }
  return { status: 502, message: 'Could not reach Synology DSM.' };
}

/** DSM error codes that mean the credentials/account did not authenticate. */
const CREDENTIAL_FAILURE_CODES = new Set([400, 401, 402, 403, 404]);

function isCredentialFailure(error: unknown): boolean {
  return (
    error instanceof DsmError &&
    error.code !== undefined &&
    CREDENTIAL_FAILURE_CODES.has(error.code)
  );
}

function playErrorPage(
  title: string,
  message: string,
  audioStation: string | null,
): string {
  const openLink = audioStation
    ? `<p><a class="button" href="${escapeHtml(audioStation)}">Open Audio Station</a></p>`
    : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f5f4f0; color: #1d1c19; font-family: ui-sans-serif, system-ui, sans-serif; }
  main { max-width: 32rem; margin: 2rem; padding: 2rem; background: #fff; border: 1px solid #e0ded7; border-radius: 16px; }
  h1 { margin: 0 0 0.75rem; font-size: 1.25rem; }
  p { margin: 0.5rem 0 1rem; line-height: 1.5; color: #6f6b63; }
  a { color: #3b5bdb; }
  a.button { display: inline-block; padding: 0.6rem 1rem; border-radius: 999px; background: #3b5bdb; color: #fff; text-decoration: none; }
  @media (prefers-color-scheme: dark) { body { background: #121214; color: #f0efeb; } main { background: #1c1c20; border-color: #303036; } p { color: #a5a29a; } a { color: #8fa4ff; } a.button { background: #8fa4ff; color: #0d1020; } }
</style>
</head>
<body><main>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
${openLink}
<p><a href="/">Back to the library</a></p>
</main></body></html>`;
}

/** Build the Express app with injectable services (used by the API tests). */
export function createApp(
  dependencies: AppDependencies = defaultDependencies,
): express.Express {
  const app = express();
  app.disable('x-powered-by');
  if (dependencies.config.trustProxy !== false) {
    // Needed for req.ip (login rate limiting) and req.secure (cookie flags)
    // behind a trusted reverse proxy. Never enable this on a directly exposed
    // port without restricting it to the proxy address/CIDR.
    app.set('trust proxy', dependencies.config.trustProxy);
  }

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use(express.json({ limit: '16kb' }));

  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/status', (_req, res) => {
    res.json(dependencies.library.status());
  });

  app.get('/api/session', (req, res) => {
    const session = dependencies.userSessions.get(req);
    const body: SessionResponse = {
      authenticated: session !== null,
      account: session?.account ?? null,
    };
    res.json(body);
  });

  app.post('/api/session/login', async (req, res) => {
    if (!dependencies.userSessions.enabled || !dependencies.config.dsmUrl) {
      res.status(503).json({ error: 'Synology sign-in is not configured.' });
      return;
    }

    const body: unknown = req.body;
    const record =
      body !== null && typeof body === 'object'
        ? (body as Record<string, unknown>)
        : {};
    const username =
      typeof record.username === 'string' ? record.username.trim() : '';
    const password = typeof record.password === 'string' ? record.password : '';

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required.' });
      return;
    }
    if (username.length > 256 || password.length > 1024) {
      res.status(400).json({ error: 'Username or password is too long.' });
      return;
    }

    const clientIp = req.ip ?? null;
    const retryAfterSeconds = dependencies.loginRateLimiter.check(
      clientIp,
      username,
    );
    if (retryAfterSeconds > 0) {
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res
        .status(429)
        .json({ error: 'Too many sign-in attempts. Try again later.' });
      return;
    }

    try {
      const { sessionId, account } = await dependencies.userSessions.login(username, password);
      dependencies.loginRateLimiter.record(clientIp, username, true);
      res.cookie(
        dependencies.userSessions.cookieName,
        sessionId,
        dependencies.userSessions.cookieOptions(req),
      );
      const result: SessionResponse = { authenticated: true, account };
      res.json(result);
    } catch (error) {
      // A DSM outage must not lock accounts out; only failed credentials do.
      if (isCredentialFailure(error)) {
        dependencies.loginRateLimiter.record(clientIp, username, false);
      }
      const { status, message } = loginErrorMessage(error);
      console.error('[session] sign-in failed:', message);
      res.status(status).json({ error: message });
    }
  });

  app.post('/api/session/logout', (req, res) => {
    dependencies.userSessions.destroy(req);
    res.clearCookie(
      dependencies.userSessions.cookieName,
      dependencies.userSessions.clearCookieOptions(req),
    );
    const result: SessionResponse = { authenticated: false, account: null };
    res.json(result);
  });

  app.get('/api/genres', (_req, res) => {
    const status = dependencies.library.status();
    if (!status.ready) {
      unavailable(res, dependencies);
      return;
    }
    const body: GenresResponse = {
      totalAlbums: status.albumCount,
      genres: dependencies.library.genres(),
      regions: dependencies.library.regions(),
      series: dependencies.library.series(),
      libraryVersion: status.libraryVersion,
    };
    res.json(body);
  });

  app.get('/api/albums', (req, res) => {
    if (!dependencies.library.status().ready) {
      unavailable(res, dependencies);
      return;
    }

    const q = (stringParam(req.query.q) ?? '').slice(0, MAX_SEARCH_LENGTH).trim();
    const sortParam = stringParam(req.query.sort);
    const sort = isSortKey(sortParam) ? sortParam : 'recent';
    const offset = integerParam(req.query.offset, 0, 0, MAX_OFFSET);
    const limit = integerParam(
      req.query.limit,
      dependencies.config.defaultPageSize,
      1,
      dependencies.config.maxPageSize,
    );
    const result = dependencies.library.queryAlbums({
      q,
      sort,
      offset,
      limit,
    });
    const body: AlbumsResponse = {
      total: result.total,
      offset,
      limit,
      albums: result.albums,
      libraryVersion: result.libraryVersion,
    };
    res.json(body);
  });

  app.get('/api/albums/:key/cover', async (req, res) => {
    const decoded = decodeAlbumKey(req.params.key);
    if (!decoded) {
      res.status(400).end();
      return;
    }

    const coverPath = dependencies.library.coverPathFor(decoded.album, decoded.artist);
    if (!coverPath) {
      res.status(404).end();
      return;
    }

    const image = await dependencies.covers.getCover(coverPath);
    if (!image) {
      // Let the browser retry a missing cover after a short while.
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.status(404).end();
      return;
    }

    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.type(image.contentType);
    res.send(image.body);
  });

  app.head('/api/albums/:key/artwork', async (req, res) => {
    const decoded = decodeAlbumKey(req.params.key);
    if (!decoded) {
      res.status(400).end();
      return;
    }

    const coverPath = dependencies.library.coverPathFor(
      decoded.album,
      decoded.artist,
    );
    if (!coverPath) {
      res.status(404).end();
      return;
    }

    // The button appears when the album folder contains an Artwork.pdf.
    res.setHeader('Cache-Control', 'private, max-age=300');
    try {
      if (!(await dependencies.artwork.hasArtwork(coverPath))) {
        res.status(404).end();
        return;
      }
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'inline; filename="Artwork.pdf"');
      res.status(200).end();
    } catch {
      res.status(502).end();
    }
  });

  app.get('/api/albums/:key/artwork', async (req, res) => {
    const decoded = decodeAlbumKey(req.params.key);
    if (!decoded) {
      res.status(400).end();
      return;
    }

    const coverPath = dependencies.library.coverPathFor(
      decoded.album,
      decoded.artist,
    );
    if (!coverPath) {
      res.status(404).end();
      return;
    }

    const range =
      typeof req.headers.range === 'string' ? req.headers.range : undefined;
    let file;
    try {
      file = await dependencies.artwork.openArtwork(coverPath, range);
    } catch (error) {
      console.error('[artwork] could not open PDF:', error);
      res.status(502).end();
      return;
    }

    if (!file) {
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.status(404).end();
      return;
    }

    res.status(file.status);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="Artwork.pdf"');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const passthroughHeaders = [
      'content-length',
      'content-range',
      'accept-ranges',
      'last-modified',
      'etag',
    ] as const;
    for (const name of passthroughHeaders) {
      const value = file.headers[name];
      if (typeof value === 'string') res.setHeader(name, value);
    }

    file.stream.on('error', (error) => {
      console.error('[artwork] PDF stream failed:', error);
      if (!res.headersSent) res.status(502).end();
      else res.destroy();
    });
    res.on('close', () => file.stream.destroy());
    file.stream.pipe(res);
  });

  app.get('/api/albums/:key/tracks', async (req, res) => {
    const decoded = decodeAlbumKey(req.params.key);
    if (!decoded) {
      res.status(400).json({ error: 'Invalid album key' });
      return;
    }

    const query = (stringParam(req.query.q) ?? '')
      .slice(0, MAX_SEARCH_LENGTH)
      .trim();
    const sourceAlbums = dependencies.library.sourceAlbumsFor(decoded.album, decoded.artist);
    const rows = await dependencies.loadTracks(sourceAlbums, decoded.album, decoded.artist);
    if (rows.length === 0) {
      res.status(404).json({ error: 'Album not found' });
      return;
    }
    const matchesTrack = createTrackMatcher(
      decoded.album,
      query,
      dependencies.library.serieKeysFor(decoded.album, decoded.artist),
    );

    const body: TracksResponse = {
      album: decoded.album,
      artist: decoded.artist,
      sourceAlbums:
        sourceAlbums.length > 0 ? sourceAlbums : [decoded.album],
      tracks: rows.map((row) => ({
        id: row.id,
        title: row.title,
        artist: row.artist,
        artists: parseArtists(row.artist),
        albumArtist: row.album_artist,
        composer: row.composer,
        composers: parseComposers(row.composer),
        matches: matchesTrack(row),
        sourceAlbum: row.source_album ?? '(Unknown Album)',
        genre: row.genre,
        year: row.year,
        track: row.track,
        disc: row.disc,
        duration: row.duration,
        bitrate: row.bitrate,
        frequency: row.frequency,
      })),
    };
    res.json(body);
  });

  app.get('/play/track/:id', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const frontendTarget = dependencies.playback.audioStationUrlFor(
      requestOrigin(req, dependencies.config.dsmFrontendAllowedOrigins),
    );
    const rawId = req.params.id;
    const trackId = /^\d+$/.test(rawId) ? Number(rawId) : Number.NaN;

    if (!Number.isSafeInteger(trackId) || trackId < 1) {
      res
        .status(400)
        .type('html')
        .send(
          playErrorPage(
            'Invalid track link',
            'This playback link is not valid.',
            frontendTarget,
          ),
        );
      return;
    }

    const session = dependencies.userSessions.get(req);
    if (!session) {
      if (!dependencies.playback.enabled || !frontendTarget) {
        res
          .status(503)
          .type('html')
          .send(
            playErrorPage(
              'Playback unavailable',
              'Synology DSM is not configured.',
              null,
            ),
          );
        return;
      }
      res.redirect(
        303,
        `/?login=1&playTrack=${encodeURIComponent(String(trackId))}`,
      );
      return;
    }

    if (!frontendTarget) {
      res
        .status(503)
        .type('html')
        .send(
          playErrorPage(
            'Playback unavailable',
            'The playback target could not be resolved.',
            null,
          ),
        );
      return;
    }

    try {
      await dependencies.playback.playTrack(session.client, trackId);
      res.redirect(303, frontendTarget);
    } catch (error) {
      console.error('[play] could not start track playback:', error);
      const message = error instanceof Error ? error.message : String(error);
      res
        .status(502)
        .type('html')
        .send(
          playErrorPage(
            'Could not start playback',
            message,
            frontendTarget,
          ),
        );
    }
  });

  app.get('/play/:key', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const frontendTarget = dependencies.playback.audioStationUrlFor(
      requestOrigin(req, dependencies.config.dsmFrontendAllowedOrigins),
    );
    const playbackQuery = (stringParam(req.query.q) ?? '')
      .slice(0, MAX_SEARCH_LENGTH)
      .trim();

    const decoded = decodeAlbumKey(req.params.key);
    if (!decoded) {
      res
        .status(400)
        .type('html')
        .send(
          playErrorPage(
            'Invalid album link',
            'This playback link is not valid.',
            frontendTarget,
          ),
        );
      return;
    }

    const session = dependencies.userSessions.get(req);
    if (!session) {
      if (!dependencies.playback.enabled || !frontendTarget) {
        res
          .status(503)
          .type('html')
          .send(
            playErrorPage(
              'Playback unavailable',
              'Synology DSM is not configured.',
              null,
            ),
          );
        return;
      }
      const loginParams = new URLSearchParams({
        login: '1',
        play: req.params.key,
      });
      if (playbackQuery) loginParams.set('playQuery', playbackQuery);
      res.redirect(303, `/?${loginParams.toString()}`);
      return;
    }

    if (!frontendTarget) {
      res
        .status(503)
        .type('html')
        .send(
          playErrorPage(
            'Playback unavailable',
            'The playback target could not be resolved.',
            null,
          ),
        );
      return;
    }

    try {
      await dependencies.playback.playAlbum(
        session.client,
        decoded.album,
        decoded.artist,
        playbackQuery || null,
      );
      res.redirect(303, frontendTarget);
    } catch (error) {
      console.error('[play] could not start playback:', error);
      const message = error instanceof Error ? error.message : String(error);
      res
        .status(502)
        .type('html')
        .send(
          playErrorPage(
            'Could not start playback',
            message,
            frontendTarget,
          ),
        );
    }
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use(
    express.static(publicDir, {
      index: 'index.html',
      etag: true,
      maxAge: 0,
    }),
  );

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    console.error('[http] request failed:', error);
    if (res.headersSent) return;
    res.status(500).json({ error: 'Internal server error' });
  };
  app.use(errorHandler);

  return app;
}

export const app = createApp();

export { publicDir };
