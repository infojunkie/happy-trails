import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import {
  bracedSeries,
  detectSeries,
  foldAlnum,
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
    sort: 'added',
    order: 'desc',
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

test('search folding ignores punctuation but keeps spaces', () => {
  assert.equal(foldAlnum('-M-'), 'm');
  assert.equal(foldAlnum('Therapy?'), 'therapy');
  assert.equal(foldAlnum('The Beatles'), 'the beatles');
  assert.equal(foldAlnum('Jay-Z'), 'jayz');
  assert.equal(foldAlnum('Søren'), 'soren');
  // All-punctuation values keep their punctuation so they stay distinct.
  assert.equal(foldAlnum('!!!'), '!!!');
});

test('album and artist matching ignores punctuation', () => {
  const bySlash = query({ q: 'album:"Getz/Gilberto"' });
  const byPlain = query({ q: 'album:"GetzGilberto"' });
  assert.deepEqual(keys(byPlain.albums), keys(bySlash.albums));
  assert.ok(byPlain.albums.some((album) => album.album === 'Getz/Gilberto'));

  const artist = query({ q: 'artist:"Earth Wind Fire"' });
  const artistPunct = query({ q: 'artist:"Earth, Wind & Fire"' });
  assert.deepEqual(keys(artist.albums), keys(artistPunct.albums));
  assert.ok(
    artist.albums.some((album) => album.artist === 'Earth, Wind & Fire'),
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

test('braced series parsing splits on / only', () => {
  assert.deepEqual(bracedSeries('Dark Magus {Legacy}'), ['Legacy']);
  assert.deepEqual(bracedSeries('A Love Supreme [2016 Rock Candy Edition]'), []);
  assert.deepEqual(bracedSeries('X { A   B }'), ['A B']);
  assert.deepEqual(bracedSeries('X {A} {A}'), ['A']);
  assert.deepEqual(bracedSeries('X {A} {B}'), ['A', 'B']);
  // Only "/" splits; spaces are optional, other punctuation stays.
  assert.deepEqual(bracedSeries('X {Blue Note / Verve}'), [
    'Blue Note',
    'Verve',
  ]);
  assert.deepEqual(bracedSeries('X {UNESCO/Auvidis}'), ['UNESCO', 'Auvidis']);
  assert.deepEqual(bracedSeries('X {A feat. B}'), ['A feat. B']);
  assert.deepEqual(bracedSeries('X {A, B}'), ['A, B']);
  assert.deepEqual(bracedSeries('X {Earth, Wind & Fire}'), [
    'Earth, Wind & Fire',
  ]);
});

test('detectSeries allowlist matches anywhere, first in order, only without braces', () => {
  assert.deepEqual(detectSeries('The Millennium Edition', ['Millennium']), [
    'Millennium',
  ]);
  assert.deepEqual(detectSeries('Nova Millennium', ['Millennium']), [
    'Millennium',
  ]);
  assert.deepEqual(detectSeries('MillenniumX', ['Millennium']), ['Millennium']);
  // First matching entry in configured order wins.
  assert.deepEqual(
    detectSeries('The Millennium Edition', ['Edition', 'Millennium']),
    ['Edition'],
  );
  assert.deepEqual(
    detectSeries('The Millennium Edition', ['Millennium', 'Edition']),
    ['Millennium'],
  );
  // Only one allowlist entry is retained.
  assert.deepEqual(detectSeries('Millennium Edition', ['Millennium', 'Edition']), [
    'Millennium',
  ]);
  // Braced albums are not considered for the allowlist.
  assert.deepEqual(
    detectSeries('The Millennium Edition {Rock Candy}', ['Millennium']),
    ['Rock Candy'],
  );
  assert.deepEqual(detectSeries('Something Else', ['Millennium']), []);
});

test('detectSeries denylist matches the album name anywhere and removes all series', () => {
  assert.deepEqual(detectSeries('X {Blue Note}', [], []), ['Blue Note']);
  assert.deepEqual(detectSeries('Live in Japan {Blue Note}', [], ['Japan']), []);
  assert.deepEqual(detectSeries('X {Blue Note}', [], ['Blue']), []);
  assert.deepEqual(
    detectSeries('The Millennium Edition', ['Millennium'], ['Edition']),
    [],
  );
  assert.deepEqual(detectSeries('X {Blue Note}', [], ['Legacy']), ['Blue Note']);
});

test('serie and label search braced album series', () => {
  const blueNote = query({ q: 'serie:"blue note"' });
  assert.ok(names(blueNote.albums).includes('Blue Train {Blue Note}'));

  const rockCandy = query({ q: 'label:"rock candy"' });
  assert.ok(names(rockCandy.albums).includes('A Love Supreme {Rock Candy}'));

  // Series are matched exactly, not as substrings.
  assert.equal(query({ q: 'serie:blue' }).total, 0);

  // A plain title without braces or an allowlist match is not a series.
  assert.equal(query({ q: 'serie:"family gathering"' }).total, 0);
});

test('only braced series are indexed for the base fixture', () => {
  const series = context.index.series();
  assert.ok(
    series.some((serie) => serie.name === 'Blue Note' && serie.albumCount === 1),
  );
  assert.ok(
    series.some((serie) => serie.name === 'Rock Candy' && serie.albumCount === 1),
  );
  assert.ok(!series.some((serie) => serie.name === 'Putumayo'));
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
  const full = query({ sort: 'album', order: 'asc' });
  assert.ok(full.total > 0);
  for (let index = 1; index < full.albums.length; index += 1) {
    const previous = full.albums[index - 1];
    const current = full.albums[index];
    assert.ok(previous);
    assert.ok(current);
    assert.ok(collator.compare(previous.album, current.album) <= 0);
  }

  const offset = Math.min(1, Math.max(0, full.albums.length - 1));
  const page = query({ sort: 'album', order: 'asc', offset, limit: 2 });
  assert.equal(page.total, full.total);
  assert.deepEqual(
    names(page.albums),
    names(full.albums.slice(offset, offset + 2)),
  );
});
