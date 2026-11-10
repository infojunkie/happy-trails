/**
 * Security regression tests.
 *
 * Each test below demonstrates a finding from docs/security-audit.md against
 * the real Express app (or the real playback/session services), with database
 * and Synology access replaced by the existing fixtures.
 *
 * F1 and F2 are now fixed: their tests assert the secure behaviour so the
 * fixes cannot regress. The remaining tests intentionally assert the *current,
 * insecure* behaviour; when a finding is fixed, invert its assertion here and
 * move the test into the regular suite.
 *
 * Run with: npm run test:security
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import type { Request } from 'express';
import type { AppDependencies } from '../../src/server/app.js';
import type { FixtureContext, FixtureOptions } from '../fixtures/library.js';
import {
  cookieFrom,
  startServer,
  type TestServer,
} from '../helpers/server.js';

/*
 * config.ts reads these once at import time, so they must be set before any
 * dynamic import below. The ":port" DSM_FRONTEND_URL mode requires the app
 * origins it may select from (see README, "Configuration").
 */
const ALLOWED_FRONTEND_ORIGINS = [
  'https://mediatheque.karimratib.me:8443',
  'https://rokanan:8443',
];

process.env.DSM_URL = 'https://dsm.example';
process.env.DSM_FRONTEND_URL = ':443';
process.env.DSM_FRONTEND_ALLOWED_ORIGINS = ALLOWED_FRONTEND_ORIGINS.join(',');
process.env.DSM_USER = 'service-account';
process.env.DSM_PASS = 'service-password';

const { createApp } = await import('../../src/server/app.js');
const { createFixtureContext } = await import('../fixtures/library.js');
const { playback } = await import('../../src/server/playback.js');
const { UserSessionStore } = await import('../../src/server/userSessions.js');
const { DsmError } = await import('../../src/server/dsm.js');
const { LoginRateLimiter } = await import(
  '../../src/server/loginRateLimit.js'
);

interface RunningServer {
  baseUrl: string;
  context: FixtureContext;
  close(): Promise<void>;
}

async function startSecurityServer(
  overrides: Partial<AppDependencies> = {},
  options: FixtureOptions = {},
): Promise<RunningServer> {
  const context = await createFixtureContext(options);
  const app = createApp({ ...context.dependencies, ...overrides });
  const server: TestServer = await startServer(app);
  return {
    baseUrl: server.baseUrl,
    context,
    async close(): Promise<void> {
      await server.close();
      context.close();
    },
  };
}

/** Raw HTTP request so tests can control Host/Referer and keep `..` in paths. */
function rawRequest(
  baseUrl: string,
  rawPath: string,
  headers: Record<string, string> = {},
): Promise<{
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}> {
  const url = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: rawPath,
        method: 'GET',
        headers,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    request.on('error', reject);
    request.end();
  });
}

async function login(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/session/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'secret' }),
  });
  assert.equal(response.status, 200);
  const cookie = cookieFrom(response);
  assert.ok(cookie, 'login did not set a session cookie');
  return cookie;
}

async function findAlbumKey(baseUrl: string, title: string): Promise<string> {
  const response = await fetch(
    `${baseUrl}/api/albums?limit=50&q=${encodeURIComponent(`album:"${title}"`)}`,
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    albums: Array<{ album: string; key: string }>;
  };
  const album = body.albums.find((entry) => entry.album === title);
  assert.ok(album, `album ${title} was not found`);
  return album.key;
}

/** The album key is base64url(JSON [album, artist]); it is not a secret. */
function albumKeyFor(album: string, artist: string): string {
  return Buffer.from(JSON.stringify([album, artist]), 'utf8').toString(
    'base64url',
  );
}

/* ------------------------------------------------------------------ */
/* 1. Open redirect — regression test for the allow-list fix          */
/* ------------------------------------------------------------------ */

