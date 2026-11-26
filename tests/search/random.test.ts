import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { createFixtureContext, type FixtureContext } from '../fixtures/library.js';

let context: FixtureContext;

before(async () => {
  context = await createFixtureContext();
});

after(() => {
  context.close();
});

const randomQuery = {
  q: '',
  sort: 'random' as const,
  order: 'desc' as const,
  seed: 12_345,
  offset: 0,
  limit: 1000,
};

test('random album order is stable across pages and seeds', () => {
  const full = context.index
    .queryAlbums(randomQuery)
    .albums.map((album) => album.key);
  const first = context.index
    .queryAlbums({ ...randomQuery, limit: 7 })
    .albums.map((album) => album.key);
  const second = context.index
    .queryAlbums({ ...randomQuery, offset: 7, limit: 7 })
    .albums.map((album) => album.key);

  assert.deepEqual([...first, ...second], full.slice(0, 14));
  assert.deepEqual(
    context.index.queryAlbums(randomQuery).albums.map((album) => album.key),
    full,
  );
  // Direction is irrelevant for a seeded shuffle.
  assert.deepEqual(
    context.index
      .queryAlbums({ ...randomQuery, order: 'asc' })
      .albums.map((album) => album.key),
    full,
  );
});

test('a different seed reshuffles the same result set', () => {
  const one = context.index
    .queryAlbums({ ...randomQuery, seed: 1 })
    .albums.map((album) => album.key);
  const two = context.index
    .queryAlbums({ ...randomQuery, seed: 2 })
    .albums.map((album) => album.key);

  assert.notDeepEqual(one, two);
  assert.deepEqual([...one].sort(), [...two].sort());
});

test('random track pages are stable and album playback follows the album shuffle', () => {
  const full = context.index
    .queryTracks(randomQuery)
    .tracks.map((track) => track.id);
  const first = context.index
    .queryTracks({ ...randomQuery, limit: 10 })
    .tracks.map((track) => track.id);
  const second = context.index
    .queryTracks({ ...randomQuery, offset: 10, limit: 10 })
    .tracks.map((track) => track.id);

  assert.deepEqual(first, full.slice(0, 10));
  assert.deepEqual(second, full.slice(10, 20));
  assert.equal(new Set([...first, ...second]).size, first.length + second.length);

  const albums = context.index
    .queryAlbums(randomQuery)
    .albums.map((album) => album.key);
  const playback = context.index.queryAlbumTracks(randomQuery).tracks;
  const seen: string[] = [];
  for (const track of playback) {
    if (seen.at(-1) !== track.albumKey) seen.push(track.albumKey);
  }
  assert.deepEqual(seen, albums);
  assert.deepEqual(
    playback.map((track) => track.id).sort((a, b) => a - b),
    [...full].sort((a, b) => a - b),
  );
});
