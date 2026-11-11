import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { albumSeries } from '../../src/server/search.js';
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
    genres: [],
    genreMode: 'any',
    regions: [],
    regionMode: 'any',
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

  const trackArtist = query({ q: 'trackartist:coltrane' });
  assert.ok(trackArtist.total > 0);
  assert.ok(names(trackArtist.albums).includes('Kind of Blue'));
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

test('genre facets support any and all modes as union and intersection', () => {
  const jazz = query({ genres: ['Jazz'] });
  const folk = query({ genres: ['Folk'] });
  const any = query({ genres: ['Jazz', 'Folk'], genreMode: 'any' });
  const all = query({ genres: ['Jazz', 'Folk'], genreMode: 'all' });

  assert.deepEqual(
    keys(any.albums),
    union(keys(jazz.albums), keys(folk.albums)),
  );
  assert.deepEqual(
    keys(all.albums),
    intersection(keys(jazz.albums), keys(folk.albums)),
  );

  for (const album of all.albums) {
    assert.ok(album.genres.includes('Jazz'));
    assert.ok(album.genres.includes('Folk'));
  }
  for (const album of any.albums) {
    assert.ok(
      album.genres.includes('Jazz') || album.genres.includes('Folk'),
    );
  }
});

test('region facets support any and all modes as union and intersection', () => {
  const spain = query({ regions: ['Spain'] });
  const catalonia = query({ regions: ['Catalonia'] });
  const any = query({
    regions: ['Spain', 'Catalonia'],
    regionMode: 'any',
  });
  const all = query({
    regions: ['Spain', 'Catalonia'],
    regionMode: 'all',
  });

  assert.ok(spain.total > 0);
  assert.ok(catalonia.total > 0);
  assert.deepEqual(
    keys(any.albums),
    union(keys(spain.albums), keys(catalonia.albums)),
  );
  assert.deepEqual(
    keys(all.albums),
    intersection(keys(spain.albums), keys(catalonia.albums)),
  );

  for (const album of all.albums) {
    assert.ok(album.regions.includes('Spain'));
    assert.ok(album.regions.includes('Catalonia'));
  }
});

test('search syntax combines with genre and region tags as set intersections', () => {
  const composer = query({ q: 'composer:toumani' });
  const spain = query({ regions: ['Spain'] });
  const combined = query({ q: 'composer:toumani', regions: ['Spain'] });
  assert.deepEqual(
    keys(combined.albums),
    intersection(keys(composer.albums), keys(spain.albums)),
  );

  const album = query({ q: 'album:abbey' });
  const rock = query({ genres: ['Rock'] });
  const both = query({ q: 'album:abbey', genres: ['Rock'] });
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

test('album series parsing extracts braces and year-Edition brackets', () => {
  assert.deepEqual(albumSeries('Dark Magus {Legacy}'), ['Legacy']);
  assert.deepEqual(albumSeries('A Love Supreme [2016 Rock Candy Edition]'), [
    'Rock Candy',
  ]);
  assert.deepEqual(albumSeries('X [2016 rock candy EDITION]'), ['rock candy']);
  assert.deepEqual(albumSeries('X [Japan Edition] [2015 Remastered]'), []);
  assert.deepEqual(albumSeries('X [2016 Edition]'), []);
  assert.deepEqual(albumSeries('X [2016 Rock Candy Editions]'), []);
  assert.deepEqual(albumSeries('X { A   B }'), ['A B']);
  assert.deepEqual(albumSeries('X {A} {A}'), ['A']);
  // A bracket group does not consume text from a different group.
  assert.deepEqual(
    albumSeries('X [2016 Remaster] [2017 Deluxe Edition]'),
    ['Deluxe'],
  );
  // Values appear in title order, across both forms.
  assert.deepEqual(
    albumSeries('X {A} [2017 30th Anniversary Deluxe Edition] {B}'),
    ['A', '30th Anniversary Deluxe', 'B'],
  );
});

test('serie and label search the parsed album series', () => {
  const blueNote = query({ q: 'serie:"blue note"' });
  assert.ok(names(blueNote.albums).includes('Blue Train {Blue Note}'));

  const rockCandy = query({ q: 'label:"rock candy"' });
  assert.ok(
    names(rockCandy.albums).includes(
      'A Love Supreme [2016 Rock Candy Edition]',
    ),
  );

  // Only the label is indexed: the year and the word "Edition" are stripped.
  assert.equal(query({ q: 'serie:2016' }).total, 0);
  assert.equal(query({ q: 'serie:"rock candy edition"' }).total, 0);
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
