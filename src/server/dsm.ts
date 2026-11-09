import https from 'node:https';
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http';
import type { Readable } from 'node:stream';

const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;
const LOGIN_BACKOFF_MS = 30_000;
const WEB_PLAYER_API = 'SYNO.AudioStation.WebPlayer';
const WEB_PLAYER_ID = '__SYNO_WEB_PLAYER__';
const WEB_PLAYER_MAX_SONGS = 8192;
const AUTH_ERROR_CODES = new Set([105, 106, 107, 119]);

export function audioStationUrl(dsmUrl: string): string {
  return `${dsmUrl.replace(/\/+$/, '')}/?launchApp=SYNO.SDS.AudioStation.Application`;
}

export interface DsmSettings {
  url: string;
  user: string;
  pass: string;
  timeoutMs: number;
  rejectUnauthorized: boolean;
}

export interface CoverImage {
  body: Buffer;
  contentType: string;
}

/** A FileStation download, streamed so large PDFs are not buffered in memory. */
export interface FileStream {
  stream: Readable;
  status: number;
  headers: IncomingHttpHeaders;
}

export class DsmError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = 'DsmError';
  }
}

function isAuthError(error: unknown): boolean {
  return (
    error instanceof DsmError &&
    error.code !== undefined &&
    AUTH_ERROR_CODES.has(error.code)
  );
}

interface Session {
  token: string;
  cookie: string;
  account: string;
}

interface RawResponse {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

type CoverResult =
  | { kind: 'image'; image: CoverImage }
  | { kind: 'missing' }
  | { kind: 'auth' }
  | { kind: 'error'; message: string };

type FileInfoResult =
  | { kind: 'exists' }
  | { kind: 'missing' }
  | { kind: 'auth' }
  | { kind: 'error'; message: string };

type FileStreamResult =
  | { kind: 'file'; file: FileStream }
  | { kind: 'missing' }
  | { kind: 'auth' }
  | { kind: 'error'; message: string };

interface LoginPayload {
  success?: unknown;
  data?: { synotoken?: unknown; account?: unknown };
  error?: { code?: unknown };
}

interface ErrorPayload {
  success?: unknown;
  error?: { code?: unknown };
}

interface WebPlayerPayload extends ErrorPayload {
  data?: { songs?: unknown };
}

interface FileInfoEntry {
  code?: unknown;
  isdir?: unknown;
}

interface FileInfoPayload extends ErrorPayload {
  data?: { files?: unknown };
}

function jsonBody(buffer: Buffer): unknown {
  try {
    return JSON.parse(buffer.toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

/** Read at most `limit` bytes of an error response; discard the rest. */
function readSmallResponse(
  response: IncomingMessage,
  limit = 64 * 1024,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    response.on('data', (chunk: Buffer) => {
      if (size >= limit) return;
      const remaining = limit - size;
      chunks.push(chunk.subarray(0, remaining));
      size += Math.min(chunk.length, remaining);
    });
    response.on('end', () => resolve(Buffer.concat(chunks)));
    response.on('error', reject);
  });
}

function errorCode(payload: unknown): number | undefined {
  const code = (payload as ErrorPayload | null)?.error?.code;
  return typeof code === 'number' ? code : undefined;
}

/**
 * Minimal Synology DSM client for AudioStation covers.
 *
 * Login is lazy and shared between concurrent requests. A failed login sets a
 * short backoff so a NAS outage does not turn every visible cover into another
 * login attempt.
 */
export class DsmClient {
  private session: Session | null = null;
  private loginPromise: Promise<Session> | null = null;
  private loginBackoffUntil = 0;
  private readonly agent: https.Agent;

  constructor(private readonly settings: DsmSettings) {
    this.agent = new https.Agent({
      keepAlive: true,
      rejectUnauthorized: settings.rejectUnauthorized,
    });
  }

  async getCover(trackId: number): Promise<CoverImage | null> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const session = await this.ensureSession();
      const result = await this.requestCover(session, trackId);

      if (result.kind === 'image') return result.image;
      if (result.kind === 'missing') return null;

      // Expired/invalid sessions are retried once with a fresh login.
      this.session = null;
      if (attempt === 1) {
        if (result.kind === 'error') throw new DsmError(result.message);
        return null;
      }
    }
    return null;
  }

  /**
   * Whether an exact file path exists in the shared-folder namespace used by
   * FileStation (for example `/music/Artist/Album/Artwork.pdf`).
   */
  async fileExists(path: string): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const session = await this.ensureSession();
      const result = await this.requestFileInfo(session, path);

      if (result.kind === 'exists') return true;
      if (result.kind === 'missing') return false;

