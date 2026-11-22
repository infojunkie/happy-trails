import { test, expect, type Page } from '@playwright/test';

const WAV_SECONDS = 30;
const WAV_RATE = 8_000;

interface StoredSource {
  descriptor?: { mode?: string; q?: string };
  nextOffset?: number;
}

/**
 * A small, valid mono WAV so the browser has real audio to play. It is
 * intentionally silent (all-zero PCM): the tests assert the media clock and
 * UI, not audible output, and this keeps local WebKit/headed runs quiet.
 */
function wavBuffer(seconds = WAV_SECONDS): Buffer {
  const samples = Math.round(seconds * WAV_RATE);
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + samples * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(WAV_RATE, 24);
  buffer.writeUInt32LE(WAV_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
}

/** Serve the audio proxy with a valid WAV, including Range support. */
async function routeAudio(page: Page, seconds = WAV_SECONDS): Promise<void> {
  const body = wavBuffer(seconds);
  await page.route('**/api/stream/**', async (route) => {
    const request = route.request();
    const headers = {
      'content-type': 'audio/wav',
      'accept-ranges': 'bytes',
    };
    if (request.method() === 'HEAD') {
      await route.fulfill({
        status: 200,
        headers: { ...headers, 'content-length': String(body.length) },
      });
      return;
    }

    const range = request.headers()['range'];
    if (!range) {
      await route.fulfill({
        status: 200,
        headers: { ...headers, 'content-length': String(body.length) },
        body,
      });
      return;
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match) {
      await route.fulfill({ status: 416, headers });
      return;
    }
    const startRaw = match[1] ?? '';
    const endRaw = match[2] ?? '';
    let start = startRaw ? Number(startRaw) : 0;
    let end = endRaw ? Number(endRaw) : body.length - 1;
    if (!startRaw && endRaw) {
      start = Math.max(0, body.length - Number(endRaw));
      end = body.length - 1;
    }
    if (start >= body.length) {
      await route.fulfill({
        status: 416,
        headers: { ...headers, 'content-range': `bytes */${body.length}` },
      });
      return;
    }
    end = Math.min(end, body.length - 1);
    const chunk = body.subarray(start, end + 1);
    await route.fulfill({
      status: 206,
      headers: {
        ...headers,
        'content-length': String(chunk.length),
        'content-range': `bytes ${start}-${end}/${body.length}`,
      },
      body: chunk,
    });
  });
}

async function routeCover(page: Page): Promise<void> {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600">' +
    '<rect width="600" height="600" fill="#3b5bdb"/></svg>';
  await page.route(
    /\/api\/albums\/[^/]+\/cover(?:\/original)?$/,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: svg,
      }),
  );
}

async function signIn(page: Page): Promise<void> {
  const response = await page.request.post('/api/session/login', {
    data: { username: 'alice', password: 'secret' },
  });
  expect(response.ok()).toBeTruthy();
}

function albumCard(page: Page, title: string) {
  return page
    .locator('.album-card')
    .filter({ has: page.locator('.album-title', { hasText: new RegExp(`^${title}$`) }) });
}

async function openAbbeyRoad(page: Page): Promise<void> {
  await page.goto(`/?q=${encodeURIComponent('album:"abbey road"')}`);
  const card = albumCard(page, 'Abbey Road').first();
  await expect(card).toBeVisible();
  await card.locator('.album-title').click();
  await expect(page.locator('#album-dialog')).toBeVisible();
  await expect(page.locator('#album-dialog .track-row').first()).toBeVisible();
}

async function audioPlaying(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLAudioElement>('#player-audio audio')].some(
      (audio) => !audio.paused && audio.currentTime > 0,
    ),
  );
}

async function audioState(page: Page): Promise<{
  volume: number | null;
  muted: boolean | null;
  currentTime: number | null;
}> {
  return page.evaluate(() => {
    const audio = document.querySelector<HTMLAudioElement>(
      '#player-audio audio[data-player-current]',
    );
    return {
      volume: audio ? audio.volume : null,
      muted: audio ? audio.muted : null,
      currentTime: audio ? audio.currentTime : null,
    };
  });
}

async function blurActiveElement(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  });
}

interface WakeLockCalls {
  requests: number;
  releases: number;
  lastType: string | null;
}

