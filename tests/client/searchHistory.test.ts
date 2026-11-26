import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_SEARCH_HISTORY_QUERY_LENGTH,
  parseSearchHistory,
  rememberSearch,
} from '../../src/client/searchHistory.js';

test('parseSearchHistory tolerates missing, malformed, and non-array data', () => {
  assert.deepEqual(parseSearchHistory(null, 5), []);
  assert.deepEqual(parseSearchHistory('', 5), []);
  assert.deepEqual(parseSearchHistory('{not json', 5), []);
  assert.deepEqual(parseSearchHistory('{"q":"x"}', 5), []);
  assert.deepEqual(parseSearchHistory('null', 5), []);
});

test('parseSearchHistory trims, drops empty/non-string entries, and caps', () => {
  assert.deepEqual(
    parseSearchHistory(
      JSON.stringify([' beatles ', '', 42, null, 'miles']),
      5,
    ),
    ['beatles', 'miles'],
  );
  assert.deepEqual(
    parseSearchHistory(JSON.stringify(['a', 'b', 'c']), 2),
    ['a', 'b'],
  );
  assert.deepEqual(parseSearchHistory(JSON.stringify(['a']), 0), []);
});

test('parseSearchHistory deduplicates case-insensitively', () => {
  assert.deepEqual(
    parseSearchHistory(JSON.stringify(['Beatles', 'miles', 'beatles']), 10),
    ['Beatles', 'miles'],
  );
});

test('parseSearchHistory truncates long queries', () => {
  const long = 'x'.repeat(MAX_SEARCH_HISTORY_QUERY_LENGTH + 20);
  const entry = parseSearchHistory(JSON.stringify([long]), 5)[0];
  assert.ok(entry);
  assert.equal(entry.length, MAX_SEARCH_HISTORY_QUERY_LENGTH);
});

test('rememberSearch unshifts, deduplicates, and respects the limit', () => {
  assert.deepEqual(rememberSearch([], '  beatles  ', 5), ['beatles']);
  assert.deepEqual(rememberSearch(['beatles', 'miles'], 'MILES', 5), [
    'MILES',
    'beatles',
  ]);
  assert.deepEqual(rememberSearch(['a', 'b', 'c'], 'd', 2), ['d', 'a']);
  assert.deepEqual(rememberSearch(['a', 'b'], '', 5), ['a', 'b']);
  assert.deepEqual(rememberSearch(['a'], 'b', 0), []);
});
