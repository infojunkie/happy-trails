import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../../src/server/app.js';
import { DsmError } from '../../src/server/dsm.js';
import { LoginRateLimiter } from '../../src/server/loginRateLimit.js';
import { createFixtureContext } from '../fixtures/library.js';
import { startServer } from '../helpers/server.js';

const WINDOW_MS = 60_000;

function makeLimiter(ipMax: number, accountMax: number): LoginRateLimiter {
  return new LoginRateLimiter({ ipMax, accountMax, windowMs: WINDOW_MS });
}

test('login limiter allows attempts below the limits', () => {
  const limiter = makeLimiter(10, 2);
  const now = 1_000_000;
  assert.equal(limiter.check('ip', 'alice', now), 0);
  limiter.record('ip', 'alice', false, now);
  assert.equal(limiter.check('ip', 'alice', now), 0);
});

test('login limiter blocks an account at its limit and reports Retry-After', () => {
  const limiter = makeLimiter(10, 2);
  const now = 1_000_000;
  limiter.record('ip', 'alice', false, now);
  limiter.record('ip', 'alice', false, now);
  assert.equal(limiter.check('ip', 'alice', now), 60);
});

test('login limiter blocks an IP across different accounts', () => {
  const limiter = makeLimiter(2, 10);
  const now = 1_000_000;
  limiter.record('ip', 'alice', false, now);
  limiter.record('ip', 'bob', false, now);
  assert.equal(limiter.check('ip', 'carol', now), 60);
  assert.equal(limiter.check('other-ip', 'carol', now), 0);
});

test('login limiter expires entries after the window', () => {
  const limiter = makeLimiter(10, 1);
  const now = 1_000_000;
  limiter.record('ip', 'alice', false, now);
  assert.equal(limiter.check('ip', 'alice', now + WINDOW_MS - 1), 1);
  assert.equal(limiter.check('ip', 'alice', now + WINDOW_MS), 0);
});

test('login limiter clears account failures on success but keeps IP failures', () => {
  const limiter = makeLimiter(2, 1);
  const now = 1_000_000;
  limiter.record('ip', 'alice', false, now); // ip 1, alice 1
  assert.equal(limiter.check('ip', 'alice', now), 60);
  limiter.record('ip', 'alice', true, now); // clears alice only
  assert.equal(limiter.check('ip', 'alice', now), 0);
  limiter.record('ip', 'alice', false, now); // ip 2, alice 1
  assert.equal(limiter.check('ip', 'alice', now), 60);
});

test('login limiter matches account names case-insensitively', () => {
  const limiter = makeLimiter(10, 1);
  const now = 1_000_000;
  limiter.record('ip', ' Alice ', false, now);
  assert.equal(limiter.check('ip', 'alice', now), 60);
});

test('TRUST_PROXY uses X-Forwarded-For for per-IP limits', async () => {
  const limiter = makeLimiter(1, 100);
  const fixture = await createFixtureContext({
    loginError: new DsmError('bad credentials', 400),
    trustProxy: 1,
  });
  const app = createApp({
    ...fixture.dependencies,
    loginRateLimiter: limiter,
  });
  const server = await startServer(app);

  const login = (forwardedFor: string): Promise<Response> =>
    fetch(`${server.baseUrl}/api/session/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Forwarded-For': forwardedFor,
      },
      body: JSON.stringify({ username: 'alice', password: 'wrong' }),
    });

  try {
    assert.equal((await login('192.0.2.1')).status, 401);
    assert.equal((await login('192.0.2.1')).status, 429);
    // A different client address has its own bucket.
    assert.equal((await login('192.0.2.2')).status, 401);
  } finally {
    await server.close();
    fixture.close();
  }
});

test('POST /api/session/login rate limits per account and per IP', async () => {
  const limiter = makeLimiter(4, 2);
  const fixture = await createFixtureContext({
    loginError: new DsmError('bad credentials', 400),
  });
  let attempts = 0;
  const sessions = fixture.dependencies.userSessions;
  const app = createApp({
    ...fixture.dependencies,
    userSessions: {
      ...sessions,
      async login(username: string, password: string) {
        attempts += 1;
        return sessions.login(username, password);
      },
    },
    loginRateLimiter: limiter,
  });
  const server = await startServer(app);

  const login = (username: string): Promise<Response> =>
    fetch(`${server.baseUrl}/api/session/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password: 'wrong' }),
    });

  try {
    const statuses: number[] = [];
    for (const username of ['alice', 'alice', 'alice', 'bob', 'bob', 'bob']) {
      const response = await login(username);
      statuses.push(response.status);
      if (response.status === 429) {
        assert.ok(
          Number(response.headers.get('retry-after')) > 0,
          '429 must include Retry-After',
        );
        assert.deepEqual(await response.json(), {
          error: 'Too many sign-in attempts. Try again later.',
        });
      }
    }

    // alice is blocked on her third failure; bob gets two attempts before the
    // shared IP limit (4 failures) blocks him as well.
    assert.deepEqual(statuses, [401, 401, 429, 401, 401, 429]);
    assert.equal(attempts, 4, 'limited requests never reach DSM login');
  } finally {
    await server.close();
    fixture.close();
  }
});
