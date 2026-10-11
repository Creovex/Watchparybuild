import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Client as PgClient } from 'pg';

// Shared helpers for the end to end tests. Test users are created with the Supabase admin API on
// the local stack and sign in with email and password, which only the local stack allows.

interface Stack {
  url: string;
  anonKey: string;
  serviceKey: string;
}

let cached: Stack | null = null;
export function stack(): Stack {
  if (!cached) cached = JSON.parse(readFileSync(join(__dirname, '.auth', 'stack.json'), 'utf8')) as Stack;
  return cached;
}

/** Where Edge Functions answer: the local stack's gateway, or the local functions server (gap G33). */
export function functionsUrl(): string {
  return process.env.E2E_FUNCTIONS_URL ?? `${stack().url}/functions/v1`;
}

export async function callFunction(client: SupabaseClient, name: string, body: unknown): Promise<Response> {
  const token = (await client.auth.getSession()).data.session?.access_token ?? '';
  return fetch(`${functionsUrl()}/${name}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: stack().anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function admin(): SupabaseClient {
  return createClient(stack().url, stack().serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Runs SQL as the database owner on the local stack, for test setup only. */
export async function sql<T = Record<string, unknown>>(query: string, params: unknown[] = []): Promise<T[]> {
  const client = new PgClient({ connectionString: process.env.E2E_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres' });
  await client.connect();
  try {
    const res = await client.query(query, params);
    return res.rows as T[];
  } finally {
    await client.end();
  }
}

export interface TestUser {
  id: string;
  email: string;
  password: string;
  name: string;
}

let counter = 0;
export async function newUser(name: string): Promise<TestUser> {
  counter += 1;
  const slug = name.toLowerCase().replace(/[^a-z]/g, '');
  const email = `e2e-${slug}-${Date.now()}-${counter}@test.local`;
  const password = 'password123';
  const { data, error } = await admin().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: name },
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  return { id: data.user.id, email, password, name };
}

export async function clientFor(user: TestUser): Promise<SupabaseClient> {
  const client = createClient(stack().url, stack().anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await client.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw new Error(`sign in failed: ${error.message}`);
  return client;
}

export async function setPlan(userId: string, plan: 'free' | 'paid'): Promise<void> {
  await sql('update public.profiles set plan = $1 where id = $2', [plan, userId]);
}

export async function rpc<T = unknown>(client: SupabaseClient, name: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data as { ok: boolean; code?: string; data: T };
}

export interface CreatedRoom {
  id: string;
  slug: string;
  link: string;
  path: string;
}

export async function createRoom(
  client: SupabaseClient,
  opts: Partial<{ title: string; source: string; content_ref: string | null; visibility: string; control_mode: string }> = {},
): Promise<CreatedRoom> {
  const res = await rpc<{ room: { id: string; slug: string }; room_link: string }>(client, 'create_room', {
    title: opts.title ?? 'Test room',
    source: opts.source ?? 'youtube',
    content_ref: opts.content_ref === undefined ? 'dQw4w9WgXcQ' : opts.content_ref,
    visibility: opts.visibility ?? 'public',
    control_mode: opts.control_mode ?? 'host',
  });
  if (!res.ok) throw new Error(`create_room: ${res.code}`);
  const url = new URL(res.data.room_link);
  return { id: res.data.room.id, slug: res.data.room.slug, link: res.data.room_link, path: `${url.pathname}${url.hash}` };
}

export interface Member {
  user: TestUser;
  context: BrowserContext;
  page: Page;
}

/** A browser context signed in as a new or given user. */
export async function signedIn(browser: Browser, user: TestUser, viewport = { width: 1280, height: 800 }): Promise<Member> {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto('/');
  const form = page.getByTestId('dev-sign-in');
  await form.getByLabel('Email').fill(user.email);
  await form.getByLabel('Password').fill(user.password);
  await form.getByRole('button', { name: 'Sign in with email' }).click();
  await page.waitForURL('**/home');
  return { user, context, page };
}

/** Opens a room link and takes a seat when the join screen shows. Resolves once the room is live. */
export async function enterRoom(member: Member, path: string): Promise<void> {
  await member.page.goto(path);
  const seat = member.page.getByRole('button', { name: 'Take your seat' });
  const title = member.page.getByTestId('room-title');
  await expect(seat.or(title)).toBeVisible({ timeout: 20_000 });
  if (await seat.isVisible()) await seat.click();
  await expect(title).toBeVisible({ timeout: 20_000 });
  await expect(member.page.locator('[data-testid=reaction-band], [data-testid=cue-expected]').first()).toBeVisible();
}

/** Server clock offset seen from this machine, by the same five sample method the app uses. */
export async function serverOffset(client: SupabaseClient): Promise<number> {
  let best = { rtt: Number.POSITIVE_INFINITY, offset: 0 };
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const res = await rpc<number>(client, 'server_time', {});
    const t1 = Date.now();
    if (t1 - t0 < best.rtt) best = { rtt: t1 - t0, offset: res.data + (t1 - t0) / 2 - t1 };
  }
  return best.offset;
}

export interface PlaybackRow {
  seq: number;
  status: 'playing' | 'paused' | 'ended';
  position_sec: number;
  rate: number;
  server_ts: string;
  paused_reason: 'user' | 'buffer' | null;
}

export async function playback(client: SupabaseClient, roomId: string): Promise<PlaybackRow> {
  const { data, error } = await client.from('playback_state').select('*').eq('room_id', roomId).single();
  if (error) throw new Error(error.message);
  return data as PlaybackRow;
}

export function expectedAt(row: PlaybackRow, serverMs: number): number {
  const ts = Date.parse(row.server_ts);
  if (row.status === 'playing' && serverMs >= ts) return row.position_sec + ((serverMs - ts) / 1000) * row.rate;
  return row.position_sec;
}

/** The stub player's position and the local time it was read, from inside the page. */
export async function stubPosition(page: Page): Promise<{ position: number; at: number; paused: boolean }> {
  return page.evaluate(() => {
    const video = document.querySelector('[data-testid=stub-video]') as HTMLVideoElement | null;
    return { position: video?.currentTime ?? -1, at: Date.now(), paused: video?.paused ?? true };
  });
}

/** Acts on the stub player as a member would: the change reaches the app as a user action. */
export async function stubAct(page: Page, action: 'play' | 'pause' | { seek: number }): Promise<void> {
  await page.evaluate((a) => {
    const video = document.querySelector('[data-testid=stub-video]') as HTMLVideoElement;
    if (a === 'play') void video.play();
    else if (a === 'pause') video.pause();
    else video.currentTime = a.seek;
  }, action);
}

export async function waitForStub(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const video = document.querySelector('[data-testid=stub-video]') as HTMLVideoElement | null;
    return Boolean(video && video.readyState >= 1);
  });
}

export async function closeAll(...members: Array<Member | undefined>): Promise<void> {
  await Promise.all(members.filter(Boolean).map((m) => m!.context.close().catch(() => undefined)));
}
