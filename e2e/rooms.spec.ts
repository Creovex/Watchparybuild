import { expect, test } from '@playwright/test';
import { clientFor, closeAll, createRoom, enterRoom, newUser, rpc, setPlan, signedIn, type Member } from './helpers';

test('E1: a second user opens a public room link and both see each other in People within 3 seconds', async ({ browser }) => {
  const [hostUser, guestUser] = await Promise.all([newUser('Ana Lindqvist'), newUser('Jamie Moss')]);
  const room = await createRoom(await clientFor(hostUser), { title: 'E1 public room' });
  const host = await signedIn(browser, hostUser);
  const guest = await signedIn(browser, guestUser, { width: 390, height: 844 });
  try {
    await enterRoom(host, room.path);
    await enterRoom(guest, room.path);
    await host.page.getByRole('tab', { name: /People/ }).click();
    await guest.page.getByRole('tab', { name: /People/ }).click();
    await expect(host.page.locator(`[data-testid=member][data-user="${guestUser.id}"]`)).toBeVisible({ timeout: 3000 });
    await expect(guest.page.locator(`[data-testid=member][data-user="${hostUser.id}"]`)).toBeVisible({ timeout: 3000 });
  } finally {
    await closeAll(host, guest);
  }
});

test('E2: a private room refuses no key and a wrong key with the bad_key sentence, then admits the right key', async ({ browser }) => {
  const [hostUser, guestUser] = await Promise.all([newUser('Ana Lindqvist'), newUser('Jamie Moss')]);
  const room = await createRoom(await clientFor(hostUser), { title: 'E2 private room', visibility: 'private' });
  const guest = await signedIn(browser, guestUser);
  const sentence = 'This private room link is missing its key or the key has changed. Ask the host for a new link.';
  try {
    await guest.page.goto(`/r/${room.slug}`);
    await guest.page.getByRole('button', { name: 'Take your seat' }).click();
    await expect(guest.page.getByTestId('join-error')).toHaveText(sentence);

    await guest.page.goto(`/r/${room.slug}#k=not-the-right-key`);
    await guest.page.getByRole('button', { name: 'Take your seat' }).click();
    await expect(guest.page.getByTestId('join-error')).toHaveText(sentence);
    // The key never stays in the address bar.
    expect(guest.page.url()).not.toContain('#k=');

    await enterRoom(guest, room.path);
    await expect(guest.page.getByTestId('room-title')).toHaveText('E2 private room');
  } finally {
    await closeAll(guest);
  }
});

test('E3: with a free host and 2 guests present, a fourth user sees the room_full sentence', async ({ browser }) => {
  const users = await Promise.all(['Ana Lindqvist', 'Jamie Moss', 'Sam Okafor', 'Kit Duarte'].map(newUser));
  const room = await createRoom(await clientFor(users[0]!), { title: 'E3 free room' });
  const members: Member[] = [];
  try {
    for (const user of users.slice(0, 3)) {
      const m = await signedIn(browser, user);
      await enterRoom(m, room.path);
      members.push(m);
    }
    const fourth = await signedIn(browser, users[3]!);
    members.push(fourth);
    await fourth.page.goto(room.path);
    await expect(fourth.page.getByTestId('join-error')).toHaveText(
      'This room is full (3 of 3). Rooms of 10 come with paid plans, coming soon.',
    );
    await expect(fourth.page.getByRole('button', { name: 'Room is full' })).toBeDisabled();
    const res = await rpc(await clientFor(users[3]!), 'join_room', { slug: room.slug, join_key: null, sync_mode: 'auto' });
    expect(res).toMatchObject({ ok: false, code: 'room_full' });
  } finally {
    await closeAll(...members);
  }
});

test('E11: a paid host room admits ten present members and the eleventh sees room_full', async ({ browser }) => {
  const users = await Promise.all(Array.from({ length: 11 }, (_, i) => newUser(`Member ${String.fromCharCode(65 + i)}`)));
  await setPlan(users[0]!.id, 'paid');
  const room = await createRoom(await clientFor(users[0]!), { title: 'E11 paid room' });
  for (const user of users.slice(1, 10)) {
    const res = await rpc(await clientFor(user), 'join_room', { slug: room.slug, join_key: null, sync_mode: 'auto' });
    expect(res.ok, `join for ${user.name}`).toBe(true);
  }
  const eleventh = await signedIn(browser, users[10]!);
  try {
    await eleventh.page.goto(room.path);
    await expect(eleventh.page.getByTestId('join-error')).toHaveText('This room is full (10 of 10).');
    const res = await rpc(await clientFor(users[10]!), 'join_room', { slug: room.slug, join_key: null, sync_mode: 'auto' });
    expect(res).toMatchObject({ ok: false, code: 'room_full' });
  } finally {
    await closeAll(eleventh);
  }
});
