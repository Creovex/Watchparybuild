import { expect, test, type Page } from '@playwright/test';
import { clientFor, closeAll, createRoom, enterRoom, newUser, rpc, signedIn, sql, stack, type Member } from './helpers';

async function openMemberMenu(page: Page, name: string) {
  await page.getByRole('tab', { name: /People/ }).click();
  await page.getByRole('button', { name: `Options for ${name}` }).click();
}

async function confirmIn(page: Page, action: string, confirm: string) {
  await page.getByRole('button', { name: action }).click();
  await page.getByRole('button', { name: confirm, exact: true }).click();
}

async function roomSettings(page: Page) {
  await page.getByTestId('room-settings').click();
  await expect(page.getByRole('dialog', { name: 'Room settings' })).toBeVisible();
}

test('E8: the host removes, then bans a guest; the guest cannot rejoin or join the new topics', async ({ browser }) => {
  const [hostUser, guestUser] = await Promise.all([newUser('Ana Lindqvist'), newUser('Jamie Moss')]);
  const room = await createRoom(await clientFor(hostUser), { title: 'E8 room' });
  const host = await signedIn(browser, hostUser);
  const guest = await signedIn(browser, guestUser);
  try {
    await enterRoom(host, room.path);
    await enterRoom(guest, room.path);

    await openMemberMenu(host.page, 'Jamie Moss');
    await confirmIn(host.page, 'Remove from room', 'Remove');
    await expect(guest.page.getByTestId('room-fatal')).toContainText('You were removed from this room.');

    await openMemberMenu(host.page, 'Jamie Moss');
    await confirmIn(host.page, 'Ban from room', 'Ban');

    await guest.page.goto(room.path);
    await guest.page.getByRole('button', { name: 'Take your seat' }).click();
    await expect(guest.page.getByTestId('join-error')).toHaveText("You can't join this room.");

    // Realtime: the banned guest is refused the topics of the room's current epoch.
    const [epochRow] = await sql<{ channel_epoch: number }>('select channel_epoch from public.rooms where id = $1', [room.id]);
    const channel_epoch = epochRow!.channel_epoch;
    expect(channel_epoch).toBeGreaterThan(1);
    const guestClient = await clientFor(guestUser);
    await guestClient.realtime.setAuth();
    const status = await new Promise<string>((resolve) => {
      const channel = guestClient.channel(`room:${room.id}:${channel_epoch}:server`, { config: { private: true } });
      channel.subscribe((s) => {
        if (s !== 'SUBSCRIBED' && s !== 'CHANNEL_ERROR' && s !== 'TIMED_OUT') return;
        resolve(s);
      });
      setTimeout(() => resolve('TIMED_OUT'), 8000);
    });
    expect(status).not.toBe('SUBSCRIBED');
    await guestClient.removeAllChannels();
  } finally {
    await closeAll(host, guest);
  }
});

test('E9: the present guest who joined first becomes host when the host leaves, and when the host goes absent', async ({ browser }) => {
  const [hostUser, guestUser] = await Promise.all([newUser('Ana Lindqvist'), newUser('Jamie Moss')]);
  const hostClient = await clientFor(hostUser);

  // The host leaves.
  const first = await createRoom(hostClient, { title: 'E9 leave room' });
  let host = await signedIn(browser, hostUser);
  let guest = await signedIn(browser, guestUser);
  try {
    await enterRoom(host, first.path);
    await enterRoom(guest, first.path);
    await host.page.getByTestId('leave-room').click();
    await host.page.waitForURL('**/home');
    await expect(guest.page.getByTestId('room-settings')).toBeVisible({ timeout: 10_000 });
  } finally {
    await closeAll(host, guest);
  }

  // The host goes absent and the scheduled job runs.
  const second = await createRoom(hostClient, { title: 'E9 absent room' });
  host = await signedIn(browser, hostUser);
  guest = await signedIn(browser, guestUser);
  try {
    await enterRoom(host, second.path);
    await enterRoom(guest, second.path);
    await host.context.close();
    await sql(`update public.room_members set last_seen_at = now() - interval '2 minutes' where room_id = $1 and user_id = $2`, [
      second.id,
      hostUser.id,
    ]);
    await sql('select public.handover_absent_hosts()');
    await expect(guest.page.getByTestId('room-settings')).toBeVisible({ timeout: 10_000 });
    const [row] = await sql<{ host_id: string }>('select host_id from public.rooms where id = $1', [second.id]);
    expect(row?.host_id).toBe(guestUser.id);
  } finally {
    await closeAll(host, guest);
  }
});

