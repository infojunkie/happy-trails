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

test('track title, artist, source, album, and bare terms use per-track fields', () => {
  assert.deepEqual(matches('track:"guitar"'), ['While My Guitar Gently Weeps']);
  assert.deepEqual(matches('artist:clapton'), [
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

test('genre and region terms use the track genre tags', () => {
  assert.deepEqual(matches('genre:rock'), tracks.map((track) => track.title));
  assert.deepEqual(matches('genre:jazz'), []);

  const first = tracks[0];
  assert.ok(first);
  const brazilTrack = { ...first, genre: 'Jazz,Brazil' };
  const matcher = createTrackMatcher('Anything', 'region:brazil');
  assert.equal(matcher(brazilTrack), true);
  const noRegion = createTrackMatcher('Anything', 'region:brazil');
  assert.equal(noRegion({ ...first, genre: 'Jazz' }), false);
});

test('boolean expressions are evaluated per track', () => {
  assert.deepEqual(matches('composer:harrison OR artist:clapton'), [
    'Something',
    'While My Guitar Gently Weeps',
  ]);
  assert.deepEqual(matches('composer:harrison artist:clapton'), [
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

test('serie and label match the album series exactly', () => {
  const track = tracks[0];
  assert.ok(track);

  const blueNote = createTrackMatcher(
    'Blue Train {Blue Note}',
    'serie:"blue note"',
    '\u0000blue note\u0000',
  );
  assert.equal(blueNote(track), true);

  const rockCandy = createTrackMatcher(
    'A Love Supreme [2016 Rock Candy Edition]',
    'label:"rock candy"',
    '\u0000rock candy\u0000',
  );
  assert.equal(rockCandy(track), true);

  const semLimite = createTrackMatcher(
    'Sem Limite [2008 Edition]',
    'serie:"sem limite"',
    '\u0000sem limite\u0000',
  );
  assert.equal(semLimite(track), true);

  // Only the exact series value matches.
  const partial = createTrackMatcher(
    'Blue Train {Blue Note}',
    'serie:blue',
    '\u0000blue note\u0000',
  );
  assert.equal(partial(track), false);

  // Variable artist text is not part of the detected series value.
  const arte = createTrackMatcher(
    'A Arte de Caetano Veloso',
    'label:"a arte de"',
    '\u0000a arte de\u0000',
  );
  assert.equal(arte(track), true);
  const artistName = createTrackMatcher(
    'A Arte de Caetano Veloso',
    'serie:"caetano"',
    '\u0000a arte de\u0000',
  );
  assert.equal(artistName(track), false);

  const unrelated = createTrackMatcher('Abbey Road', 'serie:"blue note"');
  assert.equal(unrelated(track), false);
});

test('no-match and malformed queries return no tracks', () => {
  assert.deepEqual(matches('foo:bar'), []);
  assert.deepEqual(matches('album:"abbey tracks"'), []);
  assert.deepEqual(matches('composer:does-not-exist'), []);
});
