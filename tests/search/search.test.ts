import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { AlbumRow } from '../../src/server/db.js';
import {
  detectPlainSeries,
  embeddedSeries,
  normalizeSeriesVolumes,
  type SeriesAlbum,
} from '../../src/server/search.js';
import { parseSearchQuery } from '../../src/server/searchQuery.js';
import type { AlbumsQuery } from '../../src/server/sqlite.js';
import type { AlbumSummary } from '../../src/shared/types.js';
import { createFixtureContext, type FixtureContext } from '../fixtures/library.js';

let context: FixtureContext;

before(async () => {
  context = await createFixtureContext();
});

after(() => {
  context.close();
});

function query(overrides: Partial<AlbumsQuery> = {}) {
  return context.index.queryAlbums({
    q: '',
    sort: 'recent',
    offset: 0,
    limit: 1000,
    ...overrides,
  });
}

function keys(albums: AlbumSummary[]): string[] {
  return albums.map((album) => album.key).sort();
}

function names(albums: AlbumSummary[]): string[] {
  return albums.map((album) => album.album);
}

function union(left: string[], right: string[]): string[] {
  return [...new Set([...left, ...right])].sort();
}

function intersection(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value)).sort();
}

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

test('parser understands fielded terms, phrases, operators, and parentheses', () => {
  assert.deepEqual(parseSearchQuery('album:"abbey road"'), {
    kind: 'term',
    field: 'album',
    value: 'abbey road',
    quoted: true,
  });
  assert.deepEqual(parseSearchQuery('artist:beatles artist:stones'), {
    kind: 'and',
    left: {
      kind: 'term',
      field: 'artist',
      value: 'beatles',
      quoted: false,
    },
    right: {
      kind: 'term',
      field: 'artist',
      value: 'stones',
      quoted: false,
    },
  });
  assert.equal(parseSearchQuery('album:road OR artist:beatles')?.kind, 'or');
  assert.equal(
    parseSearchQuery('(album:road OR album:street) artist:beatles')?.kind,
    'and',
  );
  assert.deepEqual(parseSearchQuery('abbey road'), {
    kind: 'term',
    field: 'all',
    value: 'abbey road',
    quoted: true,
  });
  assert.equal(parseSearchQuery('abbey AND road')?.kind, 'and');
  assert.deepEqual(parseSearchQuery('composers:jobim'), {
    kind: 'term',
    field: 'composer',
    value: 'jobim',
    quoted: false,
  });
  assert.deepEqual(parseSearchQuery('serie:"rock candy"'), {
    kind: 'term',
    field: 'serie',
    value: 'rock candy',
    quoted: true,
  });
  assert.deepEqual(parseSearchQuery('label:blue'), {
    kind: 'term',
    field: 'serie',
    value: 'blue',
    quoted: false,
  });
  assert.deepEqual(parseSearchQuery('genre:jazz'), {
    kind: 'term',
    field: 'genre',
    value: 'jazz',
    quoted: false,
  });
  assert.deepEqual(parseSearchQuery('region:brazil'), {
    kind: 'term',
    field: 'region',
    value: 'brazil',
    quoted: false,
  });
  assert.deepEqual(parseSearchQuery('foo:bar'), {
    kind: 'term',
    field: 'all',
    value: 'foo:bar',
    quoted: true,
  });
  assert.deepEqual(parseSearchQuery('all:abbey'), {
    kind: 'term',
    field: 'all',
    value: 'abbey',
    quoted: true,
  });
  assert.deepEqual(parseSearchQuery('all:abbey road'), {
    kind: 'term',
    field: 'all',
    value: 'abbey road',
    quoted: true,
  });
  assert.equal(parseSearchQuery('album:'), null);
  assert.equal(parseSearchQuery('album:road OR (artist:beatles'), null);
});

test('bare terms search all indexed fields', () => {
  const abbey = query({ q: 'abbey' });
  assert.ok(abbey.total > 0);
  assert.ok(names(abbey.albums).includes('Abbey Road'));
  assert.ok(names(abbey.albums).includes('Live at Abbey Road'));

  const beatles = query({ q: 'beatles' });
  assert.ok(beatles.total > 0);
  for (const album of beatles.albums) {
    assert.match(album.artist.toLowerCase(), /beatles/);
  }

  assert.deepEqual(
    keys(query({ q: 'abbey' }).albums),
    keys(query({ q: 'all:abbey' }).albums),
  );
  assert.deepEqual(
    keys(query({ q: 'jobim' }).albums),
    keys(query({ q: 'composer:jobim' }).albums),
  );
});