/** Install a fake Screen Wake Lock implementation before the app loads. */
async function installWakeLockMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const calls: {
      requests: number;
      releases: number;
      lastType: string | null;
    } = { requests: 0, releases: 0, lastType: null };
    (window as unknown as { __wakeLockCalls: typeof calls }).__wakeLockCalls =
      calls;
    Object.defineProperty(Navigator.prototype, 'wakeLock', {
      configurable: true,
      get() {
        return {
          request: async (type: string) => {
            calls.requests += 1;
            calls.lastType = type;
            return new (class extends EventTarget {
              released = false;
              async release(): Promise<void> {
                if (this.released) return;
                this.released = true;
                calls.releases += 1;
                this.dispatchEvent(new Event('release'));
              }
            })();
          },
        };
      },
    });
  });
}

async function wakeLockCalls(page: Page): Promise<WakeLockCalls> {
  return page.evaluate(
    () =>
      (window as unknown as { __wakeLockCalls: WakeLockCalls }).__wakeLockCalls,
  );
}

function assertURL(value: unknown): asserts value is URL {
  expect(value).toBeInstanceOf(URL);
  if (!(value instanceof URL)) throw new Error('Expected a URL');
}

test('Play all in Tracks mode fills the window from the full result set', async ({
  page,
}) => {
  await signIn(page);
  await routeAudio(page);
  const requests: URL[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/playback/tracks')) {
      requests.push(new URL(request.url()));
    }
  });

  await page.goto('/?view=tracks');
  await expect(page.locator('.track-result').first()).toBeVisible();
  const firstTitle = await page
    .locator('.track-result-title')
    .first()
    .innerText();

  const playAll = page.locator('#play-all');
  await expect(playAll).toBeVisible();
  await playAll.click();

  await expect(page.locator('#player-title')).toHaveText(firstTitle);
  await expect(page.locator('#player-queue-count')).toHaveText('48');

  await expect
    .poll(() =>
      page.evaluate(() =>
        (localStorage.getItem('happy-trails.player') ?? '').includes(
          '"source"',
        ),
      ),
    )
    .toBe(true);

  const storedSource = (await page.evaluate(() => {
    const raw = localStorage.getItem('happy-trails.player');
    if (!raw) return null;
    return JSON.parse(raw).source ?? null;
  })) as StoredSource | null;
  expect(storedSource?.descriptor?.mode).toBe('tracks');
  expect(storedSource?.descriptor?.q).toBe('');
  expect(storedSource?.nextOffset).toBe(48);

  await expect.poll(() => requests.length).toBeGreaterThan(0);
  const initial = requests[0];
  assertURL(initial);
  expect(initial?.searchParams.get('mode')).toBe('tracks');
  expect(initial?.searchParams.get('offset')).toBe('0');
  expect(initial?.searchParams.get('limit')).toBe('48');
  expect(initial?.searchParams.get('q')).toBeNull();

  await page.reload();
  await expect(page.locator('#player')).toBeVisible();
  await expect(page.locator('#player-title')).toHaveText(firstTitle);
  await expect(page.locator('#player-queue-count')).toHaveText('48');
  expect(
    await page.evaluate(() => {
      const raw = localStorage.getItem('happy-trails.player');
      if (!raw) return null;
      return JSON.parse(raw).source?.descriptor?.mode ?? null;
    }),
  ).toBe('tracks');
});

test('Play all in Albums mode queues every track of matching albums', async ({
  page,
}) => {
  await signIn(page);
  await routeAudio(page);
  const requests: URL[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/playback/tracks')) {
      requests.push(new URL(request.url()));
    }
  });

  await page.goto(`/?q=${encodeURIComponent('artist:"the beatles"')}`);
  await expect(page.locator('.album-card').first()).toBeVisible();
  await page.locator('#play-all').click();

  await expect(page.locator('#player-title')).toHaveText('Come Together');
  await expect(page.locator('#player-queue-count')).toHaveText('20');
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  expect(requests[0]?.searchParams.get('mode')).toBe('albums');
  expect(requests[0]?.searchParams.get('limit')).toBe('48');

  await page.locator('#player-queue-toggle').click();
  const queueTitles = page.locator(
    '#player-queue-list .player-queue-title',
  );
  await expect(queueTitles).toHaveCount(20);
  await expect(queueTitles.first()).toHaveText('Come Together');
});

