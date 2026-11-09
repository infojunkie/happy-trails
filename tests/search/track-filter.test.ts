import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrackMatcher } from '../../src/server/trackSearch.js';
import { fixtureTracks } from '../fixtures/library.js';

const tracks =
  fixtureTracks.get('Abbey Road\u0000The Beatles') ?? [];

function matches(query: string): string[] {
  const matcher = createTrackMatcher('Abbey Road', query);
  return tracks.filter((track) => matcher(track)).map((track) => track.title);
}

test('an empty query matches every track', () => {
  assert.deepEqual(matches(''), tracks.map((track) => track.title));
  assert.deepEqual(matches('   '), tracks.map((track) => track.title));
});

test('composer terms narrow the track list', () => {
  assert.deepEqual(matches('composer:"George Harrison"'), [
    'Something',
    'While My Guitar Gently Weeps',
  ]);
  assert.deepEqual(matches('composer:lennon'), [
    'Come Together',
    'Come Together (Take 1)',
  ]);
  assert.deepEqual(matches('composer:"Lennon, Paul"'), [
    'Come Together',
    'Come Together (Take 1)',
  ]);
});

test('track artist, source, album, and bare terms use per-track fields', () => {
  assert.deepEqual(matches('trackartist:clapton'), [
    'While My Guitar Gently Weeps',
  ]);
  assert.deepEqual(matches('source:"bonus tracks"'), [
    'Come Together (Take 1)',
  ]);
  assert.deepEqual(matches('album:"abbey road"'), tracks.map((track) => track.title));
  assert.deepEqual(matches('artist:beatles'), tracks.map((track) => track.title));
  assert.deepEqual(matches('george'), [
    'Something',
    'While My Guitar Gently Weeps',
  ]);
});

test('boolean expressions are evaluated per track', () => {
  assert.deepEqual(matches('composer:harrison OR trackartist:clapton'), [
    'Something',
    'While My Guitar Gently Weeps',
  ]);
  assert.deepEqual(matches('composer:harrison trackartist:clapton'), [
    'While My Guitar Gently Weeps',
  ]);
  assert.deepEqual(
    matches('(composer:lennon OR composer:harrison) album:abbey'),
    [
      'Come Together',
      'Something',
      'While My Guitar Gently Weeps',
      'Come Together (Take 1)',
    ],
  );
});

test('no-match and malformed queries return no tracks', () => {
  assert.deepEqual(matches('foo:bar'), []);
  assert.deepEqual(matches('album:"abbey tracks"'), []);
  assert.deepEqual(matches('composer:does-not-exist'), []);
});
