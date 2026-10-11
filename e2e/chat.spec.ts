import { expect, test } from '@playwright/test';
import { clientFor, closeAll, createRoom, enterRoom, newUser, signedIn, stubAct, waitForStub } from './helpers';

test('E6: chat arrives within 1 second, a timed comment reappears when the other member passes it, reactions float', async ({ browser }) => {
  const [hostUser, guestUser] = await Promise.all([newUser('Ana Lindqvist'), newUser('Jamie Moss')]);
  const room = await createRoom(await clientFor(hostUser), { title: 'E6 chat room', content_ref: 'aaaaaaaaaaa', control_mode: 'everyone' });
  const host = await signedIn(browser, hostUser);
  const guest = await signedIn(browser, guestUser);
  try {
    await enterRoom(host, room.path);
    await enterRoom(guest, room.path);
    await Promise.all([waitForStub(host.page), waitForStub(guest.page)]);

    // Chat: under a second, measured from pressing send.
    await guest.page.getByTestId('chat-input').fill('Popcorn ready');
    const sentAt = Date.now();
    await guest.page.getByTestId('chat-input').press('Enter');
    await expect(host.page.getByTestId('chat-log').getByText('Popcorn ready')).toBeVisible({ timeout: 1000 });
    expect(Date.now() - sentAt).toBeLessThanOrEqual(1000);

    // Timed comment: pinned at the guest's position, shown again when the host passes it.
    await stubAct(host.page, { seek: 10 });
    await host.page.waitForTimeout(1500);
    await guest.page.getByTestId('pin-toggle').click();
    await guest.page.getByTestId('chat-input').fill('Watch this bit');
    await guest.page.getByTestId('chat-input').press('Enter');
    await expect(host.page.getByTestId('chat-log').getByText('Watch this bit')).toBeVisible();
    await stubAct(host.page, { seek: 7 });
    await host.page.waitForTimeout(800);
    await stubAct(host.page, 'play');
    await expect(host.page.getByTestId('timed-popup')).toContainText('Watch this bit', { timeout: 8000 });

    // Reaction: shown to the other member.
    await guest.page.getByRole('button', { name: 'React' }).click();
    await guest.page.getByRole('button', { name: 'Popcorn' }).click();
    await expect(host.page.getByTestId('reaction-band').getByText('🍿')).toBeVisible({ timeout: 1000 });
  } finally {
    await closeAll(host, guest);
  }
});

test('E10: the sixth message inside 5 seconds shows the rate_limited sentence', async ({ browser }) => {
  const user = await newUser('Ana Lindqvist');
  const room = await createRoom(await clientFor(user), { title: 'E10 chat room' });
  const member = await signedIn(browser, user);
  try {
    await enterRoom(member, room.path);
    const input = member.page.getByTestId('chat-input');
    for (let i = 1; i <= 6; i++) {
      await input.fill(`Message ${i}`);
      await input.press('Enter');
      if (i < 6) await expect(member.page.getByTestId('chat-log').getByText(`Message ${i}`, { exact: true })).toBeVisible();
    }
    await expect(member.page.getByText("You're sending messages too fast. Wait a few seconds.")).toBeVisible();
  } finally {
    await closeAll(member);
  }
});
