import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { createApp } from '../../src/server/app.js';
import { DsmError } from '../../src/server/dsm.js';
import type {
  AlbumSummary,
  AlbumsResponse,
  GenresResponse,
  StatusResponse,
  TracksResponse,
} from '../../src/shared/types.js';
import {
  createFixtureContext,
  type FixtureContext,
  type FixtureOptions,
} from '../fixtures/library.js';
import { cookieFrom, json, startServer, type TestServer } from '../helpers/server.js';

interface RunningFixture {
  context: FixtureContext;
  server: TestServer;
}

async function runFixture(options: FixtureOptions = {}): Promise<RunningFixture> {
  const context = await createFixtureContext(options);
  const server = await startServer(createApp(context.dependencies));
  return { context, server };
}

async function closeFixture(fixture: RunningFixture): Promise<void> {
  await fixture.server.close();
  fixture.context.close();
}

async function findAlbum(
  baseUrl: string,
  title: string,
): Promise<AlbumSummary> {
  const { body } = await json<AlbumsResponse>(
    baseUrl,
    `/api/albums?q=${encodeURIComponent(`album:"${title}"`)}&limit=50`,
  );
  const album = body.albums.find((entry) => entry.album === title);
  assert.ok(album, `album ${title} was not found`);
  return album;
}

function albumKeys(albums: AlbumSummary[]): string[] {
  return albums.map((album) => album.key).sort();
}

function union(left: string[], right: string[]): string[] {
  return [...new Set([...left, ...right])].sort();
}

function intersection(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value)).sort();
}

async function albums(
  baseUrl: string,
  path: string,
): Promise<AlbumsResponse> {
  const { response, body } = await json<AlbumsResponse>(baseUrl, path);
  assert.equal(response.status, 200);
  return body;
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

let main: RunningFixture;
let covers: RunningFixture;

before(async () => {
  main = await runFixture();
  covers = await runFixture({
    coverImages: new Map([
      [
        'covers/abbey.jpg',
        { body: Buffer.from('fixture-image'), contentType: 'image/jpeg' },
      ],
    ]),
  });
});

after(async () => {
  await closeFixture(main);
  await closeFixture(covers);
});

test('GET /api/status exposes library and playback state', async () => {
  const response = await fetch(`${main.server.baseUrl}/api/status`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  const body = (await response.json()) as StatusResponse;
  assert.equal(body.ready, true);
  assert.equal(typeof body.albumCount, 'number');
  assert.ok(body.albumCount > 0);
  assert.equal(typeof body.trackCount, 'number');
  assert.ok(body.trackCount >= body.albumCount);
  assert.ok(body.libraryVersion >= 1);
  assert.equal(typeof body.lastRefreshed, 'string');
  assert.equal(typeof body.lastCheckedAt, 'string');
  assert.equal(body.refreshing, false);
  assert.ok(body.checkIntervalMs > 0);
  assert.equal(body.error, null);
  assert.equal(body.playbackEnabled, true);
});

test('GET /api/session starts signed out', async () => {
  const { response, body } = await json<{
    authenticated: boolean;
    account: string | null;
  }>(main.server.baseUrl, '/api/session');
  assert.equal(response.status, 200);
  assert.deepEqual(body, { authenticated: false, account: null });
});

test('session login validates input and creates a cookie session', async () => {
  const missing = await json<{ error: string }>(
    main.server.baseUrl,
    '/api/session/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice' }),
    },
  );
  assert.equal(missing.response.status, 400);

  const login = await json<{ authenticated: boolean; account: string }>(
    main.server.baseUrl,
    '/api/session/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'secret' }),
    },
  );
  assert.equal(login.response.status, 200);
  assert.deepEqual(login.body, { authenticated: true, account: 'alice' });
  const cookie = cookieFrom(login.response);
  assert.ok(cookie);
  assert.match(cookie, /^mw_session=/);

  const session = await json<{ authenticated: boolean; account: string }>(
    main.server.baseUrl,
    '/api/session',
    { headers: { Cookie: cookie } },
  );
  assert.deepEqual(session.body, { authenticated: true, account: 'alice' });

  const logout = await json<{ authenticated: boolean; account: string | null }>(
    main.server.baseUrl,
    '/api/session/logout',
    { method: 'POST', headers: { Cookie: cookie } },
  );
  assert.deepEqual(logout.body, { authenticated: false, account: null });
  const afterLogout = await json<{ authenticated: boolean }>(
    main.server.baseUrl,
    '/api/session',
    { headers: { Cookie: cookie } },
  );
  assert.equal(afterLogout.body.authenticated, false);
});

