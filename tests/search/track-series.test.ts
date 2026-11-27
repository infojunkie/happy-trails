import assert from 'node:assert/strict';
import test from 'node:test';
import type { AlbumRow, TrackIndexRow } from '../../src/server/db.js';
import { SqliteIndex } from '../../src/server/sqlite.js';

function album(title: string, artist: string, trackCount = 1): AlbumRow {
  return {
    album: title,
    artist,
    year: 2000,
    track_count: trackCount,
    duration: trackCount * 100,
    latest: '2024-01-01T00:00:00',
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
  trackSeries: string[] = [],
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
    track: id,
    disc: 1,
    duration: 100,
    date: '2024-01-01T00:00:00',
    format: 'flac',
    track_series: trackSeries,
  };
}

function buildIndex(): Promise<SqliteIndex> {
  const rows = [
    album('Album One', 'Artist A'),
    album('Album Two', 'Artist B'),
    album('Mixed Album', 'Various Artists', 2),
  ];
  const tracks = [
    track(1, 'One', 'Album One', 'Artist A', ['Covers Collection']),
    track(2, 'Two', 'Album Two', 'Artist B', ['Covers Collection']),
    track(3, 'Three', 'Mixed Album', 'Various Artists', [
      'Covers Collection',
      'Edition Series',
    ]),
    track(4, 'Four', 'Mixed Album', 'Various Artists'),
  ];
  return SqliteIndex.build(rows, tracks, 1, ':memory:', {
    seriesAllowlist: [
      { name: 'Edition Series', match: 'Album One' },
      { name: 'Edition Series', match: 'Album Two' },
    ],
  });
}

test('allowlist entries sharing a name aggregate into one album series', async () => {
  const index = await buildIndex();
  try {
    const facets = index.series();
    const edition = facets.find((serie) => serie.name === 'Edition Series');
    assert.ok(edition);
    assert.equal(edition.albumCount, 2);
    // Two album tracks plus one track-level assignment, counted once each.
    assert.equal(edition.trackCount, 3);
  } finally {
    index.close();
  }
});

test('track folder series appear only on tracks and in Tracks-mode filters', async () => {
  const index = await buildIndex();
  const albums = {
    q: '',
    sort: 'added' as const,
    order: 'desc' as const,
    seed: 0,
    offset: 0,
    limit: 100,
  };
  try {
    const covers = index
      .series()
      .find((serie) => serie.name === 'Covers Collection');
    assert.ok(covers);
    assert.equal(covers.albumCount, 0);
    assert.equal(covers.trackCount, 3);

    const matchingTracks = index.queryTracks({
      ...albums,
      q: 'serie:"Covers Collection"',
    });
    assert.deepEqual(
      matchingTracks.tracks.map((track) => track.id).sort((a, b) => a - b),
      [1, 2, 3],
    );
    assert.ok(
      matchingTracks.tracks.every((track) =>
        track.series.includes('Covers Collection'),
      ),
    );

    // The album listing never sees a track-only series.
    assert.equal(
      index.queryAlbums({ ...albums, q: 'serie:"Covers Collection"' }).total,
      0,
    );
    assert.equal(
      index.queryAlbums({ ...albums, q: 'serie:"Edition Series"' }).total,
      2,
    );

    // Bare Tracks-mode search matches the track series name too.
    assert.deepEqual(
      index
        .queryTracks({ ...albums, q: 'covers' })
        .tracks.map((track) => track.id)
        .sort((a, b) => a - b),
      [1, 2, 3],
    );
  } finally {
    index.close();
  }
});