test('fielded terms target only their fields', () => {
  const album = query({ q: 'album:"abbey road"' });
  assert.ok(album.total > 0);
  for (const entry of album.albums) {
    assert.match(entry.album.toLowerCase(), /abbey road/);
  }

  const source = query({ q: 'source:"bonus tracks"' });
  assert.ok(source.total > 0);
  assert.ok(names(source.albums).includes('Abbey Road'));

  const artist = query({ q: 'artist:beatles' });
  assert.ok(artist.total > 0);
  for (const entry of artist.albums) {
    assert.match(entry.artist.toLowerCase(), /beatles/);
  }

  const composer = query({ q: 'composer:jobim' });
  assert.ok(composer.total > 0);
  assert.ok(names(composer.albums).includes('Getz/Gilberto'));

  const trackedArtist = query({ q: 'artist:coltrane' });
  assert.ok(trackedArtist.total > 0);
  assert.ok(names(trackedArtist.albums).includes('Kind of Blue'));
});

test('plain keyword lists are phrases; explicit AND stays independent', () => {
  const quoted = query({ q: '"abbey road"' });
  const keywords = query({ q: 'abbey road' });
  const independent = query({ q: 'abbey AND road' });

  assert.ok(keywords.total > 0);
  assert.deepEqual(keys(keywords.albums), keys(quoted.albums));
  assert.ok(independent.total >= keywords.total);
  assert.equal(query({ q: 'album:"abbey tracks"' }).albums.length, 0);

  const short = query({ q: 'album:"ab"' });
  assert.ok(short.total > 0);
  for (const entry of short.albums) {
    assert.match(entry.album.toLowerCase(), /ab/);
  }
});

test('AND, OR, implicit AND, and parentheses compose as sets', () => {
  const albumRoad = query({ q: 'album:road' });
  const artistBeatles = query({ q: 'artist:beatles' });
  const artistMiles = query({ q: 'artist:miles' });
  const roadOrBeatles = query({ q: 'album:road OR artist:beatles' });
  const both = query({ q: 'album:road artist:beatles' });
  const parenthesized = query({
    q: '(album:road OR album:street) artist:beatles',
  });

  assert.deepEqual(
    keys(roadOrBeatles.albums),
    union(keys(albumRoad.albums), keys(artistBeatles.albums)),
  );
  assert.deepEqual(
    keys(both.albums),
    intersection(keys(albumRoad.albums), keys(artistBeatles.albums)),
  );
  assert.deepEqual(
    keys(parenthesized.albums),
    intersection(keys(albumRoad.albums), keys(artistBeatles.albums)),
  );
  assert.deepEqual(
    keys(query({ q: 'artist:beatles OR artist:miles' }).albums),
    union(keys(artistBeatles.albums), keys(artistMiles.albums)),
  );
});

test('search folding is accent-insensitive', () => {
  assert.deepEqual(
    keys(query({ q: 'artist:bjork' }).albums),
    keys(query({ q: 'artist:"Björk"' }).albums),
  );
  assert.deepEqual(
    keys(query({ q: 'artist:"Joao Gilberto"' }).albums),
    keys(query({ q: 'artist:"João Gilberto"' }).albums),
  );
  assert.deepEqual(
    keys(query({ q: 'composer:"Soren Lee"' }).albums),
    keys(query({ q: 'composer:"Søren Lee"' }).albums),
  );
  assert.deepEqual(
    keys(query({ q: 'artist:"Michal Urbaniak"' }).albums),
    keys(query({ q: 'artist:"Michał Urbaniak"' }).albums),
  );
});

test('unknown fields are text and missing terms produce no matches', () => {
  assert.equal(query({ q: 'foo:bar' }).albums.length, 0);
  assert.equal(query({ q: 'composer:does-not-exist' }).albums.length, 0);
});

