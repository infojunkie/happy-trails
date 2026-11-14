import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  groupAlbumLocations,
  selectAlbumLocations,
} from '../../src/shared/albumPlaces.js';
import {
  createPlaceResolver,
  type GeneratedPlaceData,
} from '../../src/shared/placeLookup.js';

const generated = JSON.parse(
  fs.readFileSync('public/map/places.json', 'utf8'),
) as GeneratedPlaceData;
const resolve = createPlaceResolver(generated);

test('multi-country albums are placed in every disjoint country', () => {
  const selection = selectAlbumLocations(
    [
      'USA',
      'Iceland',
      'Zimbabwe',
      'Austria',
      'Algeria',
      'Cuba',
      'Colombia',
      'Greece',
      'Brazil',
      'Kenya',
      'Rapa Nui',
    ],
    resolve,
  );

  assert.equal(selection.locations.length, 11);
  assert.deepEqual(selection.unresolved, []);
  assert.deepEqual(
    selection.locations.map((place) => place.name).sort(),
    [
      'Algeria',
      'Austria',
      'Brazil',
      'Colombia',
      'Cuba',
      'Greece',
      'Iceland',
      'Kenya',
      'Rapa Nui',
      'United States',
      'Zimbabwe',
    ].sort(),
  );
});

test('nested places keep only the most specific location', () => {
  const corsica = selectAlbumLocations(['Corsica', 'France'], resolve);
  assert.deepEqual(
    corsica.locations.map((place) => place.name),
    ['Corsica'],
  );

  const vancouver = selectAlbumLocations(['Vancouver', 'Canada'], resolve);
  assert.deepEqual(
    vancouver.locations.map((place) => place.name),
    ['Vancouver'],
  );

  const vancouverUs = selectAlbumLocations(['Vancouver', 'USA'], resolve);
  assert.deepEqual(
    vancouverUs.locations.map((place) => place.name).sort(),
    ['United States', 'Vancouver'],
  );
});

test('macro regions are dropped when a specific place exists', () => {
  const withSpecific = selectAlbumLocations(
    ['Brazil', 'Latin America'],
    resolve,
  );
  assert.deepEqual(
    withSpecific.locations.map((place) => place.name),
    ['Brazil'],
  );

  const macroOnly = selectAlbumLocations(['Latin America'], resolve);
  assert.equal(macroOnly.locations.length, 1);
  assert.equal(macroOnly.locations[0]?.tier, 'macro');
});

test('aliases resolving to the same place are deduplicated', () => {
  const selection = selectAlbumLocations(['USA', 'US'], resolve);
  assert.equal(selection.locations.length, 1);
  assert.equal(selection.locations[0]?.name, 'United States');
});

test('unresolved tags are reported without inventing a location', () => {
  const selection = selectAlbumLocations(['Atlantis'], resolve);
  assert.equal(selection.locations.length, 0);
  assert.deepEqual(selection.unresolved, ['Atlantis']);
});

test('album locations group by coordinate and handle multi-location albums', () => {
  const result = groupAlbumLocations(
    [
      { key: 'a', regions: ['Brazil'] },
      { key: 'b', regions: ['Brazil'] },
      { key: 'c', regions: ['Brazil', 'Cuba'] },
      { key: 'd', regions: ['Cuba'] },
      { key: 'e', regions: [] },
      { key: 'f', regions: ['Atlantis'] },
    ],
    resolve,
  );

  assert.deepEqual(result.unplaced, ['e', 'f']);
  assert.deepEqual(result.unresolved.get('f'), ['Atlantis']);
  assert.equal(result.groups.length, 2);

  const brazil = result.groups.find((group) => group.location.name === 'Brazil');
  assert.deepEqual(brazil?.albumKeys, ['a', 'b', 'c']);

  const cuba = result.groups.find((group) => group.location.name === 'Cuba');
  assert.deepEqual(cuba?.albumKeys, ['c', 'd']);
});
