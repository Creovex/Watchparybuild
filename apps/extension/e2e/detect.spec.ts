import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect, test, type BrowserContext, type Frame, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Loads the built extension (run `pnpm --filter @watchparty/extension build` first) into Chromium
// in the new headless mode and talks to it from http://localhost:3000 exactly as the room page does
// (apps/web/lib/extension.ts). Extensions do not load in the old headless mode. When nothing answers
// on port 3000, a blank page is served there for the few seconds the checks take: the extension only
// cares about the page's origin, which is the same. Netflix itself is never contacted: the browser
// resolves www.netflix.com to a local HTTPS server with a throwaway certificate, which serves a stub
// watch page with one video element. (Playwright's request routing does not catch the first
// navigation of a tab the extension opens, so routing cannot be used for this.)

const EXTENSION_ID = 'appcjgbhipnbklhodimgbmjhbncljoip';
const DIST = resolve(import.meta.dirname, '../dist');
const APP_URL = process.env.EXTENSION_E2E_APP_URL ?? 'http://localhost:3000';
const ROOM_ID = '11111111-1111-4111-8111-111111111111';
const WATCH_URL = 'https://www.netflix.com/watch/81234567';
const PANEL_URL = `chrome-extension://${EXTENSION_ID}/src/panel/panel.html`;
const REPO_ROOT = resolve(import.meta.dirname, '../../..');

test.skip(process.env.EXTENSION_E2E !== '1', 'Set EXTENSION_E2E=1 to run the extension checks');
test.describe.configure({ mode: 'serial' });

let standIn: Server | null = null;
let fakeNetflix: Server | null = null;
let context: BrowserContext;
let app: Page;

/** A local HTTPS server standing in for www.netflix.com, with a certificate made for this run. */
async function startFakeNetflix(): Promise<Server> {
  const dir = mkdtempSync(join(tmpdir(), 'watchparty-e2e-'));
  const key = join(dir, 'key.pem');
  const cert = join(dir, 'cert.pem');
  execFileSync(
    'openssl',
    ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=www.netflix.com', '-keyout', key, '-out', cert, '-days', '1'],
    { stdio: 'ignore' },
  );
  const server = createHttpsServer({ key: readFileSync(key), cert: readFileSync(cert) }, (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>Stub watch page</title><video></video>');
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return server;
}

async function standInIfNeeded(): Promise<Server | null> {
  try {
    await fetch(APP_URL, { signal: AbortSignal.timeout(3000) });
    return null;
  } catch {
    const server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><title>Stand in for the web app</title>');
    });
    await new Promise<void>((done) => server.listen(Number(new URL(APP_URL).port || 80), 'localhost', done));
    return server;
  }
}

/** chrome.runtime.sendMessage from the app page, as the room page sends it. */
function sendFromApp(message: unknown): Promise<unknown> {
  return app.evaluate(
    ([id, msg]) =>
      new Promise((done) => {
        const runtime = (globalThis as { chrome?: { runtime?: { sendMessage?: Function; lastError?: { message?: string } } } })
          .chrome?.runtime;
        if (!runtime?.sendMessage) {
          done({ error: 'chrome.runtime is not exposed to this page' });
          return;
        }
        runtime.sendMessage(id, msg, (response: unknown) => done(response ?? { error: runtime.lastError?.message }));
      }),
    [EXTENSION_ID, message] as const,
  );
}

/** The panel iframe the content script docked in a streaming tab. */
async function panelOf(tab: Page): Promise<Frame> {
  await expect.poll(() => tab.frames().some((f) => f.url() === PANEL_URL), { timeout: 15_000 }).toBe(true);
  return tab.frames().find((f) => f.url() === PANEL_URL)!;
}

/** "Bring it back here", as apps/web/lib/extension.ts sends it over the room page port. */
function reclaim(roomId: string): Promise<unknown> {
  return app.evaluate(
    ([id, room]) =>
      new Promise((done) => {
        const runtime = (globalThis as { chrome: { runtime: { connect: Function } } }).chrome.runtime;
        const port = runtime.connect(id, { name: `room-page:${room}` });
        port.onMessage.addListener((message: unknown) => done(message));
        port.postMessage({ type: 'reclaim', room_id: room });
      }),
    [EXTENSION_ID, roomId] as const,
  );
}

/** The local Supabase stack's address and keys, or null when it is not running. */
function localStack(): { url: string; anonKey: string; serviceKey: string } | null {
  try {
    const out = execSync('pnpm exec supabase status -o env', { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60_000 });
    const env: Record<string, string> = {};
    for (const line of out.split('\n')) {
      const match = /^([A-Z_]+)="?([^"]*)"?$/.exec(line);
      if (match) env[match[1]!] = match[2]!;
    }
    return env.API_URL && env.ANON_KEY && env.SERVICE_ROLE_KEY ? { url: env.API_URL, anonKey: env.ANON_KEY, serviceKey: env.SERVICE_ROLE_KEY } : null;
  } catch {
    return null;
  }
}

test.beforeAll(async () => {
  standIn = await standInIfNeeded();
  fakeNetflix = await startFakeNetflix();
  const port = (fakeNetflix.address() as AddressInfo).port;
  context = await chromium.launchPersistentContext('', {
    executablePath: process.env.PW_CHROMIUM_PATH ?? '/opt/pw-browsers/chromium',
    headless: false,
    ignoreHTTPSErrors: true,
    args: [
      '--headless=new',
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      `--host-resolver-rules=MAP www.netflix.com 127.0.0.1:${port}`,
      '--no-proxy-server',
      '--ignore-certificate-errors',
    ],
  });
  app = await context.newPage();
  await app.goto(APP_URL);
});

