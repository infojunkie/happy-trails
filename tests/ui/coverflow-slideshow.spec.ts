import { test, expect, type Page } from '@playwright/test';

async function shortSlideshow(
  page: Page,
  options: { intervalMs?: number; pageSize?: number } = {},
): Promise<void> {
  const intervalMs = options.intervalMs ?? 250;
  const pageSize = options.pageSize ?? 48;
  await page.route('**/api/status', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...body, coverflowIntervalMs: intervalMs, pageSize }),
    });
  });
}

async function openFullscreenCoverflow(page: Page): Promise<void> {
  await page.locator('#view-switch button[data-view="coverflow"]').click();
  await expect(page.locator('.cf-root')).toBeVisible();
  await page.locator('#coverflow-fullscreen').click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const wrap = document.querySelector('.album-coverflow-wrap');
        return (
          document.fullscreenElement === wrap ||
          wrap?.classList.contains('is-expanded') === true
        );
      }),
    )
    .toBe(true);
}

function captionTitle(page: Page) {
  return page.locator('.coverflow-caption-title');
}

test('full-screen slideshow advances, loads later pages, and loops', async ({
  page,
}) => {
  await shortSlideshow(page, { intervalMs: 250, pageSize: 2 });
  await page.goto('/');
  const firstPageResponse = await page.request.get(
    '/api/albums?sort=added&order=desc&limit=2',
  );
  const firstPage = (await firstPageResponse.json()) as {
    albums: Array<{ album: string }>;
  };
  const firstPageTitles = firstPage.albums.map((album) => album.album);
  expect(firstPageTitles).toHaveLength(2);

  await openFullscreenCoverflow(page);
  const initialTitle = (await captionTitle(page).textContent()) ?? '';
  expect(firstPageTitles).toContain(initialTitle);

  // Watch the captions: seeing an album outside the first page proves the
  // next page was fetched without pressing Load more; seeing the first title
  // again proves the full query was traversed and looped.
  const observed = await page.evaluate(
    ({ firstPageTitles: firstPage, initialTitle: initial, timeout }) =>
      new Promise<{ outside: boolean; looped: boolean; titles: string[] }>(
        (resolve) => {
          const titles: string[] = [];
          let last = '';
          let outside = false;
          const start = performance.now();
          const tick = (): void => {
            const title =
              document.querySelector('.coverflow-caption-title')
                ?.textContent ?? '';
            if (title && title !== last) {
              titles.push(title);
              last = title;
              if (!firstPage.includes(title)) outside = true;
            }
            const looped =
              titles.filter((entry) => entry === initial).length >= 2;
            if ((outside && looped) || performance.now() - start > timeout) {
              resolve({ outside, looped, titles });
              return;
            }
            window.setTimeout(tick, 30);
          };
          tick();
        },
      ),
    { firstPageTitles, initialTitle, timeout: 20_000 },
  );

  expect(observed.outside).toBe(true);
  expect(observed.looped).toBe(true);
  expect(observed.titles.length).toBeGreaterThan(2);
});

test('full screen scales covers up to the viewport maximum', async ({
  page,
}) => {
  await page.goto('/');
  await page.locator('#view-switch button[data-view="coverflow"]').click();
  await expect(page.locator('.cf-root')).toBeVisible();
  const cardSize = (): Promise<number> =>
    page.evaluate(() => {
      const root = document.querySelector('.cf-root');
      if (!root) return 0;
      return (
        Number.parseFloat(
          getComputedStyle(root).getPropertyValue('--cf-card-size'),
        ) || 0
      );
    });

  const before = await cardSize();
  expect(before).toBeGreaterThan(0);

  await page.locator('#coverflow-fullscreen').click();
  await expect.poll(cardSize).toBeGreaterThan(before);

  // Measure against the carousel's actual viewport: headless full-screen
  // dimensions can differ from Playwright's configured viewport (Firefox).
  const metrics = await page.evaluate(() => {
    const root = document.querySelector('.cf-root');
    const viewport = root?.querySelector('.cf-viewport');
    return {
      size:
        Number.parseFloat(
          root
            ? getComputedStyle(root).getPropertyValue('--cf-card-size')
            : '',
        ) || 0,
      width: viewport?.clientWidth ?? 0,
      height: viewport?.clientHeight ?? 0,
    };
  });
  expect(metrics.size).toBeGreaterThan(360);
  const widthFactor = metrics.width < 600 ? 0.62 : 0.32;
  expect(metrics.size).toBeLessThanOrEqual(metrics.width * widthFactor + 2);
  expect(metrics.size).toBeLessThanOrEqual(metrics.height * 0.57 + 2);

  await page.locator('#coverflow-fullscreen').click();
  await expect.poll(cardSize).toBeLessThan(metrics.size);
});

test('opening an album pauses the slideshow and closing resumes it', async ({
  page,
}) => {
  test.setTimeout(45_000);
  await shortSlideshow(page, { intervalMs: 800 });
  await page.goto('/');
  await openFullscreenCoverflow(page);
  // Activate whichever cover is selected when the dialog opens; keyboard
  // activation avoids racing the carousel's pointer-stability checks.
  await page.locator('.cf-viewport').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#album-dialog')).toBeVisible();
  const pausedTitle = (await captionTitle(page).textContent()) ?? '';
  await page.waitForTimeout(1_600);
  expect(await captionTitle(page).textContent()).toBe(pausedTitle);

  await page.locator('#album-dialog .dialog-close').click();
  await expect(page.locator('#album-dialog')).toBeHidden();
  await expect
    .poll(async () => (await captionTitle(page).textContent()) ?? '', {
      timeout: 10_000,
    })
    .not.toBe(pausedTitle);
});

test('explicitly exiting full screen stops the slideshow', async ({ page }) => {
  await shortSlideshow(page, { intervalMs: 250 });
  await page.goto('/');
  await openFullscreenCoverflow(page);
  const initialTitle = (await captionTitle(page).textContent()) ?? '';

  await expect
    .poll(async () => (await captionTitle(page).textContent()) ?? '', {
      timeout: 10_000,
    })
    .not.toBe(initialTitle);

  await page.locator('#coverflow-fullscreen').click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const wrap = document.querySelector('.album-coverflow-wrap');
        return (
          document.fullscreenElement !== wrap &&
          wrap?.classList.contains('is-expanded') !== true
        );
      }),
    )
    .toBe(true);

  const stoppedTitle = (await captionTitle(page).textContent()) ?? '';
  await page.waitForTimeout(900);
  expect(await captionTitle(page).textContent()).toBe(stoppedTitle);
});