test('genre and region search terms target tag fields', () => {
  const rock = query({ q: 'genre:rock' });
  assert.ok(rock.total > 0);
  for (const album of rock.albums) {
    assert.ok(
      album.genres.some((genre) => genre.toLowerCase() === 'rock'),
    );
  }

  const brazil = query({ q: 'region:brazil' });
  assert.ok(brazil.total > 0);
  for (const album of brazil.albums) {
    assert.ok(
      album.regions.some((region) => region.toLowerCase() === 'brazil'),
    );
  }

  const jazzBrazil = query({ q: 'genre:jazz region:brazil' });
  assert.ok(jazzBrazil.total > 0);
  for (const album of jazzBrazil.albums) {
    assert.ok(album.genres.includes('Jazz'));
    assert.ok(album.regions.includes('Brazil'));
  }

  // Tag fields are exact, unlike the substring fields.
  assert.equal(query({ q: 'genre:jaz' }).total, 0);
  assert.ok(query({ q: 'genre:"Bossa Nova"' }).total > 0);

  assert.deepEqual(
    keys(query({ q: 'genre:jazz OR genre:folk' }).albums),
    union(
      keys(query({ q: 'genre:jazz' }).albums),
      keys(query({ q: 'genre:folk' }).albums),
    ),
  );
});

test('genre and region search terms compose as union and intersection', () => {
  const jazz = query({ q: 'genre:"Jazz"' });
  const folk = query({ q: 'genre:"Folk"' });
  assert.deepEqual(
    keys(query({ q: 'genre:"Jazz" OR genre:"Folk"' }).albums),
    union(keys(jazz.albums), keys(folk.albums)),
  );
  assert.deepEqual(
    keys(query({ q: 'genre:"Jazz" AND genre:"Folk"' }).albums),
    intersection(keys(jazz.albums), keys(folk.albums)),
  );
  for (const album of query({ q: 'genre:"Jazz" AND genre:"Folk"' }).albums) {
    assert.ok(album.genres.includes('Jazz'));
    assert.ok(album.genres.includes('Folk'));
  }

  const spain = query({ q: 'region:"Spain"' });
  const catalonia = query({ q: 'region:"Catalonia"' });
  assert.ok(spain.total > 0);
  assert.ok(catalonia.total > 0);
  assert.deepEqual(
    keys(query({ q: 'region:"Spain" OR region:"Catalonia"' }).albums),
    union(keys(spain.albums), keys(catalonia.albums)),
  );
  assert.deepEqual(
    keys(query({ q: 'region:"Spain" AND region:"Catalonia"' }).albums),
    intersection(keys(spain.albums), keys(catalonia.albums)),
  );
});

test('search syntax combines with genre and region tags as set intersections', () => {
  const composer = query({ q: 'composer:toumani' });
  const spain = query({ q: 'region:"Spain"' });
  const combined = query({ q: 'composer:toumani region:"Spain"' });
  assert.deepEqual(
    keys(combined.albums),
    intersection(keys(composer.albums), keys(spain.albums)),
  );

  const album = query({ q: 'album:abbey' });
  const rock = query({ q: 'genre:"Rock"' });
  const both = query({ q: 'album:abbey genre:"Rock"' });
  assert.deepEqual(
    keys(both.albums),
    intersection(keys(album.albums), keys(rock.albums)),
  );
});

test('genre and region facets exclude and separate location tags', () => {
  const genres = context.index.genres();
  const regions = context.index.regions();
  assert.ok(genres.some((genre) => genre.name === 'Rock'));
  assert.ok(!genres.some((genre) => genre.name === 'Brazil'));
  assert.ok(regions.some((region) => region.name === 'Brazil'));
  assert.ok(regions.some((region) => region.name === 'Corsica'));
  assert.ok(regions.some((region) => region.name === 'Catalonia'));
  assert.ok(regions.every((region) => region.albumCount > 0));
});

