import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commitPage,
  createQueueSource,
  isStoredQueueSource,
  planRefill,
  QUEUE_REFILL_THRESHOLD,
  QUEUE_WINDOW_SIZE,
  type QueueSourceState,
} from '../../src/client/queueSource.js';

function source(overrides: Partial<QueueSourceState> = {}): QueueSourceState {
  return {
    descriptor: { mode: 'tracks', q: 'beatles', sort: 'recent' },
    nextOffset: 48,
    total: 100,
    libraryVersion: 7,
    exhausted: false,
    ...overrides,
  };
}

test('createQueueSource marks a short first page exhausted', () => {
  const full = createQueueSource(
    { mode: 'tracks', q: '', sort: 'recent' },
    { requested: 48, received: 48, total: 100, libraryVersion: 3 },
  );
  assert.equal(full.nextOffset, 48);
  assert.equal(full.exhausted, false);

  const short = createQueueSource(
    { mode: 'albums', q: 'beatles', sort: 'artist' },
    { requested: 48, received: 20, total: 20, libraryVersion: 3 },
  );
  assert.equal(short.nextOffset, 20);
  assert.equal(short.exhausted, true);

  const empty = createQueueSource(
    { mode: 'tracks', q: 'nothing', sort: 'album' },
    { requested: 48, received: 0, total: 0, libraryVersion: 3 },
  );
  assert.equal(empty.exhausted, true);
});

test('planRefill waits until the upcoming buffer is small', () => {
  assert.equal(
    planRefill(QUEUE_WINDOW_SIZE, 0, source()),
    null,
  );
  assert.equal(
    planRefill(
      QUEUE_WINDOW_SIZE,
      QUEUE_WINDOW_SIZE - 1 - QUEUE_REFILL_THRESHOLD,
      source(),
    ),
    null,
  );
});

test('planRefill trims history and fetches exactly enough to restore the window', () => {
  const plan = planRefill(48, 36, source());
  assert.deepEqual(plan, { trimCount: 36, fetchLimit: 36 });

  const last = planRefill(48, 47, source());
  assert.deepEqual(last, { trimCount: 47, fetchLimit: 47 });
});

test('planRefill fills a queue shortened by deletions', () => {
  const plan = planRefill(10, 0, source());
  assert.deepEqual(plan, { trimCount: 0, fetchLimit: 38 });
});

test('planRefill ignores exhausted sources and missing current items', () => {
  assert.equal(planRefill(48, 36, source({ exhausted: true })), null);
  assert.equal(planRefill(48, -1, source()), null);
  assert.equal(planRefill(0, 0, source()), null);
});

test('commitPage advances the cursor and detects exhaustion', () => {
  const advanced = commitPage(source(), {
    requested: 36,
    received: 36,
    total: 100,
    libraryVersion: 8,
  });
  assert.equal(advanced.nextOffset, 84);
  assert.equal(advanced.total, 100);
  assert.equal(advanced.libraryVersion, 8);
  assert.equal(advanced.exhausted, false);

  const short = commitPage(source(), {
    requested: 36,
    received: 10,
    total: 100,
    libraryVersion: 8,
  });
  assert.equal(short.nextOffset, 58);
  assert.equal(short.exhausted, true);

  const end = commitPage(source({ nextOffset: 90, total: 100 }), {
    requested: 20,
    received: 10,
    total: 100,
    libraryVersion: 8,
  });
  assert.equal(end.nextOffset, 100);
  assert.equal(end.exhausted, true);
});

test('isStoredQueueSource accepts valid state and rejects malformed state', () => {
  assert.equal(isStoredQueueSource(source()), true);
  assert.equal(isStoredQueueSource(undefined), false);
  assert.equal(
    isStoredQueueSource({ ...source(), descriptor: { mode: 'bad' } }),
    false,
  );
  assert.equal(isStoredQueueSource({ ...source(), nextOffset: -1 }), false);
  assert.equal(isStoredQueueSource({ ...source(), total: 1.5 }), false);
  assert.equal(isStoredQueueSource({ ...source(), exhausted: 'no' }), false);
});