test('Play all keeps refilling from the original query after the UI query changes', async ({
  page,
}) => {
  await signIn(page);
  await routeAudio(page);
  const requests: URL[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/playback/tracks')) {
      requests.push(new URL(request.url()));
    }
  });

  await page.goto('/?view=tracks');
  await expect(page.locator('.track-result').first()).toBeVisible();
  await page.locator('#play-all').click();
  await expect(page.locator('#player-queue-count')).toHaveText('48');

  const before = await page
    .locator('#player-queue-list .player-queue-title')
    .allTextContents();
  expect(before).toHaveLength(48);

  // Change the visible result query. The playing source must keep its own q.
  await page.locator('#search').fill('track:"so what"');
  await page.locator('#search').press('Enter');
  await expect(page.locator('#result-summary')).toContainText('tracks');
  await blurActiveElement(page);

  for (let index = 0; index < 36; index += 1) {
    await page.keyboard.press('Shift+ArrowRight');
  }

  await expect
    .poll(() =>
      requests.some(
        (request) => request.searchParams.get('offset') === '48',
      ),
    )
    .toBe(true);
  const refill = requests.find(
    (request) => request.searchParams.get('offset') === '48',
  );
  assertURL(refill);
  expect(refill?.searchParams.get('mode')).toBe('tracks');
  expect(refill?.searchParams.get('q')).toBeNull();
  expect(refill?.searchParams.get('sort')).toBe('recent');
  expect(refill?.searchParams.get('limit')).toBe('36');

  await expect(page.locator('#player-queue-count')).toHaveText('48');
  await expect(
    page.locator('#player-queue-list .player-queue-title').first(),
  ).toHaveText(before[36] ?? '');
  await expect(page.locator('#player-title')).toHaveText(before[36] ?? '');
});

test('manual track or album playback clears the Play all source', async ({
  page,
}) => {
  await signIn(page);
  await routeAudio(page);
  await page.goto('/?view=tracks');
  await expect(page.locator('.track-result').first()).toBeVisible();
  await page.locator('#play-all').click();
  await expect(page.locator('#player-queue-count')).toHaveText('48');

  await page.goto(`/?q=${encodeURIComponent('album:"abbey road"')}`);
  const card = albumCard(page, 'Abbey Road').first();
  await expect(card).toBeVisible();
  await card.locator('.album-play').click();
  await expect(page.locator('#player-title')).toHaveText('Come Together');
  await expect(page.locator('#player-queue-count')).toHaveText('5');

  await expect
    .poll(() =>
      page.evaluate(() => {
        const raw = localStorage.getItem('happy-trails.player');
        if (!raw) return false;
        return Boolean(JSON.parse(raw).source);
      }),
    )
    .toBe(false);
});

test('Play all is hidden while signed out', async ({ page }) => {
  await page.goto('/?view=tracks');
  await expect(page.locator('.track-result').first()).toBeVisible();
  await expect(page.locator('#play-all')).toBeHidden();
});

test('album Play streams through the footer player', async ({ page }) => {
  await signIn(page);
  await routeAudio(page);
  await page.goto(`/?q=${encodeURIComponent('album:"abbey road"')}`);

  const card = albumCard(page, 'Abbey Road').first();
  await expect(card).toBeVisible();
  await card.locator('.album-play').click();

  const player = page.locator('#player');
  await expect(player).toBeVisible();
  await expect(page.locator('#player-title')).toHaveText('Come Together');
  await expect(page.locator('#player-subtitle')).toContainText('The Beatles');
  await expect(page.locator('#player-queue-count')).toHaveText('5');
  await expect(page.locator('#player-toggle')).toHaveAttribute(
    'aria-label',
    'Pause',
  );
  await expect.poll(() => audioPlaying(page)).toBe(true);

  // The transport controls operate on the real audio element.
  await page.locator('#player-toggle').click();
  await expect(page.locator('#player-toggle')).toHaveAttribute(
    'aria-label',
    'Play',
  );
  await expect.poll(() => audioPlaying(page)).toBe(false);
});

test('the player holds a screen wake lock while playing and releases it on pause', async ({
  page,
}) => {
  await installWakeLockMock(page);
  await signIn(page);
  await routeAudio(page);
  await page.goto(`/?q=${encodeURIComponent('album:"abbey road"')}`);

  const card = albumCard(page, 'Abbey Road').first();
  await expect(card).toBeVisible();
  await card.locator('.album-play').click();
  await expect.poll(() => audioPlaying(page)).toBe(true);

  await expect.poll(async () => (await wakeLockCalls(page)).requests).toBe(1);
  expect((await wakeLockCalls(page)).lastType).toBe('screen');

  await page.locator('#player-toggle').click();
  await expect(page.locator('#player-toggle')).toHaveAttribute(
    'aria-label',
    'Play',
  );
  await expect.poll(async () => (await wakeLockCalls(page)).releases).toBe(1);

  await page.locator('#player-toggle').click();
  await expect.poll(() => audioPlaying(page)).toBe(true);
  await expect.poll(async () => (await wakeLockCalls(page)).requests).toBe(2);
});