test('embedded series parsing extracts braces and year-Edition brackets', () => {
  assert.deepEqual(embeddedSeries('Dark Magus {Legacy}'), ['Legacy']);
  assert.deepEqual(embeddedSeries('A Love Supreme [2016 Rock Candy Edition]'), [
    'Rock Candy',
  ]);
  assert.deepEqual(embeddedSeries('X [2016 rock candy EDITION]'), [
    'rock candy',
  ]);
  assert.deepEqual(embeddedSeries('X [Japan Edition] [2015 Remastered]'), []);
  assert.deepEqual(embeddedSeries('X [2016 Edition]'), []);
  assert.deepEqual(embeddedSeries('X [2016 Rock Candy Editions]'), []);
  assert.deepEqual(embeddedSeries('X { A   B }'), ['A B']);
  assert.deepEqual(embeddedSeries('X {A} {A}'), ['A']);
  // A bracket group does not consume text from a different group.
  assert.deepEqual(
    embeddedSeries('X [2016 Remaster] [2017 Deluxe Edition]'),
    ['Deluxe'],
  );
  // Values appear in title order, across both forms.
  assert.deepEqual(
    embeddedSeries('X {A} [2017 30th Anniversary Deluxe Edition] {B}'),
    ['A', '30th Anniversary Deluxe', 'B'],
  );
});

function seriesAlbum(
  album: string,
  artist: string,
  overrides: Partial<SeriesAlbum> = {},
): SeriesAlbum {
  return {
    key: `${album}\u0000${artist}`,
    album,
    artist,
    trackCount: 12,
    titleTrack: false,
    ...overrides,
  };
}

test('embedded series volume suffixes fold only for recurring stems', () => {
  const normalized = normalizeSeriesVolumes([
    'Network Medien / World Network 1',
    'Network Medien / World Network 38',
    'Club Top 13',
    '2 em 1',
    'Ocora',
  ]);

  assert.equal(
    normalized.get('Network Medien / World Network 38'),
    'Network Medien / World Network',
  );
  assert.equal(normalized.get('Club Top 13'), 'Club Top 13');
  assert.equal(normalized.get('2 em 1'), '2 em 1');
  assert.equal(normalized.get('Ocora'), 'Ocora');
});

test('plain-title series detection uses recurring titles and prefixes', () => {
  const artists = ['A', 'B', 'C', 'D', 'E'];
  const volumes = ['01', '02', '03', '04', '05'];
  const detected = detectPlainSeries([
    ...artists.map((artist) => seriesAlbum('Sem Limite', artist)),
    ...artists.map((artist) => seriesAlbum(`A Arte de ${artist}`, artist)),
    ...volumes.map((volume) =>
      seriesAlbum(`The Wire Tapper ${volume}`, 'Various Artists'),
    ),
    ...artists.map((artist) => seriesAlbum('Série Bis', artist)),
    ...artists.map((artist) =>
      seriesAlbum('Une Autre Série [2008 Edition]', artist),
    ),
  ]);

  assert.equal(detected.get('Sem Limite\u0000A'), 'Sem Limite');
  assert.equal(detected.get('A Arte de A\u0000A'), 'A Arte de');
  assert.equal(
    detected.get('The Wire Tapper 01\u0000Various Artists'),
    'The Wire Tapper',
  );
  assert.equal(detected.get('Série Bis\u0000A'), 'Série Bis');
  assert.equal(
    detected.get('Une Autre Série [2008 Edition]\u0000A'),
    'Une Autre Série',
  );

  // Four albums are below the recurrence threshold.
  assert.equal(
    detectPlainSeries(
      artists
        .slice(0, 4)
        .map((artist) => seriesAlbum('Sem Limite', artist)),
    ).size,
    0,
  );
});

test('embedded series honors the exception list', () => {
  assert.deepEqual(embeddedSeries('X [2016 Legacy Edition]', ['Legacy']), []);
  assert.deepEqual(
    embeddedSeries('X [2016 Collectors Edition]', ["Collector's"]),
    [],
  );
  assert.deepEqual(
    embeddedSeries('X [2016 Legacy Edition] {ACT}', ['Legacy']),
    ['ACT'],
  );
  // Exceptions match any part of the series name, not only the whole value.
  assert.deepEqual(
    embeddedSeries('X {Sony Legacy Recordings}', ['Legacy']),
    [],
  );
  assert.deepEqual(embeddedSeries('X {Live in Japan}', ['Japan']), []);
});