test('session login reports DSM credential errors', async () => {
  const fixture = await runFixture({
    loginError: new DsmError('bad credentials', 400),
  });
  try {
    const { response, body } = await json<{ error: string }>(
      fixture.server.baseUrl,
      '/api/session/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: 'wrong' }),
      },
    );
    assert.equal(response.status, 401);
    assert.equal(body.error, 'Incorrect username or password.');
  } finally {
    await closeFixture(fixture);
  }
});

test('session login is unavailable when DSM is not configured', async () => {
  const fixture = await runFixture({ authEnabled: false, playbackUrl: null });
  try {
    const { response, body } = await json<{ error: string }>(
      fixture.server.baseUrl,
      '/api/session/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: 'secret' }),
      },
    );
    assert.equal(response.status, 503);
    assert.match(body.error, /not configured/i);
    const status = await json<{ playbackEnabled: boolean }>(
      fixture.server.baseUrl,
      '/api/status',
    );
    assert.equal(status.body.playbackEnabled, false);
  } finally {
    await closeFixture(fixture);
  }
});

test('GET /api/genres returns separate genre and region facets', async () => {
  const [facets, status] = await Promise.all([
    json<GenresResponse>(main.server.baseUrl, '/api/genres'),
    json<StatusResponse>(main.server.baseUrl, '/api/status'),
  ]);
  assert.equal(facets.response.status, 200);
  assert.equal(facets.body.totalAlbums, status.body.albumCount);
  assert.equal(facets.body.libraryVersion, status.body.libraryVersion);

  assert.ok(facets.body.genres.length > 0);
  assert.ok(facets.body.regions.length > 0);
  assert.ok(facets.body.genres.every((genre) => genre.albumCount > 0));
  assert.ok(facets.body.regions.every((region) => region.albumCount > 0));
  assert.ok(facets.body.genres.some((genre) => genre.name === 'Rock'));
  assert.ok(facets.body.genres.every((genre) => genre.name !== 'Brazil'));
  assert.ok(facets.body.regions.some((region) => region.name === 'Brazil'));
  assert.ok(facets.body.regions.some((region) => region.name === 'England'));
  assert.ok(facets.body.regions.some((region) => region.name === 'Corsica'));
  assert.ok(facets.body.regions.some((region) => region.name === 'Catalonia'));
});

test('GET /api/albums lists, sorts, paginates, and clamps parameters', async () => {
  const all = await albums(main.server.baseUrl, '/api/albums');
  assert.ok(all.total > 0);
  assert.equal(all.offset, 0);
  assert.equal(all.limit, 48);
  assert.equal(all.albums.length, Math.min(all.limit, all.total));

  const full = await albums(
    main.server.baseUrl,
    '/api/albums?sort=album&limit=200',
  );
  assert.ok(full.total > 0);
  for (let index = 1; index < full.albums.length; index += 1) {
    const previous = full.albums[index - 1];
    const current = full.albums[index];
    assert.ok(previous);
    assert.ok(current);
    assert.ok(collator.compare(previous.album, current.album) <= 0);
  }

  const offset = Math.min(2, Math.max(0, full.albums.length - 1));
  const page = await albums(
    main.server.baseUrl,
    `/api/albums?sort=album&offset=${offset}&limit=2`,
  );
  assert.equal(page.total, full.total);
  assert.equal(page.offset, offset);
  assert.equal(page.limit, 2);
  assert.deepEqual(
    albumKeys(page.albums),
    albumKeys(full.albums.slice(offset, offset + 2)),
  );

  const max = await albums(main.server.baseUrl, '/api/albums?limit=999');
  assert.equal(max.limit, 200);
  const min = await albums(main.server.baseUrl, '/api/albums?limit=0');
  assert.equal(min.limit, 1);

  const invalidSort = await albums(
    main.server.baseUrl,
    '/api/albums?sort=bogus&limit=1',
  );
  assert.equal(invalidSort.total, all.total);
});

