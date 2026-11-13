import { test, expect, type Browser, type Page } from '@playwright/test';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const file = process.env.MOVIE_E2E_STATE_FILE;
if (!file) throw new Error('Set MOVIE_E2E_STATE_FILE to the private temporary test-session file.');
const state = JSON.parse(readFileSync(file, 'utf8'));
const backend: string = state.backend ?? 'https://zkemdupefosllskayozr.supabase.co';
const functions: string = state.functions ?? backend + '/functions/v1';
const site = new URL(process.env.MOVIE_E2E_BASE_URL ?? 'http://localhost:3100');
for (const session of [state.session, state.guest_session])
  if (!session?.user?.email?.endsWith('@example.invalid'))
    throw new Error('Movie acceptance tests require temporary test accounts.');
async function api(path: string, body: unknown, guest = false) {
  const response = await fetch(
    path.startsWith('/functions/v1/')
      ? functions + path.slice('/functions/v1'.length)
      : backend + path,
    {
      method: 'POST',
      headers: {
        apikey: state.anon,
        Authorization: 'Bearer ' + (guest ? state.guest_session : state.session).access_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
  return response.json();
}
async function signed(browser: Browser, guest = false) {
  const context = await browser.newContext();
  const session = guest ? state.guest_session : state.session;
  const name = `sb-${new URL(backend).hostname.split('.')[0]}-auth-token`;
  const value = 'base64-' + Buffer.from(JSON.stringify(session)).toString('base64url');
  const chunks = Array.from({ length: Math.ceil(value.length / 3180) }, (_, index) =>
    value.slice(index * 3180, (index + 1) * 3180),
  );
  await context.addCookies([
    ...chunks.map((chunk, index) => ({
      name: chunks.length === 1 ? name : `${name}.${index}`,
      value: chunk,
      domain: site.hostname,
      path: '/',
      httpOnly: false,
      secure: site.protocol === 'https:',
      sameSite: 'Lax' as const,
    })),
  ]);
  return { context, page: await context.newPage() };
}
async function movieRows() {
  const response = await fetch(backend + '/rest/v1/movie_library?select=id,title,status', {
    headers: { apikey: state.anon, Authorization: 'Bearer ' + state.session.access_token },
  });
  return response.json() as Promise<Array<{ id: string; title: string; status: string }>>;
}
async function clean() {
  for (const movie of await movieRows())
    await api('/functions/v1/movie-delete', { movie_id: movie.id });
}
async function seeded(title = 'Movie acceptance test') {
  const id = crypto.randomUUID();
  const bytes = readFileSync(join(__dirname, '../apps/web/test/fixtures/playable.mp4'));
  const started = await api('/functions/v1/movie-upload-start', {
    movie_id: id,
    title,
    size_bytes: bytes.length,
    content_type: 'video/mp4',
    duration_sec: 20,
    width: 160,
    height: 90,
  });
  expect(started.ok).toBe(true);
  const urls = await api('/functions/v1/movie-upload-urls', { movie_id: id, part_numbers: [1] });
  const put = await fetch(urls.data.urls['1'], { method: 'PUT', body: bytes });
  expect(put.ok).toBe(true);
  const completed = await api('/functions/v1/movie-upload-complete', { movie_id: id });
  expect(completed.ok).toBe(true);
  return id;
}
async function enter(page: Page, path: string) {
  await page.bringToFront();
  await page.goto(path);
  const button = page.getByRole('button', { name: 'Take your seat', exact: true });
  await expect(page.getByTestId('movie-video').or(button)).toBeVisible({ timeout: 45000 });
  if (await button.isVisible()) await button.click();
  await expect(page.getByTestId('movie-video')).toBeVisible({ timeout: 45000 });
}
test.beforeEach(async () => {
  await clean();
});
test.afterEach(async () => {
  await clean();
});
test('E24: prepare an MKV with Dolby sound, upload and play it', async ({ browser }) => {
  const source = join(__dirname, '.auth', 'upload-ac3.mkv');
  mkdirSync(join(__dirname, '.auth'), { recursive: true });
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=24:duration=20',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=20', '-c:v', 'libx264', '-c:a', 'ac3', '-y', source]);
  const host = await signed(browser);
  const guest = await signed(browser, true);
  try {
    await host.page.goto('/movies');
    await host.page.getByLabel('Choose a movie', { exact: true }).setInputFiles(source);
    await expect(host.page.getByLabel('Movie title', { exact: true })).toBeVisible({ timeout: 60000 });
    await host.page.getByLabel('Movie title', { exact: true }).fill('MKV upload acceptance');
    await host.page.getByRole('button', { name: 'Upload movie', exact: true }).click();
    await expect(host.page.getByRole('button', { name: 'Watch together', exact: true })).toBeVisible({ timeout: 60000 });
    await host.page.getByRole('button', { name: 'Watch together', exact: true }).click();
    await expect(host.page.getByRole('dialog', { name: 'Invite friends' })).toBeVisible({ timeout: 45000 });
    const invite = new URL(await host.page.getByLabel('Private room invite link').inputValue());
    await host.page.keyboard.press('Escape');
    await enter(guest.page, invite.pathname + invite.hash);
    const player = host.page.getByTestId('movie-video');
    await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
    await player.evaluate((video: HTMLVideoElement) => video.play());
    await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0.2);
    await player.evaluate((video: HTMLVideoElement) => { video.currentTime = 10; });
    await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThanOrEqual(10);
    await expect.poll(() => guest.page.getByTestId('movie-video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(false);
    await expect.poll(async () => {
      const times = await Promise.all([host.page, guest.page].map(page =>
        page.getByTestId('movie-video').evaluate((video: HTMLVideoElement) => video.currentTime)));
      return Math.abs(times[0]! - times[1]!);
    }).toBeLessThan(0.3);
  } finally {
    await host.context.close();
    await guest.context.close();
    const { unlinkSync } = await import('node:fs');
    unlinkSync(source);
  }
});
test('E16: upload a movie through the browser and watch with another member', async ({
  browser,
}) => {
  const host = await signed(browser);
  const guest = await signed(browser, true);
  try {
    await host.page.goto('/movies');
    await expect(
      host.page.getByRole('heading', { name: 'Your movies', exact: true }),
    ).toBeVisible();
    await host.page
      .getByLabel('Choose a movie', { exact: true })
      .setInputFiles(join(__dirname, '../apps/web/test/fixtures/playable.mp4'));
    await host.page.getByLabel('Movie title', { exact: true }).fill('Browser acceptance movie');
    await host.page.getByRole('button', { name: 'Upload movie', exact: true }).click();
    await expect(
      host.page.getByRole('button', { name: 'Watch together', exact: true }),
    ).toBeVisible({
      timeout: 60000,
    });
    await host.page.getByRole('button', { name: 'Watch together', exact: true }).click();
    await expect(host.page.getByRole('dialog', { name: 'Invite friends' })).toBeVisible({
      timeout: 45000,
    });
    await expect(host.page.getByLabel('Private room invite link')).toHaveValue(/https?:/);
    const link = await host.page.getByLabel('Private room invite link').inputValue();
    const parsed = new URL(link);
    await host.page.keyboard.press('Escape');
    await expect(host.page.getByRole('dialog', { name: 'Invite friends' })).toBeHidden();
    await host.page.getByRole('button', { name: 'Invite', exact: true }).click();
    await expect(host.page.getByLabel('Private room invite link')).toHaveValue(link);
    await host.page.bringToFront();
    await host.context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await host.page.getByRole('button', { name: 'Copy link', exact: true }).click();
    await expect(host.page.getByText('Invite link copied.', { exact: true })).toBeVisible();
    await host.page.getByRole('button', { name: 'Close', exact: true }).click();
    await enter(guest.page, parsed.pathname + parsed.hash);
    await expect(host.page.getByTestId('movie-video')).toBeVisible();
    await expect
      .poll(() =>
        guest.page.getByTestId('movie-video').evaluate((v: HTMLVideoElement) => v.readyState),
      )
      .toBeGreaterThanOrEqual(1);
    await host.page.getByTestId('movie-video').evaluate((v: HTMLVideoElement) => v.play());
    await expect
      .poll(() => guest.page.getByTestId('movie-video').evaluate((v: HTMLVideoElement) => v.paused))
      .toBe(false);
    await expect
      .poll(
        async () => {
          const positions = await Promise.all(
            [host.page, guest.page].map((page) =>
              page.getByTestId('movie-video').evaluate((v: HTMLVideoElement) => v.currentTime),
            ),
          );
          return Math.abs(positions[0]! - positions[1]!);
        },
        { timeout: 15000 },
      )
      .toBeLessThan(0.15);
    await host.page.getByTestId('movie-video').evaluate((v: HTMLVideoElement) => v.pause());
    await expect
      .poll(() => guest.page.getByTestId('movie-video').evaluate((v: HTMLVideoElement) => v.paused))
      .toBe(true);
    await host.page.getByTestId('movie-video').evaluate((v: HTMLVideoElement) => {
      v.currentTime = 8;
    });
    await expect
      .poll(() =>
        guest.page.getByTestId('movie-video').evaluate((v: HTMLVideoElement) => v.currentTime),
      )
      .toBeGreaterThan(7.7);
  } finally {
    await host.context.close();
    await guest.context.close();
  }
});
test('E17: deleting a movie clears a room playing it', async ({ browser }) => {
  const id = await seeded();
  const room = await api('/rest/v1/rpc/create_room', {
    title: 'Delete acceptance room',
    source: 'upload',
    content_ref: id,
    visibility: 'private',
    control_mode: 'host',
  });
  expect(room.ok).toBe(true);
  const member = await signed(browser);
  try {
    await enter(member.page, '/r/' + room.data.room.slug);
    const deleted = await api('/functions/v1/movie-delete', { movie_id: id });
    expect(deleted.ok).toBe(true);
    await expect(member.page.getByTestId('movie-video')).toHaveCount(0, { timeout: 15000 });
    await expect(member.page.getByText('Pick a video to start', { exact: true })).toBeVisible();
  } finally {
    await api('/rest/v1/rpc/close_room', { room_id: room.data.room.id });
    await member.context.close();
  }
});
test('E18: an account without upload permission sees no upload control and the API refuses it', async ({
  browser,
}) => {
  const guest = await signed(browser, true);
  try {
    await guest.page.goto('/movies');
    await expect(
      guest.page.getByText(
        'Movie uploads are available only to approved accounts. You can still watch movies shared in a room.',
      ),
    ).toBeVisible();
    await expect(guest.page.getByRole('button', { name: 'Upload movie', exact: true })).toHaveCount(
      0,
    );
    const result = await api(
      '/functions/v1/movie-upload-start',
      {
        movie_id: crypto.randomUUID(),
        title: 'Refused',
        size_bytes: 9,
        content_type: 'video/mp4',
        duration_sec: 1,
        width: 160,
        height: 90,
      },
      true,
    );
    expect(result).toEqual({ ok: false, code: 'upload_not_allowed' });
  } finally {
    await guest.context.close();
  }
});

test('E19: an interrupted multipart upload resumes after reopening the tab', async ({
  browser,
}) => {
  const folder = join(__dirname, '.auth');
  mkdirSync(folder, { recursive: true });
  const path = join(folder, 'resumable-movie.mp4');
  // A valid MP4 free box makes the playable fixture large enough for three parts.
  const padding = Buffer.alloc(34 * 1024 * 1024);
  padding.writeUInt32BE(padding.length, 0);
  padding.write('free', 4, 'ascii');
  writeFileSync(
    path,
    Buffer.concat([
      readFileSync(join(__dirname, '../apps/web/test/fixtures/playable.mp4')),
      padding,
    ]),
  );
  const host = await signed(browser);
  try {
    await host.page.route('**/*', async (route) => {
      const request = route.request();
      const part = new URL(request.url()).searchParams.get('partNumber');
      if (request.method() === 'PUT' && part && Number(part) > 1) await route.abort();
      else await route.continue();
    });
    await host.page.goto('/movies');
    await host.page.getByLabel('Choose a movie', { exact: true }).setInputFiles(path);
    await host.page.getByLabel('Movie title', { exact: true }).fill('Recovery acceptance movie');
    await host.page.getByRole('button', { name: 'Upload movie', exact: true }).click();
    let id = '';
    await expect
      .poll(
        async () => {
          const movie = (await movieRows()).find((m) => m.status === 'uploading');
          if (!movie) return false;
          id = movie.id;
          const result = await api('/functions/v1/movie-upload-urls', {
            movie_id: id,
            part_numbers: [1],
          });
          return result.data?.uploaded?.some((p: { part_number: number }) => p.part_number === 1);
        },
        { timeout: 30000 },
      )
      .toBe(true);
    await host.context.setOffline(true);
    await host.page.close({ runBeforeUnload: false });
    await host.context.setOffline(false);
    const reopened = await host.context.newPage();
    await reopened.goto('/movies');
    await reopened.getByLabel('Choose the same file to resume').setInputFiles(path);
    await reopened.getByRole('button', { name: 'Resume upload', exact: true }).click();
    await expect(reopened.getByRole('button', { name: 'Watch together', exact: true })).toBeVisible(
      { timeout: 60000 },
    );
    expect((await movieRows()).find((m) => m.id === id)?.status).toBe('ready');
  } finally {
    await host.context.close();
  }
});

test('E20: pause resumes the selected file without creating another upload and preview closes with Escape', async ({
  browser,
}) => {
  const host = await signed(browser);
  try {
    const folder = join(__dirname, '.auth');
    mkdirSync(folder, { recursive: true });
    const path = join(folder, 'pause-movie.mp4');
    const padding = Buffer.alloc(34 * 1024 * 1024);
    padding.writeUInt32BE(padding.length, 0);
    padding.write('free', 4, 'ascii');
    writeFileSync(
      path,
      Buffer.concat([
        readFileSync(join(__dirname, '../apps/web/test/fixtures/playable.mp4')),
        padding,
      ]),
    );
    await host.page.route('**/*', async (route) => {
      const request = route.request();
      const part = new URL(request.url()).searchParams.get('partNumber');
      if (request.method() === 'PUT' && part && Number(part) > 1) await route.abort();
      else await route.continue();
    });
    await host.page.goto('/movies');
    await host.page.getByLabel('Choose a movie', { exact: true }).setInputFiles(path);
    await host.page.getByLabel('Movie title', { exact: true }).fill('Paused movie');
    await host.page.getByRole('button', { name: 'Upload movie', exact: true }).click();
    await expect
      .poll(
        async () => {
          const movie = (await movieRows()).find((m) => m.status === 'uploading');
          if (!movie) return false;
          const result = await api('/functions/v1/movie-upload-urls', {
            movie_id: movie.id,
            part_numbers: [1],
          });
          return result.data?.uploaded?.some(
            (part: { part_number: number }) => part.part_number === 1,
          );
        },
        { timeout: 30000 },
      )
      .toBe(true);
    const id = (await movieRows()).find((m) => m.status === 'uploading')!.id;
    await host.page.getByRole('button', { name: 'Pause upload', exact: true }).click();
    await expect(
      host.page.getByRole('button', { name: 'Resume upload', exact: true }),
    ).toBeEnabled();
    await expect(host.page.getByText('Upload paused.', { exact: false })).toBeVisible();
    await expect(host.page.getByLabel('Movie title', { exact: true })).toBeDisabled();
    const progress = host.page.getByRole('progressbar', { name: 'Upload progress', exact: true });
    await expect(progress).toBeVisible();
    expect(await progress.evaluate((bar: HTMLProgressElement) => bar.value / bar.max)).toBeGreaterThan(0);
    expect(await progress.evaluate((bar: HTMLProgressElement) => bar.getBoundingClientRect().width)).toBeGreaterThan(250);
    await host.page.screenshot({ path: '/tmp/synvello-upload-progress-paused.png', fullPage: true });
    await host.page.unroute('**/*');
    await host.page.getByRole('button', { name: 'Resume upload', exact: true }).click();
    await expect(
      host.page.getByRole('button', { name: 'Watch together', exact: true }),
    ).toBeVisible({ timeout: 60000 });
    expect((await movieRows()).filter((m) => m.status === 'ready').map((m) => m.id)).toEqual([id]);
    await host.page.getByRole('button', { name: 'Preview movie', exact: true }).click();
    await expect(host.page.getByRole('dialog', { name: 'Preview: Paused movie' })).toBeVisible();
    await host.page.keyboard.press('Escape');
    await expect(host.page.getByRole('dialog', { name: 'Preview: Paused movie' })).toBeHidden();
  } finally {
    await host.context.close();
  }
});

test('E21: invalid files recover to a valid selection without starting an upload', async ({
  browser,
}) => {
  const host = await signed(browser);
  try {
    await host.page.goto('/movies');
    await host.page.getByLabel('Choose a movie', { exact: true }).setInputFiles({
      name: 'broken.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('invalid movie'),
    });
    await expect(host.page.getByRole('main').getByRole('alert')).toContainText('unsupported');
    expect((await movieRows()).filter((m) => m.status !== 'failed')).toHaveLength(0);
    await host.page
      .getByLabel('Choose a movie', { exact: true })
      .setInputFiles(join(__dirname, '../apps/web/test/fixtures/playable.mp4'));
    await expect(
      host.page.getByRole('button', { name: 'Upload movie', exact: true }),
    ).toBeEnabled();
    await expect(host.page.getByRole('main').getByRole('alert')).toHaveCount(0);
  } finally {
    await host.context.close();
  }
});

test('E22: phone and desktop layouts expose Android and keep their content within the viewport', async ({
  browser,
}) => {
  const host = await signed(browser);
  const title = 'ALongMovieTitleWithoutAnySpaces'.repeat(4).slice(0, 100);
  const movie = await seeded(title);
  const room = await api('/rest/v1/rpc/create_room', {
    title: title.slice(0, 80),
    source: 'upload',
    content_ref: movie,
    visibility: 'private',
    control_mode: 'host',
  });
  expect(room.ok).toBe(true);
  try {
    for (const width of [320, 390, 1280]) {
      await host.page.setViewportSize({ width, height: 850 });
      for (const path of ['/home', '/movies', '/android']) {
        await host.page.goto(path);
        await expect(host.page.getByRole('heading', { level: 1 })).toBeVisible();
        if (path !== '/android')
          await expect(host.page.getByRole('heading', { name: title, exact: true })).toBeVisible();
        await expect(
          host.page.getByRole('link', { name: 'Android app', exact: true }).first(),
        ).toBeVisible();
        await host.page.screenshot({
          path: join(__dirname, '../test-results', `flow-${width}-${path.slice(1)}.png`),
          fullPage: true,
        });
        expect(
          await host.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          `Content overflows at ${path}, viewport ${width}`,
        ).toBe(true);
      }
    }
  } finally {
    await api('/rest/v1/rpc/close_room', { room_id: room.data.room.id });
    await host.context.close();
  }
});

test('Movie playback: two browsers share play, pause and seek with bounded drift', async ({
  browser,
}) => {
  const id = await seeded();
  const room = await api('/rest/v1/rpc/create_room', {
    title: 'Synchronized movie acceptance',
    source: 'upload',
    content_ref: id,
    visibility: 'private',
    control_mode: 'host',
  });
  expect(room.ok).toBe(true);
  const host = await signed(browser);
  const url = new URL(room.data.room_link);
  await enter(host.page, url.pathname + url.hash);
  const guest = await signed(browser, true);
  try {
    await enter(guest.page, url.pathname + url.hash);
    await expect
      .poll(() =>
        guest.page.getByTestId('movie-video').evaluate((v: HTMLVideoElement) => v.readyState),
      )
      .toBeGreaterThanOrEqual(1);
    await host.page.getByTestId('movie-video').evaluate((v: HTMLVideoElement) => v.play());
    await expect
      .poll(
        () => guest.page.getByTestId('movie-video').evaluate((v: HTMLVideoElement) => v.paused),
        {
          timeout: 10000,
        },
      )
      .toBe(false);
    await expect
      .poll(
        async () => {
          const positions = await Promise.all(
            [host.page, guest.page].map((page) =>
              page.getByTestId('movie-video').evaluate((v: HTMLVideoElement) => v.currentTime),
            ),
          );
          return Math.abs(positions[0]! - positions[1]!);
        },
        { timeout: 15000 },
      )
      .toBeLessThan(0.15);
    const sampleDrift = async (phase: string) => {
      const samples: number[] = [];
      for (let sample = 0; sample < 10; sample++) {
        const times = await Promise.all([host.page, guest.page].map(page =>
          page.getByTestId('movie-video').evaluate((video: HTMLVideoElement) => video.currentTime)));
        samples.push(Math.abs(times[0]! - times[1]!));
        // Observe sustained playback, rather than accepting a single instant of alignment.
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      console.log(`Movie sync ${phase}: maximum drift ${Math.max(...samples).toFixed(3)}s across ${samples.length} samples`);
      expect(Math.max(...samples)).toBeLessThan(0.3);
    };
    await sampleDrift('playing');
    await host.page.getByTestId('movie-video').evaluate((v: HTMLVideoElement) => v.pause());
    await expect
      .poll(() => guest.page.getByTestId('movie-video').evaluate((v: HTMLVideoElement) => v.paused))
      .toBe(true);
    await host.page.getByTestId('movie-video').evaluate((v: HTMLVideoElement) => {
      v.currentTime = 8;
    });
    await expect
      .poll(() =>
        guest.page.getByTestId('movie-video').evaluate((v: HTMLVideoElement) => v.currentTime),
      )
      .toBeGreaterThan(7.7);
    await expect.poll(async () => {
      const times = await Promise.all([host.page, guest.page].map(page =>
        page.getByTestId('movie-video').evaluate((video: HTMLVideoElement) => video.currentTime)));
      return Math.abs(times[0]! - times[1]!);
    }).toBeLessThan(0.3);
    await host.page.getByTestId('movie-video').evaluate((video: HTMLVideoElement) => video.play());
    await expect.poll(() => guest.page.getByTestId('movie-video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(false);
    await sampleDrift('resumed after seek');
  } finally {
    await api('/rest/v1/rpc/close_room', { room_id: room.data.room.id });
    await host.context.close();
    await guest.context.close();
  }
});

test('E25: upload progress advances before a multipart part finishes', async ({ browser }) => {
  const host = await signed(browser);
  const folder = join(__dirname, '.auth');
  mkdirSync(folder, { recursive: true });
  const source = join(folder, 'progress-movie.mp4');
  const padding = Buffer.alloc(45 * 1024 * 1024);
  padding.writeUInt32BE(padding.length, 0);
  padding.write('free', 4, 'ascii');
  writeFileSync(source, Buffer.concat([readFileSync(join(__dirname, '../apps/web/test/fixtures/playable.mp4')), padding]));
  try {
    await host.page.setViewportSize({ width: 390, height: 844 });
    await host.page.goto('/movies');
    await host.page.getByLabel('Choose a movie', { exact: true }).setInputFiles(source);
    await expect(host.page.getByLabel('Movie title', { exact: true })).toBeVisible();
    const cdp = await host.context.newCDPSession(host.page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false, latency: 10, downloadThroughput: -1, uploadThroughput: 2 * 1024 * 1024,
    });
    await host.page.getByRole('button', { name: 'Upload movie', exact: true }).click();
    const progress = host.page.getByRole('progressbar', { name: 'Upload progress', exact: true });
    await expect.poll(() => progress.evaluate((bar: HTMLProgressElement) => bar.value)).toBeGreaterThan(0);
    const movie = (await movieRows()).find(movie => movie.status === 'uploading')!;
    expect(movie).toBeTruthy();
    const receipt = await api('/functions/v1/movie-upload-urls', { movie_id: movie.id, part_numbers: [1, 2, 3] });
    expect(receipt.data.uploaded).toEqual([]);
    expect(await progress.evaluate((bar: HTMLProgressElement) => bar.value / bar.max)).toBeLessThan(1);
    expect(await progress.evaluate((bar: HTMLProgressElement) => bar.getBoundingClientRect().width)).toBeGreaterThan(250);
    await host.page.screenshot({ path: '/tmp/synvello-upload-progress-active.png', fullPage: true });
    await host.page.getByRole('button', { name: 'Pause upload', exact: true }).click();
    await expect(host.page.getByRole('button', { name: 'Resume upload', exact: true })).toBeEnabled();
    await expect(progress).toBeVisible();
  } finally {
    await host.context.close();
    const { unlinkSync } = await import('node:fs');
    unlinkSync(source);
  }
});

async function syncPair(browser: Browser) {
  const id = await seeded();
  const created = await api('/rest/v1/rpc/create_room', { title: 'Shared timeline regression', source: 'upload', content_ref: id, visibility: 'private', control_mode: 'host' });
  expect(created.ok).toBe(true);
  const host = await signed(browser); const guest = await signed(browser, true);
  const url = new URL(created.data.room_link);
  await enter(host.page, url.pathname + url.hash);
  await enter(guest.page, url.pathname + url.hash);
  const videos = [host.page, guest.page].map(page => page.getByTestId('movie-video'));
  for (const video of videos) await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(3);
  const drift = async () => {
    const times = await Promise.all(videos.map(video => video.evaluate((v: HTMLVideoElement) => v.currentTime)));
    return Math.abs(times[0]! - times[1]!);
  };
  const close = async () => {
    await api('/rest/v1/rpc/close_room', { room_id: created.data.room.id });
    await host.context.close(); await guest.context.close();
  };
  return { host, guest, videos, drift, close, roomId: created.data.room.id };
}

test('Shared seeking: small, rapid and playing host drags move both players; guest drags cannot diverge', async ({ browser }) => {
  const pair = await syncPair(browser);
  const [host, guest] = pair.videos;
  try {
    for (const position of [5, 5.2, 5.4]) {
      await host!.evaluate((video: HTMLVideoElement, target) => { video.currentTime = target; }, position);
      await expect.poll(() => guest!.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(position, 1);
    }
    let delayedSeeks = 0;
    await pair.host.page.route('**/rest/v1/rpc/set_playback', async route => {
      if (route.request().postDataJSON().reason === 'user') {
        delayedSeeks++;
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      await route.continue();
    });
    await host!.evaluate(async (video: HTMLVideoElement) => {
      for (const target of [6, 6.2, 6.4]) {
        video.currentTime = target;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    });
    await expect.poll(() => guest!.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeCloseTo(6.4, 1);
    expect(delayedSeeks).toBeGreaterThan(0);
    await pair.host.page.unroute('**/rest/v1/rpc/set_playback');
    await host!.evaluate((video: HTMLVideoElement) => video.play());
    await expect.poll(() => guest!.evaluate((video: HTMLVideoElement) => video.paused)).toBe(false);
    await expect.poll(pair.drift).toBeLessThan(0.25);
    await host!.evaluate((video: HTMLVideoElement) => { video.currentTime = 10; });
    await expect.poll(() => guest!.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThanOrEqual(10);
    await expect.poll(pair.drift).toBeLessThan(0.25);
    await guest!.evaluate((video: HTMLVideoElement) => { video.currentTime = 17; });
    await expect.poll(pair.drift, { timeout: 3000 }).toBeLessThan(0.25);
    expect(await host!.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeLessThan(15);
  } finally { await pair.close(); }
});

test('Buffering: stalled downloads do not pause buffered players, and a real buffer pause recovers while paused', async ({ browser }) => {
  const pair = await syncPair(browser);
  const [host, guest] = pair.videos;
  try {
    await host!.evaluate((video: HTMLVideoElement) => video.play());
    await expect.poll(() => guest!.evaluate((video: HTMLVideoElement) => video.paused)).toBe(false);
    for (const video of pair.videos) await video.evaluate((v: HTMLVideoElement) => v.dispatchEvent(new Event('stalled')));
    // Observe longer than the room's buffer-pause threshold and polling interval.
    await new Promise(resolve => setTimeout(resolve, 3500));
    const statuses = await Promise.all(pair.videos.map(video => video.evaluate((v: HTMLVideoElement) => ({ paused: v.paused, ready: v.readyState, position: v.currentTime, ended: v.ended }))));
    const diagnostics = await fetch(backend + '/rest/v1/room_members?select=buffering_since,user_id&room_id=eq.' + pair.roomId, { headers: { apikey: state.anon, Authorization: 'Bearer ' + state.session.access_token } }).then(response => response.json());
    expect(diagnostics.every((member: { buffering_since: string | null }) => member.buffering_since === null)).toBe(true);
    for (const status of statuses) expect(status.paused).toBe(false);
    let delayed = false;
    await pair.guest.page.route('**/rest/v1/rpc/touch_member', async route => {
      const body = route.request().postDataJSON();
      if (body.buffering && !delayed) {
        delayed = true;
        await new Promise(resolve => setTimeout(resolve, 650));
      }
      await route.continue();
    });
    await guest!.evaluate((video: HTMLVideoElement) => {
      Object.defineProperty(video, 'readyState', { configurable: true, value: 2 });
      video.dispatchEvent(new Event('waiting'));
    });
    await expect.poll(() => delayed).toBe(true);
    await guest!.evaluate((video: HTMLVideoElement) => {
      delete (video as unknown as { readyState?: number }).readyState;
      video.dispatchEvent(new Event('progress'));
    });
    // The delayed buffering update must not overwrite readiness when the network reorders them.
    await new Promise(resolve => setTimeout(resolve, 1000));
    const readiness = await fetch(backend + '/rest/v1/room_members?select=buffering_since,user_id&room_id=eq.' + pair.roomId, { headers: { apikey: state.anon, Authorization: 'Bearer ' + state.session.access_token } }).then(response => response.json());
    expect(readiness.every((member: { buffering_since: string | null }) => member.buffering_since === null)).toBe(true);
    await pair.guest.page.unroute('**/rest/v1/rpc/touch_member');
    await guest!.evaluate((video: HTMLVideoElement) => {
      Object.defineProperty(video, 'readyState', { configurable: true, value: 2 });
      video.dispatchEvent(new Event('waiting'));
    });
    for (const video of pair.videos) await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
    await guest!.evaluate((video: HTMLVideoElement) => {
      delete (video as unknown as { readyState?: number }).readyState;
      video.dispatchEvent(new Event('progress'));
    });
    for (const video of pair.videos) await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused), { timeout: 10000 }).toBe(false);
    await expect.poll(pair.drift).toBeLessThan(0.25);
  } finally { await pair.close(); }
});

// Observe frames submitted to the compositor, not the room clock or currentTime setter.
async function observeFrames(page: Page) {
  await page.getByTestId('movie-video').evaluate((video: HTMLVideoElement) => {
    const frames: number[] = [];
    (video as HTMLVideoElement & { presentedFrames: number[] }).presentedFrames = frames;
    const next = (_: number, frame: VideoFrameCallbackMetadata) => {
      frames.push(frame.mediaTime);
      if (frames.length > 300) frames.shift();
      video.requestVideoFrameCallback(next);
    };
    video.requestVideoFrameCallback(next);
  });
}
async function lastFrame(page: Page) {
  return page.getByTestId('movie-video').evaluate((video) =>
    (video as HTMLVideoElement & { presentedFrames: number[] }).presentedFrames.at(-1) ?? -1);
}
async function assertFrameAt(page: Page, target: number, tolerance = 0.15) {
  await expect.poll(async () => Math.abs(await lastFrame(page) - target), { timeout: 15000 }).toBeLessThan(tolerance);
  await expect.poll(() => page.getByTestId('movie-video').evaluate((v: HTMLVideoElement) => v.seeking)).toBe(false);
}

for (const playing of [false, true]) {
  test(`Backward frames: ${playing ? 'playing' : 'paused'} movie rewinds on both screens`, async ({ browser }) => {
    const pair = await syncPair(browser);
    try {
      for (const page of [pair.host.page, pair.guest.page]) await observeFrames(page);
      const host = pair.videos[0]!;
      await host.evaluate((v: HTMLVideoElement) => { v.currentTime = 14; });
      for (const page of [pair.host.page, pair.guest.page]) await assertFrameAt(page, 14);
      if (playing) {
        await host.evaluate((v: HTMLVideoElement) => v.play());
        for (const v of pair.videos) await expect.poll(() => v.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
      }
      await host.evaluate((v: HTMLVideoElement) => { v.currentTime = 3; });
      for (const page of [pair.host.page, pair.guest.page]) await assertFrameAt(page, 3, playing ? 1.5 : 0.15);
      if (playing) {
        await expect.poll(async () => await lastFrame(pair.guest.page)).toBeGreaterThan(4.5);
        await expect.poll(pair.drift).toBeLessThan(0.25);
      }
    } finally { await pair.close(); }
  });
}

test('Rapid frames: alternating forward and backward drags finish at the last requested frame', async ({ browser }) => {
  const pair = await syncPair(browser);
  try {
    for (const page of [pair.host.page, pair.guest.page]) await observeFrames(page);
    await pair.host.page.route('**/rpc/set_playback', async route => {
      await new Promise(resolve => setTimeout(resolve, 150)); await route.continue();
    });
    for (const target of [15, 3, 11, 2, 8, 4]) {
      await pair.videos[0]!.evaluate((v: HTMLVideoElement, target) => { v.currentTime = target; }, target);
      await pair.host.page.waitForTimeout(60);
    }
    for (const page of [pair.host.page, pair.guest.page]) await assertFrameAt(page, 4);
    await pair.host.page.waitForTimeout(2000);
    for (const page of [pair.host.page, pair.guest.page]) await assertFrameAt(page, 4);
  } finally { await pair.close(); }
});

test('Buffering frames: a backwards seek supersedes the guest old buffering position', async ({ browser }) => {
  const pair = await syncPair(browser);
  try {
    for (const page of [pair.host.page, pair.guest.page]) await observeFrames(page);
    await pair.videos[0]!.evaluate((v: HTMLVideoElement) => { v.currentTime = 14; });
    for (const page of [pair.host.page, pair.guest.page]) await assertFrameAt(page, 14);
    await pair.videos[0]!.evaluate((v: HTMLVideoElement) => v.play());
    for (const v of pair.videos) await expect.poll(() => v.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
    await pair.videos[1]!.evaluate((v: HTMLVideoElement) => {
      Object.defineProperty(v, 'readyState', { configurable: true, value: 2 });
      v.dispatchEvent(new Event('waiting'));
    });
    await pair.videos[0]!.evaluate((v: HTMLVideoElement) => { v.currentTime = 2; });
    await assertFrameAt(pair.guest.page, 2, 1.5);
    await pair.videos[1]!.evaluate((v: HTMLVideoElement) => {
      delete (v as unknown as { readyState?: number }).readyState;
      v.dispatchEvent(new Event('canplay'));
    });
    await expect.poll(pair.drift).toBeLessThan(0.25);
  } finally { await pair.close(); }
});

test('Admin only: guest controls are absent and guest API commands are denied even in everyone mode', async ({ browser }) => {
  const pair = await syncPair(browser);
  try {
    expect(await pair.videos[0]!.evaluate((v: HTMLVideoElement) => v.controls)).toBe(true);
    expect(await pair.videos[1]!.evaluate((v: HTMLVideoElement) => v.controls)).toBe(false);
    const settings = await api('/rest/v1/rpc/update_room_settings', { room_id: pair.roomId, settings: { control_mode: 'everyone' } });
    expect(settings.ok).toBe(true);
    for (const status of ['playing', 'paused']) {
      const denied = await api('/rest/v1/rpc/set_playback', { room_id: pair.roomId, expected_seq: 0, status, position_sec: 12, rate: 1, start_delay_ms: 0, reason: 'user' }, true);
      expect(denied.ok).toBe(false); expect(denied.code).toBe('not_controller');
    }
    await pair.videos[0]!.evaluate((v: HTMLVideoElement) => { v.currentTime = 5; });
    await expect.poll(pair.drift).toBeLessThan(0.15);
    await pair.videos[1]!.evaluate((v: HTMLVideoElement) => { v.currentTime = 12; });
    await expect.poll(() => pair.videos[1]!.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeLessThan(5.2);
    await pair.videos[1]!.evaluate(async (v: HTMLVideoElement) => {
      try { await v.play(); } catch (error) {
        if (!(error instanceof DOMException) || error.name !== 'AbortError') throw error;
      }
    });
    for (const v of pair.videos) await expect.poll(() => v.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
    await pair.videos[0]!.evaluate((v: HTMLVideoElement) => v.play());
    for (const v of pair.videos) await expect.poll(() => v.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
    await pair.videos[1]!.evaluate((v: HTMLVideoElement) => v.pause());
    await expect.poll(() => pair.videos[1]!.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
    await expect.poll(pair.drift).toBeLessThan(0.25);
  } finally { await pair.close(); }
});

test('Late loading frames: rejoining guest receives the latest backward seek after a delayed media response', async ({ browser }) => {
  const pair = await syncPair(browser);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    await pair.videos[0]!.evaluate((v: HTMLVideoElement) => { v.currentTime = 14; });
    await expect.poll(pair.drift).toBeLessThan(0.15);
    let intercepted = false;
    await pair.guest.page.route('**/synvello-movies/**', async route => {
      intercepted = true;
      await gate;
      await route.continue();
    });
    await pair.guest.page.reload({ waitUntil: 'domcontentloaded' });
    const seat = pair.guest.page.getByRole('button', { name: 'Take your seat', exact: true });
    await expect(pair.guest.page.getByTestId('movie-video').or(seat)).toBeVisible();
    if (await seat.isVisible()) await seat.click();
    await expect.poll(() => intercepted).toBe(true);
    await observeFrames(pair.guest.page);
    await pair.videos[0]!.evaluate((v: HTMLVideoElement) => { v.currentTime = 2; });
    await pair.host.page.waitForTimeout(1000);
    release();
    await assertFrameAt(pair.guest.page, 2);
    await expect.poll(pair.drift).toBeLessThan(0.15);
  } finally { release(); await pair.close(); }
});