test('the screen wake lock feature flag disables the request', async ({
  page,
}) => {
  await installWakeLockMock(page);
  const statusResponse = await page.request.get('/api/status');
  const status = (await statusResponse.json()) as Record<string, unknown>;
  await page.route('**/api/status', (route) =>
    route.fulfill({ json: { ...status, screenWakeLockEnabled: false } }),
  );

  await signIn(page);
  await routeAudio(page);
  await page.goto(`/?q=${encodeURIComponent('album:"abbey road"')}`);

  const card = albumCard(page, 'Abbey Road').first();
  await expect(card).toBeVisible();
  await card.locator('.album-play').click();
  await expect.poll(() => audioPlaying(page)).toBe(true);
  expect((await wakeLockCalls(page)).requests).toBe(0);
});

test('track Play queues the album from that track onward', async ({ page }) => {
  await signIn(page);
  await routeAudio(page);
  await openAbbeyRoad(page);

  const something = page
    .locator('#album-dialog .track-row')
    .filter({ has: page.locator('.track-title', { hasText: /^Something$/ }) })
    .first();
  await expect(something).toBeVisible();
  await something.locator('.track-play').click();

  await expect(page.locator('#player-title')).toHaveText('Something');
  await expect(page.locator('#player-queue-count')).toHaveText('4');
  await page.locator('#player-queue-toggle').click();
  const titles = page.locator('#player-queue-list .player-queue-title');
  await expect(titles).toHaveText([
    'Something',
    'While My Guitar Gently Weeps',
    "Maxwell's Silver Hammer",
    'Come Together (Take 1)',
  ]);
});

test('queue items can be reordered and removed; deleting the current item advances', async ({
  page,
}) => {
  await signIn(page);
  await routeAudio(page);
  await page.goto(`/?q=${encodeURIComponent('album:"abbey road"')}`);
  await albumCard(page, 'Abbey Road').first().locator('.album-play').click();
  await expect(page.locator('#player-title')).toHaveText('Come Together');

  await page.locator('#player-queue-toggle').click();
  const items = page.locator('#player-queue-list .player-queue-item');
  await expect(items).toHaveCount(5);

  // Move the first item down one slot.
  const first = items.first();
  await first.hover();
  await first.locator('.player-queue-move').nth(1).click();
  await expect(
    page.locator('#player-queue-list .player-queue-title').first(),
  ).toHaveText('Something');

  // Remove the playing item; playback advances to the item after it.
  const playing = page
    .locator('#player-queue-list .player-queue-item')
    .filter({
      has: page.locator('.player-queue-title', { hasText: /^Come Together$/ }),
    })
    .first();
  await playing.hover();
  await playing.locator('.player-queue-remove').click();
  await expect(page.locator('#player-queue-list .player-queue-item')).toHaveCount(4);
  await expect(page.locator('#player-title')).toHaveText(
    'While My Guitar Gently Weeps',
  );
});

test('cover lightbox opens from album detail and dismisses via X, Escape, and backdrop', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await routeCover(page);
  await page.goto(`/?q=${encodeURIComponent('album:"abbey road"')}`);
  const card = albumCard(page, 'Abbey Road').first();
  await expect(card).toBeVisible();
  await card.locator('.album-title').click();
  await expect(page.locator('#album-dialog')).toBeVisible();

  const coverButton = page.locator('#album-dialog .dialog-cover-button');
  const lightbox = page.locator('#cover-lightbox');
  const image = page.locator('#cover-lightbox-image');
  const coverBox = await coverButton.boundingBox();
  expect(coverBox?.width).toBeCloseTo(112, 0);
  expect(coverBox?.height).toBeCloseTo(112, 0);

  await coverButton.click();
  await expect(lightbox).toBeVisible();
  await expect(lightbox).toHaveAttribute(
    'aria-label',
    'Cover of Abbey Road by The Beatles',
  );
  await expect(image).toHaveAttribute('src', /\/api\/albums\/.+\/cover\/original$/);
  await expect(image).toBeVisible();
  await expect(page.locator('#cover-lightbox-title')).toHaveText('Abbey Road');
  await expect(page.locator('#cover-lightbox-close')).toBeVisible();

  const viewport = page.viewportSize();
  const imageBox = await image.boundingBox();
  expect(viewport).not.toBeNull();
  expect(imageBox).not.toBeNull();
  if (viewport && imageBox) {
    expect(imageBox.x).toBeGreaterThanOrEqual(0);
    expect(imageBox.y).toBeGreaterThanOrEqual(0);
    expect(imageBox.x + imageBox.width).toBeLessThanOrEqual(viewport.width);
    expect(imageBox.y + imageBox.height).toBeLessThanOrEqual(viewport.height);
  }

  await page.locator('#cover-lightbox-close').click();
  await expect(lightbox).toBeHidden();
  await expect(page.locator('#album-dialog')).toBeVisible();

  await coverButton.click();
  await expect(lightbox).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(lightbox).toBeHidden();

  await coverButton.click();
  await expect(lightbox).toBeVisible();
  await page
    .locator('#cover-lightbox-stage')
    .click({ position: { x: 4, y: 4 } });
  await expect(lightbox).toBeHidden();
});

