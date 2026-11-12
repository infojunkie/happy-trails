import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createFixtureContext } from '../fixtures/library.js';

test('a file-backed index builds, queries, and removes its file on close', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'happy-trails-index-test-'));
  const file = path.join(dir, 'index.sqlite');

  const context = await createFixtureContext({ indexDbPath: file });
  try {
    assert.ok(fs.existsSync(file));
    assert.ok(fs.statSync(file).size > 0);

    const result = context.index.queryTracks({
      q: 'track:"so what"',
      sort: 'recent',
      offset: 0,
      limit: 10,
    });
    assert.equal(result.total, 1);
    assert.equal(result.tracks[0]?.title, 'So What');
  } finally {
    context.close();
    assert.equal(fs.existsSync(file), false);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('building a second file-backed index leaves the first one intact', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'happy-trails-index-test-'));
  const first = path.join(dir, 'first.sqlite');
  const second = path.join(dir, 'second.sqlite');

  const one = await createFixtureContext({ indexDbPath: first });
  const two = await createFixtureContext({ indexDbPath: second });
  try {
    assert.ok(fs.existsSync(first));
    assert.ok(fs.existsSync(second));
    assert.equal(one.index.albumCount, two.index.albumCount);
  } finally {
    one.close();
    two.close();
    assert.equal(fs.existsSync(first), false);
    assert.equal(fs.existsSync(second), false);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
