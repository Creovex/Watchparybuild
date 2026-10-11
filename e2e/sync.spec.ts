import { expect, test, type Browser, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  clientFor,
  closeAll,
  createRoom,
  enterRoom,
  expectedAt,
  newUser,
  playback,
  serverOffset,
  signedIn,
  stubAct,
  stubPosition,
  waitForStub,
  type Member,
} from './helpers';

// Sync tests drive the stub adapter: an HTML video of a local test file, so they run headless
// without YouTube. Real YouTube is covered by device rows D1, D2 and D9.

async function drift(page: Page, client: SupabaseClient, roomId: string, offset: number): Promise<number> {
  const row = await playback(client, roomId);
  const { position, at } = await stubPosition(page);
  return position - expectedAt(row, at + offset);
}

async function setup(browser: Browser, control: 'host' | 'everyone' = 'host') {
  const [hostUser, guestUser] = await Promise.all([newUser('Ana Lindqvist'), newUser('Jamie Moss')]);
  const hostClient = await clientFor(hostUser);
  const room = await createRoom(hostClient, { title: 'Sync room', control_mode: control, content_ref: 'aaaaaaaaaaa' });
  const host = await signedIn(browser, hostUser);
  const guest = await signedIn(browser, guestUser);
  await enterRoom(host, room.path);
  await enterRoom(guest, room.path);
  await Promise.all([waitForStub(host.page), waitForStub(guest.page)]);
  const offset = await serverOffset(hostClient);
  return { host, guest, room, hostClient, offset };
}

test('E4: after the host plays, pauses and seeks to 120 seconds, the guest is within 0.6 seconds of expected 3 seconds later', async ({ browser }) => {
  const { host, guest, room, hostClient, offset } = await setup(browser);
  try {
    await stubAct(host.page, 'play');
    await host.page.waitForTimeout(3000);
    expect(Math.abs(await drift(guest.page, hostClient, room.id, offset))).toBeLessThanOrEqual(0.6);
    expect((await stubPosition(guest.page)).paused).toBe(false);

    await stubAct(host.page, 'pause');
    await host.page.waitForTimeout(3000);
    expect(Math.abs(await drift(guest.page, hostClient, room.id, offset))).toBeLessThanOrEqual(0.6);
    expect((await stubPosition(guest.page)).paused).toBe(true);

    await stubAct(host.page, { seek: 120 });
    await host.page.waitForTimeout(3000);
    expect(Math.abs(await drift(guest.page, hostClient, room.id, offset))).toBeLessThanOrEqual(0.6);
    expect((await stubPosition(guest.page)).position).toBeGreaterThan(119);
  } finally {
    await closeAll(host, guest);
  }
});

test('E5: in host control mode a guest pause is undone within 1 second and the host is unaffected', async ({ browser }) => {
  const { host, guest, room, hostClient } = await setup(browser, 'host');
  try {
    await stubAct(host.page, 'play');
    await expect.poll(async () => (await stubPosition(guest.page)).paused, { timeout: 5000 }).toBe(false);
    await guest.page.waitForTimeout(1000);
    await stubAct(guest.page, 'pause');
    await expect.poll(async () => (await stubPosition(guest.page)).paused, { timeout: 1000, intervals: [100] }).toBe(false);
    await expect(guest.page.getByText('Only the host controls playback.')).toBeVisible();
    expect((await stubPosition(host.page)).paused).toBe(false);
    expect((await playback(hostClient, room.id)).status).toBe('playing');
  } finally {
    await closeAll(host, guest);
  }
});

test('E12: wait for everyone pauses for a buffering guest, resumes after, and never resumes a host pause', async ({ browser }) => {
  const { host, guest, room, hostClient } = await setup(browser, 'host');
  let members: Member[] = [host, guest];
  try {
    await stubAct(host.page, 'play');
    await expect.poll(async () => (await playback(hostClient, room.id)).status).toBe('playing');
    await host.page.waitForTimeout(1500);

    const stalledAt = Date.now();
    await guest.page.evaluate(() => window.__stub?.setBuffering(true));
    await expect
      .poll(async () => (await playback(hostClient, room.id)).paused_reason, { timeout: 3000, intervals: [100] })
      .toBe('buffer');
    expect(Date.now() - stalledAt).toBeLessThanOrEqual(3000);
    await expect(host.page.getByTestId('chat-log').getByText(/Waiting for .* to catch up/)).toBeVisible();

    const recoveredAt = Date.now();
    await guest.page.evaluate(() => window.__stub?.setBuffering(false));
    await expect.poll(async () => (await playback(hostClient, room.id)).status, { timeout: 3000, intervals: [100] }).toBe('playing');
    expect(Date.now() - recoveredAt).toBeLessThanOrEqual(3000);

    await stubAct(host.page, 'pause');
    await expect.poll(async () => (await playback(hostClient, room.id)).paused_reason).toBe('user');
    await host.page.waitForTimeout(3000);
    const row = await playback(hostClient, room.id);
    expect(row.status).toBe('paused');
    expect(row.paused_reason).toBe('user');
  } finally {
    await closeAll(...members);
    members = [];
  }
});