test('cover lightbox falls back when the original cover is missing', async ({
  page,
}) => {
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480">' +
    '<rect width="480" height="480" fill="#6f6b63"/></svg>';
  await page.route(
    /\/api\/albums\/[^/]+\/cover\/original$/,
    (route) => route.fulfill({ status: 404, body: '' }),
  );
  await page.route(
    /\/api\/albums\/[^/]+\/cover$/,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: svg,
      }),
  );

  await page.goto(`/?q=${encodeURIComponent('album:"abbey road"')}`);
  await albumCard(page, 'Abbey Road').first().locator('.album-title').click();
  await page.locator('#album-dialog .dialog-cover-button').click();

  const image = page.locator('#cover-lightbox-image');
  await expect(image).toHaveAttribute(
    'src',
    /\/api\/albums\/.+\/cover$/,
  );
  await expect(image).toBeVisible();
  await expect(page.locator('#cover-lightbox-error')).toBeHidden();
});

test('cover lightbox opens from the player footer', async ({ page }) => {
  await signIn(page);
  await routeAudio(page);
  await routeCover(page);
  await page.goto(`/?q=${encodeURIComponent('album:"abbey road"')}`);
  await albumCard(page, 'Abbey Road').first().locator('.album-play').click();
  await expect(page.locator('#player-title')).toHaveText('Come Together');

  const cover = page.locator('#player-cover');
  await expect(cover).toHaveAttribute(
    'aria-label',
    'View cover for Abbey Road by The Beatles',
  );
  await cover.click();
  await expect(page.locator('#cover-lightbox')).toBeVisible();
  await expect(page.locator('#cover-lightbox-image')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#cover-lightbox')).toBeHidden();
  await expect(page.locator('#player')).toBeVisible();
});

test('selecting a queued track keeps the play queue open', async ({ page }) => {
  await signIn(page);
  await routeAudio(page);
  await page.goto(`/?q=${encodeURIComponent('album:"abbey road"')}`);
  await albumCard(page, 'Abbey Road').first().locator('.album-play').click();
  await expect(page.locator('#player-title')).toHaveText('Come Together');

  await page.locator('#player-queue-toggle').click();
  const queuePanel = page.locator('#player-queue-panel');
  await expect(queuePanel).toBeVisible();

  const something = page
    .locator('#player-queue-list .player-queue-item')
    .filter({
      has: page.locator('.player-queue-title', { hasText: /^Something$/ }),
    })
    .first();
  await something.locator('.player-queue-track').click();

  await expect(page.locator('#player-title')).toHaveText('Something');
  await expect(queuePanel).toBeVisible();
  await expect(page.locator('#player-queue-toggle')).toHaveAttribute(
    'aria-expanded',
    'true',
  );
});

test('seeking updates the position and the remaining time', async ({ page }) => {
  await signIn(page);
  await routeAudio(page);
  await page.goto(`/?q=${encodeURIComponent('album:"abbey road"')}`);
  await albumCard(page, 'Abbey Road').first().locator('.album-play').click();
  await expect(page.locator('#player-title')).toHaveText('Come Together');
  await expect.poll(() => audioPlaying(page)).toBe(true);

  const seek = page.locator('#player-seek');
  await seek.evaluate((input: HTMLInputElement) => {
    input.value = '12';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('#player-elapsed')).toHaveText('0:12');
  await expect(page.locator('#player-remaining')).toContainText('-');
});

test('player state survives a reload and the queue is restored paused', async ({
  page,
}) => {
  await signIn(page);
  await routeAudio(page);
  await page.goto(`/?q=${encodeURIComponent('album:"abbey road"')}`);
  await albumCard(page, 'Abbey Road').first().locator('.album-play').click();
  await expect(page.locator('#player-title')).toHaveText('Come Together');
  await expect.poll(() => audioPlaying(page)).toBe(true);

  await page.locator('#player-toggle').click();
  await page.reload();

  await expect(page.locator('#player')).toBeVisible();
  await expect(page.locator('#player-title')).toHaveText('Come Together');
  await expect(page.locator('#player-toggle')).toHaveAttribute(
    'aria-label',
    'Play',
  );
  await expect(page.locator('#player-queue-count')).toHaveText('5');
  await expect.poll(() => audioPlaying(page)).toBe(false);
});

test('a restored queue stays hidden until the user signs in', async ({
  page,
}) => {
  await signIn(page);
  await routeAudio(page);
  await page.goto(`/?q=${encodeURIComponent('album:"abbey road"')}`);
  await albumCard(page, 'Abbey Road').first().locator('.album-play').click();
  await expect(page.locator('#player-title')).toHaveText('Come Together');
  await expect.poll(() => audioPlaying(page)).toBe(true);
  await page.locator('#player-toggle').click();

  // Simulate an expired server session without the UI's sign-out path, which
  // would deliberately clear the queue.
  const logout = await page.request.post('/api/session/logout');
  expect(logout.ok()).toBeTruthy();
  await page.reload();
  await expect(page.locator('.album-card').first()).toBeVisible();
  await expect(page.locator('#player')).toBeHidden();
  expect(
    await page.evaluate(() => localStorage.getItem('happy-trails.player')),
  ).not.toBeNull();

  await page.locator('#session-button').click();
  await page.locator('#login-username').fill('alice');
  await page.locator('#login-password').fill('secret');
  await page.locator('#login-submit').click();
  await expect(page.locator('#player')).toBeVisible();
  await expect(page.locator('#player-title')).toHaveText('Come Together');
  await expect(page.locator('#player-toggle')).toHaveAttribute(
    'aria-label',
    'Play',
  );
  await expect(page.locator('#player-queue-count')).toHaveText('5');
});

test('Audio Station links remain when native playback is disabled', async ({
  page,
}) => {
  await signIn(page);
  const status = (await (
    await page.request.get('/api/status')
  ).json()) as Record<string, unknown>;
  await page.route('**/api/status', async (route) => {
    await route.fulfill({
      json: {
        ...status,
        nativePlaybackEnabled: false,
        audioStationFallbackEnabled: true,
      },
    });
  });

  await page.goto(`/?q=${encodeURIComponent('album:"abbey road"')}`);
  const card = albumCard(page, 'Abbey Road').first();
  await expect(card).toBeVisible();
  const play = card.locator('.album-play');
  await expect(play).toContainText('Play in Audio Station');
  await expect(play).toHaveAttribute('href', /^\/play\//);
  await expect(page.locator('#player')).toBeHidden();
});

test('the Audio Station fallback can be hidden while native playback stays on', async ({
  page,
}) => {
  await signIn(page);
  const status = (await (
    await page.request.get('/api/status')
  ).json()) as Record<string, unknown>;
  await page.route('**/api/status', async (route) => {
    await route.fulfill({
      json: {
        ...status,
        nativePlaybackEnabled: true,
        audioStationFallbackEnabled: false,
      },
    });
  });

  await page.goto(`/?q=${encodeURIComponent('album:"abbey road"')}`);
  const card = albumCard(page, 'Abbey Road').first();
  await expect(card).toBeVisible();
  await expect(card.locator('.album-play')).toContainText('Play');
  await card.locator('.album-title').click();
  await expect(page.locator('#album-dialog .dialog-play')).toBeVisible();
  await expect(page.locator('#album-dialog .dialog-fallback')).toHaveCount(0);
});

test('volume and mute update both audio elements', async ({ page }) => {
  await signIn(page);
  await routeAudio(page);
  await page.goto(`/?q=${encodeURIComponent('album:"abbey road"')}`);
  await albumCard(page, 'Abbey Road').first().locator('.album-play').click();
  await expect.poll(() => audioPlaying(page)).toBe(true);

  await page.locator('#player-volume').evaluate((input: HTMLInputElement) => {
    input.value = '0.4';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(async () => (await audioState(page)).volume).toBeCloseTo(
    0.4,
    2,
  );
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem('happy-trails.player-volume')),
    )
    .toBe('0.4');

  await page.locator('#player-mute').click();
  await expect(page.locator('#player-mute')).toHaveAttribute(
    'aria-label',
    'Unmute',
  );
  await expect.poll(async () => (await audioState(page)).muted).toBe(true);

  await page.locator('#player-mute').click();
  await expect(page.locator('#player-mute')).toHaveAttribute(
    'aria-label',
    'Mute',
  );
  await expect.poll(async () => (await audioState(page)).muted).toBe(false);
  await expect
    .poll(async () => (await audioState(page)).volume)
    .toBeCloseTo(0.4, 2);
});

test('player keyboard shortcuts seek, skip, mute, and restart', async ({
  page,
}) => {
  await signIn(page);
  await routeAudio(page);
  await page.goto(`/?q=${encodeURIComponent('album:"abbey road"')}`);
  await albumCard(page, 'Abbey Road').first().locator('.album-play').click();
  await expect(page.locator('#player-title')).toHaveText('Come Together');
  await expect.poll(() => audioPlaying(page)).toBe(true);

  await blurActiveElement(page);
  await page.keyboard.press('Space');
  await expect(page.locator('#player-toggle')).toHaveAttribute(
    'aria-label',
    'Play',
  );
  await page.keyboard.press('Space');
  await expect(page.locator('#player-toggle')).toHaveAttribute(
    'aria-label',
    'Pause',
  );

  const beforeSeek = (await audioState(page)).currentTime ?? 0;
  await page.keyboard.press('ArrowRight');
  await expect
    .poll(async () => (await audioState(page)).currentTime ?? 0)
    .toBeGreaterThan(beforeSeek + 3);

  await page.keyboard.press('Shift+ArrowRight');
  await expect(page.locator('#player-title')).toHaveText('Something');

  await page.keyboard.press('m');
  await expect.poll(async () => (await audioState(page)).muted).toBe(true);
  await page.keyboard.press('m');
  await expect.poll(async () => (await audioState(page)).muted).toBe(false);

  const beforeVolume = (await audioState(page)).volume ?? 1;
  await page.keyboard.press('ArrowDown');
  await expect
    .poll(async () => (await audioState(page)).volume ?? 1)
    .toBeLessThan(beforeVolume);

  await page.keyboard.press('r');
  await expect
    .poll(async () => (await audioState(page)).currentTime ?? 99)
    .toBeLessThan(2);
});

test('Media Session position state follows playback and seeking', async ({
  page,
}) => {
  await signIn(page);
  await routeAudio(page);
  await page.goto(`/?q=${encodeURIComponent('album:"abbey road"')}`);

  const available = await page.evaluate(() => {
    const session = navigator.mediaSession;
    if (!session || typeof session.setPositionState !== 'function') return false;
    const original = session.setPositionState.bind(session);
    const target = window as unknown as {
      __positionStates: Array<
        { duration: number; playbackRate: number; position: number } | null
      >;
    };
    target.__positionStates = [];
    session.setPositionState = (state?: MediaPositionState) => {
      target.__positionStates.push(
        state
          ? {
              duration: state.duration ?? 0,
              playbackRate: state.playbackRate ?? 1,
              position: state.position ?? 0,
            }
          : null,
      );
      return original(state);
    };
    return true;
  });
  test.skip(!available, 'Media Session position state is unavailable');

  await albumCard(page, 'Abbey Road').first().locator('.album-play').click();
  await expect.poll(() => audioPlaying(page)).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __positionStates: Array<
                { duration: number; playbackRate: number; position: number } | null
              >;
            }
          ).__positionStates.length,
      ),
    )
    .toBeGreaterThan(0);

  const initial = await page.evaluate(() => {
    const states = (
      window as unknown as {
        __positionStates: Array<
          { duration: number; playbackRate: number; position: number } | null
        >;
      }
    ).__positionStates;
    return states.at(-1) ?? null;
  });
  expect(initial).not.toBeNull();
  expect(initial?.duration).toBeGreaterThan(0);
  expect(initial?.position).toBeGreaterThanOrEqual(0);
  expect(initial?.position).toBeLessThanOrEqual(initial?.duration ?? 0);
  expect(initial?.playbackRate).toBeGreaterThan(0);

  await page.locator('#player-seek').evaluate((input: HTMLInputElement) => {
    input.value = '12';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const states = (
          window as unknown as {
            __positionStates: Array<
              { duration: number; playbackRate: number; position: number } | null
            >;
          }
        ).__positionStates;
        return states.at(-1)?.position ?? -1;
      }),
    )
    .toBeGreaterThan(9);
});