test('E13: lock refuses a new user and readmits a former member; a muted member gets voice_muted; close reaches everyone', async ({ browser }) => {
  const [hostUser, formerUser, newcomerUser] = await Promise.all([newUser('Ana Lindqvist'), newUser('Jamie Moss'), newUser('Sam Okafor')]);
  const room = await createRoom(await clientFor(hostUser), { title: 'E13 room' });
  const host = await signedIn(browser, hostUser);
  const former = await signedIn(browser, formerUser);
  const newcomer = await signedIn(browser, newcomerUser);
  try {
    await enterRoom(host, room.path);
    await enterRoom(former, room.path);
    await former.page.getByTestId('leave-room').click();
    await former.page.waitForURL('**/home');

    await roomSettings(host.page);
    await host.page.getByRole('switch', { name: 'Lock the room' }).click();
    await expect(host.page.getByRole('switch', { name: 'Lock the room' })).toHaveAttribute('aria-checked', 'true');
    await host.page.keyboard.press('Escape');

    await newcomer.page.goto(room.path);
    await newcomer.page.getByRole('button', { name: 'Take your seat' }).click();
    await expect(newcomer.page.getByTestId('join-error')).toHaveText(
      'The host has locked this room, so only people who were here before can come in.',
    );
    await enterRoom(former, room.path);

    // Mute voice: the muted member's turn-credentials call is refused.
    await openMemberMenu(host.page, 'Jamie Moss');
    await host.page.getByRole('button', { name: 'Mute voice' }).click();
    await expect.poll(async () => (await sql<{ voice_muted: boolean }>('select voice_muted from public.room_members where room_id = $1 and user_id = $2', [room.id, formerUser.id]))[0]?.voice_muted).toBe(true);
    const [sessionRow] = await sql<{ engine_session: string }>(
      'select engine_session from public.room_members where room_id = $1 and user_id = $2',
      [room.id, formerUser.id],
    );
    const engine_session = sessionRow!.engine_session;
    const formerClient = await clientFor(formerUser);
    const token = (await formerClient.auth.getSession()).data.session!.access_token;
    const response = await fetch(`${stack().url}/functions/v1/turn-credentials`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, apikey: stack().anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ room_id: room.id, engine_session }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ ok: false, code: 'voice_muted' });

    // Close: every member sees the sentence.
    await roomSettings(host.page);
    await host.page.getByRole('button', { name: 'Close room' }).click();
    await host.page.getByRole('button', { name: 'Close room' }).last().click();
    await expect(former.page.getByTestId('room-fatal')).toContainText('This room was closed.');
    await expect(host.page.getByTestId('room-fatal')).toContainText('This room was closed.');
  } finally {
    await closeAll(host, former, newcomer);
  }
});

