import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { AlbumRow } from '../../src/server/db.js';
import type { GenreFacet, TrackSummary } from '../../src/shared/types.js';
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
    sort: 'added',
    order: 'desc',
    offset: 0,
    limit: 1000,
    ...overrides,
  });
}

function albums(query = '') {
  return context.index.queryAlbums({
    q: query,
    sort: 'added',
    order: 'desc',
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

test('track rows carry their own genres and regions', () => {
  const soWhat = tracks('track:"so what"').tracks[0];
  assert.ok(soWhat);
  assert.deepEqual(soWhat.genres, ['Jazz']);
  assert.deepEqual(soWhat.regions, []);

  const filler = tracks('track:"kind of blue track 3"').tracks[0];
  assert.ok(filler);
  assert.deepEqual(filler.genres, ['Jazz']);
  assert.deepEqual(filler.regions, ['USA']);

  // Track filters use the track's own tag: So What has no USA region even
  // though another track on the same album does.
  const usa = tracks('region:usa');
  assert.ok(usa.tracks.every((track) => track.regions.includes('USA')));
  assert.ok(!usa.tracks.some((track) => track.title === 'So What'));
  assert.ok(usa.tracks.some((track) => track.title === 'Kind of Blue Track 3'));
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

test('genre and region filters use the track tags; series stays album-level', () => {
  const all = tracks().tracks;
  const expectedJazz = all.filter((track) =>
    track.genres.includes('Jazz'),
  ).length;
  assert.equal(tracks('genre:jazz').total, expectedJazz);

  // Exact keys: a prefix is not a partial genre match.
  assert.equal(tracks('genre:jaz').total, 0);

  const expectedUsa = all.filter((track) =>
    track.regions.includes('USA'),
  ).length;
  const usaTracks = tracks('region:usa');
  assert.equal(usaTracks.total, expectedUsa);
  assert.ok(usaTracks.tracks.every((track) => track.regions.includes('USA')));

  // Series is an album property: every track of Blue Train belongs to it.
  assert.equal(tracks('serie:"Blue Note"').total, 5);
});

test('track-mode region filters use the track tag, not the album tag', () => {
  const iceland = tracks('region:iceland');
  assert.ok(iceland.tracks.every((track) =>
    track.regions.includes('Iceland'),
  ));

  // Only the track with its own Iceland tag is returned from this album.
  const putumayo = iceland.tracks.filter(
    (track) => track.album === 'Putumayo - Family Gathering',
  );
  assert.deepEqual(putumayo.map((track) => track.title), [
    'Icelandic Track',
  ]);

  // Album mode still reports the album under the Iceland facet.
  assert.ok(
    albums('region:iceland').albums.some(
      (album) => album.album === 'Putumayo - Family Gathering',
    ),
  );
});

test('bare terms match track metadata, album titles, and track tags', () => {
  assert.ok(tracks('freeloader').total > 0);
  assert.equal(tracks('kind of blue').total, 5);
  assert.equal(tracks('jazz').total, tracks('genre:jazz').total);
  assert.equal(
    tracks('iceland album:"Putumayo - Family Gathering"').total,
    1,
  );
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

test('loose-track folders keep Tracks results but not Albums entries', async () => {
  const looseRows: AlbumRow[] = [
    {
      album: 'Loose Covers {Loose Series}',
      artist: 'Various Artists',
      year: 2020,
      track_count: 2,
      duration: 400,
      latest: '2025-01-01T00:00:00',
      genres: 'HiddenOnly',
      track_artists: ['Various Artists'],
      composers: [],
      comments: [],
      cover_path: '/music/loose/covers/a.flac',
      title_track: false,
      track_only: true,
    },
    {
      album: 'Mixed Album',
      artist: 'Mixed Artist',
      year: 2021,
      track_count: 1,
      duration: 200,
      latest: '2025-01-02T00:00:00',
      genres: 'MixedOnly',
      track_artists: ['Mixed Artist'],
      composers: [],
      comments: [],
      cover_path: '/music/loose/random/mixed.flac',
      title_track: false,
      track_only: true,
    },
    {
      album: 'Mixed Album',
      artist: 'Mixed Artist',
      year: 2021,
      track_count: 1,
      duration: 200,
      latest: '2025-01-02T00:00:00',
      genres: 'MixedOnly',
      track_artists: ['Mixed Artist'],
      composers: [],
      comments: [],
      cover_path: '/music/albums/mixed.flac',
      title_track: false,
      track_only: false,
    },
  ];
  const loose = await createFixtureContext({ extraRows: looseRows });
  const allQuery = {
    q: '',
    sort: 'added' as const,
    order: 'desc' as const,
    offset: 0,
    limit: 1000,
  };
  try {
    const albumNames = loose.index
      .queryAlbums(allQuery)
      .albums.map((album) => album.album);
    assert.ok(!albumNames.includes('Loose Covers {Loose Series}'));
    // A mixed album with at least one normal track stays visible.
    assert.ok(albumNames.includes('Mixed Album'));
    assert.equal(loose.index.queryAlbums({ ...allQuery, q: 'serie:"Loose Series"' }).total, 0);

    // Album-mode Play all uses the same visibility rule.
    const playAlbums = new Set(
      loose.index
        .queryAlbumTracks(allQuery)
        .tracks.map((track) => track.album),
    );
    assert.ok(!playAlbums.has('Loose Covers {Loose Series}'));
    assert.ok(playAlbums.has('Mixed Album'));

    // Tracks view still shows every track, with a working album lookup.
    const looseTracks = loose.index
      .queryTracks(allQuery)
      .tracks.filter((track) => track.album === 'Loose Covers {Loose Series}');
    assert.equal(looseTracks.length, 2);
    const looseKey = looseTracks[0]?.albumKey;
    assert.ok(looseKey);
    assert.equal(
      loose.index.albumForKey(looseKey)?.album,
      'Loose Covers {Loose Series}',
    );

    // Facet album counts ignore hidden albums; track counts do not.
    const counts = (facets: GenreFacet[], name: string) => {
      const facet = facets.find((item) => item.name === name);
      return facet
        ? { albumCount: facet.albumCount, trackCount: facet.trackCount }
        : null;
    };
    assert.deepEqual(counts(loose.index.genres(), 'HiddenOnly'), {
      albumCount: 0,
      trackCount: 2,
    });
    assert.deepEqual(counts(loose.index.genres(), 'MixedOnly'), {
      albumCount: 1,
      trackCount: 2,
    });
    assert.deepEqual(counts(loose.index.series(), 'Loose Series'), {
      albumCount: 0,
      trackCount: 2,
    });

    // Track counts equal what the corresponding Tracks filter returns.
    for (const facet of loose.index.genres()) {
      assert.equal(
        facet.trackCount,
        loose.index.queryTracks({
          ...allQuery,
          q: `genre:"${facet.name}"`,
        }).total,
        `genre ${facet.name}`,
      );
    }
    for (const facet of loose.index.regions()) {
      assert.equal(
        facet.trackCount,
        loose.index.queryTracks({
          ...allQuery,
          q: `region:"${facet.name}"`,
        }).total,
        `region ${facet.name}`,
      );
    }
    for (const facet of loose.index.series()) {
      assert.equal(
        facet.trackCount,
        loose.index.queryTracks({
          ...allQuery,
          q: `serie:"${facet.name}"`,
        }).total,
        `serie ${facet.name}`,
      );
    }
  } finally {
    loose.close();
  }
});

test('track sort fields and orders apply with missing years last', () => {
  const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
  const assertYears = (years: Array<number | null>, direction: 1 | -1) => {
    const known = years.filter((year): year is number => year !== null);
    assert.deepEqual(
      known,
      [...known].sort((a, b) => direction * (a - b)),
    );
    let seenNull = false;
    for (const year of years) {
      if (year === null) seenNull = true;
      else assert.ok(!seenNull, 'missing years must be last');
    }
  };

  const oldest = tracks('', { sort: 'released', order: 'asc', limit: 1000 });
  assertYears(oldest.tracks.map((track) => track.year), 1);
  const newest = tracks('', { sort: 'released', order: 'desc', limit: 1000 });
  assertYears(newest.tracks.map((track) => track.year), -1);

  const artistDesc = tracks('', { sort: 'artist', order: 'desc', limit: 1000 });
  for (let index = 1; index < artistDesc.tracks.length; index += 1) {
    const previous = artistDesc.tracks[index - 1];
    const current = artistDesc.tracks[index];
    assert.ok(previous);
    assert.ok(current);
    assert.ok(collator.compare(previous.artist, current.artist) >= 0);
  }
});
