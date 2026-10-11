import { expect, test } from '@playwright/test';
import { clientFor, closeAll, createRoom, enterRoom, newUser, signedIn } from './helpers';

// Chromium runs with fake media devices (playwright.config.ts): a test tone stands in for each
// microphone, so mesh voice can connect and speaking detection can fire headless. The local stack's
// turn-credentials returns STUN only (TURN_TEST_MODE), which is enough on one machine.

test('E7: mesh voice reaches connected for both members and speaking fires for the fake audio', async ({ browser }) => {
  const [hostUser, guestUser] = await Promise.all([newUser('Ana Lindqvist'), newUser('Jamie Moss')]);
  const room = await createRoom(await clientFor(hostUser), { title: 'E7 voice room' });
  const host = await signedIn(browser, hostUser);
  const guest = await signedIn(browser, guestUser);
  try {
    await host.context.grantPermissions(['microphone', 'camera']);
    await guest.context.grantPermissions(['microphone', 'camera']);
    await enterRoom(host, room.path);
    await enterRoom(guest, room.path);

    for (const m of [host, guest]) {
      await m.page.getByTestId('join-voice').click();
      await m.page.getByTestId('confirm-join-voice').click();
    }
    for (const m of [host, guest]) {
      await expect(m.page.locator('[data-voice-state]')).toHaveAttribute('data-voice-state', 'connected', { timeout: 20_000 });
    }
    // Speaking fires for the other member's fake microphone.
    await expect(host.page.locator(`[data-testid=seat][data-user="${guestUser.id}"]`)).toHaveAttribute('data-speaking', 'true', {
      timeout: 15_000,
    });
    await expect(guest.page.locator(`[data-testid=seat][data-user="${hostUser.id}"]`)).toHaveAttribute('data-speaking', 'true', {
      timeout: 15_000,
    });
  } finally {
    await closeAll(host, guest);
  }
});