test('plain-title detection normalizes dashes, colons, and parentheses', () => {
  const artists = ['A', 'B', 'C', 'D', 'E'];
  const detected = detectPlainSeries([
    ...artists.map((name) =>
      seriesAlbum(`Putumayo - ${name}`, 'Various Artists'),
    ),
    ...['1', '2', '3', '4', '5'].map((volume, index) =>
      seriesAlbum(`Jazz Is Dead ${volume}: ${artists[index]}`, 'Various Artists'),
    ),
    ...artists.map((name) =>
      seriesAlbum(`Une Série (Live) - ${name}`, name),
    ),
  ]);

  assert.equal(
    detected.get('Putumayo - A\u0000Various Artists'),
    'Putumayo',
  );
  assert.equal(
    detected.get('Jazz Is Dead 1: A\u0000Various Artists'),
    'Jazz Is Dead',
  );
  assert.equal(detected.get('Une Série (Live) - A\u0000A'), 'Une Série');

  // A one-word title without a dash/colon suffix cannot become a series.
  assert.equal(
    detectPlainSeries(
      artists.map((artist) => seriesAlbum('Putumayo', artist)),
    ).size,
    0,
  );
});

test('series allowlist admits named one-word titles with the usual safeguards', () => {
  const artists = ['A', 'B', 'C', 'D', 'E'];
  const albums = artists.map((artist) => seriesAlbum('Millennium', artist));

  assert.equal(detectPlainSeries(albums).size, 0);

  const detected = detectPlainSeries(albums, [], ['millennium']);
  for (const artist of artists) {
    assert.equal(detected.get(`Millennium\u0000${artist}`), 'Millennium');
  }

  // The regular safeguards still apply.
  assert.equal(
    detectPlainSeries(albums.slice(0, 4), [], ['Millennium']).size,
    0,
  );
  assert.equal(
    detectPlainSeries(
      artists.map((artist) => seriesAlbum('Live', artist)),
      [],
      ['Live'],
    ).size,
    0,
  );
  assert.equal(
    detectPlainSeries(
      artists.map((artist) =>
        seriesAlbum('Millennium', artist, { titleTrack: true }),
      ),
      [],
      ['Millennium'],
    ).size,
    0,
  );
});

test('plain-title detection accepts apostrophe-prefixed volume numbers', () => {
  const years = ['71', '72', '73', '74', '75'];
  const detected = detectPlainSeries(
    years.map((year) =>
      seriesAlbum(`NOW Yearbook '${year}`, 'Various Artists'),
    ),
  );

  for (const year of years) {
    assert.equal(
      detected.get(`NOW Yearbook '${year}\u0000Various Artists`),
      'NOW Yearbook',
    );
  }
});

test('plain-title detection compares whole titles longer than six words', () => {
  const title = "Now That's What I Call An Era";
  const artists = ['A', 'B', 'C', 'D', 'E'];
  const detected = detectPlainSeries(
    artists.map((artist) => seriesAlbum(`${title} (${artist})`, artist)),
  );

  for (const artist of artists) {
    assert.equal(detected.get(`${title} (${artist})\u0000${artist}`), title);
  }
});

test('plain-title detection handles year/volume suffixes and non-generic titles', () => {
  const detected = detectPlainSeries(
    ['1', '2', '3', '4', '5'].map((volume) =>
      seriesAlbum(
        `Mr Music Hits 1989 Vol. ${volume}`,
        'Various Artists',
        { trackCount: 14 },
      ),
    ),
  );
  assert.equal(
    detected.get('Mr Music Hits 1989 Vol. 1\u0000Various Artists'),
    'Mr Music Hits',
  );
});

test('plain-title detection ignores exact titles that are artist names', () => {
  const albums = [
    seriesAlbum('The Beatles', 'The Beatles'),
    ...['A', 'B', 'C', 'D'].map((artist) =>
      seriesAlbum('The Beatles', artist),
    ),
  ];
  assert.equal(detectPlainSeries(albums).size, 0);
});

test('plain-title detection honors the exception list', () => {
  const artists = ['A', 'B', 'C', 'D', 'E'];

  const legacy = artists.map((artist) =>
    seriesAlbum(`Legacy - ${artist}`, 'Various Artists'),
  );
  assert.equal(detectPlainSeries(legacy, ['Legacy']).size, 0);

  // Exceptions ignore apostrophes: "Collector's" covers "Collectors".
  const collectors = artists.map((artist) =>
    seriesAlbum(`Collectors - ${artist}`, 'Various Artists'),
  );
  assert.equal(detectPlainSeries(collectors, ["Collector's"]).size, 0);

  // Exceptions also match inside a detected series name.
  const japan = artists.map((artist) =>
    seriesAlbum(`Live in Japan - ${artist}`, 'Various Artists'),
  );
  assert.ok(detectPlainSeries(japan).size > 0);
  assert.equal(detectPlainSeries(japan, ['Japan']).size, 0);
});