test('GET /api/albums applies genre and region modes', async () => {
  const jazz = await albums(main.server.baseUrl, '/api/albums?genre=Jazz');
  const folk = await albums(main.server.baseUrl, '/api/albums?genre=Folk');
  const genreAny = await albums(
    main.server.baseUrl,
    '/api/albums?genre=Jazz&genre=Folk&genreMode=any',
  );
  const genreAll = await albums(
    main.server.baseUrl,
    '/api/albums?genre=Jazz&genre=Folk&genreMode=all',
  );

  assert.deepEqual(
    albumKeys(genreAny.albums),
    union(albumKeys(jazz.albums), albumKeys(folk.albums)),
  );
  assert.deepEqual(
    albumKeys(genreAll.albums),
    intersection(albumKeys(jazz.albums), albumKeys(folk.albums)),
  );
  for (const album of genreAll.albums) {
    assert.ok(album.genres.includes('Jazz'));
    assert.ok(album.genres.includes('Folk'));
  }

  const spain = await albums(main.server.baseUrl, '/api/albums?region=Spain');
  const catalonia = await albums(
    main.server.baseUrl,
    '/api/albums?region=Catalonia',
  );
  const regionAny = await albums(
    main.server.baseUrl,
    '/api/albums?region=Spain&region=Catalonia&regionMode=any',
  );
  const regionAll = await albums(
    main.server.baseUrl,
    '/api/albums?region=Spain&region=Catalonia&regionMode=all',
  );

  assert.ok(spain.total > 0);
  assert.ok(catalonia.total > 0);
  assert.deepEqual(
    albumKeys(regionAny.albums),
    union(albumKeys(spain.albums), albumKeys(catalonia.albums)),
  );
  assert.deepEqual(
    albumKeys(regionAll.albums),
    intersection(albumKeys(spain.albums), albumKeys(catalonia.albums)),
  );
  for (const album of regionAll.albums) {
    assert.ok(album.regions.includes('Spain'));
    assert.ok(album.regions.includes('Catalonia'));
  }
});

test('GET /api/albums applies the search expression and combines with tags', async () => {
  const composer = await albums(
    main.server.baseUrl,
    `/api/albums?q=${encodeURIComponent('composer:jobim')}`,
  );
  assert.ok(composer.total > 0);
  assert.ok(
    composer.albums.some((album) => album.album === 'Getz/Gilberto'),
  );

  const phrase = await albums(
    main.server.baseUrl,
    `/api/albums?q=${encodeURIComponent('album:"abbey road"')}`,
  );
  assert.ok(phrase.total > 0);
  for (const album of phrase.albums) {
    assert.match(album.album.toLowerCase(), /abbey road/);
  }

  const albumRoad = await albums(
    main.server.baseUrl,
    `/api/albums?q=${encodeURIComponent('album:road')}`,
  );
  const artistBeatles = await albums(
    main.server.baseUrl,
    `/api/albums?q=${encodeURIComponent('artist:beatles')}`,
  );
  const boolean = await albums(
    main.server.baseUrl,
    `/api/albums?q=${encodeURIComponent('album:road OR artist:beatles')}`,
  );
  assert.deepEqual(
    albumKeys(boolean.albums),
    union(albumKeys(albumRoad.albums), albumKeys(artistBeatles.albums)),
  );

  const searchOnly = await albums(
    main.server.baseUrl,
    `/api/albums?q=${encodeURIComponent('album:abbey')}`,
  );
  const genreOnly = await albums(
    main.server.baseUrl,
    '/api/albums?genre=Rock',
  );
  const combined = await albums(
    main.server.baseUrl,
    `/api/albums?q=${encodeURIComponent('album:abbey')}&genre=Rock`,
  );
  assert.deepEqual(
    albumKeys(combined.albums),
    intersection(albumKeys(searchOnly.albums), albumKeys(genreOnly.albums)),
  );

  const none = await albums(
    main.server.baseUrl,
    `/api/albums?q=${encodeURIComponent('foo:bar')}`,
  );
  assert.equal(none.albums.length, 0);
});