test('F1 fix: /play/:key redirects only to allow-listed app origins', async () => {
  const calls: Array<{ album: string; artist: string }> = [];
  // The app calls the playback hook with an origin selected from the allow
  // list; the real playback service then applies DSM_FRONTEND_URL=:443.
  const running = await startSecurityServer(
    {
      playback: {
        enabled: true,
        audioStationUrlFor: (origin) => playback.audioStationUrlFor(origin),
        playAlbum: async (_client, album, artist) => {
          calls.push({ album, artist });
          return 1;
        },
        playTrack: async () => 1,
      },
    },
    { allowedFrontendOrigins: ALLOWED_FRONTEND_ORIGINS },
  );

  try {
    const key = await findAlbumKey(running.baseUrl, 'Abbey Road');
    const cookie = await login(running.baseUrl);
    const playPath = `/play/${encodeURIComponent(key)}`;

    // The browser's Host selects which configured origin is used, even when a
    // cross-site page supplied Origin and Referer.
    const allowed: Array<{ host: string; expected: string }> = [
      {
        host: 'rokanan:8443',
        expected:
          'https://rokanan/?launchApp=SYNO.SDS.AudioStation.Application',
      },
      {
        host: 'mediatheque.karimratib.me:8443',
        expected:
          'https://mediatheque.karimratib.me/?launchApp=SYNO.SDS.AudioStation.Application',
      },
    ];
    for (const { host, expected } of allowed) {
      const response = await rawRequest(running.baseUrl, playPath, {
        Cookie: cookie,
        Host: host,
        Origin: 'https://evil.example',
        Referer: 'https://evil.example/phish',
      });
      assert.equal(response.status, 303, host);
      assert.equal(response.headers.location, expected, host);
    }

    // X-Forwarded-Host is a fallback for proxies that rewrite Host, and is
    // still constrained to the same allow list.
    const forwarded = await rawRequest(running.baseUrl, playPath, {
      Cookie: cookie,
      Host: 'upstream.internal:3000',
      'X-Forwarded-Host': 'rokanan:8443, proxy.internal',
    });
    assert.equal(forwarded.status, 303);
    assert.equal(
      forwarded.headers.location,
      'https://rokanan/?launchApp=SYNO.SDS.AudioStation.Application',
    );

    // A Host that is not allow-listed fails closed, even with an evil Origin
    // and Referer. The previous implementation would have redirected to
    // https://evil.example here.
    const callsBefore = calls.length;
    const blocked = await rawRequest(running.baseUrl, playPath, {
      Cookie: cookie,
      Host: 'evil.example',
      Origin: 'https://evil.example',
      Referer: 'https://evil.example/phish',
    });
    assert.equal(blocked.status, 503);
    assert.match(blocked.body, /playback target could not be resolved/i);
    assert.equal(calls.length, callsBefore, 'playback must not be triggered');
  } finally {
    await running.close();
  }
});

/* ------------------------------------------------------------------ */
/* 2. CSRF on state-changing playback GETs                            */
/* ------------------------------------------------------------------ */

test('CSRF: a cross-site top-level GET queues an album without a token', async () => {
  const running = await startSecurityServer();

  try {
    const key = await findAlbumKey(running.baseUrl, 'Abbey Road');
    const cookie = await login(running.baseUrl);
    const before = running.context.playbackCalls.length;

    // SameSite=Lax sends the session cookie on cross-site top-level navigation,
    // and the server performs no Origin/Referer validation of its own.
    const response = await rawRequest(
      running.baseUrl,
      `/play/${encodeURIComponent(key)}`,
      { Cookie: cookie, Referer: 'https://attacker.example/page' },
    );

    assert.equal(response.status, 303);
    assert.equal(running.context.playbackCalls.length, before + 1);
    assert.deepEqual(running.context.playbackCalls.at(-1), {
      album: 'Abbey Road',
      artist: 'The Beatles',
    });

    // The same applies to the single-track endpoint.
    const trackBefore = running.context.trackPlaybackCalls.length;
    const track = await rawRequest(running.baseUrl, '/play/track/1', {
      Cookie: cookie,
      Referer: 'https://attacker.example/page',
    });
    assert.equal(track.status, 303);
    assert.equal(running.context.trackPlaybackCalls.length, trackBefore + 1);
  } finally {
    await running.close();
  }
});

