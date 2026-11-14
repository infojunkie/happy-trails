import assert from 'node:assert/strict';
import test from 'node:test';
import { isRegionTag } from '../../src/server/regions.js';
import {
  findCatalogPlace,
  NON_PLACE_TAGS,
  PLACE_CATALOG,
  TIER_RANK,
} from '../../src/shared/placeCatalog.js';
import {
  resolvePlace,
  type GeneratedPlaceData,
} from '../../src/shared/placeLookup.js';
import { regionKey } from '../../src/shared/text.js';

test('place catalog entries are valid and uniquely keyed', () => {
  const keys = new Set<string>();
  for (const entry of PLACE_CATALOG) {
    assert.ok(entry.lat >= -90 && entry.lat <= 90, entry.name);
    assert.ok(entry.lon >= -180 && entry.lon <= 180, entry.name);
    assert.ok(entry.tier in TIER_RANK, entry.name);
    for (const name of [entry.name, ...(entry.aliases ?? [])]) {
      const key = regionKey(name);
      assert.ok(key, name);
      assert.ok(!keys.has(key), `duplicate catalog key: ${key}`);
      keys.add(key);
    }
  }
});

test('manual places are recognized as region tags', () => {
  assert.equal(isRegionTag('Vancouver'), true);
  assert.equal(isRegionTag('vancouver'), true);
  assert.equal(isRegionTag('Lagos'), true);
  assert.equal(isRegionTag('Catalunya'), true);
  assert.equal(isRegionTag('Zanzibar'), true);
  assert.equal(isRegionTag('Americana'), false);
  assert.equal(isRegionTag('Berber'), false);
});

test('catalog lookup resolves names and aliases', () => {
  const vancouver = findCatalogPlace('VANCOUVER');
  assert.ok(vancouver);
  assert.equal(vancouver.name, 'Vancouver');
  assert.equal(vancouver.tier, 'city');
  assert.equal(vancouver.countryCode, 'CA');

  const catalonia = findCatalogPlace('Catalunya');
  assert.ok(catalonia);
  assert.equal(catalonia.name, 'Catalonia');
  assert.equal(catalonia.tier, 'subnational');
  assert.equal(catalonia.countryCode, 'ES');

  assert.equal(findCatalogPlace('Atlantis'), null);
});

test('catalog entries override the generated lookup', () => {
  const generated: GeneratedPlaceData = {
    places: {
      vancouver: {
        name: 'Wrong Vancouver',
        tier: 'country',
        countryCode: 'US',
        lat: 0,
        lon: 0,
      },
    },
  };
  const place = resolvePlace('Vancouver', generated);
  assert.ok(place);
  assert.equal(place.name, 'Vancouver');
  assert.equal(place.countryCode, 'CA');
});

test('the non-place denylist covers the known false positives', () => {
  for (const tag of ['Americana', 'Berber', 'Turkestan', 'Roma']) {
    assert.ok(NON_PLACE_TAGS.includes(tag), tag);
  }
});
