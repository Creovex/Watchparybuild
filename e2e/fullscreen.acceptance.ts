import { test, expect } from '@playwright/test';

test('fullscreen fills the screen and preserves the playing video', async ({ page }) => {
  await page.goto('/');
  const video = page.getByTestId('movie-video');
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThanOrEqual(2);
  expect(await video.getAttribute('controlsList')).not.toContain('nofullscreen');
  await video.evaluate(async (v: HTMLVideoElement) => {
    (window as unknown as { originalVideo: HTMLVideoElement }).originalVideo = v;
    await v.play();
  });
  const before = await video.evaluate((v: HTMLVideoElement) => v.currentTime);
  await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Exit fullscreen', exact: true })).toBeVisible();
  const stage = page.getByTestId('movie-screen');
  const box = await stage.boundingBox();
  expect(box).toMatchObject({ x: 0, y: 0, width: 1280, height: 720 });
  expect(await page.evaluate(() => document.elementFromPoint(1250, 360)?.closest('[data-testid="movie-screen"]') !== null)).toBe(true);
  expect(await video.evaluate(v => v === (window as unknown as { originalVideo: HTMLVideoElement }).originalVideo)).toBe(true);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(before);
  await page.screenshot({ path: '/tmp/synvello-fullscreen-desktop.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Fullscreen', exact: true })).toBeFocused();
  expect((await stage.boundingBox())!.width).toBeLessThan(1280);
  expect(await page.locator('aside').evaluate(el => (el as HTMLElement).inert)).toBe(false);
});

test('a rejected fullscreen request has a working, escapable fallback', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
    HTMLElement.prototype.requestFullscreen = async () => { throw new Error('Denied'); };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('video fills this window');
  await expect(page.getByRole('dialog', { name: 'Expanded movie' })).toBeVisible();
  expect(await page.locator('aside').evaluate(el => (el as HTMLElement).inert)).toBe(true);
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Fullscreen', exact: true })).toBeFocused();
});

test('browsers without the fullscreen API can expand in landscape', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.addInitScript(() => { Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { value: undefined }); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  const box = await page.getByTestId('movie-screen').boundingBox();
  expect(box).toMatchObject({ x: 0, y: 0, width: 844, height: 390 });
  const videoBox = await page.getByTestId('movie-video').boundingBox();
  expect(videoBox!.y + videoBox!.height).toBeLessThanOrEqual(390);
  await page.screenshot({ path: '/tmp/synvello-fullscreen-landscape.png' });
});

test('native fullscreen events update enter and exit controls', async ({ page }) => {
  // Verify the API event contract independently of the browser fullscreen policy.
  await page.addInitScript(() => {
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
    HTMLElement.prototype.requestFullscreen = async function () {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: this });
      document.dispatchEvent(new Event('fullscreenchange'));
    };
    document.exitFullscreen = async () => {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
      document.dispatchEvent(new Event('fullscreenchange'));
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Exit fullscreen', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => document.fullscreenElement?.getAttribute('data-testid'))).toBe('movie-screen');
  await page.getByRole('button', { name: 'Exit fullscreen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Fullscreen', exact: true })).toHaveAttribute('aria-pressed', 'false');
});

for (const size of [{ width: 1280, height: 720 }, { width: 1280, height: 450 }, { width: 1024, height: 600 }, { width: 900, height: 560 }, { width: 390, height: 844 }]) {
  test(`profiles and reactions do not overlap the player at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.goto('/?layout');
    const stage = page.getByTestId('movie-screen');
    const band = page.getByTestId('reaction-band');
    const people = page.getByRole('list', { name: 'People here' });
    const stageBox = (await stage.boundingBox())!;
    const bandBox = (await band.boundingBox())!;
    const peopleBox = (await people.boundingBox())!;
    expect(bandBox.y + bandBox.height).toBeLessThanOrEqual(stageBox.y + stageBox.height + 1);
    expect(peopleBox.y).toBeGreaterThanOrEqual(bandBox.y + bandBox.height - 1);
    await page.getByRole('button', { name: 'React', exact: true }).click();
    await page.getByRole('button', { name: 'Send reaction' }).click();
    // Freeze each point in the real CSS animation; check the emoji's entire rectangle.
    for (const time of [240, 1000, 1500]) {
      const bounds = await band.evaluate((el, time) => {
        const emoji = el.querySelector('span.animate-rise')!;
        const animation = emoji.getAnimations()[0]; animation.pause(); animation.currentTime = time;
        const b = el.getBoundingClientRect(), e = emoji.getBoundingClientRect();
        return { top: e.top - b.top, bottom: b.bottom - e.bottom };
      }, time);
      expect(bounds.top).toBeGreaterThanOrEqual(0);
      expect(bounds.bottom).toBeGreaterThanOrEqual(0);
    }
    await page.getByRole('button', { name: 'React', exact: true }).click();
    await people.scrollIntoViewIfNeeded();
    expect(await page.getByTestId('seat').evaluate(el => {
      const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + 10));
    })).toBe(true);
    await page.screenshot({ path: `/tmp/synvello-layout-${size.width}-${size.height}.png` });
  });
}