test('typing in the search field does not trigger player shortcuts', async ({
  page,
}) => {
  await signIn(page);
  await routeAudio(page);
  await page.goto(`/?q=${encodeURIComponent('album:"abbey road"')}`);
  await albumCard(page, 'Abbey Road').first().locator('.album-play').click();
  await expect.poll(() => audioPlaying(page)).toBe(true);

  await page.locator('#search').click();
  await page.locator('#search').fill('beatles');
  const before = await page.locator('#player-toggle').getAttribute('aria-label');
  await page.locator('#search').press('Space');
  await expect(page.locator('#search')).toHaveValue('beatles ');
  await expect(page.locator('#player-toggle')).toHaveAttribute(
    'aria-label',
    before ?? 'Pause',
  );
});

test('? opens the collapsed help dialog with all keyboard shortcuts', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.album-card').first()).toBeVisible();
  await blurActiveElement(page);
  await page.keyboard.press('?');
  await expect(page.locator('#search-help-dialog')).toBeVisible();
  await expect(page.locator('#search-help-title')).toHaveText('Help');

  const shortcuts = page.locator('.help-section').first();
  await expect(shortcuts).not.toHaveAttribute('open');
  await shortcuts.locator('summary').click();
  await expect(shortcuts).toHaveAttribute('open');
  await expect(page.locator('.search-help-shortcuts')).toContainText(
    'Play or pause the player',
  );
  await expect(page.locator('.search-help-shortcuts')).toContainText(
    'Mute or unmute',
  );
  await expect(page.locator('.search-help-shortcuts')).toContainText(
    'Restart the current track',
  );
});