test('plain-title detection skips covers, generic titles, and extracts', () => {
  const artists = ['A', 'B', 'C', 'D', 'E'];
  const detected = detectPlainSeries([
    // Cover/single titled after one of its tracks.
    ...artists.map((artist) =>
      seriesAlbum('Let It Be', artist, { titleTrack: true }),
    ),
    // Generic repeated titles.
    ...artists.map((artist) => seriesAlbum('Greatest Hits', artist)),
    // One-track extracts are not albums in the series sense.
    ...artists.map((artist) =>
      seriesAlbum('All The Shapes You Are', artist, { trackCount: 1 }),
    ),
  ]);

  assert.equal(detected.size, 0);
});

test('serie and label search the embedded album series', () => {
  const blueNote = query({ q: 'serie:"blue note"' });
  assert.ok(names(blueNote.albums).includes('Blue Train {Blue Note}'));

  const rockCandy = query({ q: 'label:"rock candy"' });
  assert.ok(
    names(rockCandy.albums).includes(
      'A Love Supreme [2016 Rock Candy Edition]',
    ),
  );

  // Series are matched exactly, not as substrings.
  assert.equal(query({ q: 'serie:blue' }).total, 0);

  // Only the label is indexed: the year and the word "Edition" are stripped.
  assert.equal(query({ q: 'serie:2016' }).total, 0);
  assert.equal(query({ q: 'serie:"rock candy edition"' }).total, 0);
});

test('detected plain-title series are searchable through the index', async () => {
  const artists = ['Ana', 'Bia', 'Caio', 'Duda', 'Eva'];
  const volumes = ['1', '2', '3', '4', '5'];
  const row = (album: string, artist: string): AlbumRow => ({
    album,
    artist,
    year: 2000,
    track_count: 10,
    duration: 2400,
    latest: '2020-01-01T10:00:00',
    genres: 'MPB',
    track_artists: [artist],
    composers: null,
    comments: null,
    title_track: false,
    cover_path: '',
  });
  const extraRows: AlbumRow[] = [
    ...artists.map((artist) => row('Sem Limite', artist)),
    ...artists.map((artist) => row(`Putumayo - ${artist}`, artist)),
    ...volumes.map((volume, index) =>
      row(
        `Jazz Is Dead ${volume}: ${artists[index] ?? ''}`,
        'Various Artists',
      ),
    ),
    row('Excepted [2016 Legacy Edition]', 'Legacy Test'),
  ];
  const local = await createFixtureContext({ extraRows });
  try {
    const search = (q: string) =>
      local.index.queryAlbums({
        q,
        sort: 'album',
        offset: 0,
        limit: 50,
      });

    const result = search('serie:"sem limite"');
    assert.equal(result.total, artists.length);
    const first = result.albums[0];
    assert.ok(first);
    assert.equal(
      local.index.serieKeysFor(first.album, first.artist),
      '\u0000sem limite\u0000',
    );

    // The base fixture also has Putumayo - Family Gathering.
    assert.equal(search('serie:putumayo').total, artists.length + 1);
    assert.equal(search('serie:"jazz is dead"').total, volumes.length);
    // Default SERIES_EXCEPTIONS drops "Legacy" from "[2016 Legacy Edition]".
    assert.equal(search('serie:legacy').total, 0);

    const series = local.index.series();
    assert.ok(
      series.some(
        (serie) =>
          serie.name === 'Sem Limite' &&
          serie.albumCount === artists.length,
      ),
    );
    assert.ok(
      series.some(
        (serie) =>
          serie.name === 'Putumayo' &&
          serie.albumCount === artists.length + 1,
      ),
    );
    assert.ok(
      series.some(
        (serie) =>
          serie.name === 'Jazz Is Dead' &&
          serie.albumCount === volumes.length,
      ),
    );
    assert.ok(!series.some((serie) => serie.name === 'Legacy'));
  } finally {
    local.close();
  }
});

