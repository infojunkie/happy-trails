import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { createApp } from '../../src/server/app.js';
import {
  DsmError,
  normalizeAudioContentType,
} from '../../src/server/dsm.js';
import {
  createFixtureContext,
  type FixtureContext,
  type FixtureOptions,
} from '../fixtures/library.js';
import {
  cookieFrom,
  startServer,
  type TestServer,
} from '../helpers/server.js';

const AUDIO = Buffer.from(Array.from({ length: 64 }, (_, index) => index));

interface RunningFixture {
  context: FixtureContext;
  server: TestServer;
}

async function runFixture(options: FixtureOptions = {}): Promise<RunningFixture> {
  const context = await createFixtureContext(options);
  const server = await startServer(createApp(context.dependencies));
  return { context, server };
}

async function closeFixture(fixture: RunningFixture): Promise<void> {
  await fixture.server.close();
  fixture.context.close();
}

async function login(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/session/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'alice', password: 'secret' }),
  });
  assert.equal(response.status, 200);
  const cookie = cookieFrom(response);
  assert.ok(cookie);
  return cookie;
}

let main: RunningFixture;
let cookie: string;

before(async () => {
  main = await runFixture({
    audioStream: AUDIO,
    audioStreamContentType: 'audio/x-flac',
  });
  cookie = await login(main.server.baseUrl);
});

after(async () => {
  await closeFixture(main);
});

test('GET /api/stream requires a signed-in session', async () => {
  const response = await fetch(`${main.server.baseUrl}/api/stream/12`);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = (await response.json()) as { error: string };
  assert.match(body.error, /sign in/i);
});

test('GET /api/stream rejects invalid track ids', async () => {
  const response = await fetch(`${main.server.baseUrl}/api/stream/not-a-number`, {
    headers: { Cookie: cookie },
  });
  assert.equal(response.status, 400);
  const body = (await response.json()) as { error: string };
  assert.match(body.error, /invalid track id/i);
});

test('GET /api/stream forwards Range and normalizes the audio MIME type', async () => {
  const response = await fetch(`${main.server.baseUrl}/api/stream/12`, {
    headers: { Cookie: cookie, Range: 'bytes=4-11' },
  });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-type'), 'audio/flac');
  assert.equal(response.headers.get('content-length'), '8');
  assert.equal(response.headers.get('content-range'), 'bytes 4-11/64');
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.equal(
    response.headers.get('cache-control'),
    'private, max-age=3600',
  );
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  const body = Buffer.from(await response.arrayBuffer());
  assert.deepEqual([...body], [4, 5, 6, 7, 8, 9, 10, 11]);

  assert.deepEqual(main.context.streamCalls.at(-1), {
    musicId: 12,
    range: 'bytes=4-11',
    ifRange: undefined,
    method: 'GET',
  });
});

test('HEAD /api/stream reports metadata without a body', async () => {
  const response = await fetch(`${main.server.baseUrl}/api/stream/12`, {
    method: 'HEAD',
    headers: { Cookie: cookie },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/flac');
  assert.equal(response.headers.get('content-length'), String(AUDIO.length));
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  const body = Buffer.from(await response.arrayBuffer());
  assert.equal(body.length, 0);

  assert.deepEqual(main.context.streamCalls.at(-1), {
    musicId: 12,
    range: undefined,
    ifRange: undefined,
    method: 'HEAD',
  });
});

test('GET /api/stream returns 416 for a range beyond the end', async () => {
  const response = await fetch(`${main.server.baseUrl}/api/stream/12`, {
    headers: { Cookie: cookie, Range: 'bytes=100-200' },
  });
  assert.equal(response.status, 416);
  assert.equal(response.headers.get('content-range'), 'bytes */64');
  const body = Buffer.from(await response.arrayBuffer());
  assert.equal(body.length, 0);
});

test('GET /api/stream returns 404 when the track has no playable file', async () => {
  const fixture = await runFixture({ audioStream: null });
  try {
    const session = await login(fixture.server.baseUrl);
    const response = await fetch(`${fixture.server.baseUrl}/api/stream/12`, {
      headers: { Cookie: session },
    });
    assert.equal(response.status, 404);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /not found/i);
  } finally {
    await closeFixture(fixture);
  }
});

test('GET /api/stream is unavailable when native playback is disabled', async () => {
  const fixture = await runFixture({
    nativePlaybackEnabled: false,
    audioStream: AUDIO,
  });
  try {
    const session = await login(fixture.server.baseUrl);
    const response = await fetch(`${fixture.server.baseUrl}/api/stream/12`, {
      headers: { Cookie: session },
    });
    assert.equal(response.status, 503);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /not enabled/i);
  } finally {
    await closeFixture(fixture);
  }
});

test('GET /api/stream returns 502 when DSM rejects the stream', async () => {
  const fixture = await runFixture({
    streamError: new DsmError('session rejected', 105),
  });
  try {
    const session = await login(fixture.server.baseUrl);
    const response = await fetch(`${fixture.server.baseUrl}/api/stream/12`, {
      headers: { Cookie: session },
    });
    assert.equal(response.status, 502);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /could not stream/i);
  } finally {
    await closeFixture(fixture);
  }
});

test('normalizeAudioContentType maps browser-relevant aliases', () => {
  assert.equal(normalizeAudioContentType('audio/x-flac'), 'audio/flac');
  assert.equal(normalizeAudioContentType('audio/x-wav'), 'audio/wav');
  assert.equal(normalizeAudioContentType('audio/wave; charset=binary'), 'audio/wav');
  assert.equal(normalizeAudioContentType('audio/mpeg'), 'audio/mpeg');
  assert.equal(normalizeAudioContentType('audio/x-ms-wma'), 'audio/x-ms-wma');
  assert.equal(normalizeAudioContentType(undefined), 'application/octet-stream');
});
