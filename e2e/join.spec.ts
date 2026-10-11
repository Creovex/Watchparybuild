import { expect, test } from '@playwright/test';
import { clientFor, closeAll, createRoom, newUser, signedIn } from './helpers';

// An app added to the iPhone home screen has no address bar, so the rooms page takes a pasted link.
test('E15: pasting a private room link on the rooms page joins the room, and junk is refused', async ({ browser }) => {
  const [hostUser, guestUser] = await Promise.all([newUser('Ana Lindqvist'), newUser('Jamie Moss')]);
  const room = await createRoom(await clientFor(hostUser), { title: 'E15 pasted link room', visibility: 'private' });
  const guest = await signedIn(browser, guestUser, { width: 390, height: 844 });
  try {
    const box = guest.page.getByTestId('join-link');
    await box.fill('not a room link');
    await guest.page.getByRole('button', { name: 'Join', exact: true }).click();
    await expect(guest.page.getByText('That is not a room link.')).toBeVisible();
    await expect(guest.page).toHaveURL(/\/home$/);

    // The whole link as it was sent, with spaces around it, as a paste often has.
    await box.fill(`  ${room.link}  `);
    await guest.page.getByRole('button', { name: 'Join', exact: true }).click();
    await guest.page.waitForURL(`**/r/${room.slug}`);
    const seat = guest.page.getByRole('button', { name: 'Take your seat' });
    await expect(seat).toBeVisible({ timeout: 20_000 });
    await seat.click();
    await expect(guest.page.getByTestId('room-title')).toHaveText('E15 pasted link room', { timeout: 20_000 });
  } finally {
    await closeAll(guest);
  }
});