test('GET /api/albums/:key/cover handles invalid, missing, and present covers', async () => {
  const invalid = await fetch(`${covers.server.baseUrl}/api/albums/nope/cover`);
  assert.equal(invalid.status, 400);

  const abbey = await findAlbum(covers.server.baseUrl, 'Abbey Road');
  const present = await fetch(
    `${covers.server.baseUrl}/api/albums/${encodeURIComponent(abbey.key)}/cover`,
  );
  assert.equal(present.status, 200);
  assert.equal(present.headers.get('content-type'), 'image/jpeg');
  assert.equal(await present.text(), 'fixture-image');
  assert.match(present.headers.get('cache-control') ?? '', /max-age=86400/);

  const corsica = await findAlbum(covers.server.baseUrl, 'Corsica');
  const before = covers.context.coverCalls.length;
  const missing = await fetch(
    `${covers.server.baseUrl}/api/albums/${encodeURIComponent(corsica.key)}/cover`,
  );
  assert.equal(missing.status, 404);
  assert.equal(covers.context.coverCalls.length, before);
});

test('GET /api/albums/:key/tracks returns merged tracks and composer metadata', async () => {
  const abbey = await findAlbum(main.server.baseUrl, 'Abbey Road');
  const { response, body } = await json<TracksResponse>(
    main.server.baseUrl,
    `/api/albums/${encodeURIComponent(abbey.key)}/tracks`,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(body.sourceAlbums, [
    'Abbey Road',
    'Abbey Road // Bonus Tracks',
  ]);
  assert.ok(body.tracks.length > 0);
  const guitar = body.tracks.find(
    (track) => track.title === 'While My Guitar Gently Weeps',
  );
  assert.equal(guitar?.artist, 'The Beatles feat. Eric Clapton');
  assert.deepEqual(guitar?.artists, ['The Beatles', 'Eric Clapton']);
  assert.equal(guitar?.composer, 'George Harrison');
  assert.deepEqual(guitar?.composers, ['George Harrison']);
  assert.equal(
    body.tracks.find((track) => track.title === 'Come Together (Take 1)')
      ?.sourceAlbum,
    'Abbey Road // Bonus Tracks',
  );

  const invalid = await json<{ error: string }>(
    main.server.baseUrl,
    '/api/albums/nope/tracks',
  );
  assert.equal(invalid.response.status, 400);

  const corsica = await findAlbum(main.server.baseUrl, 'Corsica');
  const missing = await json<{ error: string }>(
    main.server.baseUrl,
    `/api/albums/${encodeURIComponent(corsica.key)}/tracks`,
  );
  assert.equal(missing.response.status, 404);
});

test('GET /play/:key handles invalid keys, sign-in, and playback handoff', async () => {
  const invalid = await fetch(`${main.server.baseUrl}/play/nope`, {
    redirect: 'manual',
  });
  assert.equal(invalid.status, 400);
  assert.match(await invalid.text(), /Invalid album link/);

  const abbey = await findAlbum(main.server.baseUrl, 'Abbey Road');
  const signedOut = await fetch(
    `${main.server.baseUrl}/play/${encodeURIComponent(abbey.key)}`,
    {
      redirect: 'manual',
      headers: { Origin: 'https://app.example:8443' },
    },
  );
  assert.equal(signedOut.status, 303);
  assert.equal(
    signedOut.headers.get('location'),
    `/?login=1&play=${encodeURIComponent(abbey.key)}`,
  );
  assert.equal(
    main.context.playbackOrigins.at(-1),
    'https://app.example:8443',
  );

  const login = await json<{ account: string }>(
    main.server.baseUrl,
    '/api/session/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'secret' }),
    },
  );
  const cookie = cookieFrom(login.response);
  assert.ok(cookie);
  const played = await fetch(
    `${main.server.baseUrl}/play/${encodeURIComponent(abbey.key)}`,
    { redirect: 'manual', headers: { Cookie: cookie } },
  );
  assert.equal(played.status, 303);
  assert.equal(
    played.headers.get('location'),
    'https://audio.example/?launchApp=SYNO.SDS.AudioStation.Application',
  );
  assert.match(
    main.context.playbackOrigins.at(-1) ?? '',
    /^http:\/\/127\.0\.0\.1:\d+$/,
  );
  assert.ok(
    main.context.playbackCalls.some(
      (call) => call.album === 'Abbey Road' && call.artist === 'The Beatles',
    ),
  );
});

