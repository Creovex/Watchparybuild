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
  try {
    await host.page.goto('/movies');
    await host.page.getByLabel('Choose a movie', { exact: true }).setInputFiles(source);
    await expect(host.page.getByLabel('Movie title', { exact: true })).toBeVisible({ timeout: 60000 });
    await host.page.getByLabel('Movie title', { exact: true }).fill('MKV upload acceptance');
    await host.page.getByRole('button', { name: 'Upload movie', exact: true }).click();
    await expect(host.page.getByRole('button', { name: 'Watch together', exact: true })).toBeVisible({ timeout: 60000 });
    await host.page.getByRole('button', { name: 'Watch together', exact: true }).click();
    await expect(host.page.getByRole('dialog', { name: 'Invite friends' })).toBeVisible({ timeout: 45000 });
    await host.page.keyboard.press('Escape');
    const player = host.page.getByTestId('movie-video');
    await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.readyState)).toBeGreaterThanOrEqual(2);
    await player.evaluate((video: HTMLVideoElement) => video.play());
    await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0.2);
    await player.evaluate((video: HTMLVideoElement) => { video.currentTime = 10; });
    await expect.poll(() => player.evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThanOrEqual(10);
  } finally {
    await host.context.close();
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
    await api('/rest/v1/rpc/close_room', { room_id: room.data.room.id });
    await host.context.close();
    await guest.context.close();
  }
});
