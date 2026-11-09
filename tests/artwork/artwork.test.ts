import assert from 'node:assert/strict';
import test from 'node:test';
import { artworkPathFor } from '../../src/server/artwork.js';

test('artworkPathFor maps volume paths to FileStation share paths', () => {
  assert.equal(
    artworkPathFor(
      '/volume1/music/AUDIO/ALBUMS/E/Elvis Presley - (2015) The Complete 1954-1962 U.S.A. Singles/1-14 My Baby Left Me.flac',
    ),
    '/music/AUDIO/ALBUMS/E/Elvis Presley - (2015) The Complete 1954-1962 U.S.A. Singles/Artwork.pdf',
  );
  assert.equal(
    artworkPathFor('/volume2/media/Artist/Album/01.flac'),
    '/media/Artist/Album/Artwork.pdf',
  );
  assert.equal(
    artworkPathFor('/music/Artist/Album/01.flac'),
    '/music/Artist/Album/Artwork.pdf',
  );
  assert.equal(
    artworkPathFor('\\volume1\\music\\Artist\\Album\\01.flac'),
    '/music/Artist/Album/Artwork.pdf',
  );
});

test('artworkPathFor rejects paths without an album folder', () => {
  assert.equal(artworkPathFor(''), null);
  assert.equal(artworkPathFor('relative/Album/01.flac'), null);
  assert.equal(artworkPathFor('/volume1'), null);
  assert.equal(artworkPathFor('/volume1/music'), null);
  assert.equal(artworkPathFor('/volume1/music/'), null);
});