/* ------------------------------------------------------------------ */
/* 3. Login rate limiting — regression test for the fix               */
/* ------------------------------------------------------------------ */

test('F2 fix: /api/session/login rate limits repeated failures', async () => {
  const fixture = await createFixtureContext({
    loginError: new DsmError('bad credentials', 400),
  });
  let attempts = 0;
  const countingSessions: AppDependencies['userSessions'] = {
    ...fixture.dependencies.userSessions,
    async login(username: string, password: string) {
      attempts += 1;
      return fixture.dependencies.userSessions.login(username, password);
    },
  };
  const app = createApp({
    ...fixture.dependencies,
    userSessions: countingSessions,
    loginRateLimiter: new LoginRateLimiter({
      ipMax: 5,
      accountMax: 3,
      windowMs: 60_000,
    }),
  });
  const server = await startServer(app);

  try {
    const statuses: number[] = [];
    for (let index = 0; index < 10; index += 1) {
      const response = await fetch(`${server.baseUrl}/api/session/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: `guess-${index}` }),
      });
      statuses.push(response.status);
      if (response.status === 429) {
        assert.ok(
          Number(response.headers.get('retry-after')) > 0,
          '429 must include Retry-After',
        );
      }
    }

    assert.deepEqual(statuses, [
      401, 401, 401, 429, 429, 429, 429, 429, 429, 429,
    ]);
    assert.equal(attempts, 3, 'limited requests never reach DSM login');
  } finally {
    await server.close();
    fixture.close();
  }
});

/* ------------------------------------------------------------------ */
/* 4. Raw internal error disclosure                                   */
/* ------------------------------------------------------------------ */

test('info leak: /api/status exposes raw library errors unauthenticated', async () => {
  const running = await startSecurityServer({}, { ready: false });
  const internalError = 'connect ECONNREFUSED 10.1.2.3:5432';
  // Library.status() returns lastError, which Library.rebuild() fills with
  // describeError(error) (src/server/library.ts:110,142). Simulate the same
  // contract with a representative PostgreSQL connection error.
  const originalStatus = running.context.dependencies.library.status;
  running.context.dependencies.library.status = () => ({
    ...originalStatus(),
    error: internalError,
  });

  try {
    const status = await fetch(`${running.baseUrl}/api/status`);
    assert.equal(status.status, 200);
    assert.equal(
      ((await status.json()) as { error: string }).error,
      internalError,
    );

    const albums = await fetch(`${running.baseUrl}/api/albums`);
    assert.equal(albums.status, 503);
    assert.equal(
      ((await albums.json()) as { error: string }).error,
      internalError,
    );
  } finally {
    await running.close();
  }
});

/* ------------------------------------------------------------------ */
/* 5. Clickjacking / header hardening                                 */
/* ------------------------------------------------------------------ */

test('headers: HTML pages have no clickjacking or CSP protection', async () => {
  const running = await startSecurityServer();
  try {
    for (const path of ['/', '/index.html']) {
      const response = await fetch(`${running.baseUrl}${path}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-frame-options'), null);
      assert.equal(response.headers.get('content-security-policy'), null);
      assert.equal(response.headers.get('strict-transport-security'), null);
    }

    // Regression check for the headers that are present.
    const response = await fetch(`${running.baseUrl}/api/status`);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(
      response.headers.get('referrer-policy'),
      'strict-origin-when-cross-origin',
    );
    assert.equal(response.headers.get('x-powered-by'), null);
  } finally {
    await running.close();
  }
});

/* ------------------------------------------------------------------ */
/* 6. Upstream image content-type passthrough (SVG)                   */
/* ------------------------------------------------------------------ */

test('stored XSS: cover endpoint relays an upstream image/svg+xml body', async () => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.domain)"></svg>';
  const running = await startSecurityServer(
    {},
    {
      coverImages: new Map([
        [
          'covers/abbey.jpg',
          { body: Buffer.from(svg), contentType: 'image/svg+xml' },
        ],
      ]),
    },
  );

  try {
    const key = await findAlbumKey(running.baseUrl, 'Abbey Road');
    const response = await fetch(
      `${running.baseUrl}/api/albums/${encodeURIComponent(key)}/cover`,
    );
    assert.equal(response.status, 200);
    // dsm.ts:342-356 takes the type from the DSM response and app.ts:391
    // passes it straight to res.type().
    assert.equal(response.headers.get('content-type'), 'image/svg+xml');
    assert.equal(await response.text(), svg);
    assert.equal(response.headers.get('content-security-policy'), null);
  } finally {
    await running.close();
  }
});