      this.session = null;
      if (attempt === 1) {
        if (result.kind === 'error') throw new DsmError(result.message);
        return false;
      }
    }
    return false;
  }

  /**
   * Open a FileStation download as a stream. Returns null when the file is not
   * found. `range` is forwarded so the browser can seek inside large PDFs.
   */
  async openFile(path: string, range?: string): Promise<FileStream | null> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const session = await this.ensureSession();
      const result = await this.requestFileStream(session, path, range);

      if (result.kind === 'file') return result.file;
      if (result.kind === 'missing') return null;

      this.session = null;
      if (attempt === 1) {
        if (result.kind === 'error') throw new DsmError(result.message);
        return null;
      }
    }
    return null;
  }

  /**
   * Replace the Audio Station web-player queue with these songs and start it.
   * The browser's Audio Station window picks up this shared queue when opened.
   * `updateplaylist` needs the token in an X-SYNO-TOKEN header (not the query).
   */
  async updateWebPlayer(trackIds: number[]): Promise<void> {
    if (trackIds.length === 0) {
      throw new DsmError('No playable tracks found for this album');
    }
    if (trackIds.length > WEB_PLAYER_MAX_SONGS) {
      throw new DsmError(
        `Album has too many tracks for Audio Station (${trackIds.length} > ${WEB_PLAYER_MAX_SONGS})`,
      );
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const session = await this.ensureSession();
        const queueLength = await this.webPlayerQueueLength(session);
        await this.updateWebPlayerQueue(session, trackIds, queueLength);
        return;
      } catch (error) {
        this.session = null;
        if (attempt === 1 || !isAuthError(error)) throw error;
      }
    }
  }

  private ensureSession(): Promise<Session> {
    if (this.session) return Promise.resolve(this.session);

    if (Date.now() < this.loginBackoffUntil) {
      return Promise.reject(
        new DsmError('DSM login is backing off after a recent failure'),
      );
    }

    if (!this.loginPromise) {
      this.loginPromise = this.login()
        .then((session) => {
          this.session = session;
          this.loginBackoffUntil = 0;
          return session;
        })
        .catch((error: unknown) => {
          this.loginBackoffUntil = Date.now() + LOGIN_BACKOFF_MS;
          throw error;
        })
        .finally(() => {
          this.loginPromise = null;
        });
    }
    return this.loginPromise;
  }

  private async login(): Promise<Session> {
    const url = this.endpoint('/webapi/entry.cgi');
    url.searchParams.set('api', 'SYNO.API.Auth');
    url.searchParams.set('version', '7');
    url.searchParams.set('method', 'login');
    url.searchParams.set('account', this.settings.user);
    url.searchParams.set('passwd', this.settings.pass);
    url.searchParams.set('enable_syno_token', 'yes');

    const response = await this.request(url, { Accept: 'application/json' });
    if (response.status < 200 || response.status >= 300) {
      throw new DsmError(`DSM login returned HTTP ${response.status}`);
    }

    const payload = jsonBody(response.body) as LoginPayload | null;
    const token = payload?.data?.synotoken;
    if (payload?.success !== true || typeof token !== 'string' || !token) {
      const code = errorCode(payload);
      throw new DsmError(
        `DSM login failed${code === undefined ? '' : ` (code ${code})`}`,
        code,
      );
    }

    const setCookies = response.headers['set-cookie'] ?? [];
    const cookie = setCookies
      .map((value) => value.split(';', 1)[0])
      .filter((value): value is string => Boolean(value))
      .join('; ');

    const account =
      typeof payload?.data?.account === 'string' && payload.data.account
        ? payload.data.account
        : this.settings.user;

    return { token, cookie, account };
  }

  /** Verify credentials now (used by the interactive sign-in flow). */
  async connect(): Promise<string> {
    const session = await this.ensureSession();
    return session.account;
  }

  private async requestCover(
    session: Session,
    trackId: number,
  ): Promise<CoverResult> {
    const url = this.endpoint('/webapi/AudioStation/cover.cgi');
    url.searchParams.set('api', 'SYNO.AudioStation.Cover');
    // false means "return an error instead of Synology's generic artwork";
    // the UI then falls back to its generated placeholder.
    url.searchParams.set('output_default', 'false');
    url.searchParams.set('is_hr', 'false');
    url.searchParams.set('version', '3');
    url.searchParams.set('library', 'shared');
    url.searchParams.set('method', 'getsongcover');
    url.searchParams.set('view', 'large');
    url.searchParams.set('id', `music_${trackId}`);
    url.searchParams.set('SynoToken', session.token);

    const response = await this.request(url, {
      Accept: 'image/*',
      ...(session.cookie ? { Cookie: session.cookie } : {}),
    });

    const contentType = String(
      response.headers['content-type'] ?? '',
    ).toLowerCase();

    if (
      response.status >= 200 &&
      response.status < 300 &&
      contentType.startsWith('image/')
    ) {
      return {
        kind: 'image',
        image: {
          body: response.body,
          contentType: contentType.split(';', 1)[0] || 'image/jpeg',
        },
      };
    }

    if (response.status === 404) return { kind: 'missing' };
    if (response.status === 401 || response.status === 403) {
      return { kind: 'auth' };
    }

    // Synology often answers HTTP 200 with a JSON error body.
    const code = errorCode(jsonBody(response.body));
    if (code === 105 || code === 106 || code === 107 || code === 119) {
      return { kind: 'auth' };
    }
    if (code !== undefined) return { kind: 'missing' };

    return {
      kind: 'error',
      message: `unexpected cover response (HTTP ${response.status}, ${contentType || 'unknown type'})`,
    };
  }

  private async requestFileInfo(
    session: Session,
    path: string,
  ): Promise<FileInfoResult> {
    const url = this.endpoint('/webapi/entry.cgi');
    url.searchParams.set('api', 'SYNO.FileStation.List');
    url.searchParams.set('version', '2');
    url.searchParams.set('method', 'getinfo');
    url.searchParams.set('path', path);
    url.searchParams.set('additional', '["size","type"]');
    url.searchParams.set('SynoToken', session.token);

    const response = await this.request(url, {
      Accept: 'application/json',
      ...(session.cookie ? { Cookie: session.cookie } : {}),
    });

    if (response.status === 401 || response.status === 403) {
      return { kind: 'auth' };
    }
    if (response.status < 200 || response.status >= 300) {
      return {
        kind: 'error',
        message: `FileStation returned HTTP ${response.status}`,
      };
    }

    const payload = jsonBody(response.body) as FileInfoPayload | null;
    if (payload?.success !== true) {
      const code = errorCode(payload);
      if (code === 408) return { kind: 'missing' };
      if (code !== undefined && AUTH_ERROR_CODES.has(code)) {
        return { kind: 'auth' };
      }
      return {
        kind: 'error',
        message: `FileStation rejected the file query${code === undefined ? '' : ` (code ${code})`}`,
      };
    }

    const files = payload.data?.files;
    const entry = Array.isArray(files)
      ? (files[0] as FileInfoEntry | undefined)
      : undefined;
    if (!entry) return { kind: 'missing' };

    // getinfo reports a missing path inside a successful response.
    if (entry.code === 408) return { kind: 'missing' };
    if (entry.code !== undefined) {
      const code = typeof entry.code === 'number' ? entry.code : undefined;
      if (code !== undefined && AUTH_ERROR_CODES.has(code)) {
        return { kind: 'auth' };
      }
      return {
        kind: 'error',
        message: `FileStation could not inspect the file${code === undefined ? '' : ` (code ${code})`}`,
      };
    }
    return entry.isdir === false ? { kind: 'exists' } : { kind: 'missing' };
  }

  private async requestFileStream(
    session: Session,
    path: string,
    range?: string,
  ): Promise<FileStreamResult> {
    const url = this.endpoint('/webapi/entry.cgi');
    url.searchParams.set('api', 'SYNO.FileStation.Download');
    url.searchParams.set('version', '2');
    url.searchParams.set('method', 'download');
    url.searchParams.set('path', path);
    url.searchParams.set('mode', 'open');
    url.searchParams.set('SynoToken', session.token);

    const response = await this.openResponse(url, {
      Accept: 'application/pdf',
      ...(range ? { Range: range } : {}),
      ...(session.cookie ? { Cookie: session.cookie } : {}),
    });

    const status = response.statusCode ?? 0;
    const contentType = String(
      response.headers['content-type'] ?? '',
    )
      .toLowerCase()
      .split(';', 1)[0];

    if ((status === 200 || status === 206) && contentType === 'application/pdf') {
      return {
        kind: 'file',
        file: { stream: response, status, headers: response.headers },
      };
    }

    if (status === 401 || status === 403) {
      response.resume();
      return { kind: 'auth' };
    }
    if (status === 404) {
      response.resume();
      return { kind: 'missing' };
    }

    // Synology returns HTTP 200 with a JSON error body for some failures, and
    // an HTML error page (usually 502) when the path is not accessible.
    const body = await readSmallResponse(response);
    const code = errorCode(jsonBody(body));
    if (code === 408) return { kind: 'missing' };
    if (code !== undefined && AUTH_ERROR_CODES.has(code)) {
      return { kind: 'auth' };
    }
    if (contentType === 'text/html') return { kind: 'missing' };
    return {
      kind: 'error',
      message: `unexpected file response (HTTP ${status}, ${contentType || 'unknown type'})`,
    };
  }

  private openResponse(
    url: URL,
    headers: Record<string, string>,
  ): Promise<IncomingMessage> {
    return new Promise((resolve, reject) => {
      const request = https.request(
        url,
        {
          method: 'GET',
          agent: this.agent,
          headers,
          timeout: this.settings.timeoutMs,
        },
        (response) => resolve(response),
      );

      request.on('timeout', () => {
        request.destroy(new Error('DSM request timed out'));
      });
      request.on('error', reject);
      request.end();
    });
  }

  private async webPlayerQueueLength(session: Session): Promise<number> {
    const url = this.endpoint('/webapi/AudioStation/web_player.cgi');
    url.searchParams.set('api', WEB_PLAYER_API);
    url.searchParams.set('version', '1');
    url.searchParams.set('method', 'getplaylist');
    url.searchParams.set('id', WEB_PLAYER_ID);
    url.searchParams.set('library', 'shared');
    url.searchParams.set('offset', '0');
    url.searchParams.set('limit', String(WEB_PLAYER_MAX_SONGS));
    url.searchParams.set('SynoToken', session.token);

    const response = await this.request(url, {
      Accept: 'application/json',
      ...(session.cookie ? { Cookie: session.cookie } : {}),
    });
    const payload = jsonBody(response.body) as WebPlayerPayload | null;
    if (payload?.success !== true) {
      const code = errorCode(payload);
      throw new DsmError(
        `Could not read the Audio Station queue${code === undefined ? '' : ` (code ${code})`}`,
        code,
      );
    }
    return Array.isArray(payload.data?.songs) ? payload.data.songs.length : 0;
  }

  private async updateWebPlayerQueue(
    session: Session,
    trackIds: number[],
    queueLength: number,
  ): Promise<void> {
    const url = this.endpoint('/webapi/AudioStation/web_player.cgi');
    const body = new URLSearchParams({
      api: WEB_PLAYER_API,
      version: '1',
      method: 'updateplaylist',
      id: WEB_PLAYER_ID,
      library: 'shared',
      offset: '0',
      limit: String(Math.min(queueLength, WEB_PLAYER_MAX_SONGS)),
      play: 'true',
      keep_shuffle_order: 'false',
      songs: trackIds.map((id) => `music_${id}`).join(','),
    }).toString();

    const response = await this.request(
      url,
      {
        Accept: 'application/json',
        'X-SYNO-TOKEN': session.token,
        'X-Requested-With': 'XMLHttpRequest',
        Referer: audioStationUrl(this.settings.url),
        ...(session.cookie ? { Cookie: session.cookie } : {}),
      },
      { method: 'POST', body },
    );

    if (response.status < 200 || response.status >= 300) {
      throw new DsmError(`Audio Station returned HTTP ${response.status}`);
    }

    const payload = jsonBody(response.body) as WebPlayerPayload | null;
    if (payload?.success !== true) {
      const code = errorCode(payload);
      throw new DsmError(
        `Audio Station rejected the playback request${code === undefined ? '' : ` (code ${code})`}`,
        code,
      );
    }
  }

  private endpoint(pathname: string): URL {
    return new URL(`${this.settings.url.replace(/\/+$/, '')}${pathname}`);
  }

  private request(
    url: URL,
    headers: Record<string, string>,
    options: { method?: 'GET' | 'POST'; body?: string } = {},
  ): Promise<RawResponse> {
    const body = options.body;
    const requestHeaders = body
      ? { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' }
      : headers;

    return new Promise((resolve, reject) => {
      const request = https.request(
        url,
        {
          method: options.method ?? 'GET',
          agent: this.agent,
          headers: requestHeaders,
          timeout: this.settings.timeoutMs,
        },
        (response) => {
          const chunks: Buffer[] = [];
          let size = 0;

          response.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_RESPONSE_BYTES) {
              request.destroy(new Error('DSM response exceeded the size limit'));
              return;
            }
            chunks.push(chunk);
          });

          response.on('end', () => {
            resolve({
              status: response.statusCode ?? 0,
              headers: response.headers,
              body: Buffer.concat(chunks),
            });
          });
          response.on('error', reject);
        },
      );

      request.on('timeout', () => {
        request.destroy(new Error('DSM request timed out'));
      });
      request.on('error', reject);
      request.end(body);
    });
  }
}