test('GET /play/track/:id queues a single track', async () => {
  const invalid = await fetch(`${main.server.baseUrl}/play/track/nope`, {
    redirect: 'manual',
  });
  assert.equal(invalid.status, 400);
  assert.match(await invalid.text(), /Invalid track link/);

  const signedOut = await fetch(`${main.server.baseUrl}/play/track/1`, {
    redirect: 'manual',
  });
  assert.equal(signedOut.status, 303);
  assert.equal(
    signedOut.headers.get('location'),
    '/?login=1&playTrack=1',
  );

  const login = await json<{ account: string }>(
    main.server.baseUrl,
    '/api/session/login',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'secret' }),
    },
  );
  const cookie = cookieFrom(login.response);
  assert.ok(cookie);
  const played = await fetch(`${main.server.baseUrl}/play/track/1`, {
    redirect: 'manual',
    headers: { Cookie: cookie },
  });
  assert.equal(played.status, 303);
  assert.equal(
    played.headers.get('location'),
    'https://audio.example/?launchApp=SYNO.SDS.AudioStation.Application',
  );
  assert.ok(main.context.trackPlaybackCalls.includes(1));
});

test('GET /play/:key reports playback failures and unavailable playback', async () => {
  const failing = await runFixture({ playbackError: new Error('queue full') });
  try {
    const login = await json(
      failing.server.baseUrl,
      '/api/session/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: 'secret' }),
      },
    );
    const cookie = cookieFrom(login.response);
    assert.ok(cookie);
    const abbey = await findAlbum(failing.server.baseUrl, 'Abbey Road');
    const response = await fetch(
      `${failing.server.baseUrl}/play/${encodeURIComponent(abbey.key)}`,
      { redirect: 'manual', headers: { Cookie: cookie } },
    );
    assert.equal(response.status, 502);
    assert.match(await response.text(), /Could not start playback/);
  } finally {
    await closeFixture(failing);
  }

  const unavailable = await runFixture({ playbackUrl: null });
  try {
    const abbey = await findAlbum(unavailable.server.baseUrl, 'Abbey Road');
    const response = await fetch(
      `${unavailable.server.baseUrl}/play/${encodeURIComponent(abbey.key)}`,
      { redirect: 'manual' },
    );
    assert.equal(response.status, 503);
    assert.match(await response.text(), /Playback unavailable/);
  } finally {
    await closeFixture(unavailable);
  }
});

test('unavailable libraries return 503 for album and facet endpoints', async () => {
  const fixture = await runFixture({ ready: false });
  try {
    const status = await json<{ ready: boolean }>(
      fixture.server.baseUrl,
      '/api/status',
    );
    assert.equal(status.body.ready, false);
    for (const path of ['/api/genres', '/api/albums']) {
      const response = await fetch(`${fixture.server.baseUrl}${path}`);
      assert.equal(response.status, 503);
      assert.match(
        ((await response.json()) as { error: string }).error,
        /unavailable|still being built/i,
      );
    }
  } finally {
    await closeFixture(fixture);
  }
});

test('unknown API routes return JSON 404 and static files are served', async () => {
  const unknown = await json<{ error: string }>(
    main.server.baseUrl,
    '/api/does-not-exist',
  );
  assert.equal(unknown.response.status, 404);
  assert.equal(unknown.body.error, 'Not found');

  const root = await fetch(`${main.server.baseUrl}/`);
  assert.equal(root.status, 200);
  assert.match(root.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await root.text(), /Happy Trails/);
});
