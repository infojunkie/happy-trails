import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatOriginTarget,
  parseAllowedFrontendOrigins,
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
      originPort: null,
    },
  );
  assert.deepEqual(
    parseDsmFrontendUrl('  http://front.example/path  ', 'https://dsm'),
    {
      url: 'http://front.example/path',
      originPort: null,
    },
  );
});

test('an empty frontend URL falls back to the DSM URL', () => {
  assert.deepEqual(parseDsmFrontendUrl('', 'https://dsm:5001'), {
    url: 'https://dsm:5001',
    originPort: null,
  });
  assert.deepEqual(parseDsmFrontendUrl('   ', 'https://dsm:5001'), {
    url: 'https://dsm:5001',
    originPort: null,
  });
  assert.deepEqual(parseDsmFrontendUrl(undefined, ''), {
    url: null,
    originPort: null,
  });
});

test('a port-only value uses the allow-listed request origin', () => {
  assert.deepEqual(parseDsmFrontendUrl(':5001', 'https://dsm'), {
    url: null,
    originPort: 5001,
  });
  assert.deepEqual(parseDsmFrontendUrl('  :443  ', 'https://dsm'), {
    url: null,
    originPort: 443,
  });
});

test('path rewriting and invalid values are rejected at startup', () => {
  for (const value of [
    '/',
    '/audio',
    '/audio:5001',
    'audio/nested',
    '$ORIGIN:0',
    ':0',
    ':65536',
    ':abc',
    'ftp://front.example',
    'not a url',
    'https://',
  ]) {
    assert.throws(
      () => parseDsmFrontendUrl(value, 'https://dsm'),
      /DSM_FRONTEND_URL must be an http\(s\) URL or ":port"/,
      value,
    );
  }
});

test('allowed frontend origins are exact and normalised', () => {
  assert.deepEqual(parseAllowedFrontendOrigins(undefined), []);
  assert.deepEqual(parseAllowedFrontendOrigins('   '), []);
  assert.deepEqual(
    parseAllowedFrontendOrigins(
      ' https://app.example:8443 , https://app.example/ , https://APP.example:8443 ',
    ),
    ['https://app.example:8443', 'https://app.example'],
  );
  assert.deepEqual(
    parseAllowedFrontendOrigins('http://192.168.1.10:3000'),
    ['http://192.168.1.10:3000'],
  );
});

test('allowed frontend origins reject paths, credentials, and non-http URLs', () => {
  for (const value of [
    'ftp://app.example',
    'https://app.example/path',
    'https://user:pass@app.example',
    'https://app.example?x=1',
    'not a url',
  ]) {
    assert.throws(
      () => parseAllowedFrontendOrigins(value),
      /DSM_FRONTEND_ALLOWED_ORIGINS/,
      value,
    );
  }
});

test('formatOriginTarget applies the configured port', () => {
  assert.equal(
    formatOriginTarget('https://app.example:8443', 443),
    'https://app.example/',
  );
  assert.equal(
    formatOriginTarget('https://app.example:3000', 5001),
    'https://app.example:5001/',
  );
  assert.equal(
    formatOriginTarget('https://app.example:3000', null),
    'https://app.example:3000/',
  );
  assert.equal(
    formatOriginTarget('http://app.example', null),
    'http://app.example/',
  );
  assert.equal(formatOriginTarget('not a url', 5001), null);
});

test('resolveDsmFrontendBase selects fixed or origin-based targets', () => {
  assert.equal(
    resolveDsmFrontendBase(
      {
        url: 'https://front.example',
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
        originPort: 5001,
      },
      'https://app.example:8443',
    ),
    'https://app.example:5001/',
  );
  assert.equal(
    resolveDsmFrontendBase(
      {
        url: null,
        originPort: null,
      },
      'https://app.example:8443',
    ),
    null,
  );
  assert.equal(
    resolveDsmFrontendBase(
      {
        url: null,
        originPort: 5001,
      },
      null,
    ),
    null,
  );
});
