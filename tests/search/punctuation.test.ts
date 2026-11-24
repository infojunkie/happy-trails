import assert from 'node:assert/strict';
import test from 'node:test';
import type { AlbumRow, TrackIndexRow } from '../../src/server/db.js';
import { SqliteIndex } from '../../src/server/sqlite.js';

function album(
  title: string,
  artist: string,
  trackCount = 1,
  latest = '2024-01-01T00:00:00',
): AlbumRow {
  return {
    album: title,
    artist,
    year: 2000,
    track_count: trackCount,
    duration: trackCount * 100,
    latest,
    genres: null,
    track_artists: [artist],
    composers: [],
    comments: [],
    cover_path: '',
    title_track: false,
  };
}

function track(
  id: number,
  title: string,
  sourceAlbum: string,
  artist: string,
  trackNumber: number,
): TrackIndexRow {
  return {
    id,
    title,
    artist,
    album_artist: artist,
    source_album: sourceAlbum,
    composer: null,
    genre: null,
    year: 2000,
    track: trackNumber,
    disc: 1,
    duration: 100,
    date: '2024-01-01T00:00:00',
    format: 'flac',
  };
}

async function buildIndex(): Promise<SqliteIndex> {
  const rows = [
    album('-M-', 'M'),
    album('M', 'M'),
    album('N', 'N'),
    album('Zed', '-M-'),
    album('Singles', 'Therapy', 2),
  ];
  const tracks = [
    track(1, 'Track A', '-M-', 'M', 1),
    track(2, 'Track B', 'M', 'M', 1),
    track(3, 'Track C', 'N', 'N', 1),
    track(4, 'Track D', 'Zed', '-M-', 1),
    track(5, 'Therapy?', 'Singles', 'Therapy', 1),
    track(6, 'Therapy', 'Singles', 'Therapy', 2),
  ];
  return SqliteIndex.build(rows, tracks, 1);
}

test('punctuation is ignored for search but entries stay separate', async () => {
  const index = await buildIndex();
  const list = {
    q: '',
    sort: 'added' as const,
    order: 'desc' as const,
    offset: 0,
    limit: 100,
  };
  try {
    const byPunctuation = index.queryAlbums({ ...list, q: 'album:"-M-"' });
    const byPlain = index.queryAlbums({ ...list, q: 'album:"M"' });
    const expected = ['-M-', 'M'];
    assert.deepEqual(
      byPunctuation.albums.map((entry) => entry.album).sort(),
      expected,
    );
    assert.deepEqual(
      byPlain.albums.map((entry) => entry.album).sort(),
      expected,
    );
    // 1A: matching is punctuation-insensitive, but the two entries remain.
    assert.equal(
      index
        .queryAlbums(list)
        .albums.filter((entry) => expected.includes(entry.album)).length,
      2,
    );

    const titles = (q: string) =>
      index
        .queryTracks({ ...list, q })
        .tracks.map((entry) => entry.title)
        .sort();
    assert.deepEqual(titles('track:"Therapy?"'), ['Therapy', 'Therapy?']);
    assert.deepEqual(titles('track:"Therapy"'), ['Therapy', 'Therapy?']);
  } finally {
    index.close();
  }
});

test('punctuation is ignored when sorting album and artist names', async () => {
  const index = await buildIndex();
  const list = {
    q: '',
    offset: 0,
    limit: 100,
  };
  try {
    const ascending = index
      .queryAlbums({ ...list, sort: 'album', order: 'asc' })
      .albums.map((entry) => entry.album);
    const firstM = ascending.indexOf('-M-');
    const plainM = ascending.indexOf('M');
    assert.ok(firstM >= 0 && plainM >= 0);
    assert.equal(Math.abs(firstM - plainM), 1, 'M variants sort together');
    assert.ok(firstM < ascending.indexOf('N'));
    assert.ok(plainM < ascending.indexOf('N'));

    const descending = index
      .queryAlbums({ ...list, sort: 'album', order: 'desc' })
      .albums.map((entry) => entry.album);
    assert.ok(descending.indexOf('Zed') < descending.indexOf('N'));
    assert.ok(descending.indexOf('N') < descending.indexOf('-M-'));
    assert.ok(descending.indexOf('N') < descending.indexOf('M'));

    const byArtist = index
      .queryAlbums({ ...list, sort: 'artist', order: 'asc' })
      .albums;
    const nPosition = byArtist.findIndex((entry) => entry.artist === 'N');
    const mPositions = byArtist
      .map((entry, position) =>
        entry.artist === 'M' || entry.artist === '-M-' ? position : -1,
      )
      .filter((position) => position >= 0);
    assert.ok(nPosition >= 0);
    assert.ok(mPositions.every((position) => position < nPosition));

    const trackArtists = index
      .queryTracks({ ...list, sort: 'artist', order: 'asc' })
      .tracks.map((entry) => entry.artist);
    const trackN = trackArtists.indexOf('N');
    const trackM = trackArtists
      .map((artist, position) =>
        artist === 'M' || artist === '-M-' ? position : -1,
      )
      .filter((position) => position >= 0);
    assert.ok(trackN >= 0);
    assert.ok(trackM.every((position) => position < trackN));
  } finally {
    index.close();
  }
});
