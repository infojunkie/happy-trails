import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EQUAL_EARTH_X_MAX,
  EQUAL_EARTH_Y_MAX,
  projectEqualEarth,
  unprojectEqualEarth,
} from '../../src/shared/equalEarth.js';

test('Equal Earth projection round-trips', () => {
  const samples: Array<[number, number]> = [
    [0, 0],
    [180, 0],
    [-180, 0],
    [0, 90],
    [0, -90],
    [10, 45],
    [-123.12, 49.28],
    [139.69, 35.69],
  ];

  for (const [lng, lat] of samples) {
    const point = projectEqualEarth(lng, lat);
    const back = unprojectEqualEarth(point.x, point.y);
    assert.ok(
      Math.abs(back.lng - lng) < 1e-9,
      `lng ${lng},${lat} -> ${back.lng}`,
    );
    assert.ok(
      Math.abs(back.lat - lat) < 1e-9,
      `lat ${lng},${lat} -> ${back.lat}`,
    );
  }
});

test('Equal Earth projected bounds match the standard extent', () => {
  assert.ok(Math.abs(projectEqualEarth(180, 0).x - EQUAL_EARTH_X_MAX) < 1e-12);
  assert.ok(Math.abs(projectEqualEarth(0, 90).y - EQUAL_EARTH_Y_MAX) < 1e-12);
  assert.ok(EQUAL_EARTH_X_MAX > EQUAL_EARTH_Y_MAX);
});