test('albums with an embedded series are not plain-title detected', async () => {
  const artists = ['A', 'B', 'C', 'D', 'E'];
  const extraRows: AlbumRow[] = artists.map((artist, index) => ({
    album: `Cuba : Track ${index} {Ocora}`,
    artist,
    year: 2000,
    track_count: 10,
    duration: 2400,
    latest: '2020-01-01T10:00:00',
    genres: 'World',
    track_artists: [artist],
    composers: null,
    comments: null,
    title_track: false,
    cover_path: '',
  }));
  const local = await createFixtureContext({ extraRows });
  try {
    const search = (q: string) =>
      local.index.queryAlbums({
        q,
        sort: 'album',
        offset: 0,
        limit: 50,
      });

    // "Cuba" would qualify from the titles, but {} already names the series.
    assert.equal(search('serie:cuba').total, 0);
    assert.equal(search('serie:ocora').total, artists.length);

    const series = local.index.series();
    assert.ok(!series.some((serie) => serie.name === 'Cuba'));
    assert.ok(
      series.some(
        (serie) =>
          serie.name === 'Ocora' && serie.albumCount === artists.length,
      ),
    );
  } finally {
    local.close();
  }
});

test('embedded series volume numbers fold into the indexed stem', async () => {
  const artists = ['A', 'B', 'C', 'D', 'E'];
  const row = (album: string, artist: string): AlbumRow => ({
    album,
    artist,
    year: 2000,
    track_count: 10,
    duration: 2400,
    latest: '2020-01-01T10:00:00',
    genres: 'World',
    track_artists: [artist],
    composers: null,
    comments: null,
    title_track: false,
    cover_path: '',
  });
  const extraRows: AlbumRow[] = [
    ...artists.map((artist, index) =>
      row(
        `Album ${index} {Network Medien / World Network ${index + 1}}`,
        artist,
      ),
    ),
    row('Single {Club Top 13}', 'Club'),
    row('Single {2 em 1}', 'Em'),
  ];
  const local = await createFixtureContext({ extraRows });
  try {
    const search = (q: string) =>
      local.index.queryAlbums({
        q,
        sort: 'album',
        offset: 0,
        limit: 50,
      });

    assert.equal(
      search('serie:"network medien / world network"').total,
      artists.length,
    );
    assert.equal(
      search('serie:"network medien / world network 1"').total,
      0,
    );
    assert.equal(search('serie:"club top 13"').total, 1);
    assert.equal(search('serie:"2 em 1"').total, 1);

    const series = local.index.series();
    assert.ok(
      series.some(
        (serie) =>
          serie.name === 'Network Medien / World Network' &&
          serie.albumCount === artists.length,
      ),
    );
    assert.ok(series.some((serie) => serie.name === 'Club Top 13'));
    assert.ok(series.some((serie) => serie.name === '2 em 1'));
  } finally {
    local.close();
  }
});

test('album comments are aggregated, deduplicated, and sorted', () => {
  const albums = query({ q: 'album:"abbey road"' }).albums;
  const abbey = albums.find((album) => album.album === 'Abbey Road');
  assert.ok(abbey);
  // Comments shared by both source titles appear once; the rest are merged.
  assert.deepEqual(abbey.comments, [
    'Bonus disc notes',
    'https://example.com/abbey-road',
    'Original mix notes',
  ]);

  const songhai = query({ q: 'album:songhai' }).albums;
  assert.ok(songhai.length > 0);
  assert.deepEqual(songhai[0]?.comments, []);
});

test('sorting and pagination return slices of the full ordered result', () => {
  const full = query({ sort: 'album' });
  assert.ok(full.total > 0);
  for (let index = 1; index < full.albums.length; index += 1) {
    const previous = full.albums[index - 1];
    const current = full.albums[index];
    assert.ok(previous);
    assert.ok(current);
    assert.ok(collator.compare(previous.album, current.album) <= 0);
  }

  const offset = Math.min(1, Math.max(0, full.albums.length - 1));
  const page = query({ sort: 'album', offset, limit: 2 });
  assert.equal(page.total, full.total);
  assert.deepEqual(
    names(page.albums),
    names(full.albums.slice(offset, offset + 2)),
  );
});
