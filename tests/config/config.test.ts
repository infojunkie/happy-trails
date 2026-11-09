import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatOriginTarget,
  parseDsmFrontendUrl,
  resolveDsmFrontendBase,
} from '../../src/server/config.js';

test('a full http(s) frontend URL is used verbatim', () => {
  assert.deepEqual(
    parseDsmFrontendUrl(
      'https://front.example:5001/audio?x=1',
      'https://dsm',
    ),
    {
      url: 'https://front.example:5001/audio?x=1',
      originPath: null,
      originPort: null,
    },
  );
  assert.deepEqual(
    parseDsmFrontendUrl('  http://front.example/path  ', 'https://dsm'),
    {
      url: 'http://front.example/path',
      originPath: null,
      originPort: null,
    },
  );
});

test('an empty frontend URL falls back to the DSM URL', () => {
  assert.deepEqual(parseDsmFrontendUrl('', 'https://dsm:5001'), {
    url: 'https://dsm:5001',
    originPath: null,
    originPort: null,
  });
  assert.deepEqual(parseDsmFrontendUrl('   ', 'https://dsm:5001'), {
    url: 'https://dsm:5001',
    originPath: null,
    originPort: null,
  });
  assert.deepEqual(parseDsmFrontendUrl(undefined, ''), {
    url: null,
    originPath: null,
    originPort: null,
  });
});

test('path-only values use the request origin and preserve its port', () => {
  assert.deepEqual(parseDsmFrontendUrl('/', 'https://dsm'), {
    url: null,
    originPath: '/',
    originPort: null,
  });
  assert.deepEqual(parseDsmFrontendUrl('/audio', 'https://dsm'), {
    url: null,
    originPath: '/audio',
    originPort: null,
  });
  assert.deepEqual(parseDsmFrontendUrl('audio/nested', 'https://dsm'), {
    url: null,
    originPath: '/audio/nested',
    originPort: null,
  });
});

test('port-only and path-plus-port values override the origin port', () => {
  assert.deepEqual(parseDsmFrontendUrl(':5001', 'https://dsm'), {
    url: null,
    originPath: '/',
    originPort: 5001,
  });
  assert.deepEqual(parseDsmFrontendUrl('/audio:5001', 'https://dsm'), {
    url: null,
    originPath: '/audio',
    originPort: 5001,
  });
  assert.deepEqual(parseDsmFrontendUrl('audio:5001', 'https://dsm'), {
    url: null,
    originPath: '/audio',
    originPort: 5001,
  });
});

test('invalid ports and non-HTTP absolute URLs fall back to the DSM URL', () => {
  for (const value of ['$ORIGIN:0', ':65536', 'ftp://front.example']) {
    assert.deepEqual(parseDsmFrontendUrl(value, 'https://dsm'), {
      url: 'https://dsm',
      originPath: null,
      originPort: null,
    });
  }
});

test('formatOriginTarget applies path and optional port', () => {
  assert.equal(
    formatOriginTarget('https://app.example:3000', '/audio', 5001),
    'https://app.example:5001/audio',
  );
  assert.equal(
    formatOriginTarget('https://app.example:3000', '/', null),
    'https://app.example:3000/',
  );
  assert.equal(
    formatOriginTarget('http://app.example', '/audio', null),
    'http://app.example/audio',
  );
  assert.equal(
    formatOriginTarget('not a url', '/audio', 5001),
    null,
  );
});

test('resolveDsmFrontendBase selects fixed or origin-based targets', () => {
  assert.equal(
    resolveDsmFrontendBase(
      {
        url: 'https://front.example',
        originPath: null,
        originPort: null,
      },
      'https://ignored.example:3000',
    ),
    'https://front.example',
  );
  assert.equal(
    resolveDsmFrontendBase(
      {
        url: null,
        originPath: '/audio',
        originPort: 5001,
      },
      'https://app.example:8443',
    ),
    'https://app.example:5001/audio',
  );
  assert.equal(
    resolveDsmFrontendBase(
      {
        url: null,
        originPath: '/audio',
        originPort: null,
      },
      null,
    ),
    null,
  );
});
