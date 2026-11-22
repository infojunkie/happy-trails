import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { createApp } from '../../src/server/app.js';
import { DsmError } from '../../src/server/dsm.js';
import type {
  AboutResponse,
  AlbumSummary,
  AlbumsResponse,
  GenresResponse,
  StatusResponse,
  TrackSearchResponse,
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

async function trackSearch(
  baseUrl: string,
  path: string,
): Promise<TrackSearchResponse> {
  const { response, body } = await json<TrackSearchResponse>(baseUrl, path);
  assert.equal(response.status, 200);
  return body;
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

let main: RunningFixture;
let covers: RunningFixture;
let artwork: RunningFixture;

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
  artwork = await runFixture({
    artworkFiles: new Map([
      ['covers/abbey.jpg', Buffer.from('%PDF-1.4 fixture artwork')],
    ]),
  });
});

after(async () => {
  await closeFixture(main);
  await closeFixture(covers);
  await closeFixture(artwork);
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
  assert.equal(body.pageSize, 48);
  assert.equal(body.error, null);
  assert.equal(body.playbackEnabled, true);
  assert.equal(body.nativePlaybackEnabled, true);
  assert.equal(body.audioStationFallbackEnabled, true);
  assert.equal(body.screenWakeLockEnabled, true);
});

test('GET /api/about exposes package metadata', async () => {
  const response = await fetch(`${main.server.baseUrl}/api/about`);
  assert.equal(response.status, 200);
  const body = (await response.json()) as AboutResponse;
  assert.equal(body.name, 'happy-trails');
  assert.match(body.version, /^\d+\.\d+\.\d+/);
  assert.equal(
    body.description,
    'Browse the Synology mediaserver music library.',
  );
  assert.equal(body.author?.name, 'Karim Ratib');
  assert.equal(body.author?.url, 'https://karimratib.me/');
  assert.equal(body.contributors.length, 1);
  assert.equal(body.contributors[0]?.name, 'deepseek-v4-flash');
  assert.equal(
    body.contributors[0]?.url,
    'https://platform.deepseek.com/',
  );
  assert.equal(
    body.issuesUrl,
    'https://github.com/infojunkie/happy-trails/issues',
  );
  assert.equal(
    body.homepageUrl,
    'https://github.com/infojunkie/happy-trails#happy-trails',
  );
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
    const status = await json<{
      playbackEnabled: boolean;
      nativePlaybackEnabled: boolean;
      audioStationFallbackEnabled: boolean;
    }>(fixture.server.baseUrl, '/api/status');
    assert.equal(status.body.playbackEnabled, false);
    assert.equal(status.body.nativePlaybackEnabled, false);
    assert.equal(status.body.audioStationFallbackEnabled, false);
  } finally {
    await closeFixture(fixture);
  }
});

test('PAGE_SIZE drives the status page size and API defaults', async () => {
  const fixture = await runFixture({ pageSize: 24 });
  try {
    const status = await json<StatusResponse>(
      fixture.server.baseUrl,
      '/api/status',
    );
    assert.equal(status.body.pageSize, 24);

    const albumPage = await albums(fixture.server.baseUrl, '/api/albums');
    assert.equal(albumPage.limit, 24);
    assert.ok(albumPage.albums.length <= 24);

    const trackPage = await json<TrackSearchResponse>(
      fixture.server.baseUrl,
      '/api/tracks',
    );
    assert.equal(trackPage.body.limit, 24);

    const playbackPage = await json<TrackSearchResponse>(
      fixture.server.baseUrl,
      '/api/playback/tracks?mode=tracks',
    );
    assert.equal(playbackPage.body.limit, 24);
  } finally {
    await closeFixture(fixture);
  }
});