test.afterAll(async () => {
  await context?.close();
  standIn?.close();
  fakeNetflix?.close();
});

test('the service worker runs under the fixed extension id', async () => {
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  expect(worker.url()).toBe(`chrome-extension://${EXTENSION_ID}/service-worker-loader.js`);
});

test('the web app detects the extension with ping and pong', async () => {
  expect(await sendFromApp({ type: 'ping' })).toEqual({ type: 'pong', version: expect.any(String) });
});

test('a handover opens the title with the panel docked, and the room page can take it back', async () => {
  const opened = context.waitForEvent('page');
  const reply = await sendFromApp({
    type: 'handover',
    room_id: ROOM_ID,
    slug: 'abcDEF1234',
    source: 'netflix',
    content_ref: WATCH_URL,
    engine_session: '33333333-3333-4333-8333-333333333333',
    session: { access_token: 'not-a-real-token', refresh_token: 'refresh-1' },
  });
  expect(reply).toEqual({ type: 'handover_ok' });
  const tab = await opened;
  await tab.waitForURL(WATCH_URL);

  // The content script docked the panel; with a made up token (or a build without the Supabase
  // settings) the panel says it cannot open the room.
  const panel = await panelOf(tab);
  await expect(panel.getByTestId('panel-message')).toContainText('Can’t open the room');

  // "Bring it back here": the room page asks over its port and gets the session back.
  const returned = await reclaim(ROOM_ID);
  expect(returned).toEqual({
    type: 'return',
    room_id: ROOM_ID,
    session: { access_token: 'not-a-real-token', refresh_token: 'refresh-1' },
  });
  // The extension no longer holds a session for the room.
  expect(await sendFromApp({ type: 'reclaim', room_id: ROOM_ID })).toEqual({ type: 'handover_refused', reason: 'no_session' });
});

test('a handover to a site that is not a streaming service is refused', async () => {
  expect(
    await sendFromApp({
      type: 'handover',
      room_id: ROOM_ID,
      slug: 'abcDEF1234',
      source: 'netflix',
      content_ref: 'https://evil.example/watch/1',
      engine_session: '33333333-3333-4333-8333-333333333333',
      session: { access_token: 'a', refresh_token: 'r' },
    }),
  ).toEqual({ type: 'handover_refused', reason: 'invalid_content_ref' });
});

test('a real session handed over resumes the room in the panel and comes back intact', async () => {
  const stack = localStack();
  test.skip(!stack, 'The local Supabase stack is not running (pnpm db:start)');
  const assets = join(DIST, 'assets');
  const builtForStack = readdirSync(assets).some((f) => {
    if (!f.endsWith('.js')) return false;
    const text = readFileSync(join(assets, f), 'utf8');
    return text.includes(stack!.url) && text.includes(stack!.anonKey);
  });
  test.skip(!builtForStack, "Build the extension with the local stack's NEXT_PUBLIC_SUPABASE_URL and anon key first");

  // The local stack's own service role key, used here only to make and remove a test user.
  const admin = createClient(stack!.url, stack!.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `extension-check-${Date.now()}@example.test`;
  const password = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'Extension Check' },
  });
  expect(createError).toBeNull();
  const userId = created.user!.id;
  try {
    // The room page's side: sign in, create a paid source room, take an engine session.
    const page = createClient(stack!.url, stack!.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: signedIn } = await page.auth.signInWithPassword({ email, password });
    const made = await page.rpc('create_room', {
      title: 'Extension check',
      source: 'netflix',
      content_ref: WATCH_URL,
      visibility: 'public',
      control_mode: 'host',
    });
    const room = (made.data as { data: { room: { id: string; slug: string } } }).data.room;
    const joined = await page.rpc('join_room', { slug: room.slug, join_key: null, sync_mode: 'cue' });
    const engineSession = (joined.data as { data: { engine_session: string } }).data.engine_session;
    const session = signedIn.session!;

    const opened = context.waitForEvent('page');
    expect(
      await sendFromApp({
        type: 'handover',
        room_id: room.id,
        slug: room.slug,
        source: 'netflix',
        content_ref: WATCH_URL,
        engine_session: engineSession,
        session: { access_token: session.access_token, refresh_token: session.refresh_token },
      }),
    ).toEqual({ type: 'handover_ok' });
    const tab = await opened;
    const panel = await panelOf(tab);
    await expect(panel.getByTestId('room-title')).toHaveText('Extension check', { timeout: 20_000 });
    await expect(panel.getByRole('tab', { name: /People/ })).toBeVisible();
    // The content script found the stub's video element and the engine reports through the panel.
    await expect(panel.getByTestId('sync-status')).toContainText('Paused');
    if (process.env.EXTENSION_E2E_SCREENSHOT) await tab.screenshot({ path: process.env.EXTENSION_E2E_SCREENSHOT });

    // The panel took over the engine session and switched the member to auto sync.
    await expect
      .poll(async () => (await admin.from('room_members').select('sync_mode').eq('room_id', room.id).eq('user_id', userId).single()).data?.sync_mode)
      .toBe('auto');

    // Taking it back stops the panel and returns a token pair that still works.
    const returned = (await reclaim(room.id)) as { type: string; session: { access_token: string; refresh_token: string } };
    expect(returned.type).toBe('return');
    await expect(panel.getByTestId('panel-message')).toContainText('Watching back on the room page');
    const back = createClient(stack!.url, stack!.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const restored = await back.auth.setSession(returned.session);
    expect(restored.error).toBeNull();
    expect(restored.data.user?.id).toBe(userId);
  } finally {
    await admin.auth.admin.deleteUser(userId);
  }
});