test('unsupported tracks show a warning icon', async ({ page }) => {
  await signIn(page);
  await routeAudio(page);
  await openAbbeyRoad(page);

  const maxwell = page
    .locator('#album-dialog .track-row')
    .filter({
      has: page.locator('.track-title', {
        hasText: /^Maxwell's Silver Hammer$/,
      }),
    })
    .first();
  await expect(maxwell.locator('.track-warning')).toHaveAttribute(
    'title',
    'Unsupported format',
  );
  await expect(maxwell.locator('.track-warning')).toHaveAttribute(
    'aria-label',
    'Unsupported format',
  );

  const something = page
    .locator('#album-dialog .track-row')
    .filter({ has: page.locator('.track-title', { hasText: /^Something$/ }) })
    .first();
  await expect(something.locator('.track-warning')).toHaveCount(0);

  await page.locator('#album-dialog .dialog-close').click();
  await page.goto(
    `/?view=tracks&q=${encodeURIComponent('track:"maxwell\'s silver hammer"')}`,
  );
  const result = page.locator('.track-result').first();
  await expect(result.locator('.track-warning')).toHaveAttribute(
    'title',
    'Unsupported format',
  );

  await page.goto(`/?q=${encodeURIComponent('album:"abbey road"')}`);
  await albumCard(page, 'Abbey Road').first().locator('.album-play').click();
  await page.locator('#player-queue-toggle').click();
  const queued = page
    .locator('#player-queue-list .player-queue-item')
    .filter({
      has: page.locator('.player-queue-title', {
        hasText: /^Maxwell's Silver Hammer$/,
      }),
    })
    .first();
  await expect(queued.locator('.track-warning')).toHaveAttribute(
    'title',
    'Unsupported format',
  );
});

test('playback continues while the user opens album dialogs', async ({
  page,
}) => {
  await signIn(page);
  await routeAudio(page);
  await page.goto(`/?q=${encodeURIComponent('album:"abbey road"')}`);
  await albumCard(page, 'Abbey Road').first().locator('.album-play').click();
  await expect.poll(() => audioPlaying(page)).toBe(true);

  await albumCard(page, 'Abbey Road').first().locator('.album-title').click();
  await expect(page.locator('#album-dialog')).toBeVisible();
  await expect.poll(() => audioPlaying(page)).toBe(true);
  await expect(page.locator('#player-toggle')).toHaveAttribute(
    'aria-label',
    'Pause',
  );
});