/* ------------------------------------------------------------------ */
/* 7. Malformed JSON is reported as a server error                    */
/* ------------------------------------------------------------------ */

test('error handling: malformed JSON returns 500 instead of 400', async () => {
  const running = await startSecurityServer();
  try {
    const response = await fetch(`${running.baseUrl}/api/session/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"username":',
    });
    // body-parser sets error.status = 400, but the app's error handler
    // (src/server/app.ts:705-709) ignores it and logs the stack.
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Internal server error' });
  } finally {
    await running.close();
  }
});

/* ------------------------------------------------------------------ */
/* 8. SQL injection is not possible (defensive proof)                 */
/* ------------------------------------------------------------------ */

test('SQL injection payloads in q, genre, region, and album key are inert', async () => {
  const running = await startSecurityServer();
  try {
    const searchPayloads = [
      "' OR '1'='1",
      '"; DROP TABLE albums;--',
      "album:\"x' OR '1'='1\"",
      "' UNION SELECT key FROM albums--",
      '%00',
    ];
    for (const payload of searchPayloads) {
      const response = await fetch(
        `${running.baseUrl}/api/albums?q=${encodeURIComponent(payload)}`,
      );
      assert.equal(response.status, 200, payload);
      const body = (await response.json()) as { total: number };
      assert.equal(typeof body.total, 'number');
    }

    const all = await fetch(`${running.baseUrl}/api/albums`);
    const allTotal = ((await all.json()) as { total: number }).total;
    const classic = await fetch(
      `${running.baseUrl}/api/albums?q=${encodeURIComponent("' OR '1'='1")}`,
    );
    const classicTotal = ((await classic.json()) as { total: number }).total;
    // The payload is searched for as text. It matches at most the albums that
    // literally contain an apostrophe; an injection would return every album.
    assert.ok(classicTotal < allTotal, 'injection returned the whole library');

    for (const param of ['genre', 'region']) {
      const response = await fetch(
        `${running.baseUrl}/api/albums?${param}=${encodeURIComponent(
          "' OR 1=1 --",
        )}`,
      );
      assert.equal(response.status, 200);
      assert.equal(
        ((await response.json()) as { total: number }).total,
        0,
        param,
      );
    }

    const key = albumKeyFor("' OR 1=1 --", 'x');
    const cover = await fetch(
      `${running.baseUrl}/api/albums/${encodeURIComponent(key)}/cover`,
    );
    assert.equal(cover.status, 404);
    const tracks = await fetch(
      `${running.baseUrl}/api/albums/${encodeURIComponent(key)}/tracks`,
    );
    assert.equal(tracks.status, 404);

    // The index is still healthy after every payload.
    const healthy = await fetch(`${running.baseUrl}/api/albums?limit=1`);
    assert.equal(healthy.status, 200);
    assert.ok(((await healthy.json()) as { total: number }).total > 0);
  } finally {
    await running.close();
  }
});

/* ------------------------------------------------------------------ */
/* 9. Static path traversal is blocked (defensive proof)              */
/* ------------------------------------------------------------------ */

test('path traversal: the static handler does not serve files outside public/', async () => {
  const running = await startSecurityServer();
  try {
    const paths = [
      '/.env',
      '/../.env',
      '/%2e%2e/.env',
      '/..%2f.env',
      '/client/../../.env',
      '/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
      '/..%2f..%2fpackage.json',
    ];
    for (const path of paths) {
      const response = await rawRequest(running.baseUrl, path);
      assert.notEqual(response.status, 200, path);
      assert.doesNotMatch(response.body, /PGPASSWORD|"dependencies"/, path);
    }
  } finally {
    await running.close();
  }
});

/* ------------------------------------------------------------------ */
/* 10. Server-rendered error pages escape HTML (defensive proof)      */
/* ------------------------------------------------------------------ */

test('XSS: playback error pages HTML-escape the DSM error message', async () => {
  const running = await startSecurityServer(
    {},
    { playbackError: new Error('<script>alert(1)</script>') },
  );
  try {
    const key = await findAlbumKey(running.baseUrl, 'Abbey Road');
    const cookie = await login(running.baseUrl);
    const response = await fetch(
      `${running.baseUrl}/play/${encodeURIComponent(key)}`,
      { redirect: 'manual', headers: { Cookie: cookie } },
    );
    assert.equal(response.status, 502);
    const html = await response.text();
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  } finally {
    await running.close();
  }
});

/* ------------------------------------------------------------------ */
/* 11. Session cookie flags                                           */
/* ------------------------------------------------------------------ */

function cookieAttributes(setCookie: string): Map<string, string> {
  const attributes = new Map<string, string>();
  for (const part of setCookie.split(';').slice(1)) {
    const [name, ...rest] = part.trim().split('=');
    attributes.set((name ?? '').toLowerCase(), rest.join('='));
  }
  return attributes;
}

test('cookie: session cookie is HttpOnly and SameSite=Lax', async () => {
  const running = await startSecurityServer();
  try {
    const response = await fetch(`${running.baseUrl}/api/session/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'secret' }),
    });
    assert.equal(response.status, 200);
    const setCookie = response.headers.get('set-cookie') ?? '';
    const attributes = cookieAttributes(setCookie);
    assert.ok(attributes.has('httponly'));
    assert.equal(attributes.get('samesite')?.toLowerCase(), 'lax');
    assert.equal(attributes.get('path'), '/');
  } finally {
    await running.close();
  }
});

