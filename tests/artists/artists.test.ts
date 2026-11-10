import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArtists } from '../../src/server/artists.js';

test('possessives discard themselves and every following token', () => {
  assert.deepEqual(parseArtists('Quincy Jones & His Orchestra'), [
    'Quincy Jones',
  ]);
  assert.deepEqual(parseArtists('Billie Holiday & Her Orchestra'), [
    'Billie Holiday',
  ]);
  assert.deepEqual(parseArtists('Art Blakey & His Jazz Messengers'), [
    'Art Blakey',
  ]);
  assert.deepEqual(parseArtists('Louis Prima et son Orchestre'), [
    'Louis Prima',
  ]);
  assert.deepEqual(parseArtists('Michi Sarmiento y su Combo Bravo'), [
    'Michi Sarmiento',
  ]);
  assert.deepEqual(parseArtists('João Gilberto e sua Orquestra'), [
    'João Gilberto',
  ]);
  assert.deepEqual(
    parseArtists('Badly Drawn Boy feat. Jools Holland & His Rhythm & Blues Orchestra'),
    ['Badly Drawn Boy', 'Jools Holland'],
  );
});

test('a possessive drops later artists too, but not a leading possessive name', () => {
  assert.deepEqual(
    parseArtists('Quincy Jones & His Orchestra & Wynton Marsalis'),
    ['Quincy Jones'],
  );
  assert.deepEqual(parseArtists('His Name Is Alive'), ['His Name Is Alive']);
});

test('accompanied by, y, and Arabic waw are separators', () => {
  assert.deepEqual(parseArtists('Billie Holiday accompanied by Ray Ellis'), [
    'Billie Holiday',
    'Ray Ellis',
  ]);
  assert.deepEqual(parseArtists('A B y C D'), ['A B', 'C D']);
  assert.deepEqual(parseArtists('أحمد و محمود'), ['أحمد', 'محمود']);
  // One-letter separators remain case-sensitive.
  assert.deepEqual(parseArtists('A Y B'), ['A Y B']);
});

test('default artist exceptions are gone', () => {
  assert.deepEqual(parseArtists('Earth, Wind & Fire'), [
    'Earth',
    'Wind',
    'Fire',
  ]);
  assert.deepEqual(parseArtists('Simon & Garfunkel'), [
    'Simon',
    'Garfunkel',
  ]);
});
