import assert from 'node:assert/strict';
import test from 'node:test';
import {
  albumFolderPathFor,
  comparePdfNames,
  isPdfFilename,
  pdfLabelFor,
} from '../../src/server/artwork.js';

test('albumFolderPathFor maps volume paths to FileStation share folders', () => {
  assert.equal(
    albumFolderPathFor(
      '/volume1/music/AUDIO/ALBUMS/E/Elvis Presley - (2015) The Complete 1954-1962 U.S.A. Singles/1-14 My Baby Left Me.flac',
    ),
    '/music/AUDIO/ALBUMS/E/Elvis Presley - (2015) The Complete 1954-1962 U.S.A. Singles',
  );
  assert.equal(
    albumFolderPathFor('/volume2/media/Artist/Album/01.flac'),
    '/media/Artist/Album',
  );
  assert.equal(
    albumFolderPathFor('/music/Artist/Album/01.flac'),
    '/music/Artist/Album',
  );
  assert.equal(
    albumFolderPathFor('\\volume1\\music\\Artist\\Album\\01.flac'),
    '/music/Artist/Album',
  );
});

test('albumFolderPathFor rejects paths without an album folder', () => {
  assert.equal(albumFolderPathFor(''), null);
  assert.equal(albumFolderPathFor('relative/Album/01.flac'), null);
  assert.equal(albumFolderPathFor('/volume1'), null);
  assert.equal(albumFolderPathFor('/volume1/music'), null);
  assert.equal(albumFolderPathFor('/volume1/music/'), null);
});

test('pdfLabelFor strips only the final extension', () => {
  assert.equal(pdfLabelFor('Artwork.pdf'), 'Artwork');
  assert.equal(pdfLabelFor('Booklet.PDF'), 'Booklet');
  assert.equal(pdfLabelFor('Booklet.v2.pdf'), 'Booklet.v2');
  assert.equal(pdfLabelFor('My Booklet — 2024.pdf'), 'My Booklet — 2024');
});

test('isPdfFilename accepts only single-segment PDF filenames', () => {
  assert.equal(isPdfFilename('Artwork.pdf'), true);
  assert.equal(isPdfFilename('Booklet.PDF'), true);
  assert.equal(isPdfFilename('Booklet.v2.pdf'), true);
  assert.equal(isPdfFilename('Artwork.jpg'), false);
  assert.equal(isPdfFilename('.pdf'), false);
  assert.equal(isPdfFilename('notes.pdf.txt'), false);
  assert.equal(isPdfFilename('folder/Artwork.pdf'), false);
  assert.equal(isPdfFilename('folder\\Artwork.pdf'), false);
  assert.equal(isPdfFilename('../Artwork.pdf'), false);
  assert.equal(isPdfFilename('Artwork.pdf\0.png'), false);
});

test('comparePdfNames sorts naturally and case-insensitively', () => {
  const sorted = ['Booklet 10.pdf', 'artwork.pdf', 'Booklet 2.pdf'].sort(
    comparePdfNames,
  );
  assert.deepEqual(sorted, [
    'artwork.pdf',
    'Booklet 2.pdf',
    'Booklet 10.pdf',
  ]);
});