test('cookie: no Secure flag behind a TLS-terminating proxy', async () => {
  // The real UserSessionStore derives Secure from req.secure. Express does not
  // enable "trust proxy", so X-Forwarded-Proto is ignored and a request that
  // reached the app over HTTPS (via the reverse proxy) still looks like HTTP.
  const store = new UserSessionStore();
  Object.defineProperty(store, 'login', {
    value: async (username: string) => ({
      sessionId: 'security-test-session',
      account: username,
    }),
  });

  const fixture = await createFixtureContext();
  const app = createApp({ ...fixture.dependencies, userSessions: store });
  const server = await startServer(app);

  try {
    const response = await fetch(`${server.baseUrl}/api/session/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
      },
      body: JSON.stringify({ username: 'alice', password: 'secret' }),
    });
    assert.equal(response.status, 200);
    const setCookie = response.headers.get('set-cookie') ?? '';
    assert.match(setCookie, /HttpOnly/i);
    assert.doesNotMatch(
      setCookie,
      /;\s*Secure/i,
      'the cookie is not marked Secure even though the proxy reported HTTPS',
    );

    // Sanity check: the store really does consult req.secure.
    assert.equal(
      (
        store.cookieOptions({ secure: true } as unknown as Request) as {
          secure: boolean;
        }
      ).secure,
      true,
    );
  } finally {
    await server.close();
    fixture.close();
  }
});