test('GET /api/genres returns separate genre, region, and series facets', async () => {
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
  for (const facet of [
    ...facets.body.genres,
    ...facets.body.regions,
    ...facets.body.series,
  ]) {
    assert.equal(typeof facet.trackCount, 'number', facet.name);
    assert.ok(facet.trackCount >= facet.albumCount, facet.name);
  }
  assert.ok(facets.body.genres.some((genre) => genre.name === 'Rock'));
  assert.ok(facets.body.genres.every((genre) => genre.name !== 'Brazil'));
  assert.ok(facets.body.regions.some((region) => region.name === 'Brazil'));
  assert.ok(facets.body.regions.some((region) => region.name === 'England'));
  assert.ok(facets.body.regions.some((region) => region.name === 'Corsica'));
  assert.ok(facets.body.regions.some((region) => region.name === 'Catalonia'));
  assert.ok(
    facets.body.series.some(
      (serie) => serie.name === 'Blue Note' && serie.albumCount === 1,
    ),
  );
  assert.ok(
    facets.body.series.some(
      (serie) => serie.name === 'Rock Candy' && serie.albumCount === 1,
    ),
  );
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

test('GET /api/tracks lists, searches, sorts, and paginates', async () => {
  const all = await trackSearch(main.server.baseUrl, '/api/tracks');
  assert.ok(all.total > 0);
  assert.equal(all.offset, 0);
  assert.equal(all.limit, 48);
  assert.ok(all.total > all.limit);
  assert.equal(all.tracks.length, all.limit);

  const page = await trackSearch(
    main.server.baseUrl,
    '/api/tracks?sort=album&offset=5&limit=3',
  );
  assert.equal(page.total, all.total);
  assert.equal(page.offset, 5);
  assert.equal(page.limit, 3);
  assert.equal(page.tracks.length, 3);

  const max = await trackSearch(main.server.baseUrl, '/api/tracks?limit=999');
  assert.equal(max.limit, 200);
  const min = await trackSearch(main.server.baseUrl, '/api/tracks?limit=0');
  assert.equal(min.limit, 1);

  const unknownSort = await trackSearch(
    main.server.baseUrl,
    '/api/tracks?sort=bogus&limit=1',
  );
  assert.equal(unknownSort.total, all.total);

  const soWhat = await trackSearch(
    main.server.baseUrl,
    `/api/tracks?q=${encodeURIComponent('track:"so what"')}`,
  );
  assert.equal(soWhat.total, 1);
  const track = soWhat.tracks[0];
  assert.ok(track);
  assert.equal(track.title, 'So What');
  assert.equal(track.artist, 'Miles Davis');
  assert.deepEqual(track.artists, ['Miles Davis']);
  assert.equal(track.album, 'Kind of Blue');
  assert.equal(track.sourceAlbum, 'Kind of Blue');
  assert.equal(track.albumArtist, 'Miles Davis');
  assert.equal(track.duration, 200);
  assert.equal(track.playable, true);
  assert.deepEqual(track.genres, ['Jazz']);
  assert.deepEqual(track.regions, []);
  assert.ok(track.albumKey.length > 0);

  const unsupported = await trackSearch(
    main.server.baseUrl,
    `/api/tracks?q=${encodeURIComponent('track:"maxwell\'s silver hammer"')}`,
  );
  assert.equal(unsupported.total, 1);
  assert.equal(unsupported.tracks[0]?.playable, false);
});

test('GET /api/playback/tracks flattens album results to tracks', async () => {
  const query = encodeURIComponent('artist:"the beatles"');
  const tracksMode = await trackSearch(
    main.server.baseUrl,
    `/api/playback/tracks?mode=tracks&q=${query}&limit=200`,
  );
  const directTracks = await trackSearch(
    main.server.baseUrl,
    `/api/tracks?q=${query}&limit=200`,
  );
  assert.equal(tracksMode.total, directTracks.total);
  assert.deepEqual(
    tracksMode.tracks.map((track) => track.id),
    directTracks.tracks.map((track) => track.id),
  );

  const albumsMode = await trackSearch(
    main.server.baseUrl,
    `/api/playback/tracks?mode=albums&q=${query}&limit=200`,
  );
  assert.equal(albumsMode.total, 20);
  assert.equal(albumsMode.tracks.length, 20);
  assert.ok(
    albumsMode.tracks.every((track) => track.album === 'Abbey Road'),
  );
  assert.equal(albumsMode.tracks[0]?.title, 'Come Together');
  assert.equal(
    new Set(albumsMode.tracks.map((track) => track.albumKey)).size,
    1,
  );

  const firstPage = await trackSearch(
    main.server.baseUrl,
    `/api/playback/tracks?mode=albums&q=${query}&limit=5&offset=0`,
  );
  const secondPage = await trackSearch(
    main.server.baseUrl,
    `/api/playback/tracks?mode=albums&q=${query}&limit=5&offset=5`,
  );
  assert.equal(firstPage.tracks.length, 5);
  assert.equal(secondPage.tracks.length, 5);
  assert.equal(firstPage.total, 20);
  assert.equal(secondPage.total, 20);
  const ids = new Set(firstPage.tracks.map((track) => track.id));
  assert.ok(secondPage.tracks.every((track) => !ids.has(track.id)));

  const empty = await trackSearch(
    main.server.baseUrl,
    '/api/playback/tracks?mode=albums&limit=1',
  );
  assert.equal(empty.total, main.context.index.trackCount);

  const invalid = await json<{ error: string }>(
    main.server.baseUrl,
    '/api/playback/tracks?mode=singles',
  );
  assert.equal(invalid.response.status, 400);

  const clamped = await trackSearch(
    main.server.baseUrl,
    '/api/playback/tracks?mode=tracks&limit=0',
  );
  assert.equal(clamped.limit, 1);
});

test('album-mode playback preserves album order and flattens each album', async () => {
  const query = encodeURIComponent('genre:jazz');
  const albumResponse = await albums(
    main.server.baseUrl,
    `/api/albums?q=${query}&sort=album&limit=200`,
  );
  const playback = await trackSearch(
    main.server.baseUrl,
    `/api/playback/tracks?mode=albums&q=${query}&sort=album&limit=200`,
  );

  const seen: string[] = [];
  for (const track of playback.tracks) {
    if (seen.at(-1) !== track.albumKey) seen.push(track.albumKey);
  }
  assert.deepEqual(
    seen,
    albumResponse.albums.map((album) => album.key),
  );

  for (const album of albumResponse.albums) {
    const tracks = playback.tracks.filter(
      (track) => track.albumKey === album.key,
    );
    assert.equal(tracks.length, album.trackCount);
  }
});

test('GET /api/tracks uses album-level genre filters', async () => {
  const jazzTracks = await trackSearch(
    main.server.baseUrl,
    `/api/tracks?q=${encodeURIComponent('genre:jazz')}&limit=200`,
  );
  const jazzAlbums = await albums(
    main.server.baseUrl,
    `/api/albums?q=${encodeURIComponent('genre:jazz')}&limit=200`,
  );
  assert.equal(
    jazzTracks.total,
    jazzAlbums.albums.reduce((sum, album) => sum + album.trackCount, 0),
  );
  assert.ok(jazzTracks.tracks.every((track) => track.genres.includes('Jazz')));

  const partial = await trackSearch(
    main.server.baseUrl,
    `/api/tracks?q=${encodeURIComponent('genre:jaz')}`,
  );
  assert.equal(partial.total, 0);
});

test('GET /api/albums/:key returns one album or 404', async () => {
  const album = await findAlbum(main.server.baseUrl, 'Kind of Blue');
  const { response, body } = await json<AlbumSummary>(
    main.server.baseUrl,
    `/api/albums/${encodeURIComponent(album.key)}`,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(body, album);

  const missing = await fetch(
    `${main.server.baseUrl}/api/albums/not-a-real-key`,
  );
  assert.equal(missing.status, 404);
});

test('track: in album search finds albums containing a matching track', async () => {
  const result = await albums(
    main.server.baseUrl,
    `/api/albums?q=${encodeURIComponent('track:"freddie freeloader"')}`,
  );
  assert.equal(result.total, 1);
  assert.equal(result.albums[0]?.album, 'Kind of Blue');
});

test('obsolete genre and region parameters are ignored', async () => {
  const all = await albums(main.server.baseUrl, '/api/albums?limit=1');
  const ignored = await albums(
    main.server.baseUrl,
    '/api/albums?genre=Jazz&genreMode=all&region=Brazil&regionMode=all&limit=1',
  );
  assert.equal(ignored.total, all.total);
});

test('GET /api/albums includes the album series', async () => {
  const blueTrain = await findAlbum(
    main.server.baseUrl,
    'Blue Train {Blue Note}',
  );
  assert.deepEqual(blueTrain.series, ['Blue Note']);

  const abbey = await findAlbum(main.server.baseUrl, 'Abbey Road');
  assert.deepEqual(abbey.series, []);
});

test('GET /api/albums aggregates and deduplicates track comments', async () => {
  const all = await albums(main.server.baseUrl, '/api/albums?limit=200');
  assert.ok(all.albums.every((album) => Array.isArray(album.comments)));

  // "Abbey Road" merges the main and bonus-disc source titles. The shared
  // URL appears once; each source's own comment is kept.
  const abbey = await findAlbum(main.server.baseUrl, 'Abbey Road');
  assert.deepEqual(abbey.comments, [
    'Bonus disc notes',
    'https://example.com/abbey-road',
    'Original mix notes',
  ]);

  const kindOfBlue = await findAlbum(main.server.baseUrl, 'Kind of Blue');
  assert.deepEqual(kindOfBlue.comments, ['UDSACD 2122']);
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

  const genre = await albums(
    main.server.baseUrl,
    `/api/albums?q=${encodeURIComponent('genre:jazz')}`,
  );
  assert.ok(genre.total > 0);
  assert.ok(genre.albums.every((album) => album.genres.includes('Jazz')));

  const region = await albums(
    main.server.baseUrl,
    `/api/albums?q=${encodeURIComponent('region:brazil')}`,
  );
  assert.ok(region.total > 0);
  assert.ok(region.albums.every((album) => album.regions.includes('Brazil')));

  const serie = await albums(
    main.server.baseUrl,
    `/api/albums?q=${encodeURIComponent('serie:"blue note"')}`,
  );
  assert.ok(
    serie.albums.some((album) => album.album === 'Blue Train {Blue Note}'),
  );

  const label = await albums(
    main.server.baseUrl,
    `/api/albums?q=${encodeURIComponent('label:"rock candy"')}`,
  );
  assert.ok(
    label.albums.some((album) =>
      album.album.startsWith('A Love Supreme {Rock Candy}'),
    ),
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
    `/api/albums?q=${encodeURIComponent('genre:"Rock"')}`,
  );
  const combined = await albums(
    main.server.baseUrl,
    `/api/albums?q=${encodeURIComponent('album:abbey genre:"Rock"')}`,
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

test('artwork endpoints report and stream Artwork.pdf', async () => {
  const invalid = await fetch(
    `${artwork.server.baseUrl}/api/albums/nope/artwork`,
    { method: 'HEAD' },
  );
  assert.equal(invalid.status, 400);

  const abbey = await findAlbum(artwork.server.baseUrl, 'Abbey Road');
  const artworkUrl = `${artwork.server.baseUrl}/api/albums/${encodeURIComponent(abbey.key)}/artwork`;
  const head = await fetch(artworkUrl, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-type'), 'application/pdf');
  assert.equal(
    head.headers.get('content-disposition'),
    'inline; filename="Artwork.pdf"',
  );
  assert.match(head.headers.get('cache-control') ?? '', /max-age=300/);

  const download = await fetch(artworkUrl, {
    headers: { Range: 'bytes=0-3' },
  });
  assert.equal(download.status, 200);
  assert.equal(download.headers.get('content-type'), 'application/pdf');
  assert.equal(await download.text(), '%PDF-1.4 fixture artwork');
  assert.deepEqual(artwork.context.artworkRangeCalls, ['bytes=0-3']);

  const kindOfBlue = await findAlbum(artwork.server.baseUrl, 'Kind of Blue');
  const missingHead = await fetch(
    `${artwork.server.baseUrl}/api/albums/${encodeURIComponent(kindOfBlue.key)}/artwork`,
    { method: 'HEAD' },
  );
  assert.equal(missingHead.status, 404);
  const missingGet = await fetch(
    `${artwork.server.baseUrl}/api/albums/${encodeURIComponent(kindOfBlue.key)}/artwork`,
  );
  assert.equal(missingGet.status, 404);

  const unconfigured = await findAlbum(main.server.baseUrl, 'Abbey Road');
  const unavailable = await fetch(
    `${main.server.baseUrl}/api/albums/${encodeURIComponent(unconfigured.key)}/artwork`,
    { method: 'HEAD' },
  );
  assert.equal(unavailable.status, 404);
});

test('original cover endpoint streams the full-resolution file', async () => {
  const fixture = await runFixture({
    originalCoverImages: new Map([
      [
        'covers/abbey.jpg',
        { body: Buffer.from('full-cover-bytes'), contentType: 'image/jpeg' },
      ],
    ]),
  });
  try {
    const abbey = await findAlbum(fixture.server.baseUrl, 'Abbey Road');
    const url = `${fixture.server.baseUrl}/api/albums/${encodeURIComponent(abbey.key)}/cover/original`;
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.equal(await response.text(), 'full-cover-bytes');
    assert.deepEqual(fixture.context.originalCoverCalls, ['covers/abbey.jpg']);

    const kindOfBlue = await findAlbum(fixture.server.baseUrl, 'Kind of Blue');
    const missing = await fetch(
      `${fixture.server.baseUrl}/api/albums/${encodeURIComponent(kindOfBlue.key)}/cover/original`,
    );
    assert.equal(missing.status, 404);
  } finally {
    await closeFixture(fixture);
  }
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
  assert.equal(
    body.tracks.find((track) => track.title === "Maxwell's Silver Hammer")
      ?.playable,
    false,
  );
  assert.ok(
    body.tracks
      .filter((track) => track.title !== "Maxwell's Silver Hammer")
      .every((track) => track.playable),
  );
  assert.ok(body.tracks.every((track) => track.matches === true));

  const filtered = await json<TracksResponse>(
    main.server.baseUrl,
    `/api/albums/${encodeURIComponent(abbey.key)}/tracks?q=${encodeURIComponent(
      'composer:"George Harrison"',
    )}`,
  );
  assert.equal(filtered.response.status, 200);
  assert.equal(filtered.body.tracks.length, body.tracks.length);
  const matched = filtered.body.tracks.filter((track) => track.matches);
  const unmatched = filtered.body.tracks.filter((track) => !track.matches);
  assert.ok(matched.length > 0);
  assert.ok(unmatched.length > 0);
  assert.ok(
    matched.every((track) => track.composer?.includes('George Harrison')),
  );

  const putumayo = await findAlbum(
    main.server.baseUrl,
    'Putumayo - Family Gathering',
  );
  const putumayoTracks = await json<TracksResponse>(
    main.server.baseUrl,
    `/api/albums/${encodeURIComponent(putumayo.key)}/tracks`,
  );
  const icelandic = putumayoTracks.body.tracks.find(
    (track) => track.title === 'Icelandic Track',
  );
  assert.deepEqual(icelandic?.genres, ['Folk']);
  assert.deepEqual(icelandic?.regions, ['Iceland']);
  const nordic = putumayoTracks.body.tracks.find(
    (track) => track.title === 'Nordic Track',
  );
  assert.deepEqual(nordic?.genres, ['Folk']);
  assert.deepEqual(nordic?.regions, ['Denmark']);
  const other = putumayoTracks.body.tracks.find(
    (track) => track.title === 'Other Track',
  );
  assert.deepEqual(other?.genres, ['Folk']);
  assert.deepEqual(other?.regions, []);

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
  assert.ok(
    main.context.playbackCalls.some(
      (call) => call.album === 'Abbey Road' && call.artist === 'The Beatles',
    ),
  );

  const filteredQuery = 'composer:"George Harrison"';
  const filteredRedirect = await fetch(
    `${main.server.baseUrl}/play/${encodeURIComponent(abbey.key)}?q=${encodeURIComponent(filteredQuery)}`,
    { redirect: 'manual' },
  );
  assert.equal(filteredRedirect.status, 303);
  assert.match(
    filteredRedirect.headers.get('location') ?? '',
    /playQuery=composer%3A%22George\+Harrison%22/,
  );

  const filteredPlay = await fetch(
    `${main.server.baseUrl}/play/${encodeURIComponent(abbey.key)}?q=${encodeURIComponent(filteredQuery)}`,
    { redirect: 'manual', headers: { Cookie: cookie } },
  );
  assert.equal(filteredPlay.status, 303);
  assert.equal(
    main.context.playbackQueries.at(-1),
    filteredQuery,
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

test('the Audio Station fallback can be disabled independently', async () => {
  const fixture = await runFixture({ audioStationFallbackEnabled: false });
  try {
    const status = await json<{
      nativePlaybackEnabled: boolean;
      audioStationFallbackEnabled: boolean;
    }>(fixture.server.baseUrl, '/api/status');
    assert.equal(status.body.nativePlaybackEnabled, true);
    assert.equal(status.body.audioStationFallbackEnabled, false);

    const abbey = await findAlbum(fixture.server.baseUrl, 'Abbey Road');
    const response = await fetch(
      `${fixture.server.baseUrl}/play/${encodeURIComponent(abbey.key)}`,
      { redirect: 'manual' },
    );
    assert.equal(response.status, 503);
    assert.match(await response.text(), /Playback unavailable/);
  } finally {
    await closeFixture(fixture);
  }
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
    for (const path of [
      '/api/genres',
      '/api/albums',
      '/api/tracks',
      '/api/albums/any-key',
    ]) {
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