test('E14: host transfer, mute, key rotation, remove and allow back, delete, report, second context, account deletion', async ({ browser }) => {
  const [aUser, bUser, cUser] = await Promise.all([newUser('Ana Lindqvist'), newUser('Jamie Moss'), newUser('Sam Okafor')]);
  const room = await createRoom(await clientFor(aUser), { title: 'E14 room', visibility: 'private' });
  const a = await signedIn(browser, aUser);
  const b = await signedIn(browser, bUser);
  const c = await signedIn(browser, cUser);
  const extra: Member[] = [];
  try {
    for (const m of [a, b, c]) await enterRoom(m, room.path);

    // Transfer host A to B and back.
    await openMemberMenu(a.page, 'Jamie Moss');
    await a.page.getByRole('button', { name: 'Make host' }).click();
    await expect(b.page.getByTestId('room-settings')).toBeVisible();
    await expect(a.page.getByTestId('room-settings')).toBeHidden();
    await openMemberMenu(b.page, 'Ana Lindqvist');
    await b.page.getByRole('button', { name: 'Make host' }).click();
    await expect(a.page.getByTestId('room-settings')).toBeVisible();

    // Mute then unmute C.
    await openMemberMenu(a.page, 'Sam Okafor');
    await a.page.getByRole('button', { name: 'Mute voice' }).click();
    await expect(b.page.locator(`[data-testid=seat][data-user="${cUser.id}"]`).getByTitle('Muted by host')).toBeVisible();
    await openMemberMenu(a.page, 'Sam Okafor');
    await a.page.getByRole('button', { name: 'Unmute voice' }).click();
    await expect(b.page.locator(`[data-testid=seat][data-user="${cUser.id}"]`).getByTitle('Muted by host')).toBeHidden();

    // Rotate the key: the old private link is refused for someone new.
    await roomSettings(a.page);
    await a.page.getByRole('button', { name: 'Make a new link' }).click();
    await a.page.getByRole('button', { name: 'Make new link' }).click();
    await expect(a.page.getByTestId('host-room-link')).not.toHaveText(room.link);
    await expect(a.page.getByTestId('host-room-link')).toContainText('#k=');
    const newLink = new URL(await a.page.getByTestId('host-room-link').innerText());
    await a.page.keyboard.press('Escape');
    const outsider = await newUser('Kit Duarte');
    const outsiderJoin = await rpc(await clientFor(outsider), 'join_room', {
      slug: room.slug,
      join_key: new URL(room.link).hash.replace('#k=', ''),
      sync_mode: 'auto',
    });
    expect(outsiderJoin).toMatchObject({ ok: false, code: 'bad_key' });

    // Remove C, allow back, C rejoins.
    await openMemberMenu(a.page, 'Sam Okafor');
    await confirmIn(a.page, 'Remove from room', 'Remove');
    await expect(c.page.getByTestId('room-fatal')).toContainText('You were removed from this room.');
    await openMemberMenu(a.page, 'Sam Okafor');
    await a.page.getByRole('button', { name: 'Allow back in' }).click();
    await enterRoom(c, `${newLink.pathname}${newLink.hash}`);

    // C sends and deletes a message.
    await c.page.getByTestId('chat-input').fill('This one goes');
    await c.page.getByTestId('chat-input').press('Enter');
    await expect(a.page.getByTestId('chat-log').getByText('This one goes')).toBeVisible();
    await c.page.getByRole('button', { name: 'Options for your message' }).last().click();
    await c.page.getByRole('button', { name: 'Delete message' }).click();
    await expect(a.page.getByTestId('chat-log').getByText('This one goes')).toBeHidden();

    // C sends a message that stays, B reports C.
    await c.page.getByTestId('chat-input').fill('Still here');
    await c.page.getByTestId('chat-input').press('Enter');
    await expect(b.page.getByTestId('chat-log').getByText('Still here')).toBeVisible();
    await openMemberMenu(b.page, 'Sam Okafor');
    await b.page.getByRole('button', { name: 'Report Sam Okafor' }).click();
    await b.page.getByText('Spam', { exact: true }).click();
    await b.page.getByRole('button', { name: 'Send report' }).click();
    await expect(b.page.getByText('Report sent. Thank you.')).toBeVisible();
    const reports = await sql('select * from public.reports where room_id = $1 and target_user_id = $2', [room.id, cUser.id]);
    expect(reports).toHaveLength(1);

    // B opens the room in a second browser context: the first shows the sentence.
    const b2 = await signedIn(browser, bUser);
    extra.push(b2);
    await enterRoom(b2, `/r/${room.slug}`);
    await expect(b.page.getByTestId('room-fatal')).toContainText('You opened this room somewhere else.', { timeout: 30_000 });

    // C deletes their account: their messages show "Deleted user".
    const cClient = await clientFor(cUser);
    const { error } = await cClient.functions.invoke('delete-account', { body: {} });
    expect(error).toBeNull();
    await a.page.reload();
    await expect(a.page.getByTestId('chat-log').getByText('Deleted user').first()).toBeVisible({ timeout: 20_000 });
  } finally {
    await closeAll(a, b, c, ...extra);
  }
});
