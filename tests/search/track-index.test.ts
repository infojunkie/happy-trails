import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { TrackSummary } from '../../src/shared/types.js';
import { createFixtureContext, type FixtureContext } from '../fixtures/library.js';

let context: FixtureContext;

before(async () => {
  context = await createFixtureContext();
});

after(() => {
  context.close();
});

function tracks(query = '', overrides: Record<string, unknown> = {}) {
  return context.index.queryTracks({
    q: query,
    sort: 'recent',
    offset: 0,
    limit: 1000,
    ...overrides,
  });
}

function albums(query = '') {
  return context.index.queryAlbums({
    q: query,
    sort: 'recent',
    offset: 0,
    limit: 1000,
  });
}

function titles(result: TrackSummary[]): string[] {
  return result.map((track) => track.title);
}

test('every album track is indexed', () => {
  const allTracks = tracks();
  const albumTrackTotal = albums().albums.reduce(
    (sum, album) => sum + album.trackCount,
    0,
  );

  assert.equal(allTracks.total, albumTrackTotal);
  assert.equal(allTracks.tracks.length, albumTrackTotal);
  assert.equal(context.index.trackCount, albumTrackTotal);
});

test('track rows carry album identity and display metadata', () => {
  const result = tracks('track:"so what"');
  assert.equal(result.total, 1);

  const track = result.tracks[0];
  assert.ok(track);
  assert.equal(track.title, 'So What');
  assert.equal(track.artist, 'Miles Davis');
  assert.deepEqual(track.artists, ['Miles Davis']);
  assert.equal(track.albumArtist, 'Miles Davis');
  assert.equal(track.album, 'Kind of Blue');
  assert.equal(track.sourceAlbum, 'Kind of Blue');
  assert.equal(track.duration, 200);
  assert.ok(track.genres.includes('Jazz'));
  assert.ok(track.albumKey.length > 0);

  const album = albums('album:"kind of blue"').albums[0];
  assert.ok(album);
  assert.equal(track.albumKey, album.key);
});

test('fielded track search targets the right per-track field', () => {
  assert.deepEqual(titles(tracks('track:"guitar"').tracks), [
    'While My Guitar Gently Weeps',
  ]);

  // Track artist and album artist both count for `artist:`.
  assert.ok(tracks('artist:clapton').total > 0);
  assert.ok(tracks('artist:"joão gilberto"').total > 0);

  assert.deepEqual(titles(tracks('source:"bonus tracks"').tracks), [
    'Come Together (Take 1)',
    'Abbey Road // Bonus Tracks Track 2',
    'Abbey Road // Bonus Tracks Track 3',
  ]);

  assert.equal(
    tracks('album:"kind of blue"').total,
    albums('album:"kind of blue"').albums[0]?.trackCount,
  );
  assert.ok(tracks('composer:monk').total > 0);
});

test('genre, region, and series filters use the album mapping tables', () => {
  const jazzTracks = tracks('genre:jazz');
  const jazzAlbums = albums('genre:jazz');
  const expectedJazz = jazzAlbums.albums.reduce(
    (sum, album) => sum + album.trackCount,
    0,
  );
  assert.equal(jazzTracks.total, expectedJazz);

  // Exact keys: a prefix is not a partial genre match.
  assert.equal(tracks('genre:jaz').total, 0);

  const usaTracks = tracks('region:usa');
  const usaAlbums = albums('region:usa');
  assert.equal(
    usaTracks.total,
    usaAlbums.albums.reduce((sum, album) => sum + album.trackCount, 0),
  );

  assert.equal(tracks('serie:"Blue Note"').total, 5);
});

test('bare terms match track metadata, album titles, and album tags', () => {
  assert.ok(tracks('freeloader').total > 0);
  assert.equal(tracks('kind of blue').total, 5);
  assert.equal(tracks('jazz').total, tracks('genre:jazz').total);
});

test('track search composes boolean expressions', () => {
  const combined = tracks('composer:lennon AND track:"come together"');
  assert.deepEqual(titles(combined.tracks).sort(), [
    'Come Together',
    'Come Together (Take 1)',
  ]);

  const either = tracks('track:"maxwell" OR track:"something"');
  assert.deepEqual(titles(either.tracks).sort(), [
    "Maxwell's Silver Hammer",
    'Something',
  ]);
});

test('short phrases fall back to substring scans', () => {
  const short = tracks('track:"so"');
  assert.ok(short.total > 0);
  assert.ok(titles(short.tracks).includes('So What'));
});

test('pagination and sorting are stable slices of the full result', () => {
  const all = tracks();
  const first = tracks('', { limit: 7, offset: 0 });
  const second = tracks('', { limit: 7, offset: 7 });

  assert.equal(first.total, all.total);
  assert.deepEqual(
    [...first.tracks, ...second.tracks].map((track) => track.id),
    all.tracks.slice(0, 14).map((track) => track.id),
  );

  const abbey = albums('album:"abbey road"').albums.find(
    (album) => album.album === 'Abbey Road',
  );
  assert.ok(abbey);
  const byAlbum = tracks('', { sort: 'album', limit: 1000 }).tracks.filter(
    (track) => track.albumKey === abbey.key,
  );
  const keys = byAlbum.map(
    (track) => [track.disc ?? 0, track.track ?? 0, track.id] as const,
  );
  const sorted = [...keys].sort(
    (left, right) =>
      left[0] - right[0] || left[1] - right[1] || left[2] - right[2],
  );
  assert.deepEqual(keys, sorted);
});

test('folder search folds accents in track fields', () => {
  assert.ok(tracks('artist:bjork').total > 0);
  assert.ok(tracks('artist:"soren lee"').total > 0);
  assert.ok(tracks('track:"maxwell\'s silver hammer"').total > 0);
});

test('album-key lookup returns the same summary as the album listing', () => {
  const album = albums('album:"kind of blue"').albums[0];
  assert.ok(album);
  assert.deepEqual(context.index.albumForKey(album.key), album);
  assert.equal(context.index.albumForKey('not-a-key'), null);
});

test('track: in album mode finds albums containing a matching track', () => {
  const result = albums('track:"freddie freeloader"');
  assert.equal(result.total, 1);
  assert.equal(result.albums[0]?.album, 'Kind of Blue');

  // A two-character phrase uses the instr fallback.
  assert.ok(albums('track:"so"').total > 0);
});

test('tracks and albums agree on merged-album track counts', () => {
  const abbey = albums('album:"abbey road"').albums.find(
    (album) => album.album === 'Abbey Road',
  );
  assert.ok(abbey);

  const abbeyTracks = tracks().tracks.filter(
    (track) => track.albumKey === abbey.key,
  );
  assert.equal(abbeyTracks.length, abbey.trackCount);
  assert.ok(abbeyTracks.some((track) => track.title === 'Come Together (Take 1)'));
});
